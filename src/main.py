import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import socket
import time
import json
import customtkinter as ctk

# --- FIX CRITIQUE POUR PYINSTALLER (WINDOWED MODE) ---
class NullWriter:
    def write(self, text): pass
    def flush(self): pass
    def isatty(self): return False

if sys.stdout is None:
    sys.stdout = NullWriter()
if sys.stderr is None:
    sys.stderr = NullWriter()
# -----------------------------------------------------

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

try:
    from server import app as fastapi_app, broadcast_sync
    from config_manager import ConfigManager
    from midi_engine import MidiManager
    from action_handler import ActionHandler
    from profile_manager import ProfileManager
    from context_monitor import ContextMonitor
    from device_manager import DeviceManager
    from remote_gui import RemoteControl
    from gui import SettingsDialog, AirstepApp
except ImportError:
    from src.server import app as fastapi_app, broadcast_sync
    from src.config_manager import ConfigManager
    from src.midi_engine import MidiManager
    from src.action_handler import ActionHandler
    from src.profile_manager import ProfileManager
    from src.context_monitor import ContextMonitor
    from src.device_manager import DeviceManager
    from src.remote_gui import RemoteControl
    from src.gui import SettingsDialog, AirstepApp

# Globals
config = None
gui_app = None # AirstepApp

def find_free_port(start_port=8000, max_tries=10):
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port

def start_uvicorn(host, port):
    try:
        uvicorn.run(fastapi_app, host=host, port=port, log_level="warning")
    except Exception as e:
        with open("server_crash.log", "w") as f: f.write(str(e))

# Background services are now handled by AirstepApp or shared logic.
# We need to bridge AirstepApp events to the Web Server.

def wait_for_server(host, port, timeout=5.0):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection((host, port), timeout=1.0): return True
        except: time.sleep(0.2)
    return False

def main():
    global config, gui_app

    print("--- Démarrage AirstepStudio V3 (Hybrid) ---")

    # 1. Config Initial Load
    config = ConfigManager()

    # 2. Start Web Server (Background)
    base_port = int(config.get("app_port", 8000))
    port = find_free_port(base_port)
    server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
    server_thread.start()

    # 3. Initialize Main Native App (AirstepApp)
    # AirstepApp handles Managers, MIDI, Context, etc. internally in its __init__
    gui_app = AirstepApp()

    # Hide immediately
    gui_app.withdraw()

    # 4. Bridge: Inject App State into Server
    # We need to bridge MIDI events and Profile changes from App -> Web

    # A. Bridge Internal Commands (Media)
    def on_internal_command(cmd):
        msg = {"type": "command", "cmd": cmd}
        broadcast_sync(json.dumps(msg))

    # Check if gui_app has action_handler initialized
    if gui_app.action_handler:
        gui_app.action_handler.set_command_callback(on_internal_command)
        fastapi_app.state.action_handler = gui_app.action_handler

    fastapi_app.state.profiles = gui_app.profiles

    # B. Bridge Settings Button
    def open_settings_from_web():
        if gui_app:
            gui_app.after(0, lambda: (gui_app.deiconify(), gui_app.lift()))

    fastapi_app.state.open_settings_callback = open_settings_from_web

    # C. Bridge MIDI Events (Native -> Web)
    # AirstepApp needs a callback to us.
    # Looking at gui.py: AirstepApp.set_midi_callback(self, cb) exists? Yes.
    # But MidiManager.create takes a callback. gui.py passes self.on_data_received.
    # We need to hook into on_data_received or wrap it.

    original_on_data = gui_app.on_data_received

    def wrapped_on_data_received(cc=None, channel=None):
        # Call original (Updates Native GUI)
        original_on_data(cc, channel)
        # Broadcast to Web
        if cc is not None:
            data = {
                "type": "midi",
                "cc": cc,
                "value": 127, # Assuming press
                "message": "cc"
            }
            broadcast_sync(json.dumps(data))

    gui_app.on_data_received = wrapped_on_data_received
    # Force update the running MidiEngine with the new callback
    if gui_app.midi_engine:
        gui_app.midi_engine.callback = wrapped_on_data_received

    # D. Bridge Profile Changes (ContextMonitor -> Web)
    # gui.py implements _monitor_remote_context loop but it's for RemoteControl.
    # It seems gui.py uses a loop `_monitor_remote_context` to scan window?
    # Wait, gui.py: `self.action_handler.find_matching_profile` is called inside `_monitor_remote_context`.
    # And it updates `self.current_profile`.
    # We need to hook into when `self.current_profile` changes.
    # The provided gui.py does NOT have a robust ContextMonitor thread like the one we wrote in src/context_monitor.py.
    # It has a simple `after` loop in `open_remote_control`.

    # CRITICAL: We want the robust `ContextMonitor` from `src/context_monitor.py` running!
    # But `AirstepApp` doesn't use it by default in the provided code.
    # Solution: We instantiate and start `ContextMonitor` here in main, and use it to drive `gui_app`.

    # 5. Robust Context Monitor
    from context_monitor import ContextMonitor

    def on_profile_change(profile_data):
        # Update Web
        msg = {"type": "profile_update", "data": profile_data}
        broadcast_sync(json.dumps(msg))

        # Update Native App
        if gui_app:
            gui_app.current_profile = profile_data
            gui_app.after(0, gui_app.refresh_ui_for_profile)

            # Update ActionHandler State
            if gui_app.action_handler:
                gui_app.action_handler.set_current_profile(profile_data)

            # Update Remote if open
            if hasattr(gui_app, 'remote_win') and gui_app.remote_win:
                gui_app.remote_win.set_profile(profile_data)

    # Use managers from gui_app
    ctx_monitor = ContextMonitor(gui_app.profile_manager, gui_app.action_handler, callback=on_profile_change)
    ctx_monitor.start()
    fastapi_app.state.context_monitor = ctx_monitor # For manual override API

    # 6. Launch Browser
    if wait_for_server("127.0.0.1", port):
        url = f"http://127.0.0.1:{port}"
        try: webbrowser.open(url)
        except: pass

    print(">>> Lancement GUI Native (Main)...")
    gui_app.mainloop()

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
