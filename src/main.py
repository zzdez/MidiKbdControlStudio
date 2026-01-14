import sys
import threading
import time
import webbrowser
import uvicorn
import json
import os

# Ensure src is in path if running from src directory (though usually run from root)
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config_manager import ConfigManager
from src.profile_manager import ProfileManager
from src.midi_engine import MidiManager
from src.action_handler import ActionHandler
from src.server import app, broadcast_sync

def main():
    print(">>> AirstepStudio Starting...")

    # 1. Config
    config = ConfigManager()
    midi_device = config.get("midi_device_name", "AIRSTEP")
    connection_mode = config.get("connection_mode", "BLE")
    
    print(f"Config: Device={midi_device}, Mode={connection_mode}")

    # 2. Profiles
    profile_mgr = ProfileManager()
    # Migrate legacy config if needed
    profile_mgr.migrate_legacy_config()

    profiles = profile_mgr.load_all_profiles()
    print(f"Profiles loaded: {len(profiles)}")

    # 3. Action Handler
    action_handler = ActionHandler()

    # 4. MIDI Callback
    def on_midi_message(msg):
        # Broadcast to Web
        try:
            # Simple string representation for now
            display_str = str(msg)

            # Format nicely for UI
            if msg.type == 'control_change':
                display_str = f"CC {msg.control} - {msg.value}"
            elif msg.type == 'note_on':
                 display_str = f"Note {msg.note} - {msg.velocity}"

            # Send JSON with message
            json_msg = json.dumps({"type": "midi", "message": display_str})
            broadcast_sync(json_msg)

            # Action Handler Logic
            if msg.type == 'control_change':
                # Mido uses 0-15, ActionHandler (and humans) use 1-16
                action_handler.execute(msg.control, msg.value, msg.channel + 1, profiles)

        except Exception as e:
            print(f"Callback Error: {e}")

    # 5. Midi Manager
    # Use existing MidiManager logic from src/midi_engine.py
    midi_mgr = MidiManager.create(connection_mode, midi_device, on_midi_message)
    midi_mgr.start()

    # 6. Server Thread
    def start_server():
        # Run Uvicorn programmatically
        # host="0.0.0.0" allows external access, "127.0.0.1" is local only
        uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # 7. Open Browser
    # Give server a moment to start
    time.sleep(1.5)
    url = "http://localhost:8000"
    print(f"Opening {url}...")
    try:
        webbrowser.open(url)
    except:
        print(f"Could not open browser automatically. Please visit {url}")
    
    # 8. Keep Main Thread Alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping...")
        midi_mgr.stop()
        sys.exit(0)

if __name__ == "__main__":
    main()
