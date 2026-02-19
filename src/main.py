import sys
import os
import threading
import webbrowser
import uvicorn
import multiprocessing
import socket
import time

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
# --- IMPORTS ---
# Note: sys.path hack above ensures we can import modules directly
from server import app as fastapi_app
from config_manager import ConfigManager
from midi_engine import MidiManager
from gui import AirstepApp

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
        # Géré via ActionHandler listener (on_data_received) pour synchronisation totale

        # 3. EXECUTION DE L'ACTION (Le plus important)
        # On utilise l'ActionHandler intégré à l'app GUI
        if app.action_handler:
            # CORRECTION : Pont Direct ActionHandler -> MidiManager (Class, pas Instance Input)
            app.action_handler.execute(msg.control, msg.value, msg.channel + 1, app.profiles, midi_manager=MidiManager)

def start_uvicorn(host, port):
    try:
        uvicorn.run(fastapi_app, host=host, port=port, log_level="warning")
    except: pass

def main():
    global app, midi_manager, server_thread

    print("--- Démarrage MidiKbd Control Studio ---")
    print("DISCLAIMER: MidiKbd Control Studio est un outil d'interopérabilité.")
    print("L'utilisateur est seul responsable de l'usage des fonctions de téléchargement,")
    print("conformément aux lois sur la copie privée et aux droits d'auteur de son pays.")

    # 0. Light Mode Detection
    light_mode_flag = os.path.join(os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.getcwd(), "light_mode.flag")
    is_light_mode = os.path.exists(light_mode_flag)

    if is_light_mode:
        print(">>> MODE LIGHT ACTIVE (Serveur Web & Context Monitor DESACTIVES) <<<")

    # 1. Config
    config = ConfigManager()
    port = int(config.get("app_port", 8000))

    # 2. Interface Graphique (GUI) - Doit être créée dans le Main Thread
    app = AirstepApp()
    
    if is_light_mode:
        # Mode Light : On ouvre directement la Remote et on affiche le Tray
        app.withdraw() # Main win hidden
        print("Ouverture immédiate de la Remote (Light Mode)...")
        app.after(500, lambda: app.open_remote_control())
    else:
        # Mode Studio : Démarrage discret (Tray only)
        app.withdraw()

    # 2b. Wiring Web Settings Button -> Native GUI
    # ... (Keep wiring, it won't hurt even if unused in Light Mode)

    # ... (Callback definitions omitted for brevity, logic remains same) ...

    # 2e. State Injection
    # ... (Keep wiring)

    # 3. Démarrage Serveur Web (Thread) - EXCLUDED IN LIGHT MODE
    server_thread = None
    if not is_light_mode:
        server_thread = threading.Thread(target=start_uvicorn, args=("127.0.0.1", port), daemon=True)
        server_thread.start()
        print("Serveur Web démarré.")
    
        # Context Monitor start is inside AirstepApp.__init__. 
        # We need to STOP it if light mode.
        if hasattr(app, 'context_monitor') and app.context_monitor:
            # Note: ContextMonitor was started in app.__init__. We should stop it here.
            # Better architecture would be to start it here, but checking existing code...
            # It IS started in AirstepApp.__init__.
             pass 
    else:
        # Stop the monitor that started automatically in AirstepApp
        if hasattr(app, 'context_monitor') and app.context_monitor:
            print("Arrêt du ContextMonitor pour Light Mode.")
            app.context_monitor.stop()

    # 4. Démarrage MIDI (Thread) - ALWAYS ON
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
            # Hack/Fix: Le MidiManager est passé à l'ActionHandler via execute() mais on utilise l'instance ici
            # Mais app.midi_engine est l'instance MidiManager
            # Donc on est bon.
            midi_manager.start()
        except Exception as e:
            print(f"Erreur Fatal MIDI: {e}")

    def open_settings_wrapper():
        # Utilise .after pour que l'appel vienne du Thread Principal Tkinter
        if app:
            # CORRECTION : On ouvre la Fenêtre Principale, pas juste le dialogue settings
            app.after(0, lambda: [app.deiconify(), app.lift(), app.focus_force()])

    fastapi_app.state.open_settings_callback = open_settings_wrapper

    # 2c. Wiring Folder Selection (Thread-Safe)
    def select_folder_wrapper():
        """Ouvre askdirectory dans le thread principal et renvoie le résultat"""
        result = {"path": None}
        event = threading.Event()
        
        def _ask():
            try:
                from tkinter import filedialog, Toplevel
                
                # Z-Order Fix: Create TopLevel parent
                top = Toplevel(app)
                top.withdraw() 
                top.attributes('-topmost', True)

                # Ensure window is visible or use root
                path = filedialog.askdirectory(parent=top, title="Sélectionner un dossier")
                
                top.destroy()
                
                if path:
                    result["path"] = path
            except Exception as e:
                print(f"Dialog Error: {e}")
            finally:
                event.set()
        
        if app:
            app.after(0, _ask)
            event.wait() # Wait for UI thread to process
            return result["path"]
        return None

    fastapi_app.state.select_folder_callback = select_folder_wrapper

    # 2d. Wiring File Selection (Thread-Safe)
    def select_file_wrapper():
        """Ouvre askopenfilename dans le thread principal et renvoie le résultat"""
        result = {"path": None}
        event = threading.Event()
        
        def _ask_file():
            try:
                from tkinter import filedialog, Toplevel
                
                # Create a temporary top-level window to act as parent
                # This allow us to set 'topmost' so the dialog appears above the browser
                top = Toplevel(app)
                top.withdraw() 
                top.attributes('-topmost', True)
                
                # Restore filetypes now that we know it wasn't the crash cause
                # Use simplified list just in case
                path = filedialog.askopenfilename(
                    parent=top,
                    title="Ajouter un fichier",
                    filetypes=[("Media", "*.mp3 *.wav *.flac *.m4a *.mp4 *.mkv *.webm *.ogg"), ("All", "*.*")]
                )
                
                top.destroy()
                
                if path:
                    result["path"] = path
            except Exception as e:
                print(f"Dialog Error: {e}")
            finally:
                event.set()
        
        if app:
            app.after(0, _ask_file)
            
            # Timeout safety
            is_set = event.wait(timeout=10.0) 
            if not is_set:
                print("Dialog Callback Timeout")
            
            return result["path"]
        return None

    fastapi_app.state.select_file_callback = select_file_wrapper

    # 2e. State Injection (Profiles, Context, Action Handler)
    # WARNING: app.action_handler might be initialized but ContextMonitor is created implicitly or needs access
    # AirstepApp creates ActionHandler, but where is ContextMonitor? 
    # Checking gui.py AirstepApp init...
    # It seems AirstepApp doesn't store context_monitor in self.
    # Wait, ContextMonitor is usually part of ActionHandler or separate?
    # In src/context_monitor.py it takes action_handler.
    # I need to create it or access it.
    # Looking at gui.py imports... no ContextMonitor usage inside AirstepApp?
    # Wait, RemoteControl uses it?
    # Actually, the user requirement is that server.py calls context_monitor.set_manual_override.
    # So it MUST exist.
    # If AirstepApp doesn't create it, I must create it here or inside AirstepApp.
    # Let's check gui.py again: AirstepApp creates ActionHandler.
    # But does it create ContextMonitor?
    # I didn't see it in AirstepApp.__init__.
    # BUT, the remote_win creates a monitor loop `_monitor_remote_context`.
    # That is NOT the real ContextMonitor class.
    # The real ContextMonitor is a Thread.
    # If it is missing from the app, I must add it to AirstepApp!
    
    # Let's assume for now I add it to AirstepApp (I will do that in next step).
    # Here I just wire it assuming it exists.
    fastapi_app.state.profile_manager = app.profile_manager
    fastapi_app.state.action_handler = app.action_handler
    
    # We will instantiate ContextMonitor in AirstepApp and expose it.
    if hasattr(app, 'context_monitor'):
        fastapi_app.state.context_monitor = app.context_monitor



    # 4. Démarrage MIDI (Thread)
    # On lance le MIDI maintenant !
    # 4. Démarrage MIDI (Thread)
    # On lance le MIDI maintenant !
    def start_midi_engine():
        time.sleep(1) # Petit délai pour laisser l'UI s'afficher
        try:
            device_name = config.get("midi_device_name", "AIRSTEP")
            conn_mode = config.get("connection_mode", "BLE") # ou MIDO

            msg = f"Tentative connexion MIDI ({conn_mode}) sur : {device_name}"
            print(msg)
            # Log to file
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[MAIN] {msg}\n")

            midi_manager = MidiManager.create(conn_mode, device_name, on_midi_event)
            # On stocke la ref dans l'app pour qu'elle puisse afficher le statut
            app.midi_engine = midi_manager
            
            # Log success assignment
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[MAIN] MidiManager created and assigned to app. Starting...\n")
            
            midi_manager.start()
        except Exception as e:
            err = f"Erreur Fatal MIDI: {e}"
            print(err)
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[MAIN] CRITICAL ERROR: {err}\n")

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
