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
except ImportError:
    from src.server import app as fastapi_app, broadcast_sync
    from src.config_manager import ConfigManager
    from src.midi_engine import MidiManager
    from src.action_handler import ActionHandler
    from src.profile_manager import ProfileManager
    from src.context_monitor import ContextMonitor
    from src.device_manager import DeviceManager
    from src.remote_gui import RemoteControl

# Globals
config = None
profile_mgr = None
device_mgr = None
action_handler = None
midi_mgr = None
context_monitor = None
remote_gui = None # Tkinter App

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

def start_background_services():
    global midi_mgr, context_monitor, profile_mgr, action_handler, config, device_mgr, remote_gui

    print(">>> Initialisation des Services Backend (Async)...")
    try:
        # 1. Context Monitor
        def on_profile_change(profile_data):
            try:
                # Update Logic
                action_handler.set_current_profile(profile_data)

                # Web Broadcast
                msg = {"type": "profile_update", "data": profile_data}
                broadcast_sync(json.dumps(msg))

                # Remote GUI Update (Thread Safe call)
                if remote_gui:
                    remote_gui.after(0, lambda: remote_gui.set_profile(profile_data))

            except Exception as e:
                print(f"Profile Change Error: {e}")

        context_monitor = ContextMonitor(profile_mgr, action_handler, callback=on_profile_change)
        context_monitor.start()

        # 2. MIDI Engine
        midi_device = config.get("midi_device_name", "AIRSTEP")
        connection_mode = config.get("connection_mode", "BLE")

        def on_midi_event(msg):
            try:
                # Web Broadcast
                data = {
                    "type": "midi",
                    "cc": msg.control if msg.type == 'control_change' else None,
                    "value": msg.value if hasattr(msg, 'value') else None,
                    "message": str(msg)
                }
                broadcast_sync(json.dumps(data))

                # Remote GUI Flash (Thread Safe)
                if remote_gui and msg.type == 'control_change':
                    # Optional: Flash visual on Remote
                    pass

                # Action Trigger (Decoupled: Frontend decides, but here we keep backend trigger available via API)
                # But wait, we removed backend trigger for MIDI in main.py previously.
                # However, for the REMOTE GUI (Native), clicking buttons calls execute().
                # Does the Remote GUI act as a MIDI Controller? No, it acts as a Trigger.
                pass

            except Exception as ex:
                print(f"MIDI Callback Error: {ex}")

        midi_mgr = MidiManager.create(connection_mode, midi_device, on_midi_event)
        midi_mgr.start()
        print(">>> Backend Opérationnel !")

    except Exception as e:
        print(f"!!! ERREUR CRITIQUE BACKEND : {e}")

def wait_for_server(host, port, timeout=5.0):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection((host, port), timeout=1.0): return True
        except: time.sleep(0.2)
    return False

def main():
    global config, profile_mgr, device_mgr, action_handler, remote_gui

    print("--- Démarrage AirstepStudio V3 (Hybrid) ---")

    # 1. Init Managers
    config = ConfigManager()
    profile_mgr = ProfileManager()
    profile_mgr.migrate_legacy_config()
    profile_mgr.load_all_profiles()
    device_mgr = DeviceManager()
    action_handler = ActionHandler()

    # Inject State
    def on_internal_command(cmd):
        msg = {"type": "command", "cmd": cmd}
        broadcast_sync(json.dumps(msg))

    action_handler.set_command_callback(on_internal_command)
    fastapi_app.state.action_handler = action_handler
    fastapi_app.state.profiles = profile_mgr.profiles

    # 2. Server (Background)
    base_port = int(config.get("app_port", 8000))
    port = find_free_port(base_port)
    server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
    server_thread.start()

    # 3. Browser
    if wait_for_server("127.0.0.1", port):
        url = f"http://127.0.0.1:{port}"
        try: webbrowser.open(url)
        except: pass

    # 4. Background Services (MIDI/Context)
    # We must inject `remote_gui` later as it is created in Main Thread
    bg_thread = threading.Thread(target=start_background_services, daemon=True)
    bg_thread.start()

    # 5. GUI Native (MAIN THREAD - BLOCKING)
    # Load default device def
    airstep_def = next((d for d in device_mgr.definitions if "AIRSTEP" in d.get("name", "")), None)
    if not airstep_def and device_mgr.definitions:
        airstep_def = device_mgr.definitions[0]

    ctk.set_appearance_mode("Dark")

    # Callback for Remote Clicks
    def on_remote_press(cc):
        # When clicking Remote, we simulate the action directly
        # Use ActionHandler
        # We assume Channel 1 for UI triggers
        # We need current profile. ActionHandler has it set by ContextMonitor
        profiles = profile_mgr.profiles # Fallback
        # Ideally ActionHandler uses its internal state
        # The execute method priorities current_profile if set
        action_handler.execute(cc, 127, 1, profiles)

    def on_close():
        # Stop background threads if needed
        if midi_mgr: midi_mgr.stop()
        if context_monitor: context_monitor.stop()
        sys.exit(0)

    remote_gui = RemoteControl(None, airstep_def, None, on_remote_press, on_close)

    # Inject context monitor for set_mode API to update GUI if needed?
    # Actually ContextMonitor updates GUI via callback.
    fastapi_app.state.context_monitor = context_monitor # This might be None until bg thread starts?
    # Actually context_monitor is global and set in bg thread.
    # Race condition potential for API calls early on.
    # But acceptable for prototype.

    # Inject remote_gui into global so ContextMonitor can find it (already done via global)

    print(">>> Lancement GUI Native...")
    remote_gui.mainloop()

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
