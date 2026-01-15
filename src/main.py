import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import json
import time

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

# Variables globales pour garder les références en vie
server_thread = None
midi_mgr = None
context_monitor = None
config = None
profile_mgr = None
action_handler = None

def start_uvicorn(host, port):
    """Lance le serveur dans un thread bloquant"""
    uvicorn.run(fastapi_app, host=host, port=port, log_level="info")

def start_background_services():
    """
    Lance les services backend (MIDI, Context) en arrière-plan.
    Cette fonction est exécutée dans son propre thread pour ne pas bloquer le serveur Web.
    """
    global midi_mgr, context_monitor, profile_mgr, action_handler, config

    print(">>> Initialisation des Services Backend (Async)...")
    try:
        # 1. Chargement de la Configuration Complète
        # Note: ConfigManager est déjà chargé au début du main, mais on peut le relire ou utiliser l'objet passé si nécessaire.
        # Ici on utilise les variables globales initialisées dans main() pour profile_mgr et action_handler

        # 2. Profiles
        print(">>> Chargement des profils...")
        profile_mgr.migrate_legacy_config()
        profiles = profile_mgr.load_all_profiles()
        print(f">>> {len(profiles)} profils chargés.")

        # 3. Context Monitor (Détection Fenêtre)
        print(">>> Démarrage Context Monitor...")
        context_monitor = ContextMonitor(profile_mgr, action_handler)
        context_monitor.start()

        # 4. MIDI Engine
        midi_device = config.get("midi_device_name", "AIRSTEP")
        connection_mode = config.get("connection_mode", "BLE")

        print(f">>> Démarrage MIDI ({connection_mode}: {midi_device})...")

        def on_midi_message(msg):
            try:
                # Formatage Message
                display_str = str(msg)
                if msg.type == 'control_change':
                    display_str = f"CC {msg.control} - {msg.value}"
                elif msg.type == 'note_on':
                     display_str = f"Note {msg.note} - {msg.velocity}"

                # Broadcast WebSocket
                json_msg = json.dumps({"type": "midi", "message": display_str})
                broadcast_sync(json_msg)

                # Trigger Action
                if msg.type == 'control_change':
                    # Correction canal 0-15 -> 1-16
                    action_handler.execute(msg.control, msg.value, msg.channel + 1, profiles)

            except Exception as e:
                print(f"Callback Error: {e}")

        midi_mgr = MidiManager.create(connection_mode, midi_device, on_midi_message)
        midi_mgr.start()
        print(">>> Backend Opérationnel !")

    except Exception as e:
        print(f"!!! ERREUR CRITIQUE BACKEND : {e}")
        # On pourrait envoyer un message d'erreur au frontend ici via broadcast_sync

def main():
    global server_thread, config, profile_mgr, action_handler

    print("--- Démarrage AirstepStudio (Priorité Web) ---")

    # 1. Initialisation de base (Rapide)
    config = ConfigManager()
    profile_mgr = ProfileManager()
    action_handler = ActionHandler()

    port = int(config.get("app_port", 8000))

    # 2. Démarrage Serveur Web (PRIORITÉ 1)
    print(">>> Démarrage Serveur Web...")
    server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
    server_thread.start()

    # Petit délai pour laisser le socket s'ouvrir
    time.sleep(1.0)

    # 3. Ouverture Navigateur
    url = f"http://localhost:{port}"
    print(f"Ouverture : {url}")
    try:
        webbrowser.open(url)
    except:
        print(f"Impossible d'ouvrir le navigateur automatiquement: {url}")

    # 4. Démarrage Services Backend (PRIORITÉ 2 - Background)
    # Lance dans un thread séparé pour que l'interface soit déjà affichée
    backend_thread = threading.Thread(target=start_background_services, daemon=True)
    backend_thread.start()

    # 5. Boucle de vie (Main Thread)
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
