import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import json

# --- 1. CONFIGURATION DU PATH ---
# Ajoute le dossier contenant ce script au Python Path.
# Cela permet de trouver les modules voisins (server.py, midi_engine.py)
# sans avoir besoin de préfixer par "src."
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# --- 2. IMPORTS ROBUSTES (Try/Except) ---
# Tente d'importer directement (Mode EXE / Flat)
# Si échoue, tente d'importer depuis src (Mode Dev)
try:
    from server import app as fastapi_app, broadcast_sync
    from config_manager import ConfigManager
    from midi_engine import MidiManager
    from action_handler import ActionHandler
    from profile_manager import ProfileManager
    from context_monitor import ContextMonitor
except ImportError:
    # Fallback pour IDE/Dev si le path n'a pas suffi
    # Note: Si sys.path est bien configuré ci-dessus, le "try" devrait réussir même en dev
    # Mais gardons ceci comme sécurité.
    from src.server import app as fastapi_app, broadcast_sync
    from src.config_manager import ConfigManager
    from src.midi_engine import MidiManager
    from src.action_handler import ActionHandler
    from src.profile_manager import ProfileManager
    from src.context_monitor import ContextMonitor

# Variable globale pour le thread serveur
server_thread = None

def start_uvicorn(host, port):
    """Lance le serveur dans un thread bloquant"""
    uvicorn.run(fastapi_app, host=host, port=port, log_level="info")

def main():
    print("--- Démarrage AirstepStudio ---")

    # 1. Chargement Config
    config = ConfigManager()
    midi_device = config.get("midi_device_name", "AIRSTEP")
    connection_mode = config.get("connection_mode", "BLE")
    # Utilisation d'un port configurable, defaut 8000
    port = int(config.get("app_port", 8000))

    print(f"Config: Device={midi_device}, Mode={connection_mode}, Port={port}")

    # 2. Profiles
    profile_mgr = ProfileManager()
    profile_mgr.migrate_legacy_config()
    profiles = profile_mgr.load_all_profiles()
    print(f"Profiles loaded: {len(profiles)}")

    # 3. Action Handler
    action_handler = ActionHandler()

    # 4. MIDI Callback
    def on_midi_message(msg):
        try:
            # Simple string representation
            display_str = str(msg)
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

    # 5. Démarrage Context Monitor
    # Detecte automatiquement le profil en fonction de la fenêtre active
    context_monitor = ContextMonitor(profile_mgr, action_handler)
    context_monitor.start()

    # 6. Démarrage Moteur MIDI
    midi_mgr = MidiManager.create(connection_mode, midi_device, on_midi_message)
    midi_mgr.start()

    # 7. Démarrage Serveur Web
    global server_thread
    server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
    server_thread.start()
    
    # 8. Ouverture Navigateur
    url = f"http://localhost:{port}"
    print(f"Ouverture : {url}")

    # Petit délai pour laisser Uvicorn se lancer
    import time
    time.sleep(1.5)
    try:
        webbrowser.open(url)
    except:
        print(f"Could not open browser automatically. Please visit {url}")

    # 9. Boucle infinie pour garder le Main Thread en vie
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Arrêt.")
        midi_mgr.stop()
        context_monitor.stop()
        sys.exit(0)

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
