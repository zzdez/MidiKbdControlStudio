import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import socket
import time
from tkinter import filedialog

# --- FIX CONSOLE PYINSTALLER ---
class NullWriter:
    def write(self, text): pass
    def flush(self): pass
    def isatty(self): return False

if sys.stdout is None: sys.stdout = NullWriter()
if sys.stderr is None: sys.stderr = NullWriter()

# --- FIX CHEMINS ---
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path: sys.path.insert(0, current_dir)

# --- IMPORTS ---
try:
    from server import app as fastapi_app
    from config_manager import ConfigManager
    from midi_engine import MidiManager
    from gui import AirstepApp
except ImportError:
    from src.server import app as fastapi_app
    from src.config_manager import ConfigManager
    from src.midi_engine import MidiManager
    from src.gui import AirstepApp

# Globals
server_thread = None
midi_manager = None
app = None

# --- CALLBACK MIDI (Le Pont Critique) ---
def on_midi_event(msg):
    """Appelé quand le pédalier envoie un signal"""
    if msg.type != 'control_change': return

    # 1. Envoi au Web (WebSocket)
    # (Note: Le broadcast est géré dans server.py via polling ou queue,
    # mais pour l'instant on se concentre sur l'action locale)

    if app:
        # 2. Feedback Visuel sur la Télécommande (LEDs)
        # On utilise .after pour thread-safety Tkinter
        app.after(0, lambda: app.on_data_received(msg.control, msg.channel + 1))

        # 3. EXECUTION DE L'ACTION (Le plus important)
        # On utilise l'ActionHandler intégré à l'app GUI
        if app.action_handler:
            app.action_handler.execute(msg.control, msg.value, msg.channel + 1, app.profiles)

def start_uvicorn(host, port):
    try:
        uvicorn.run(fastapi_app, host=host, port=port, log_level="warning")
    except: pass

def main():
    global app, midi_manager, server_thread

    print("--- Démarrage AirstepStudio ---")

    # 1. Config
    config = ConfigManager()
    port = int(config.get("app_port", 8000))

    # 2. Interface Graphique (GUI) - Doit être créée dans le Main Thread
    app = AirstepApp()
    app.withdraw() # Démarrage discret
    # app.open_remote_control() # Affiche la télécommande immédiatement (Désactivé : Mode Service)

    # 2b. Wiring Web Settings Button -> Native GUI
    def open_settings_wrapper():
        # Utilise .after pour que l'appel vienne du Thread Principal Tkinter
        if app:
            # CORRECTION : On ouvre la Fenêtre Principale, pas juste le dialogue settings
            app.after(0, lambda: [app.deiconify(), app.lift(), app.focus_force()])

    def open_file_dialog_wrapper(callback):
        def internal_task():
            if app:
                file_path = filedialog.askopenfilename(
                    title="Importer un fichier média",
                    filetypes=[("Média", "*.mp3 *.wav *.mp4 *.mkv *.avi *.flac *.ogg *.wma"), ("Tous les fichiers", "*.*")]
                )
                callback(file_path)
        if app:
            app.after(0, internal_task)

    fastapi_app.state.open_settings_callback = open_settings_wrapper
    fastapi_app.state.open_file_dialog = open_file_dialog_wrapper

    # 3. Démarrage Serveur Web (Thread)
    server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
    server_thread.start()

    # 4. Démarrage MIDI (Thread)
    # On lance le MIDI maintenant !
    def start_midi_engine():
        time.sleep(1) # Petit délai pour laisser l'UI s'afficher
        try:
            device_name = config.get("midi_device_name", "AIRSTEP")
            conn_mode = config.get("connection_mode", "BLE") # ou MIDO

            print(f"Tentative connexion MIDI ({conn_mode}) sur : {device_name}")

            midi_manager = MidiManager.create(conn_mode, device_name, on_midi_event)
            # On stocke la ref dans l'app pour qu'elle puisse afficher le statut
            app.midi_engine = midi_manager
            midi_manager.start()
        except Exception as e:
            print(f"Erreur Fatal MIDI: {e}")

    threading.Thread(target=start_midi_engine, daemon=True).start()

    # 5. Ouverture Navigateur (Désactivé : Mode Service)
    # def open_browser():
    #     time.sleep(2)
    #     webbrowser.open(f"http://127.0.0.1:{port}")
    #
    # threading.Thread(target=open_browser, daemon=True).start()

    # 6. Boucle Principale (Bloquante Tkinter)
    # C'est ici que l'application vit.
    try:
        app.mainloop()
    except KeyboardInterrupt:
        pass
    finally:
        if midi_manager: midi_manager.stop()

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
