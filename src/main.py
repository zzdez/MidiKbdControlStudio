import threading
import socket
import sys
import datetime
import tkinter
from tkinter import messagebox
from gui import AirstepApp
from midi_engine import MidiManager
from action_handler import ActionHandler
import icons

# Variable globale pour l'app
app = None
midi_engine = None
action_handler = ActionHandler()

def on_midi_message(msg):
    """Callback appelé quand l'Airstep envoie un message"""
    # Filtrage des messages système fréquents pour éviter de saturer l'app
    if msg.type in ['clock', 'active_sensing', 'start', 'continue', 'stop', 'reset']:
        return

    # DEBUG LOG
    try:
        with open("midi_debug.log", "a") as f:
            f.write(f"{datetime.datetime.now()} {msg}\n")
    except: pass

    if msg.type == 'control_change':
        # Feedback visuel (Activité)
        if app and msg.value > 0:
            # Note: msg.channel is 0-15
            app.after(0, lambda: app.on_data_received(msg.control, msg.channel + 1))

        # On passe les infos au gestionnaire d'actions
        # Note : mido compte les canaux de 0 à 15, on ajoute 1 pour l'humain
        if app:
            action_handler.execute(msg.control, msg.value, msg.channel + 1, app.profiles)

def check_connection_status():
    """Vérifie périodiquement si le moteur MIDI est connecté pour mettre à jour l'interface"""
    if app and app.midi_engine:
        if app.midi_engine.is_connected:
            app.update_status(True)
        else:
            # Si erreur spécifique (ex: port occupé ou lib manquante), on l'affiche
            msg = None
            if app.midi_engine.last_error:
                if "MidiInWinMM" in app.midi_engine.last_error:
                    msg = "Port Inaccessible (Airstep éteint ?)"
                else:
                    msg = app.midi_engine.last_error

            app.update_status(False, msg)
    
    # On rappelle cette fonction dans 1000ms (1 seconde) via la boucle Tkinter
    if app:
        app.after(1000, check_connection_status)

import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()

    # Check Singleton
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # Port arbitraire pour le verrouillage
        sock.bind(('127.0.0.1', 54321))
    except socket.error:
        root = tkinter.Tk()
        root.withdraw()
        messagebox.showwarning("Airstep", "L'application est déjà lancée !\nVérifiez l'icône dans la zone de notification.")
        sys.exit(0)

    # 0. Générer les assets (icônes)
    icons.ensure_assets()

    # 1. Initialiser l'interface
    app = AirstepApp()
    
    # 2. Récupérer le nom du device depuis l'interface (chargé via config)
    target_device = app.device_combo.get()
    if target_device == "Recherche..." or not target_device:
        target_device = "AIRSTEP"
    
    # 3. Démarrer le Moteur MIDI
    mode = app.settings.get("connection_mode", "MIDO")

    midi_engine = MidiManager.create(mode, target_device, on_midi_message)
    app.midi_engine = midi_engine
    app.set_midi_callback(on_midi_message)
    app.action_handler = action_handler
    midi_engine.start()

    # 4. Lancer la boucle de vérification du statut (GUI Update)
    check_connection_status()

    # 5. Lancer l'application (Bloquant)
    try:
        app.mainloop()
    except KeyboardInterrupt:
        pass
    finally:
        # Nettoyage à la fermeture
        if midi_engine:
            midi_engine.stop()