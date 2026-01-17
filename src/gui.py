import customtkinter as ctk
import json
import os
import time
import threading
import datetime
import pygetwindow as gw
import keyboard
import mido
import pystray
from PIL import Image
try:
    from icons import ICON_PNG_PATH, LOGO_PATH
except ImportError:
    # Fallback paths if icons.py is missing or paths are wrong
    ICON_PNG_PATH = "icon.png"
    LOGO_PATH = "logo.png"

def get_resource_path(relative_path):
    import sys, os
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

try:
    import driver_check
    from profile_manager import ProfileManager
    from device_manager import DeviceManager, DEFAULT_AIRSTEP_DEF
    from env_manager import EnvManager
    from midi_engine import MidiManager
    from action_handler import ActionHandler
    from remote_gui import RemoteControl, CompactPedalboardFrame
except ImportError:
    from src import driver_check
    from src.profile_manager import ProfileManager
    from src.device_manager import DeviceManager, DEFAULT_AIRSTEP_DEF
    from src.env_manager import EnvManager
    from src.midi_engine import MidiManager
    from src.action_handler import ActionHandler
    from src.remote_gui import RemoteControl, CompactPedalboardFrame

# Configuration de l'apparence
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class CTkMessageBox(ctk.CTkToplevel):
    def __init__(self, title="Message", message="", icon="info", option_text_1="OK", option_text_2=None):
        super().__init__()
        self.title(title)
        self.geometry("400x200")
        self.attributes("-topmost", True)

        self.update_idletasks()
        try:
            x = (self.winfo_screenwidth() // 2) - (400 // 2)
            y = (self.winfo_screenheight() // 2) - (200 // 2)
            self.geometry(f"+{x}+{y}")
        except: pass

        self.result = None

        self.label = ctk.CTkLabel(self, text=message, wraplength=350)
        self.label.pack(pady=30, padx=20, fill="both", expand=True)

        self.btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.btn_frame.pack(pady=20)

        if option_text_2:
            self.btn2 = ctk.CTkButton(self.btn_frame, text=option_text_2, fg_color="transparent", border_width=1, text_color=("gray10", "gray90"), command=lambda: self.on_click(False))
            self.btn2.pack(side="left", padx=10)

        self.btn1 = ctk.CTkButton(self.btn_frame, text=option_text_1, command=lambda: self.on_click(True))
        self.btn1.pack(side="left", padx=10)

        self.grab_set()
        self.wait_window()

    def on_click(self, value):
        self.result = value
        self.destroy()

    @staticmethod
    def show_info(title, message):
        CTkMessageBox(title, message, option_text_1="OK")

    @staticmethod
    def show_error(title, message):
        CTkMessageBox(title, message, option_text_1="OK")

    @staticmethod
    def ask_yes_no(title, message):
        msg = CTkMessageBox(title, message, option_text_1="Oui", option_text_2="Non")
        return msg.result

class ShortcutsDialog(ctk.CTkToplevel):
    def __init__(self, parent, initial_text, callback):
        super().__init__(parent)
        self.callback = callback
        self.title("Mémo Raccourcis")
        self.geometry("600x600")
        self.attributes("-topmost", True)

        self.textbox = ctk.CTkTextbox(self)
        self.textbox.pack(fill="both", expand=True, padx=20, pady=20)
        self.textbox.insert("0.0", initial_text)

        self.btn_save = ctk.CTkButton(self, text="Sauvegarder", command=self.save)
        self.btn_save.pack(pady=(0, 20), padx=20, fill="x")

    def save(self):
        text = self.textbox.get("0.0", "end").strip()
        self.callback(text)
        self.destroy()

class SettingsDialog(ctk.CTkToplevel):
    def __init__(self, parent, profile_manager, action_handler, env_manager):
        super().__init__(parent)
        self.title("Réglages")
        self.geometry("450x400")
        self.attributes("-topmost", True)
        self.profile_manager = profile_manager
        self.action_handler = action_handler
        self.env_manager = env_manager

        try:
            self.tabview = ctk.CTkTabview(self)
            self.tabview.pack(fill="both", expand=True, padx=10, pady=10)
            self.tabview.add("Général")
            self.tabview.add("Sauvegarde")

            # Tab General
            tab_gen = self.tabview.tab("Général")
            ctk.CTkLabel(tab_gen, text="Délai Anti-Rebond (Burst Mode) :").pack(pady=(20, 5))

            current_val = action_handler.debounce_delay if action_handler else 0.15
            self.lbl_debounce = ctk.CTkLabel(tab_gen, text=f"{int(current_val * 1000)} ms")
            self.lbl_debounce.pack()

            self.slider = ctk.CTkSlider(tab_gen, from_=0, to=1000, number_of_steps=100, command=self.update_label)
            self.slider.set(current_val * 1000)
            self.slider.pack(pady=10, padx=20, fill="x")

            ctk.CTkLabel(tab_gen, text="(Délai pour grouper les messages MIDI rapides\ncomme l'appui court/long AIRSTEP)", text_color="gray", font=("Arial", 10)).pack()

            # Tab Backup
            tab_backup = self.tabview.tab("Sauvegarde")
            ctk.CTkButton(tab_backup, text="Exporter Configuration (Zip)", command=self.export_conf).pack(pady=20, padx=20, fill="x")
            ctk.CTkButton(tab_backup, text="Importer Configuration (Zip)", command=self.import_conf).pack(pady=10, padx=20, fill="x")

            # Force set tab
            self.tabview.set("Général")

        except Exception as e:
            with open("debug.log", "a") as f:
                import traceback
                f.write(f"SETTINGS ERROR: {e}\n{traceback.format_exc()}\n")
            CTkMessageBox.show_error("Erreur", f"Erreur lors de l'ouverture des réglages :\n{e}")

    def update_label(self, value):
        self.lbl_debounce.configure(text=f"{int(value)} ms")
        if self.action_handler:
            self.action_handler.set_debounce_delay(value / 1000.0)

    def export_conf(self):
        from tkinter import filedialog
        path = filedialog.asksaveasfilename(defaultextension=".zip", filetypes=[("Zip files", "*.zip")])
        if path:
            ok, msg = self.profile_manager.export_backup(path)
            if ok: CTkMessageBox.show_info("Succès", "Sauvegarde réussie !")
            else: CTkMessageBox.show_error("Erreur", msg)

    def import_conf(self):
        from tkinter import filedialog
        path = filedialog.askopenfilename(filetypes=[("Zip files", "*.zip")])
        if path:
            if CTkMessageBox.ask_yes_no("Attention", "Cela va écraser votre configuration actuelle.\nContinuer ?"):
                ok, msg = self.profile_manager.import_backup(path)
                if ok:
                    CTkMessageBox.show_info("Succès", "Configuration restaurée.\nVeuillez redémarrer l'application.")
                else:
                    CTkMessageBox.show_error("Erreur", msg)

class DeviceEditorDialog(ctk.CTkToplevel):
    def __init__(self, parent, manager, current_def=None, callback=None):
        super().__init__(parent)
        self.manager = manager
        self.callback = callback
        self.title("Éditeur de Périphérique")
        self.geometry("500x600")
        self.attributes("-topmost", True)

        self.definition = current_def if current_def else {"name": "Nouveau", "buttons": []}

        # Name
        ctk.CTkLabel(self, text="Nom du Modèle (ex: AIRSTEP) :").pack(pady=(10,0))
        self.entry_name = ctk.CTkEntry(self)
        self.entry_name.insert(0, self.definition["name"])
        self.entry_name.pack(pady=5, padx=20, fill="x")

        # Buttons List
        self.scroll_frame = ctk.CTkScrollableFrame(self, label_text="Boutons (CC -> Nom)")
        self.scroll_frame.pack(pady=10, padx=20, fill="both", expand=True)

        self.rows = []
        for btn in self.definition.get("buttons", []):
            self.add_row(btn["cc"], btn["label"])

        # Add Button
        ctk.CTkButton(self, text="+ Ajouter Bouton", command=lambda: self.add_row("", "")).pack(pady=5)

        # Save
        ctk.CTkButton(self, text="Sauvegarder", fg_color="green", command=self.save).pack(pady=20, padx=20, fill="x")

    def add_row(self, cc, label):
        row = ctk.CTkFrame(self.scroll_frame)
        row.pack(fill="x", pady=2)

        e_cc = ctk.CTkEntry(row, width=60, placeholder_text="CC")
        e_cc.insert(0, str(cc))
        e_cc.pack(side="left", padx=5)

        e_lbl = ctk.CTkEntry(row, placeholder_text="Nom (ex: Bouton A)")
        e_lbl.insert(0, str(label))
        e_lbl.pack(side="left", fill="x", expand=True, padx=5)

        btn_del = ctk.CTkButton(row, text="X", width=30, fg_color="red", command=lambda: self.delete_row(row))
        btn_del.pack(side="right", padx=5)

        self.rows.append((row, e_cc, e_lbl))

    def delete_row(self, row_widget):
        for i, r in enumerate(self.rows):
            if r[0] == row_widget:
                self.rows.pop(i)
                break
        row_widget.destroy()

    def save(self):
        new_buttons = []
        for r in self.rows:
            try:
                cc = int(r[1].get())
                lbl = r[2].get()
                new_buttons.append({"cc": cc, "label": lbl})
            except: pass

        data = {
            "name": self.entry_name.get(),
            "buttons": new_buttons
        }
        self.manager.save_definition(data)

        if self.callback:
            self.callback()

        self.destroy()




class MappingDialog(ctk.CTkToplevel):
    """Fenêtre popup pour ajouter/éditer un mapping"""
    def __init__(self, parent, callback, device_def=None, initial_data=None, profile_context=None, action_handler=None):
        super().__init__(parent)
        self.callback = callback
        self.initial_data = initial_data
        self.current_rec_data = None # Store scan codes from recording
        self.profile_context = profile_context # {app_context, window_title_filter}
        self.action_handler = action_handler

        self.title("Modifier l'Action" if initial_data else "Ajouter une Action")
        self.geometry("450x450")
        self.attributes("-topmost", True)

        ctk.CTkLabel(self, text="Nom de l'action :").pack(pady=(10,0))
        self.entry_name = ctk.CTkEntry(self, placeholder_text="Ex: Play YouTube")
        self.entry_name.pack(pady=5, padx=20, fill="x")
        if initial_data:
            self.entry_name.insert(0, initial_data.get("name", ""))

        ctk.CTkLabel(self, text="Bouton / MIDI CC :").pack(pady=(10,0))

        self.combo_cc = ctk.CTkComboBox(self)
        self.combo_cc.pack(pady=5, padx=20, fill="x")

        # Populate values
        values = []
        if device_def:
            for b in device_def.get("buttons", []):
                values.append(f"{b['cc']} - {b['label']}")

        if not values:
            values = ["54", "55", "56", "57", "58"]

        self.combo_cc.configure(values=values)

        # Select Initial Value
        if initial_data:
            target_cc = initial_data.get("midi_cc")
            # Find matching string
            match = next((v for v in values if v.startswith(f"{target_cc} -") or v == str(target_cc)), str(target_cc))
            self.combo_cc.set(match)
        elif values:
            self.combo_cc.set(values[0])

        # Icon Selector
        ctk.CTkLabel(self, text="Icône (Optionnel) :").pack(pady=(10,0))
        self.combo_icon = ctk.CTkComboBox(self, values=["Auto", "▶", "⏸", "■", "●", "⏪", "⏩", "⟳", "🔇", "🔊", "↔", "⏱", "♪", "◴", "📍", "▲", "▼", "◄", "►", "✓", "↶", "↷", "⚡", "⚙", "📂", "🎸", "🎤", "🎹"])
        self.combo_icon.pack(pady=5, padx=20, fill="x")

        if initial_data and initial_data.get("custom_icon"):
            self.combo_icon.set(initial_data.get("custom_icon"))
        else:
            self.combo_icon.set("Auto")

        ctk.CTkLabel(self, text="Touche Clavier (Ex: k, space) :").pack(pady=(10,0))
        self.frame_key = ctk.CTkFrame(self, fg_color="transparent")
        self.frame_key.pack(pady=5, padx=20, fill="x")

        self.entry_key = ctk.CTkEntry(self.frame_key, placeholder_text="space")
        self.entry_key.pack(side="left", fill="x", expand=True)

        # Test Button
        self.btn_test = ctk.CTkButton(self.frame_key, text="▶", width=30, fg_color="#444", hover_color="#666", command=self.test_mapping)
        self.btn_test.pack(side="right", padx=(5,0))

        self.btn_rec = ctk.CTkButton(self.frame_key, text="REC", width=60, fg_color="#cc3300", hover_color="#992200", command=self.start_recording)
        self.btn_rec.pack(side="right", padx=(5,0))

        if initial_data:
            self.entry_key.insert(0, initial_data.get("action_value", ""))

        self.lbl_scan_info = ctk.CTkLabel(self, text="", text_color="gray", font=("Arial", 10))
        self.lbl_scan_info.pack(pady=(0, 5))

        self.btn_save = ctk.CTkButton(self, text="Valider", fg_color="green", hover_color="darkgreen", command=self.save_mapping)
        self.btn_save.pack(pady=10, padx=20, fill="x")

    def start_recording(self):
        self.btn_rec.configure(text="...", state="disabled")
        self.entry_key.delete(0, "end")
        self.entry_key.insert(0, "Appuyez...")

        def _rec_thread():
            try:
                # Advanced recording to capture Scan Code
                pressed_scancodes = set()
                while True:
                    e = keyboard.read_event(suppress=False)
                    if e.event_type == keyboard.KEY_DOWN:
                        pressed_scancodes.add(e.scan_code)

                        # Improved modifier detection for AltGr/Right Alt
                        is_mod = keyboard.is_modifier(e.scan_code) or e.name in ['right alt', 'alt gr', 'right ctrl', 'right shift']

                        if not is_mod:
                            # Non-modifier key pressed -> Determine context
                            # Capture all other pressed keys as modifiers
                            current_modifiers_sc = [sc for sc in pressed_scancodes if sc != e.scan_code]

                            # Construct display name (best effort)
                            # We still want to show names like "Ctrl+C" even if we use scan codes internally
                            mod_names = []
                            def safe_is_pressed(k):
                                try: return keyboard.is_pressed(k)
                                except: return False

                            if safe_is_pressed('ctrl'): mod_names.append('ctrl')
                            if safe_is_pressed('shift'): mod_names.append('shift')
                            if safe_is_pressed('alt'): mod_names.append('alt')
                            if safe_is_pressed('right alt') or safe_is_pressed('alt gr'): mod_names.append('alt gr')
                            if safe_is_pressed('windows'): mod_names.append('windows')

                            # Deduplicate
                            mod_names = sorted(list(set(mod_names)))
                            full_name = "+".join(mod_names + [e.name])

                            res = {
                                "scan_code": e.scan_code,
                                "modifiers": mod_names,
                                "modifier_scan_codes": current_modifiers_sc,
                                "name": full_name
                            }
                            self.after(0, lambda: self.finish_recording(res))
                            break
                    elif e.event_type == keyboard.KEY_UP:
                         if e.scan_code in pressed_scancodes:
                             pressed_scancodes.discard(e.scan_code)
            except Exception as e:
                with open("debug.log", "a") as f:
                    import traceback
                    f.write(f"REC ERROR: {e}\n{traceback.format_exc()}\n")
                self.after(0, lambda: self.finish_recording(None))

        threading.Thread(target=_rec_thread, daemon=True).start()

    def finish_recording(self, result):
        if result:
            self.entry_key.delete(0, "end")
            self.entry_key.insert(0, result["name"])
            self.current_rec_data = result
            self.lbl_scan_info.configure(text=f"Scan Code: {result['scan_code']} (+{len(result.get('modifier_scan_codes', []))} mods)")
        else:
            self.entry_key.delete(0, "end")
            self.entry_key.insert(0, "Erreur")
            self.lbl_scan_info.configure(text="")

        self.btn_rec.configure(text="REC", state="normal")

    def test_mapping(self):
        """Teste le mapping avec un compte à rebours pour laisser l'utilisateur changer le focus"""
        mapping_data = self._build_mapping_data_from_ui()
        if not mapping_data: return

        if not self.action_handler:
             CTkMessageBox.show_error("Erreur", "ActionHandler manquant.")
             return

        # Disable button
        self.btn_test.configure(state="disabled")

        # Countdown 3s
        def _countdown(count):
            if not self.winfo_exists(): return

            if count > 0:
                self.btn_test.configure(text=str(count))
                self.after(1000, lambda: _countdown(count - 1))
            else:
                # Trigger !
                self.btn_test.configure(text="Go!", fg_color="green")
                self.action_handler.trigger_keystroke(mapping_data)

                # Reset UI
                self.after(500, lambda: self._reset_test_btn())

        _countdown(3)

    def _reset_test_btn(self):
        try:
            self.btn_test.configure(text="▶", state="normal", fg_color="#444")
        except: pass

    def _build_mapping_data_from_ui(self):
        val = self.combo_cc.get()
        try:
            if " - " in val:
                cc = int(val.split(" - ")[0])
            else:
                cc = int(val)
        except ValueError:
            CTkMessageBox.show_error("Erreur", "Le MIDI CC doit être valide (Nombre).")
            return None

        scan_code = None
        modifiers = []
        modifier_scan_codes = []

        if self.current_rec_data and self.current_rec_data.get("name") == self.entry_key.get():
             scan_code = self.current_rec_data.get("scan_code")
             modifiers = self.current_rec_data.get("modifiers")
             modifier_scan_codes = self.current_rec_data.get("modifier_scan_codes", [])
        elif self.initial_data and self.initial_data.get("action_value") == self.entry_key.get():
             scan_code = self.initial_data.get("action_scan_code")
             modifiers = self.initial_data.get("action_modifiers")
             modifier_scan_codes = self.initial_data.get("action_modifier_scan_codes", [])

        icon_val = self.combo_icon.get()
        custom_icon = icon_val if icon_val != "Auto" else None

        return {
            "name": self.entry_name.get() or "Sans nom",
            "midi_cc": cc,
            "midi_channel": 16,
            "trigger_value": "any",
            "action_type": "hotkey",
            "action_value": self.entry_key.get(),
            "action_scan_code": scan_code,
            "action_modifiers": modifiers,
            "action_modifier_scan_codes": modifier_scan_codes,
            "custom_icon": custom_icon
        }

    def save_mapping(self):
        data = self._build_mapping_data_from_ui()
        if data:
            self.callback(data)
            self.destroy()


# VirtualPedalboard replaced by CompactPedalboardFrame from remote_gui.py

class AirstepApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Airstep Smart Control")
        self.geometry("1000x750")

        self.tray_icon = None
        self.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)
        try:
            self.iconbitmap(ICON_PNG_PATH)
        except: pass

        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.profile_manager = ProfileManager()
        self.profile_manager.migrate_legacy_config()

        self.env_manager = EnvManager()

        self.device_manager = DeviceManager()
        self.current_device_def = DEFAULT_AIRSTEP_DEF

        self.profiles = []
        self.current_profile = None
        self.mapping_indicators = {}
        self.midi_engine = None
        self.midi_callback = None
        self.action_handler = None
        self.settings = {"midi_device_name": "AIRSTEP", "connection_mode": "MIDO"}

        self.create_sidebar()
        self.create_main_area()

        self.load_data()
        self.refresh_midi_ports()
        self.check_driver()

        self.setup_tray()
        self.last_flash_time = 0
        self._revert_timer = None

    def set_midi_callback(self, cb):
        self.midi_callback = cb

    def log_debug(self, message):
        try:
            timestamp = datetime.datetime.now().strftime("%H:%M:%S")
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[GUI] [{timestamp}] {message}\n")
        except: pass

    def create_sidebar(self):
        self.sidebar_frame = ctk.CTkFrame(self, width=220, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, rowspan=4, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(7, weight=1) # Spacer

        # 1. Logo
        try:
             pil_img = Image.open(LOGO_PATH)
             logo_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(180, 70))
             self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="", image=logo_img)
        except Exception as e:
             self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="AIRSTEP\nControl", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=10, pady=(20, 10))

        # 2. MIDI Mode & Selector
        self.lbl_mode = ctk.CTkLabel(self.sidebar_frame, text="Mode de Connexion :", anchor="w")
        self.lbl_mode.grid(row=1, column=0, padx=20, pady=(5, 0), sticky="w")

        self.mode_combo = ctk.CTkComboBox(self.sidebar_frame, values=["Windows (USB/Driver)", "Bluetooth (Direct)"], command=self.change_mode)
        self.mode_combo.grid(row=2, column=0, padx=20, pady=(0, 5))

        self.lbl_device = ctk.CTkLabel(self.sidebar_frame, text="Périphérique :", anchor="w")
        self.lbl_device.grid(row=3, column=0, padx=20, pady=(5, 0), sticky="w")

        self.device_combo = ctk.CTkComboBox(self.sidebar_frame, values=["Recherche..."], command=self.change_midi_device)
        self.device_combo.grid(row=4, column=0, padx=20, pady=(0, 5))

        self.btn_refresh = ctk.CTkButton(self.sidebar_frame, text="Rafraîchir", width=100, command=self.refresh_midi_ports)
        self.btn_refresh.grid(row=5, column=0, padx=20, pady=5)

        # 3. Device & Settings
        self.settings_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.settings_frame.grid(row=6, column=0, padx=10, pady=10)

        self.btn_edit_device = ctk.CTkButton(self.settings_frame, text="⚙ Boutons", width=90, fg_color="#555", command=self.open_device_editor)
        self.btn_edit_device.pack(side="left", padx=2)

        self.btn_settings = ctk.CTkButton(self.settings_frame, text="🛠 Réglages", width=90, fg_color="#555", command=self.open_settings)
        self.btn_settings.pack(side="left", padx=2)

        # 4. Status & Monitor
        self.status_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.status_frame.grid(row=7, column=0, padx=20, pady=10, sticky="ew")

        # Connection State
        self.conn_frame = ctk.CTkFrame(self.status_frame, fg_color="transparent")
        self.conn_frame.pack(fill="x", pady=2)

        self.lbl_conn_led = ctk.CTkLabel(self.conn_frame, text="●", font=ctk.CTkFont(size=18), text_color="red")
        self.lbl_conn_led.pack(side="left", padx=(0, 5))

        self.lbl_conn_text = ctk.CTkLabel(self.conn_frame, text="Déconnecté", font=ctk.CTkFont(size=12, weight="bold"))
        self.lbl_conn_text.pack(side="left")

        # Driver Info
        self.lbl_driver = ctk.CTkLabel(self.status_frame, text="Driver: ...", font=ctk.CTkFont(size=10), text_color="gray")
        self.lbl_driver.pack(anchor="w", pady=(0, 5))

        # LCD Monitor
        self.monitor_frame = ctk.CTkFrame(self.status_frame, fg_color=("gray90", "gray20"), corner_radius=5)
        self.monitor_frame.pack(fill="x", pady=5)

        self.lbl_monitor_cc = ctk.CTkLabel(self.monitor_frame, text="CC: --", font=ctk.CTkFont(family="Consolas", size=14, weight="bold"))
        self.lbl_monitor_cc.pack(side="left", padx=10, pady=5)

        self.lbl_monitor_ch = ctk.CTkLabel(self.monitor_frame, text="CH: --", font=ctk.CTkFont(family="Consolas", size=11))
        self.lbl_monitor_ch.pack(side="right", padx=10, pady=5)

        # Auto-Scan Switch
        self.switch_scan = ctk.CTkSwitch(self.status_frame, text="Auto-Scan", command=self.toggle_scan, font=ctk.CTkFont(size=11), width=80, height=20)
        self.switch_scan.select()
        self.switch_scan.pack(pady=(5, 0), anchor="w")

        # Theme Switch
        self.theme_switch = ctk.CTkSwitch(self.status_frame, text="Mode Sombre", command=self.toggle_theme, font=ctk.CTkFont(size=11), width=80, height=20)

        # Load theme setting
        current_theme = self.settings.get("theme", "Dark")
        if current_theme == "Dark":
            self.theme_switch.select()
            ctk.set_appearance_mode("Dark")
        else:
            self.theme_switch.deselect()
            ctk.set_appearance_mode("Light")

        self.theme_switch.pack(pady=(5, 0), anchor="w")

        # Spacer
        ctk.CTkLabel(self.sidebar_frame, text="").grid(row=8, column=0)

        # 5. Startup
        is_startup = self.check_startup_status()
        self.startup_var = ctk.BooleanVar(value=is_startup)
        self.chk_startup = ctk.CTkCheckBox(self.sidebar_frame, text="Lancer au démarrage", variable=self.startup_var, command=self.toggle_startup, font=ctk.CTkFont(size=12))
        self.chk_startup.grid(row=9, column=0, padx=20, pady=10, sticky="w")

        # 6. Global Actions
        self.btn_remote = ctk.CTkButton(self.sidebar_frame, text="Détacher Télécommande ⧉", command=self.open_remote_control, fg_color="#444", hover_color="#666")
        self.btn_remote.grid(row=10, column=0, padx=20, pady=(20, 5))

        self.save_button = ctk.CTkButton(self.sidebar_frame, text="Sauvegarder Tout", command=lambda: self.save_all(silent=False), fg_color="green", hover_color="darkgreen")
        self.save_button.grid(row=11, column=0, padx=20, pady=(5, 20))

    def create_main_area(self):
        # Configuration de la grille principale
        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=0)
        self.grid_rowconfigure(2, weight=0)
        self.grid_rowconfigure(3, weight=1)

        # --- Zone 1: Sélection du Profil ---
        self.profile_frame = ctk.CTkFrame(self, corner_radius=5)
        self.profile_frame.grid(row=0, column=1, padx=5, pady=(5, 1), sticky="ew")

        ctk.CTkLabel(self.profile_frame, text="Profil :", font=ctk.CTkFont(weight="bold")).pack(side="left", padx=(5, 2), pady=2)

        self.profile_combo = ctk.CTkComboBox(self.profile_frame, width=200, height=24, command=self.on_profile_change)
        self.profile_combo.pack(side="left", padx=2, pady=2)

        self.btn_new_profile = ctk.CTkButton(self.profile_frame, text="+", width=24, height=24, command=self.create_new_profile)
        self.btn_new_profile.pack(side="left", padx=2, pady=2)

        self.btn_dup_profile = ctk.CTkButton(self.profile_frame, text="❐", width=24, height=24, fg_color="#555", hover_color="#777", command=self.duplicate_current_profile)
        self.btn_dup_profile.pack(side="left", padx=2, pady=2)

        self.btn_del_profile = ctk.CTkButton(self.profile_frame, text="Suppr", width=40, height=24, fg_color="red", hover_color="darkred", command=self.delete_current_profile)
        self.btn_del_profile.pack(side="left", padx=2, pady=2)

        # Shortcut Memo Button
        self.btn_shortcuts = ctk.CTkButton(self.profile_frame, text="📝 Mémo", width=60, height=24, command=self.open_shortcuts_dialog)
        self.btn_shortcuts.pack(side="right", padx=5, pady=2)

        # --- Zone 2: Règles de Détection ---
        self.rules_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.rules_frame.grid(row=1, column=1, padx=5, pady=(1, 5), sticky="ew")

        ctk.CTkLabel(self.rules_frame, text="Règles :", width=60).grid(row=0, column=0, padx=(2,0), pady=1)

        self.entry_app_rule = ctk.CTkEntry(self.rules_frame, placeholder_text="Processus", height=24)
        self.entry_app_rule.grid(row=0, column=1, padx=2, sticky="ew")

        self.btn_scan_app = ctk.CTkButton(self.rules_frame, text="Scan App", width=60, height=24, command=lambda: self.scan_window("app"))
        self.btn_scan_app.grid(row=0, column=2, padx=2)

        self.entry_title_rule = ctk.CTkEntry(self.rules_frame, placeholder_text="Titre (Optionnel)", height=24)
        self.entry_title_rule.grid(row=0, column=3, padx=2, sticky="ew")

        self.btn_scan_title = ctk.CTkButton(self.rules_frame, text="Scan Titre", width=60, height=24, command=lambda: self.scan_window("title"))
        self.btn_scan_title.grid(row=0, column=4, padx=2)

        self.rules_frame.grid_columnconfigure(1, weight=1)
        self.rules_frame.grid_columnconfigure(3, weight=1)

        self.btn_apply_rules = ctk.CTkButton(self.rules_frame, text="✓", width=24, height=24, command=self.apply_rules_to_profile)
        self.btn_apply_rules.grid(row=0, column=5, padx=2)

        # --- Zone 3: Header Mappings (New) ---
        self.mappings_header = ctk.CTkFrame(self, fg_color="transparent")
        self.mappings_header.grid(row=2, column=1, padx=5, pady=(2, 0), sticky="ew")

        ctk.CTkLabel(self.mappings_header, text="Mappings", font=ctk.CTkFont(size=14, weight="bold")).pack(side="left", padx=5)

        self.add_mapping_btn = ctk.CTkButton(self.mappings_header, text="+ Ajouter", width=70, height=24, command=self.open_add_dialog)
        self.add_mapping_btn.pack(side="right", padx=5)

        # --- Zone 4: Liste des Mappings ---
        self.scrollable_frame = ctk.CTkScrollableFrame(self)
        self.scrollable_frame.grid(row=3, column=1, padx=5, pady=(0, 5), sticky="nsew")
        self.scrollable_frame.grid_columnconfigure(0, weight=1)

        # --- Zone 5: Pédalier Virtuel ---
        self.virtual_pedalboard = CompactPedalboardFrame(self, self.current_device_def, self.current_profile, self.simulate_midi_press)
        self.virtual_pedalboard.grid(row=4, column=1, padx=5, pady=(0, 10), sticky="ew")


    def load_data(self):
        # 1. Load Global Settings
        if os.path.exists("config.json"):
            try:
                with open("config.json", 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.settings = data.get("settings", {"midi_device_name": "AIRSTEP", "connection_mode": "MIDO"})
                    self.device_combo.set(self.settings["midi_device_name"])

                    mode = self.settings.get("connection_mode", "MIDO")
                    if mode == "BLE": self.mode_combo.set("Bluetooth (Direct)")
                    else: self.mode_combo.set("Windows (USB/Driver)")
            except: pass

        # 2. Update Device Def
        self.update_device_def()

        # 3. Load Profiles
        self.profiles = self.profile_manager.load_all_profiles()
        self.update_profile_combo()
        if self.profiles:
            self.select_profile_by_name(self.profiles[0]["name"])
        else:
            self.create_default_profile()

    def update_device_def(self):
        port_name = self.device_combo.get()
        new_def = self.device_manager.get_definition_for_port(port_name)

        # Fallback to AIRSTEP if nothing found (e.g. at startup or no device connected)
        if not new_def:
             new_def = self.device_manager.get_definition_for_port("AIRSTEP")

        # Ultimate Fallback: Just take the first one available
        if not new_def and self.device_manager.definitions:
             new_def = self.device_manager.definitions[0]

        # Absolute Last Resort: Hardcoded default
        if not new_def:
            new_def = DEFAULT_AIRSTEP_DEF

        self.current_device_def = new_def
        self.log_debug(f"Device Definition set to: {self.current_device_def.get('name')}")

        # Update btn text for confirmation?
        if self.current_device_def:
            self.btn_edit_device.configure(text=f"⚙ Conf. {self.current_device_def['name']}")
        else:
            self.btn_edit_device.configure(text="⚙ Créer Conf.")

    def open_device_editor(self):
        DeviceEditorDialog(self, self.device_manager, self.current_device_def, self.on_device_saved)

    def open_settings(self):
        SettingsDialog(self, self.profile_manager, self.action_handler, self.env_manager)

    def on_device_saved(self):
        # Reload definitions
        self.device_manager.load_all_definitions()
        self.update_device_def()
        # Update Main UI Frame
        if hasattr(self, 'virtual_pedalboard'):
            self.virtual_pedalboard.set_device_def(self.current_device_def)
        self.refresh_ui_for_profile()

    def create_default_profile(self):
        default = {
            "name": "Global / Desktop",
            "app_context": "",
            "window_title_filter": "",
            "mappings": []
        }
        self.profile_manager.save_profile(default)
        self.profiles = self.profile_manager.load_all_profiles()
        self.update_profile_combo()
        self.select_profile_by_name(default["name"])

    def update_profile_combo(self):
        names = [p["name"] for p in self.profiles]
        self.profile_combo.configure(values=names)

    def select_profile_by_name(self, name):
        self.profile_combo.set(name)
        self.current_profile = next((p for p in self.profiles if p["name"] == name), None)
        self.refresh_ui_for_profile()

    def on_profile_change(self, choice):
        self.select_profile_by_name(choice)

    def refresh_ui_for_profile(self):
        if not self.current_profile: return

        # Update Pedalboard
        if hasattr(self, 'virtual_pedalboard'):
            self.virtual_pedalboard.set_profile(self.current_profile)

        self.entry_app_rule.delete(0, "end")
        self.entry_app_rule.insert(0, self.current_profile.get("app_context", ""))

        self.entry_title_rule.delete(0, "end")
        self.entry_title_rule.insert(0, self.current_profile.get("window_title_filter", ""))

        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()

        self.mapping_indicators = {}

        # Table Config
        self.scrollable_frame.grid_columnconfigure(1, weight=1) # Col 1 (Name) expands

        mappings = self.current_profile.get("mappings", [])
        for index, mapping in enumerate(mappings):
            self.create_mapping_card(index, mapping)

    def create_mapping_card(self, index, mapping):
        # Direct Grid Layout (Table)

        # Col 0: LED Indicator
        lbl_led = ctk.CTkLabel(self.scrollable_frame, text="●", font=ctk.CTkFont(size=16), text_color="#444444", width=20)
        lbl_led.grid(row=index, column=0, padx=(5,0), pady=1)

        cc = mapping.get('midi_cc')
        if cc is not None:
             self.mapping_indicators.setdefault(cc, []).append(lbl_led)

        # Col 1: Name
        info_text = f"{mapping.get('name', '???')}"
        lbl_name = ctk.CTkLabel(self.scrollable_frame, text=info_text, anchor="w", font=ctk.CTkFont(weight="bold"))
        lbl_name.grid(row=index, column=1, padx=5, pady=1, sticky="ew")

        # Col 2: Button Name
        btn_label = f"CC {cc}"
        if self.current_device_def:
             match = next((b for b in self.current_device_def['buttons'] if b['cc'] == cc), None)
             if match:
                 btn_label = match['label']

        lbl_btn = ctk.CTkLabel(self.scrollable_frame, text=btn_label, anchor="w", text_color="silver")
        lbl_btn.grid(row=index, column=2, padx=5, pady=1, sticky="w")

        # Col 3: Details
        details_text = f"({cc}) {mapping.get('action_value')}"
        lbl_details = ctk.CTkLabel(self.scrollable_frame, text=details_text, text_color="gray", font=ctk.CTkFont(size=11), anchor="w")
        lbl_details.grid(row=index, column=3, padx=10, pady=1, sticky="w")

        # Col 4: Up
        btn_up = ctk.CTkButton(self.scrollable_frame, text="▲", width=24, height=22, fg_color="#555", hover_color="#777",
                               command=lambda i=index: self.move_mapping_up(i))
        btn_up.grid(row=index, column=4, padx=2, pady=1)

        # Col 5: Down
        btn_down = ctk.CTkButton(self.scrollable_frame, text="▼", width=24, height=22, fg_color="#555", hover_color="#777",
                                 command=lambda i=index: self.move_mapping_down(i))
        btn_down.grid(row=index, column=5, padx=2, pady=1)

        # Col 6: Edit
        edit_btn = ctk.CTkButton(self.scrollable_frame, text="✎", width=24, height=22, command=lambda i=index: self.edit_mapping(i))
        edit_btn.grid(row=index, column=6, padx=2, pady=1)

        # Col 7: Del
        del_btn = ctk.CTkButton(self.scrollable_frame, text="X", width=24, height=22, fg_color="red", hover_color="darkred",
                                command=lambda i=index: self.delete_mapping(i))
        del_btn.grid(row=index, column=7, padx=(2, 5), pady=1)

    # --- Actions Profils ---
    def create_new_profile(self):
        dialog = ctk.CTkInputDialog(text="Nom du profil (ex: Reaper) :", title="Nouveau Profil")
        name = dialog.get_input()
        if name:
            self.create_profile_by_name(name)

    def create_profile_by_name(self, name, auto_context=False):
        """Creates a profile programmatically and selects it."""
        # Check duplication
        for p in self.profiles:
            if p["name"] == name:
                self.select_profile_by_name(name)
                return

        context = ""
        if auto_context:
            context = f"{name.lower()}.exe"

        new_p = {
            "name": name,
            "app_context": context,
            "window_title_filter": "",
            "mappings": []
        }

        if self.profile_manager.save_profile(new_p):
            self.profiles = self.profile_manager.load_all_profiles()
            self.update_profile_combo()
            self.select_profile_by_name(name)

    def duplicate_current_profile(self):
        if not self.current_profile: return

        old_name = self.current_profile["name"]

        dialog = ctk.CTkInputDialog(text="Nom du nouveau profil :", title="Dupliquer Profil")

        new_name = dialog.get_input()
        if not new_name: return

        # Check if exists
        for p in self.profiles:
            if p["name"] == new_name:
                CTkMessageBox.show_error("Erreur", "Un profil avec ce nom existe déjà.")
                return

        # Deep copy manually
        import copy
        new_profile = copy.deepcopy(self.current_profile)
        new_profile["name"] = new_name

        if self.profile_manager.save_profile(new_profile):
            self.profiles = self.profile_manager.load_all_profiles()
            self.update_profile_combo()
            self.select_profile_by_name(new_name)
            CTkMessageBox.show_info("Succès", f"Profil dupliqué : {new_name}")

    def delete_current_profile(self):
        if not self.current_profile: return
        name = self.current_profile["name"]
        if CTkMessageBox.ask_yes_no("Confirmer", f"Supprimer le profil '{name}' et tous ses mappings ?"):
            self.profile_manager.delete_profile(name)
            self.profiles = self.profile_manager.load_all_profiles()
            self.update_profile_combo()
            if self.profiles:
                self.select_profile_by_name(self.profiles[0]["name"])
            else:
                self.create_default_profile()

    def apply_rules_to_profile(self):
        if not self.current_profile: return
        self.current_profile["app_context"] = self.entry_app_rule.get()
        self.current_profile["window_title_filter"] = self.entry_title_rule.get()
        self.profile_manager.save_profile(self.current_profile)
        self.btn_apply_rules.configure(fg_color="green")
        self.after(500, lambda: self.btn_apply_rules.configure(fg_color=["#3B8ED0", "#1F6AA5"]))

    # --- Shortcuts Memo ---
    def open_shortcuts_dialog(self):
        if not self.current_profile: return
        text = self.current_profile.get("shortcuts_text", "")
        ShortcutsDialog(self, text, self.on_shortcuts_saved)

    def on_shortcuts_saved(self, text):
        if self.current_profile:
            self.current_profile["shortcuts_text"] = text
            self.profile_manager.save_profile(self.current_profile)

    # --- Actions Mappings ---
    def open_add_dialog(self):
        if not self.current_profile:
             CTkMessageBox.show_info("Attention", "Aucun profil sélectionné.")
             return

        ctx = {
            "app_context": self.current_profile.get("app_context", ""),
            "window_title_filter": self.current_profile.get("window_title_filter", "")
        }
        MappingDialog(self, self.add_mapping_callback, self.current_device_def, profile_context=ctx, action_handler=self.action_handler)

    def add_mapping_callback(self, data):
        if self.current_profile:
            self.current_profile["mappings"].append(data)
            self.profile_manager.save_profile(self.current_profile)
            self.refresh_ui_for_profile()

    def edit_mapping(self, index):
        if not self.current_profile: return
        data = self.current_profile["mappings"][index]
        ctx = {
            "app_context": self.current_profile.get("app_context", ""),
            "window_title_filter": self.current_profile.get("window_title_filter", "")
        }
        MappingDialog(self, lambda d: self.update_mapping(index, d), self.current_device_def, initial_data=data, profile_context=ctx, action_handler=self.action_handler)

    def update_mapping(self, index, data):
        if self.current_profile:
            self.current_profile["mappings"][index] = data
            self.profile_manager.save_profile(self.current_profile)
            self.refresh_ui_for_profile()

    def delete_mapping(self, index):
        if self.current_profile:
            del self.current_profile["mappings"][index]
            self.profile_manager.save_profile(self.current_profile)
            self.refresh_ui_for_profile()

    def move_mapping_up(self, index):
        if not self.current_profile or index <= 0: return
        mappings = self.current_profile["mappings"]
        mappings[index], mappings[index-1] = mappings[index-1], mappings[index]
        self.profile_manager.save_profile(self.current_profile)
        self.refresh_ui_for_profile()

    def move_mapping_down(self, index):
        if not self.current_profile: return
        mappings = self.current_profile["mappings"]
        if index >= len(mappings) - 1: return
        mappings[index], mappings[index+1] = mappings[index+1], mappings[index]
        self.profile_manager.save_profile(self.current_profile)
        self.refresh_ui_for_profile()

    # --- Save ---
    def save_all(self, silent=False):
        self.settings["midi_device_name"] = self.device_combo.get()
        full_config = {"settings": self.settings}
        try:
            with open("config.json", "w", encoding="utf-8") as f:
                json.dump(full_config, f, indent=4)
        except Exception as e:
            if not silent: CTkMessageBox.show_error("Erreur", f"Erreur Config: {e}")
            return

        try:
            for p in self.profiles:
                self.profile_manager.save_profile(p)
            if not silent: CTkMessageBox.show_info("Succès", "Configuration sauvegardée !")
        except Exception as e:
            if not silent: CTkMessageBox.show_error("Erreur", f"Erreur Profils: {e}")

    # --- Remote Control ---
    def open_remote_control(self):
        if not self.current_device_def:
            CTkMessageBox.show_error("Erreur", "Aucune définition d'appareil chargée.")
            return

        # Hide Main Window
        self.withdraw()

        # Create Remote
        self.remote_win = RemoteControl(
            self,
            self.current_device_def,
            self.current_profile,
            callback_press=self.simulate_midi_press,
            callback_close=self.on_remote_close
        )
        # Start monitoring background context
        self.after(500, self._monitor_remote_context)

    def _monitor_remote_context(self):
        # Stop if remote is closed
        if not self.remote_win or not self.remote_win.winfo_exists():
            return

        if self.action_handler:
            # Avoid detecting the remote itself
            ignore = ["Remote -", "Airstep Remote", "Airstep Smart Control"]

            # Find best profile for current active window
            new_profile = self.action_handler.find_matching_profile(self.profiles, ignore_titles=ignore)

            if new_profile:
                # Update Remote UI
                self.remote_win.set_profile(new_profile)
                # Update internal state for click handling
                self.current_profile = new_profile

        # Loop
        self.after(500, self._monitor_remote_context)

    def on_remote_close(self):
        self.deiconify()
        # Monitor loop stops automatically via winfo_exists check

    # --- Scan Tools ---
    def scan_window(self, target_type):
        btn = self.btn_scan_app if target_type == "app" else self.btn_scan_title
        original_text = btn.cget("text")

        self.attributes("-topmost", True)

        def _scan_thread():
            for i in range(3, 0, -1):
                btn.configure(text=f"{i}...")
                time.sleep(1)

            self.after(0, lambda: self.attributes("-topmost", False))

            try:
                win = gw.getActiveWindow()
                if win:
                    titre = win.title
                    if target_type == "title":
                        cleaned_title = titre
                        if "YouTube" in titre:
                            cleaned_title = "YouTube"
                        else:
                            suffixes = [" - Google Chrome", " - Mozilla Firefox", " - Microsoft Edge", " - Opera"]
                            for suffix in suffixes:
                                if cleaned_title.endswith(suffix):
                                    cleaned_title = cleaned_title[:-len(suffix)]
                                    break
                        self.after(0, lambda: self._update_entry(self.entry_title_rule, cleaned_title))
                    else:
                        val = titre
                        if "Chrome" in titre or "Google" in titre: val = "chrome.exe"
                        elif "VLC" in titre: val = "vlc.exe"
                        elif "Moises" in titre: val = "moises.exe"
                        elif "Reaper" in titre: val = "reaper.exe"
                        self.after(0, lambda: self._update_entry(self.entry_app_rule, val))
            except Exception as e:
                print(e)
            self.after(0, lambda: btn.configure(text=original_text))
        threading.Thread(target=_scan_thread, daemon=True).start()

    def _update_entry(self, entry_widget, value):
        entry_widget.delete(0, "end")
        entry_widget.insert(0, value)
        # Auto apply
        self.apply_rules_to_profile()

    # --- MIDI & System ---
    def toggle_scan(self):
        if self.midi_engine:
            self.midi_engine.set_scanning(bool(self.switch_scan.get()))

    def toggle_theme(self):
        mode = "Dark" if self.theme_switch.get() else "Light"
        ctk.set_appearance_mode(mode)
        self.settings["theme"] = mode
        self.save_all(silent=True)

    def change_mode(self, choice):
        mode = "BLE" if "Bluetooth" in choice else "MIDO"
        self.settings["connection_mode"] = mode
        self.save_all(silent=True)

        target = self.device_combo.get()
        if self.midi_engine:
            self.midi_engine.stop()

        # Switch Engine
        self.midi_engine = MidiManager.create(mode, target, self.midi_callback)
        self.midi_engine.start()

        # Refresh UI list
        self.refresh_midi_ports()

    def refresh_midi_ports(self):
        # Use Engine's non-blocking port list if available
        if self.midi_engine:
            # Force scan on
            self.midi_engine.set_scanning(True)
            try: self.switch_scan.select()
            except: pass

            ports = self.midi_engine.get_ports()
            self.device_combo.configure(values=ports)

            # Debug Popup
            mode = self.settings.get("connection_mode", "MIDO")
            info = f"Mode Actuel : {mode}\n\n"
            if ports:
                info += f"{len(ports)} Appareil(s) détecté(s) :\n" + "\n".join([f"- {p}" for p in ports])
            else:
                info += "Aucun appareil détecté.\n"
                if mode == "BLE":
                    info += "Vérifiez le Bluetooth et l'alimentation.\n(Le scan BLE peut prendre quelques secondes)."
                else:
                    info += "Vérifiez le câble USB."

            if mode == "BLE" and not ports:
                info += "\n\n(Note : Le scan Bluetooth prend quelques secondes. Essayez de rafraîchir à nouveau dans 5s si l'appareil est allumé.)"

            CTkMessageBox.show_info("Diagnostic Connexion", info)
        else:
            self.device_combo.configure(values=[])

    def change_midi_device(self, choice):
        self.save_all(silent=True)
        self.update_device_def()
        if self.midi_engine:
            self.midi_engine.restart(choice)

    def on_data_received(self, cc=None, channel=None):
        if cc is not None:
            # Update LCD
            self.lbl_monitor_cc.configure(text=f"CC: {cc}")
            self.lbl_monitor_ch.configure(text=f"CH: {channel}" if channel else "CH: ?")

            # Flash LCD text
            try:
                self.lbl_monitor_cc.configure(text_color="#00FF00")
                self.after(100, lambda: self.lbl_monitor_cc.configure(text_color=("black", "white")))

                # Flash Connection LED (Activity Confirmation)
                self.lbl_conn_led.configure(text_color="#00FF00")
                self.after(100, lambda: self.lbl_conn_led.configure(text_color="green"))
            except: pass

            self.flash_mapping_row(cc)

    def flash_mapping_row(self, cc):
        indicators = self.mapping_indicators.get(cc, [])
        for lbl in indicators:
             try:
                lbl.configure(text_color="#00FF00")
                self.after(200, lambda l=lbl: l.configure(text_color="#444444"))
             except: pass

    def update_status(self, connected, message=None):
        if connected:
            self.lbl_conn_led.configure(text_color="green")
            self.lbl_conn_text.configure(text="Port Ouvert")
            # Clear error message if present
            try:
                if "Err:" in self.lbl_driver.cget("text"):
                    self.lbl_driver.configure(text="Driver KORG: OK", text_color="gray")
            except: pass
        else:
            self.lbl_conn_led.configure(text_color="red")
            self.lbl_conn_text.configure(text="Déconnecté")
            if message:
                self.lbl_driver.configure(text=f"Err: {message}", text_color="orange")

    def check_driver(self):
        installed, msg = driver_check.is_korg_driver_installed()
        if installed:
            self.lbl_driver.configure(text="Driver KORG: OK", text_color="gray")
        else:
            self.lbl_driver.configure(text="Driver KORG: MANQUANT", text_color="red")

    def check_startup_status(self):
        startup_dir = os.path.join(os.getenv('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
        self.startup_bat = os.path.join(startup_dir, "AirstepSmartControl.bat")
        return os.path.exists(self.startup_bat)

    def toggle_startup(self):
        if self.startup_var.get():
            import sys
            if getattr(sys, 'frozen', False):
                 target = f'"{sys.executable}"'
            else:
                 cwd = os.getcwd()
                 target = f'"{sys.executable}" "{os.path.join(cwd, "src", "main.py")}"'
            content = f'@echo off\ncd /d "{os.getcwd()}"\nstart "" {target}'
            try:
                with open(self.startup_bat, "w") as f:
                    f.write(content)
            except Exception as e:
                CTkMessageBox.show_error("Erreur", f"Erreur démarrage auto: {e}")
        else:
            if os.path.exists(self.startup_bat):
                try: os.remove(self.startup_bat)
                except: pass

    # --- Tray System ---
    def setup_tray(self):
        def _create_tray():
            try:
                icon_path = get_resource_path(ICON_PNG_PATH)
                if not os.path.exists(icon_path):
                    # Try finding in assets if not at root
                    if os.path.exists("assets/icon.png"): icon_path = "assets/icon.png"

                image = Image.open(icon_path)
                menu = pystray.Menu(
                    pystray.MenuItem("Ouvrir", self.restore_window, default=True),
                    pystray.MenuItem("Quitter", self.quit_app)
                )
                self.tray_icon = pystray.Icon("AirstepSmartControl", image, "Airstep Smart Control", menu)
                self.tray_icon.run()
            except Exception as e:
                self.log_debug(f"Erreur Tray: {e}")
        threading.Thread(target=_create_tray, daemon=True).start()

    def minimize_to_tray(self):
        self.withdraw()

    def restore_window(self, icon=None, item=None):
        self.after(0, self._restore_main_thread)

    def _restore_main_thread(self):
        self.deiconify()
        self.lift()
        self.focus_force()

    def simulate_midi_press(self, cc):
        """Simule l'appui physique sur une pédale (Feedback GUI + Action)"""
        # 1. Feedback GUI (LEDs, LCD)
        self.on_data_received(cc, 16) # Canal 16 par défaut pour la simulation

        # 2. Exécution réelle de l'action
        # On simule un message VALUE=127 (Press)
        # On force le profil actuel pour activer le "Focus Switch"
        if self.action_handler:
            self.action_handler.execute(cc, 127, 16, self.profiles, force_target_profile=self.current_profile)

    def quit_app(self, icon=None, item=None):
        if self.tray_icon: self.tray_icon.stop()
        if self.midi_engine: self.midi_engine.stop()
        self.quit()
