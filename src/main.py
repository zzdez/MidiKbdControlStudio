import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import socket
import time
import json

# --- FIX CRITIQUE POUR PYINSTALLER (WINDOWED MODE) ---
# Uvicorn plante s'il ne trouve pas de console (sys.stdout est None).
# On crée une fausse console pour rediriger les logs vers le vide.
class NullWriter:
    def write(self, text): pass
    def flush(self): pass
    def isatty(self): return False # C'est CA que Uvicorn veut savoir !

if sys.stdout is None:
    sys.stdout = NullWriter()
if sys.stderr is None:
    sys.stderr = NullWriter()
# -----------------------------------------------------

# --- FIX CHEMINS (Dev vs EXE) ---
# Ajoute le dossier courant au Path pour trouver les modules voisins
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# --- IMPORTS ---
try:
    from server import app as fastapi_app, broadcast_sync
    from config_manager import ConfigManager
    from midi_engine import MidiManager
    from action_handler import ActionHandler
    from profile_manager import ProfileManager
    from context_monitor import ContextMonitor
except ImportError:
    # Fallback pour structure src/
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
    """Cherche un port libre"""
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port

def start_uvicorn(host, port):
    """Lance le serveur Uvicorn"""
    try:
        # log_config=None ou log_level critical évite certains appels console
        uvicorn.run(fastapi_app, host=host, port=port, log_level="warning")
    except Exception as e:
        # Log d'urgence fichier si le serveur meurt
        try:
            with open("server_crash.log", "w") as f:
                f.write(str(e))
        except: pass

def start_background_services():
    """
    Lance les services backend (MIDI, Context) en arrière-plan.
    """
    global midi_mgr, context_monitor, profile_mgr, action_handler, config

    print(">>> Initialisation des Services Backend (Async)...")
    try:
        # 2. Profiles (Rechargement/Validation)
        # Note: Déjà chargés dans main, mais on peut rafraîchir

        # 3. Context Monitor (Smart Logic)
        print(">>> Démarrage Context Monitor...")

        # Callback appelé quand le profil change (0.5s check)
        def on_profile_change(profile_data):
            try:
                # A. Update ActionHandler State
                action_handler.set_current_profile(profile_data)

                # B. Broadcast to Web
                msg = {
                    "type": "profile_update",
                    "data": profile_data # Peut être None
                }
                broadcast_sync(json.dumps(msg))
            except Exception as e:
                print(f"Profile Change Error: {e}")

        context_monitor = ContextMonitor(profile_mgr, action_handler, callback=on_profile_change)
        context_monitor.start()

        # 4. MIDI Engine
        midi_device = config.get("midi_device_name", "AIRSTEP")
        connection_mode = config.get("connection_mode", "BLE")

        print(f">>> Démarrage MIDI ({connection_mode}: {midi_device})...")

        def on_midi_event(msg):
            try:
                # 1. Web Broadcast
                data = {
                    "type": "midi",
                    "cc": msg.control if msg.type == 'control_change' else None,
                    "value": msg.value if hasattr(msg, 'value') else None,
                    "channel": msg.channel if hasattr(msg, 'channel') else None,
                    "message": str(msg)
                }
                broadcast_sync(json.dumps(data))

                # 2. Action Trigger (Using Smart Context in ActionHandler)
                # DECOUPLED: Action Trigger is now handled by the Frontend (Win/Web Mode)
                # The Frontend will call POST /api/trigger if needed.
                pass

            except Exception as ex:
                print(f"MIDI Callback Error: {ex}")

        midi_mgr = MidiManager.create(connection_mode, midi_device, on_midi_event)
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

    print("--- Démarrage AirstepStudio (Smart) ---")

    # 1. Init Base
    config = ConfigManager()
    profile_mgr = ProfileManager()
    profile_mgr.migrate_legacy_config()
    profile_mgr.load_all_profiles()

    action_handler = ActionHandler()

    # Callback pour commandes internes (media_*) -> WebSocket
    def on_internal_command(cmd):
        msg = {
            "type": "command",
            "cmd": cmd
        }
        broadcast_sync(json.dumps(msg))

    action_handler.set_command_callback(on_internal_command)

    # Injection dans FastAPI pour l'API /api/trigger
    fastapi_app.state.action_handler = action_handler
    fastapi_app.state.profiles = profile_mgr.profiles
    # Injection pour /api/set_mode
    fastapi_app.state.context_monitor = context_monitor

    # Choix du Port
    requested_port = int(config.get("app_port", 8000))
    port = find_free_port(requested_port)
    host = "127.0.0.1"

    # 2. Démarrage Serveur Web
    print(">>> Démarrage Serveur Web...")
    server_thread = threading.Thread(target=start_uvicorn, args=(host, port), daemon=True)
    server_thread.start()

    # 3. Vérification de vie
    print(">>> Attente disponibilité serveur...")
    if wait_for_server(host, port):
        url = f"http://{host}:{port}"
        print(f">>> Serveur PRÊT. Ouverture : {url}")
        try:
            webbrowser.open(url)
        except:
            print("Impossible d'ouvrir le navigateur.")
    else:
        print("TIMEOUT: Le serveur n'a pas démarré.")
        # On continue...

    # 4. Démarrage Backend (Async)
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
