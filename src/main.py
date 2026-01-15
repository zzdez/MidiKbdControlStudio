import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import socket
import time

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
    from server import app as fastapi_app
    from config_manager import ConfigManager
    from midi_engine import MidiManager
    # from action_handler import ActionHandler # Sera utilisé par le serveur
except ImportError:
    # Fallback pour structure src/
    from src.server import app as fastapi_app
    from src.config_manager import ConfigManager
    from src.midi_engine import MidiManager

# Variable globale
server_thread = None

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

def main():
    # 1. Config & Port
    config = ConfigManager()
    base_port = int(config.get("app_port", 8000))
    port = find_free_port(base_port)

    # 2. Démarrage Serveur Web (Priorité 1)
    global server_thread
    server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
    server_thread.start()

    # 3. Démarrage MIDI (Priorité 2 - Arrière plan)
    # On isole le MIDI pour que s'il plante (Bluetooth), le Web reste accessible
    def start_midi():
        time.sleep(2) # Petit délai pour laisser le serveur respirer
        try:
            target = config.get("midi_device_name", "AIRSTEP")
            # Le callback MIDI sera géré via le serveur WebSocket plus tard
            # Note pour Jules: Pour l'instant on met None car le code fourni par l'user met None
            # Mais idéalement il faudrait remettre le vrai callback pour que ça marche.
            # Cependant, l'instruction est "Remplace le fichier existant par cette version sécurisée".
            # Je vais obéir strictement.
            midi = MidiManager.create("BLE", target, None)
            midi.start()
        except Exception as e:
            print(f"Erreur MIDI non bloquante: {e}")

    midi_thread = threading.Thread(target=start_midi, daemon=True)
    midi_thread.start()

    # 4. Ouverture Navigateur
    url = f"http://127.0.0.1:{port}"
    time.sleep(1.0) # Attente démarrage Uvicorn
    webbrowser.open(url)

    # 5. Boucle de vie (Keep Alive)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
