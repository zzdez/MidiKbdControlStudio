import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import json
import time
import socket
import traceback

# --- 1. CONFIGURATION DU PATH ---
# Ajoute le dossier contenant ce script au Python Path.
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# --- 2. IMPORTS ROBUSTES (Try/Except) ---
try:
    from server import app as fastapi_app, broadcast_sync
    from config_manager import ConfigManager
    from midi_engine import MidiManager
    from action_handler import ActionHandler
    from profile_manager import ProfileManager
    from context_monitor import ContextMonitor
except ImportError:
    # Fallback pour IDE/Dev
    from src.server import app as fastapi_app, broadcast_sync
    from src.config_manager import ConfigManager
    from src.midi_engine import MidiManager
    from src.action_handler import ActionHandler
    from src.profile_manager import ProfileManager
    from src.context_monitor import ContextMonitor

# Variables globales
server_thread = None
midi_mgr = None
context_monitor = None
config = None
profile_mgr = None
action_handler = None

def find_free_port(start_port=8000, max_tries=10):
    """Cherche un port libre à partir de start_port."""
    for port in range(start_port, start_port + max_tries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    print(f"ATTENTION: Aucun port libre trouvé entre {start_port} et {start_port + max_tries}. Utilisation par défaut de {start_port}")
    return start_port

def start_uvicorn(host, port):
    """Lance le serveur dans un thread bloquant avec logging d'erreur."""
    try:
        uvicorn.run(fastapi_app, host=host, port=port, log_level="info")
    except Exception as e:
        err_msg = f"CRITICAL Uvicorn Crash: {e}\n{traceback.format_exc()}"
        print(err_msg)
        try:
            with open("server_crash.log", "w", encoding="utf-8") as f:
                f.write(err_msg)
        except: pass

def start_background_services():
    """
    Lance les services backend (MIDI, Context) en arrière-plan.
    """
    global midi_mgr, context_monitor, profile_mgr, action_handler, config

    print(">>> Initialisation des Services Backend (Async)...")
    try:
        # 2. Profiles
        print(">>> Chargement des profils...")
        profile_mgr.migrate_legacy_config()
        profiles = profile_mgr.load_all_profiles()
        print(f">>> {len(profiles)} profils chargés.")

        # 3. Context Monitor
        print(">>> Démarrage Context Monitor...")
        context_monitor = ContextMonitor(profile_mgr, action_handler)
        context_monitor.start()

        # 4. MIDI Engine
        midi_device = config.get("midi_device_name", "AIRSTEP")
        connection_mode = config.get("connection_mode", "BLE")

        print(f">>> Démarrage MIDI ({connection_mode}: {midi_device})...")

        def on_midi_message(msg):
            try:
                display_str = str(msg)
                if msg.type == 'control_change':
                    display_str = f"CC {msg.control} - {msg.value}"
                elif msg.type == 'note_on':
                     display_str = f"Note {msg.note} - {msg.velocity}"

                json_msg = json.dumps({"type": "midi", "message": display_str})
                broadcast_sync(json_msg)

                if msg.type == 'control_change':
                    action_handler.execute(msg.control, msg.value, msg.channel + 1, profiles)

            except Exception as e:
                print(f"Callback Error: {e}")

        midi_mgr = MidiManager.create(connection_mode, midi_device, on_midi_message)
        midi_mgr.start()
        print(">>> Backend Opérationnel !")

    except Exception as e:
        print(f"!!! ERREUR CRITIQUE BACKEND : {e}")

def wait_for_server(host, port, timeout=5.0):
    """Attend que le port soit ouvert avant de continuer."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except (OSError, ConnectionRefusedError):
            time.sleep(0.2)
    return False

def main():
    global server_thread, config, profile_mgr, action_handler

    print("--- Démarrage AirstepStudio (Robust) ---")

    # 1. Init Base
    config = ConfigManager()
    profile_mgr = ProfileManager()
    action_handler = ActionHandler()

    # Choix du Port
    requested_port = int(config.get("app_port", 8000))
    port = find_free_port(requested_port)
    host = "127.0.0.1"

    print(f">>> Port sélectionné : {port}")

    # 2. Démarrage Serveur Web (Thread)
    print(">>> Démarrage Serveur Web...")
    server_thread = threading.Thread(target=start_uvicorn, args=(host, port), daemon=True)
    server_thread.start()

    # 3. Vérification de vie (Smart Start)
    print(">>> Attente disponibilité serveur...")
    if wait_for_server(host, port):
        url = f"http://{host}:{port}"
        print(f">>> Serveur PRÊT. Ouverture : {url}")
        try:
            webbrowser.open(url)
        except:
            print("Impossible d'ouvrir le navigateur.")
    else:
        err_msg = "TIMEOUT: Le serveur n'a pas démarré après 5 secondes."
        print(err_msg)
        with open("server_crash.log", "a", encoding="utf-8") as f:
            f.write(f"\n{err_msg}")
        # On continue quand même pour le backend, mais l'utilisateur saura qu'il y a un souci

    # 4. Démarrage Services Backend (Background)
    backend_thread = threading.Thread(target=start_background_services, daemon=True)
    backend_thread.start()

    # 5. Boucle de vie
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Arrêt demandé...")
        if midi_mgr: midi_mgr.stop()
        if context_monitor: context_monitor.stop()
        sys.exit(0)

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
