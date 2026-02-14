import customtkinter as ctk
import json
import os
import sys
import time
import threading
import datetime
import pygetwindow as gw
import keyboard
import mido
import pystray
import webbrowser
from PIL import Image
def get_resource_path(relative_path):
    """Trouve les fichiers aussi bien en Dev qu'en EXE PyInstaller"""
    if hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

# CORRECTION : On pointe vers assets/icon.png, pas juste icon.png
ICON_PNG_PATH = get_resource_path(os.path.join("assets", "icon.png"))
LOGO_PATH = get_resource_path(os.path.join("assets", "logo.png"))

try:
    from profile_manager import ProfileManager
    from device_manager import DeviceManager, DEFAULT_AIRSTEP_DEF
    from env_manager import EnvManager
    from midi_engine import MidiManager
    from action_handler import ActionHandler
    from library_manager import LibraryManager
    from remote_gui import RemoteControl, CompactPedalboardFrame
    
    # ContextMonitor Import with specific debug
    try:
        from context_monitor import ContextMonitor
    except ImportError as e:
        # If this fails in frozen app, it's fatal if fallback also fails. 
        # But we let it bubble to outer except for now, 
        # assuming --hidden-import fixed the missing file.
        raise e

except ImportError:
    from src.profile_manager import ProfileManager
    from src.device_manager import DeviceManager, DEFAULT_AIRSTEP_DEF
    from src.env_manager import EnvManager
    from src.midi_engine import MidiManager
    from src.action_handler import ActionHandler
    from src.library_manager import LibraryManager
    from src.remote_gui import RemoteControl, CompactPedalboardFrame
    from src.context_monitor import ContextMonitor

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
    def populate_output_ports(self):
        try:
             # Use Mido directly here as simpler than passing engine just for listing
             if hasattr(mido, 'get_output_names'):
                 ports = mido.get_output_names()
             else:
                 ports = []
                 
             clean_ports = list(dict.fromkeys(ports)) # Dedup
             clean_ports.insert(0, "Aucun")
             
             self.output_combo.configure(values=clean_ports)
             
             # Get current setting
             if hasattr(self.parent, 'settings'):
                 current = self.parent.settings.get("midi_output_name", "Aucun")
                 if current in clean_ports:
                     self.output_combo.set(current)
                 else:
                     self.output_combo.set("Aucun")
        except:
             self.output_combo.configure(values=["Erreur Mido"])

    def change_output_port(self, choice):
        # Save to main settings
        if hasattr(self.parent, 'settings'):
             self.parent.settings["midi_output_name"] = choice
             if choice == "Aucun":
                 choice = None
             
             # Apply immediately
             if hasattr(self.parent, 'midi_engine') and self.parent.midi_engine:
                 self.parent.midi_engine.start_output(choice)
             
             self.parent.save_all(silent=True)

    def __init__(self, parent, profile_manager, action_handler, env_manager):
        super().__init__(parent)
        self.parent = parent # Store parent to access settings/engine
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

            # Output Port Selector
            ctk.CTkLabel(tab_gen, text="Port de Sortie MIDI (Vers DAW/Synthé) :").pack(pady=(10, 5))
            self.output_combo = ctk.CTkComboBox(tab_gen, command=self.change_output_port)
            self.output_combo.pack(pady=5, padx=20, fill="x")
            
            # Populate Output Ports
            self.populate_output_ports()

            # Debounce
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
            cc = btn["cc"]
            lbl = btn["label"]
            m_type = btn.get("macro_type")
            
            if str(cc).startswith("-") or (isinstance(cc, int) and cc < 0):
                self.add_row("VIRT", lbl, m_type)
            else:
                self.add_row(cc, lbl)

        # Add Buttons
        f_btns = ctk.CTkFrame(self)
        f_btns.pack(pady=5)
        # Physical
        ctk.CTkButton(f_btns, text="+ Bouton Physique", width=120, command=lambda: self.add_row("", "")).pack(side="left", padx=5)
        
        # Macros
        ctk.CTkButton(f_btns, text="+ Macro Clavier", width=120, fg_color="#555", command=lambda: self.add_row("VIRT", "Macro Key", "hid")).pack(side="left", padx=5)
        ctk.CTkButton(f_btns, text="+ Macro MIDI", width=120, fg_color="#444", command=lambda: self.add_row("VIRT", "Macro MIDI", "midi")).pack(side="left", padx=5)

        # Save
        ctk.CTkButton(self, text="Sauvegarder", fg_color="green", command=self.save).pack(pady=20, padx=20, fill="x")

    def add_row(self, cc, label, macro_type=None):
        row = ctk.CTkFrame(self.scroll_frame)
        row.pack(fill="x", pady=2)
        
        is_virtual = (cc == "VIRT") or (isinstance(cc, int) and cc < 0)

        # CC Field
        e_cc = ctk.CTkEntry(row, width=80, placeholder_text="CC")
        if is_virtual:
             type_lbl = "MIDI" if macro_type == "midi" else "CLAVIER"
             e_cc.insert(0, f"MACRO {type_lbl}")
             e_cc.configure(state="disabled", fg_color="#333", text_color="gray")
        else:
             e_cc.insert(0, str(cc))
        e_cc.pack(side="left", padx=5)

        # Name Field
        e_lbl = ctk.CTkEntry(row, placeholder_text="Nom")
        e_lbl.insert(0, str(label))
        e_lbl.pack(side="left", fill="x", expand=True, padx=5)

        btn_del = ctk.CTkButton(row, text="X", width=30, fg_color="red", command=lambda: self.delete_row(row))
        btn_del.pack(side="right", padx=5)

        # Store macro_type in widget for save
        self.rows.append((row, e_cc, e_lbl, is_virtual, macro_type))

    def delete_row(self, row_widget):
        for i, r in enumerate(self.rows):
            if r[0] == row_widget:
                self.rows.pop(i)
                break
        row_widget.destroy()

    def save(self):
        new_buttons = []
        virtual_id_counter = -1
        
        for r in self.rows:
            try:
                # r = (row, e_cc, e_lbl, is_virtual, macro_type)
                is_virt = r[3]
                m_type = r[4]
                lbl = r[2].get()
                
                if is_virt:
                     cc = virtual_id_counter
                     virtual_id_counter -= 1
                else:
                     cc_val = r[1].get()
                     if not cc_val.strip(): continue
                     cc = int(cc_val)
                     m_type = None # Physical buttons don't have macro_type
                     
                entry = {"cc": cc, "label": lbl}
                if m_type: entry["macro_type"] = m_type
                
                new_buttons.append(entry)
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
        self.geometry("500x600")
        self.attributes("-topmost", True)

        ctk.CTkLabel(self, text="Nom de l'action :").pack(pady=(10,0))
        self.entry_name = ctk.CTkEntry(self, placeholder_text="Ex: Play YouTube")
        self.entry_name.pack(pady=5, padx=20, fill="x")
        if initial_data:
            self.entry_name.insert(0, initial_data.get("name", ""))

        ctk.CTkLabel(self, text="Bouton / MIDI CC :").pack(pady=(10,0))

        self.combo_cc = ctk.CTkComboBox(self)
        self.combo_cc.pack(pady=5, padx=20, fill="x")

        # Map display name -> {cc, macro_type}
        self.cc_map = {}
        values = []
        
        if device_def:
            for b in device_def.get("buttons", []):
                cc = b['cc']
                lbl = b['label']
                m_type = b.get("macro_type")
                
                if isinstance(cc, int) and cc < 0:
                    type_str = "MIDI" if m_type == "midi" else "CLAVIER" if m_type == "hid" else "MACRO"
                    display = f"[{type_str}] {lbl}"
                else:
                    display = f"{cc} - {lbl}"
                
                self.cc_map[display] = {"cc": cc, "macro_type": m_type}
                values.append(display)

        if not values:
            # Fallback
            for i in range(54, 59):
                d = f"{i} - Button {i}"
                self.cc_map[d] = {"cc": i, "macro_type": None}
                values.append(d)

        self.combo_cc.configure(values=values, command=self.on_trigger_change)

        # Select Initial Value
        if initial_data:
            target_cc = initial_data.get("midi_cc")
            # Find display name for this CC
            match = next((k for k, v in self.cc_map.items() if v["cc"] == target_cc), None)
            
            # Fallback for manual legacy values
            if not match:
                 match = f"{target_cc} - Inconnu"
                 self.cc_map[match] = {"cc": target_cc, "macro_type": None}
                 
            self.combo_cc.set(match)
        elif values:
            self.combo_cc.set(values[0])

        # --- Action Type Selector ---
        ctk.CTkLabel(self, text="Action à exécuter :").pack(pady=(10,0))
        self.seg_action_type = ctk.CTkSegmentedButton(self, values=["Clavier", "MIDI"], command=self.on_type_change)
        self.seg_action_type.pack(pady=5)
        self.seg_action_type.set("Clavier") 

        # --- DYNAMIC CONTENT CONTAINER ---
        # This frame reserves the space between the type selector and the bottom buttons
        self.frame_dynamic = ctk.CTkFrame(self, fg_color="transparent")
        self.frame_dynamic.pack(pady=5, padx=20, fill="x")

        # 1. Hotkey Content (To be packed into frame_dynamic)
        self.frame_hotkey = ctk.CTkFrame(self.frame_dynamic, fg_color="transparent")
        
        ctk.CTkLabel(self.frame_hotkey, text="Raccourci Clavier (Ex: k, space) :").pack(pady=(5,0))
        f_k = ctk.CTkFrame(self.frame_hotkey, fg_color="transparent")
        f_k.pack(fill="x")
        
        self.entry_key = ctk.CTkEntry(f_k, placeholder_text="space")
        self.entry_key.pack(side="left", fill="x", expand=True)

        self.btn_rec = ctk.CTkButton(f_k, text="REC", width=60, fg_color="#cc3300", hover_color="#992200", command=self.start_recording)
        self.btn_rec.pack(side="right", padx=(5,0))
        
        self.btn_test = ctk.CTkButton(f_k, text="▶", width=30, fg_color="#444", hover_color="#666", command=self.test_mapping)
        self.btn_test.pack(side="right", padx=(5,0))

        # 2. MIDI Content (To be packed into frame_dynamic)
        self.frame_midi = ctk.CTkFrame(self.frame_dynamic, fg_color="transparent")
        
        ctk.CTkLabel(self.frame_midi, text="Message MIDI :").pack(pady=(5,0))
        self.midi_msg_type = ctk.CTkSegmentedButton(self.frame_midi, values=["Control Change", "Program Change", "Note On"])
        self.midi_msg_type.pack(pady=2, fill="x")
        self.midi_msg_type.set("Control Change")
        
        # Params Row
        f_p = ctk.CTkFrame(self.frame_midi, fg_color="transparent")
        f_p.pack(pady=5, fill="x")
        
        # Channel
        f_ch = ctk.CTkFrame(f_p, fg_color="transparent")
        f_ch.pack(side="left", expand=True)
        ctk.CTkLabel(f_ch, text="Canal (1-16)").pack(side="top")
        self.ent_midi_ch = ctk.CTkEntry(f_ch, width=50, justify="center")
        self.ent_midi_ch.insert(0, "1")
        self.ent_midi_ch.pack(side="top")

        # Target
        f_tgt = ctk.CTkFrame(f_p, fg_color="transparent")
        f_tgt.pack(side="left", expand=True)
        ctk.CTkLabel(f_tgt, text="Numéro (0-127)").pack(side="top")
        self.ent_midi_target = ctk.CTkEntry(f_tgt, width=50, justify="center")
        self.ent_midi_target.insert(0, "0")
        self.ent_midi_target.pack(side="top")

        # Value
        f_val = ctk.CTkFrame(f_p, fg_color="transparent")
        f_val.pack(side="left", expand=True)
        ctk.CTkLabel(f_val, text="Valeur (0-127)").pack(side="top")
        self.ent_midi_val = ctk.CTkEntry(f_val, width=50, justify="center")
        self.ent_midi_val.insert(0, "127")
        self.ent_midi_val.pack(side="top")

        # Icon Selector (Shared, packed AFTER dynamic frame)
        ctk.CTkLabel(self, text="Icône (Optionnel) :").pack(pady=(10,0))
        self.combo_icon = ctk.CTkComboBox(self, values=["Auto", "▶", "⏸", "■", "●", "⏪", "⏩", "⟳", "🔇", "🔊", "↔", "⏱", "♪", "◴", "📍", "▲", "▼", "◄", "►", "✓", "↶", "↷", "⚡", "⚙", "📂", "🎸", "🎤", "🎹"])
        self.combo_icon.pack(pady=5, padx=20, fill="x")

        # Initial Data Loading
        if initial_data:
            # Hotkey
            self.entry_key.insert(0, initial_data.get("action_value", ""))
            
            # Action Type
            a_type = initial_data.get("action_type", "hotkey")
            if a_type == "midi":
                self.seg_action_type.set("MIDI")
                
                # Load MIDI Data
                m_type = initial_data.get("midi_out_type", "cc")
                if m_type == "cc": self.midi_msg_type.set("Control Change")
                elif m_type == "pc": self.midi_msg_type.set("Program Change")
                elif m_type == "note": self.midi_msg_type.set("Note On")
                
                self.ent_midi_ch.delete(0, "end")
                self.ent_midi_ch.insert(0, str(initial_data.get("midi_out_channel", 1)))
                
                self.ent_midi_target.delete(0, "end")
                self.ent_midi_target.insert(0, str(initial_data.get("midi_out_target", 0)))
                
                self.ent_midi_val.delete(0, "end")
                self.ent_midi_val.insert(0, str(initial_data.get("midi_out_velocity", 127)))
            else:
                self.seg_action_type.set("Clavier")

            # Icon
            if initial_data.get("custom_icon"):
                self.combo_icon.set(initial_data.get("custom_icon"))
            else:
                self.combo_icon.set("Auto")
        else:
            self.combo_icon.set("Auto")

        self.lbl_scan_info = ctk.CTkLabel(self, text="", text_color="gray", font=("Arial", 10))
        self.lbl_scan_info.pack(pady=(0, 5))

        self.btn_save = ctk.CTkButton(self, text="Valider", fg_color="green", hover_color="darkgreen", command=self.save_mapping)
        self.btn_save.pack(pady=10, padx=20, fill="x")

        # Trigger initial state
        self.on_type_change(self.seg_action_type.get())
    
    def on_trigger_change(self, choice):
        if choice in self.cc_map:
            data = self.cc_map[choice]
            m_type = data.get("macro_type")
            
            if m_type == "midi":
                self.seg_action_type.set("MIDI")
                self.on_type_change("MIDI")
            elif m_type == "hid":
                self.seg_action_type.set("Clavier")
                self.on_type_change("Clavier")

    def on_type_change(self, value):
        self.frame_hotkey.pack_forget()
        self.frame_midi.pack_forget()
        
        if value == "MIDI":
            self.frame_midi.pack(fill="both", expand=True)
        else:
            self.frame_hotkey.pack(fill="both", expand=True)

        self.lbl_scan_info.configure(text="")

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
        
        # Use map if available
        if hasattr(self, 'cc_map') and val in self.cc_map:
             cc = self.cc_map[val]["cc"]
        else:
            # Fallback parsing
            try:
                if " - " in val:
                    cc = int(val.split(" - ")[0])
                else:
                    cc = int(val)
            except ValueError:
                 # Last resort (maybe it's a raw number entered manually?)
                 try: cc = int(val)
                 except: 
                    CTkMessageBox.show_error("Erreur", "Le MIDI CC doit être valide.")
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

        # Determine Action Type
        act_type = "midi" if self.seg_action_type.get() == "MIDI" else "hotkey"
        
        # Determine MIDI Data
        midi_type = "cc"
        t_str = self.midi_msg_type.get()
        if "Program" in t_str: midi_type = "pc"
        elif "Note" in t_str: midi_type = "note"
        
        try:
             midi_ch = int(self.ent_midi_ch.get())
        except: midi_ch = 1
        
        try:
             midi_target = int(self.ent_midi_target.get())
        except: midi_target = 0
        
        try:
             midi_velocity = int(self.ent_midi_val.get())
        except: midi_velocity = 127

        return {
            "name": self.entry_name.get() or "Sans nom",
            "midi_cc": cc,
            "midi_channel": 16, # Input Channel (Always 16/Omni for now for Airstep)
            "trigger_value": "any",
            
            # New Fields
            "action_type": act_type,
            
            # Hotkey Data
            "action_value": self.entry_key.get(),
            "action_scan_code": scan_code,
            "action_modifiers": modifiers,
            "action_modifier_scan_codes": modifier_scan_codes,
            
            # MIDI Out Data
            "midi_out_type": midi_type,
            "midi_out_channel": midi_ch,
            "midi_out_target": midi_target,     # CC# / PC# / Note#
            "midi_out_velocity": midi_velocity, # Value / Velocity
            
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
        self.library_manager = LibraryManager()

        self.device_manager = DeviceManager()
        self.current_device_def = DEFAULT_AIRSTEP_DEF

        self.profiles = []
        self.current_profile = None
        self.manual_override_profile = None # For Smart Launcher
        self.mapping_indicators = {}
        self.midi_engine = None
        self.midi_callback = None
        self.action_handler = ActionHandler()
        self.action_handler.register_listener(self.on_data_received)
        self.action_handler.start_monitoring()
        self.settings = {"midi_device_name": "AIRSTEP", "connection_mode": "MIDO", "midi_output_name": "Aucun"}
        self.remote_win = None

        # --- Context Monitor ---
        # Starts a background thread to detect active windows
        self.context_monitor = ContextMonitor(self.profile_manager, self.action_handler, self.on_context_change)
        self.context_monitor.start()

        self.create_sidebar()
        self.create_main_area()

        # Start Connection Monitor (AFTER UI creation)
        self._monitor_connection_status()

        self.load_data()
        self.refresh_midi_ports()
        
        # Init Output Port
        out_port = self.settings.get("midi_output_name")
        if self.midi_engine and out_port and out_port != "Aucun":
             self.midi_engine.start_output(out_port)
        
        # Link ActionHandler to Engine (for Output)
        if self.action_handler:
            self.action_handler.set_midi_engine(self.midi_engine)
        
        self.setup_tray()
        self.last_flash_time = 0
        self._revert_timer = None

    def on_context_change(self, profile):
        """Callback from ContextMonitor when window changes"""
        # Update UI if allowed
        if not profile: return

        # Thread-safe UI update
        def _update():
            # Debug Log
            prof_name = profile.get("name") if profile else "None"
            self.log_debug(f"on_context_change callback triggered for: {prof_name}")
            
            # Avoid loop if same
            if self.current_profile and self.current_profile.get("name") == prof_name:
                 self.log_debug(f"Profile {prof_name} already active. Skipping UI refresh.")
                 return

            self.log_debug(f"Auto-Switch Profile: {prof_name}")
            
            # Select in Main UI
            self.select_profile_by_name(prof_name)
            
            # Update Remote Control specifically if open
            if hasattr(self, 'remote_win') and self.remote_win and self.remote_win.winfo_exists():
                self.log_debug(f"Updating Remote Window to {prof_name}")
                self.remote_win.set_profile(profile)
            else:
                self.log_debug(f"Remote window not open or invalid.")

        self.after(0, _update)

    def log_debug(self, message):
        try:
            timestamp = datetime.datetime.now().strftime("%H:%M:%S")
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[GUI] [{timestamp}] {message}\n")
                f.flush()
        except: pass

    def create_sidebar(self):
        self.sidebar_frame = ctk.CTkFrame(self, width=220, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, rowspan=4, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(8, weight=1) # Spacer on Row 8 (below Status)

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
                    self.settings = data.get("settings", {"midi_device_name": "AIRSTEP", "connection_mode": "MIDO", "midi_output_name": "Aucun"})
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

        # 4. Smart Launcher Wiring
        self.library_manager.import_apps_from_profiles(self.profile_manager)
        self.library_manager.set_force_profile_callback(self.force_profile_switch)

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
        self.log_debug(f"select_profile_by_name called: {name} (AppID: {id(self)})")
        new_prof = next((p for p in self.profiles if p["name"] == name), None)
        if new_prof:
             self.log_debug(f"Found Profile Object: {new_prof.get('name')} (ID: {id(new_prof)})")
             self.profile_combo.set(name) # Update combo box to reflect selection
        else:
             self.log_debug(f"Profile Object NOT FOUND for: {name}")
             # Fallback to first profile if not found, or clear selection
             if self.profiles:
                 self.profile_combo.set(self.profiles[0]["name"])
                 new_prof = self.profiles[0]
             else:
                 self.profile_combo.set("") # Clear selection if no profiles

        self.current_profile = new_prof
        if self.action_handler:
            self.action_handler.set_current_profile(new_prof)
            
        self.refresh_ui_for_profile()

    def on_profile_change(self, choice):
        self.select_profile_by_name(choice)

    def reload_and_refresh(self):
        """Reloads profiles from manager (disk), re-syncs current profile, and refreshes UI."""
        print("[GUI] Reloading profiles and refreshing UI...")
        
        # 1. Update List from Manager (Manager already reloaded from disk on save)
        self.profiles = self.profile_manager.profiles
        
        # 2. Re-acquire Current Profile Object (Sync Memory)
        if self.current_profile:
            # FIX: Use NAME as key, because ID does not exist in our simple JSONs
            current_name = self.current_profile.get("name")
            found = next((p for p in self.profiles if p.get("name") == current_name), None)
            
            if found:
                self.current_profile = found
                self.log_debug(f"Synced current profile: {found.get('name')}")
            else:
                self.log_debug(f"Warning: Current profile '{current_name}' not found after reload (Renamed?)")
                # Fallback: Don't change self.current_profile immediately, or handle gracefully
                # If not found, it might have been deleted? But we just saved it.
                # Just keep the old object reference as a fallback? No, that breaks sync.
                # If save succeeded, it MUST be there.
                pass
        
        # 3. Refresh UI
        self.refresh_ui_for_profile()
        
        # 4. Notify Server (TODO: Add Broadcast Callback if needed)
        # For now, UI refresh is key.

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
        self.log_debug("open_add_dialog called")
        try:
            if not self.current_profile:
                 self.log_debug("No profile selected")
                 CTkMessageBox.show_info("Attention", "Aucun profil sélectionné.")
                 return

            # PAUSE MONITORING to prevent conflict
            if hasattr(self, 'context_monitor') and self.context_monitor:
                self.log_debug("Pausing Monitor...")
                self.context_monitor.pause_monitoring(True)
            else:
                self.log_debug("Context Monitor NOT found or None")

            ctx = {
                "app_context": self.current_profile.get("app_context", ""),
                "window_title_filter": self.current_profile.get("window_title_filter", "")
            }
            self.log_debug(f"Creating MappingDialog with ctx: {ctx}")
            
            dialog = MappingDialog(self, self.add_mapping_callback, self.current_device_def, profile_context=ctx, action_handler=self.action_handler)
            
            self.log_debug("MappingDialog created, binding protocol...")
            dialog.protocol("WM_DELETE_WINDOW", lambda: self.on_mapping_dialog_close(dialog))
            self.log_debug("Dialog open sequence complete.")
            
        except Exception as e:
            import traceback
            err_msg = traceback.format_exc()
            self.log_debug(f"FATAL ERROR in open_add_dialog: {e}\n{err_msg}")
            
            # RESUME if error
            if hasattr(self, 'context_monitor') and self.context_monitor:
                self.context_monitor.pause_monitoring(False)
            
            CTkMessageBox.show_error("Erreur", f"Erreur lors de l'ouverture:\n{e}")

    def on_mapping_dialog_close(self, dialog):
        # RESUME MONITORING
        if hasattr(self, 'context_monitor') and self.context_monitor:
            self.context_monitor.pause_monitoring(False)
        dialog.destroy()

    def add_mapping_callback(self, data):
        if self.current_profile:
            self.current_profile["mappings"].append(data)
            self.profile_manager.save_profile(self.current_profile)
            self.reload_and_refresh()
            
            # RESUME MONITORING (Success Case)
            if hasattr(self, 'context_monitor') and self.context_monitor:
                self.context_monitor.pause_monitoring(False)

    def edit_mapping(self, index):
        if not self.current_profile: return
        data = self.current_profile["mappings"][index]
        
        # PAUSE MONITORING
        if hasattr(self, 'context_monitor') and self.context_monitor:
            self.context_monitor.pause_monitoring(True)

        ctx = {
            "app_context": self.current_profile.get("app_context", ""),
            "window_title_filter": self.current_profile.get("window_title_filter", "")
        }
        dialog = MappingDialog(self, lambda d: self.update_mapping(index, d), self.current_device_def, initial_data=data, profile_context=ctx, action_handler=self.action_handler)
        # Handle Cancel/Close via X
        dialog.protocol("WM_DELETE_WINDOW", lambda: self.on_mapping_dialog_close(dialog))

    def update_mapping(self, index, data):
        if self.current_profile:
            self.current_profile["mappings"][index] = data
            self.profile_manager.save_profile(self.current_profile)
            self.reload_and_refresh()

            # RESUME MONITORING (Success Case)
            if hasattr(self, 'context_monitor') and self.context_monitor:
                self.context_monitor.pause_monitoring(False)

    def delete_mapping(self, index):
        if self.current_profile:
            del self.current_profile["mappings"][index]
            self.profile_manager.save_profile(self.current_profile)
            self.reload_and_refresh()

    def move_mapping_up(self, index):
        if not self.current_profile or index <= 0: return
        mappings = self.current_profile["mappings"]
        mappings[index], mappings[index-1] = mappings[index-1], mappings[index]
        self.profile_manager.save_profile(self.current_profile)
        self.reload_and_refresh()

    def move_mapping_down(self, index):
        if not self.current_profile: return
        mappings = self.current_profile["mappings"]
        if index >= len(mappings) - 1: return
        mappings[index], mappings[index+1] = mappings[index+1], mappings[index]
        self.profile_manager.save_profile(self.current_profile)
        self.reload_and_refresh()

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

        # Singleton Check
        if hasattr(self, 'remote_win') and self.remote_win:
            try:
                if self.remote_win.winfo_exists():
                    # Déjà ouvert : on restaure
                    self.withdraw() 
                    self.remote_win.deiconify()
                    self.remote_win.lift()
                    self.remote_win.focus_force()
                    return
                else:
                    self.remote_win = None # Cleaning up dead reference
            except:
                self.remote_win = None

        # Hide Main Window
        self.withdraw()

        # Create Remote
        self.remote_win = RemoteControl(
            self,
            self.current_device_def,
            self.current_profile,
            callback_press=self.simulate_midi_press,
            callback_close=self.on_remote_close,
            callback_open_conf=lambda: (self.deiconify(), self.lift(), self.focus_force()),
            callback_open_web=self.open_web
        )
        # Start monitoring background context
        self.after(500, self._monitor_remote_context)

    def force_profile_switch(self, profile_name):
        """Called by LibraryManager when launching an app"""
        found = next((p for p in self.profiles if p.get("name") == profile_name), None)
        if found:
            self.manual_override_profile = found
            self.log_debug(f"FORCE PROFILE: {profile_name}")
            # Immediate Update
            self.current_profile = found
            if self.remote_win: self.remote_win.set_profile(found)
        else:
            self.log_debug(f"Cannot force profile: {profile_name} not found")

    def _monitor_remote_context(self):
        # Stop if remote is closed
        if not self.remote_win or not self.remote_win.winfo_exists():
            return

        # 1. Check Manual Override
        if self.manual_override_profile:
            # Check if we should release the lock?
            # For now, we assume user wants to stay on it until they change focus manually?
            # Or implementing a "Release" logic.
            # Simpler: If we are locked, we check if the active window is DIFFERENT from the locked context.
            # But the requirement is strict: "Force le changement".
            # We keep it locked. But how to unlock?
            # Let's say if user clicks on the remote, we are good.
            # If user switches window naturally, we might want to unlock.
            # But "Smart Launcher" implies we want the controls for that app.

            # Re-confirm logic: "set_manual_override".
            # We stick to the override until explicitly cleared.
            pass
        else:
            # 2. Auto-Detect
            if self.action_handler:
                # Avoid detecting the remote itself
                ignore = ["Remote -", "Airstep Remote", "Airstep Smart Control"]

                # Find best profile for current active window
                new_profile = self.action_handler.find_matching_profile(self.profiles, ignore_titles=ignore)

                if new_profile and new_profile != self.current_profile:
                    # Update Remote UI
                    self.remote_win.set_profile(new_profile)
                    # Update internal state for click handling
                    self.current_profile = new_profile

        # Loop
        self.after(500, self._monitor_remote_context)

    def on_remote_close(self):
        # self.deiconify() # On ne ré-ouvre PAS le backend automatiquement
        self.remote_win = None
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
        self.midi_engine = MidiManager.create(mode, target, self.midi_callback)
        self.midi_engine.start()
        
        out_port = self.settings.get("midi_output_name")
        if out_port and out_port != "Aucun":
             self.midi_engine.start_output(out_port)
             
        # Update ActionHandler
        if self.action_handler:
            self.action_handler.set_midi_engine(self.midi_engine)

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

    def midi_callback(self, msg):
        """Callback principal du moteur MIDI"""
        if not msg: return
        
        # On ne traite que les Control Change pour l'instant
        if msg.type == 'control_change':
            cc = msg.control
            val = msg.value
            chan = msg.channel + 1 # 1-based for display
            
            # Action Handler
            if self.action_handler:
                self.action_handler.execute(cc, val, chan, self.profiles, self.manual_override_profile)

    def on_data_received(self, cc=None, value=None, channel=None):
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

            # Flash Remote
            if hasattr(self, 'remote_win') and self.remote_win and self.remote_win.winfo_exists():
                self.remote_win.flash_button(cc)

            # Flash Main UI
            if hasattr(self, 'virtual_pedalboard'):
                self.virtual_pedalboard.flash_button(cc)

    def flash_mapping_row(self, cc):
        indicators = self.mapping_indicators.get(cc, [])
        for lbl in indicators:
             try:
                lbl.configure(text_color="#00FF00")
                self.after(200, lambda l=lbl: l.configure(text_color="#444444"))
             except: pass

    def _monitor_connection_status(self):
        """Vérifie périodiquement l'état de la connexion"""
        if self.midi_engine:
            connected = self.midi_engine.is_connected
            self.update_status(connected)
        else:
            self.update_status(False)
        
        # Loop 1s
        self.after(1000, self._monitor_connection_status)

    def update_status(self, connected, message=None):
        if connected:
            self.lbl_conn_led.configure(text_color="green")
            
            # Récupération du mode et du device
            mode = self.settings.get("connection_mode", "MIDO")
            mode_str = "USB" if mode == "MIDO" else "Bluetooth"
            
            # Nom du device
            dev_name = self.settings.get("midi_device_name", "Appareil")
            if dev_name in ["Recherche...", ""]: dev_name = "Appareil"
            
            # Clean name (remove index port numbers if any)
            if " " in dev_name: 
                 # Often MIDI ports are named "AIRSTEP 0" or "1- AIRSTEP"
                 # We try to keep it clean
                 pass

            self.lbl_conn_text.configure(text=f"{dev_name} ({mode_str})")
        else:
            self.lbl_conn_led.configure(text_color="red")
            self.lbl_conn_text.configure(text="Déconnecté")

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
                # Use the robust path directly
                image = Image.open(ICON_PNG_PATH)
                menu = pystray.Menu(
                    pystray.MenuItem("Télécommande", self.open_remote_from_tray, default=True),
                    pystray.MenuItem("Configuration", self.open_conf_from_tray),
                    pystray.MenuItem("Interface Web", self.open_web),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem("Quitter", self.quit_app)
                )
                self.tray_icon = pystray.Icon("AirstepSmartControl", image, "Airstep Smart Control", menu)
                self.tray_icon.run()
            except Exception as e:
                self.log_debug(f"Erreur Tray: {e}")
        threading.Thread(target=_create_tray, daemon=True).start()

    def open_remote_from_tray(self, icon=None, item=None):
        self.after(0, self.open_remote_control)

    def open_conf_from_tray(self, icon=None, item=None):
        self.after(0, lambda: (self.deiconify(), self.lift(), self.focus_force()))

    def open_web(self, icon=None, item=None):
        try:
            port = self.settings.get("app_port", 8000)
            # Default is 8000 if not in settings, but ConfigManager might have it.
            # Ideally we check where 'config' variable ended up, but here we use self.settings dict.
            # self.settings is loaded from config.json.
            url = f"http://127.0.0.1:{port}"
            webbrowser.open(url)
        except: pass

    def minimize_to_tray(self):
        self.withdraw()

    def restore_window(self, icon=None, item=None):
        self.after(0, self._restore_main_thread)

    def _restore_main_thread(self):
        # Prioritize restoring the Remote if it exists
        if hasattr(self, 'remote_win') and self.remote_win and self.remote_win.winfo_exists():
            self.remote_win.deiconify()
            self.remote_win.lift()
            self.remote_win.focus_force()
        else:
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
            self.log_debug(f"SIMULATE PRESS: AppID={id(self)}, CurrentProfile={self.current_profile.get('name') if self.current_profile else 'None'}, ID={id(self.current_profile) if self.current_profile else 'None'}")
            self.action_handler.execute(cc, 127, 16, self.profiles, force_target_profile=self.current_profile)

    def quit_app(self, icon=None, item=None):
        if self.tray_icon: self.tray_icon.stop()
        if self.midi_engine: self.midi_engine.stop()
        if self.context_monitor: self.context_monitor.stop()
        self.quit()
