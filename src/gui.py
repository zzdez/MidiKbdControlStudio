import customtkinter as ctk
import logging
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
from utils import get_app_dir, get_data_dir
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
    from config_manager import ConfigManager
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

from i18n import _

# Configuration de l'apparence
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class CTkMessageBox(ctk.CTkToplevel):
    def __init__(self, title=_("gui.msg_title"), message="", icon="info", option_text_1=_("gui.btn_ok"), option_text_2=None):
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
        msg = CTkMessageBox(title, message, option_text_1=_("gui.btn_yes"), option_text_2=_("gui.btn_no"))
        return msg.result

class ShortcutsDialog(ctk.CTkToplevel):
    def __init__(self, parent, initial_text, callback):
        super().__init__(parent)
        self.callback = callback
        self.title(_("gui.title_shortcuts"))
        self.geometry("600x600")
        self.attributes("-topmost", True)

        self.textbox = ctk.CTkTextbox(self)
        self.textbox.pack(fill="both", expand=True, padx=20, pady=20)
        self.textbox.insert("0.0", initial_text)

        self.btn_save = ctk.CTkButton(self, text=_("gui.btn_save"), command=self.save)
        self.btn_save.pack(pady=(0, 20), padx=20, fill="x")

    def save(self):
        text = self.textbox.get("0.0", "end").strip()
        self.callback(text)
        self.destroy()

class SyncConfirmationDialog(ctk.CTkToplevel):
    def __init__(self, parent, analysis_result, callback):
        super().__init__(parent)
        self.title("Récapitulatif de Synchronisation")
        self.geometry("950x850")
        self.attributes("-topmost", True)
        self.callback = callback
        self.vars = {"pull": [], "push": [], "delete_remote": [], "delete_local": []}
        self.section_cbs = {} # Global checkboxes
        
        # Handle close window (X button)
        self.protocol("WM_DELETE_WINDOW", self.on_cancel)
        self.grab_set()

        self.scroll = ctk.CTkScrollableFrame(self)
        self.scroll.pack(fill="both", expand=True, padx=20, pady=20)

        ctk.CTkLabel(self.scroll, text="Vérifiez les actions avant de lancer la synchronisation :", 
                     font=ctk.CTkFont(size=14, weight="bold")).pack(pady=10)

        # Build sections
        self._add_section("📥 Téléchargements (Cloud ➔ PC)", analysis_result.get("pull", []), "pull", "#2ecc71", default=True)
        self._add_section("📤 Envois (PC ➔ Cloud)", analysis_result.get("push", []), "push", "#3498db", default=True)
        self._add_section("🗑️ Suppressions sur le Cloud (Cloud ❌)", analysis_result.get("delete_remote", []), "delete_remote", "#e74c3c", default=False)
        self._add_section("🗑️ Suppressions sur ce PC (PC ❌)", analysis_result.get("delete_local", []), "delete_local", "#e67e22", default=False)

        # Execution Section
        ctk.CTkLabel(self, text="Progression & Logs", font=ctk.CTkFont(size=14, weight="bold")).pack(pady=(10, 5))
        self.progress_bar = ctk.CTkProgressBar(self, width=800)
        self.progress_bar.set(0)
        self.progress_bar.pack(pady=10)
        
        self.log_box = ctk.CTkTextbox(self, height=180, font=ctk.CTkFont(family="Consolas", size=11))
        self.log_box.pack(fill="both", expand=True, padx=20, pady=5)
        self.log_box.configure(state="disabled")

        self.btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.btn_frame.pack(fill="x", side="bottom", pady=20, padx=20)
        
        self.btn_sync = ctk.CTkButton(self.btn_frame, text="Lancer la Synchronisation", fg_color="green", hover_color="darkgreen", command=self.on_sync)
        self.btn_sync.pack(side="right", padx=10)
        
        self.btn_cancel = ctk.CTkButton(self.btn_frame, text="Fermer / Annuler", fg_color="#555", command=self.on_cancel)
        self.btn_cancel.pack(side="right", padx=10)

    def on_cancel(self):
        self.callback(None)
        self.destroy()

    def log_msg(self, msg):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _add_section(self, title, items, key, color, default=True):
        if not items: return
        
        header_frame = ctk.CTkFrame(self.scroll, fg_color="transparent")
        header_frame.pack(fill="x", pady=(15, 5))
        
        ctk.CTkLabel(header_frame, text=title, font=ctk.CTkFont(weight="bold", size=13), text_color=color).pack(side="left")
        
        # Select All checkbox
        toggle_var = ctk.BooleanVar(value=default)
        cb_all = ctk.CTkCheckBox(header_frame, text="Tout sélectionner", font=ctk.CTkFont(size=11), 
                                 variable=toggle_var, command=lambda k=key, v=toggle_var: self._toggle_all(k, v))
        cb_all.pack(side="right", padx=10)
        self.section_cbs[key] = (cb_all, toggle_var)
        
        # Direction mapping
        dir_map = {
            "pull": "Cloud ➔ PC",
            "push": "PC ➔ Cloud",
            "delete_remote": "Cloud ❌",
            "delete_local": "PC ❌"
        }
        direction = dir_map.get(key, "")
        
        for item in items:
            path = item["path"] if isinstance(item, dict) else item
            reason = item.get("reason", "") if isinstance(item, dict) else ""
            
            display_text = f"{direction} : {path}"
            if reason: display_text += f" ({reason})"
            
            var = ctk.BooleanVar(value=default)
            cb = ctk.CTkCheckBox(self.scroll, text=display_text, variable=var, font=ctk.CTkFont(size=11))
            cb.pack(anchor="w", padx=20, pady=2)
            self.vars[key].append((item, var))

    def _toggle_all(self, key, master_var):
        val = master_var.get()
        for item, var in self.vars[key]:
            var.set(val)

    def on_sync(self):
        self.btn_sync.configure(state="disabled")
        self.btn_cancel.configure(state="disabled")
        final_res = {
            "pull": [i for i, v in self.vars["pull"] if v.get()],
            "push": [i for i, v in self.vars["push"] if v.get()],
            "delete_remote": [i for i, v in self.vars["delete_remote"] if v.get()],
            "delete_local": [i for i, v in self.vars["delete_local"] if v.get()]
        }
        self.callback(final_res)
        # We DON'T destroy yet, as we want to see logs. 
        # run_sync will re-enable the cancel button at the end.

class SettingsDialog(ctk.CTkToplevel):
    def __init__(self, parent, profile_manager, action_handler, env_manager, midi_manager):
        super().__init__(parent)
        self.title(_("gui.tab_settings"))
        self.geometry("450x400")
        self.attributes("-topmost", True)
        self.profile_manager = profile_manager
        self.action_handler = action_handler
        self.env_manager = env_manager
        self.midi_manager = midi_manager

        try:
            self.tabview = ctk.CTkTabview(self)
            self.tabview.pack(fill="both", expand=True, padx=10, pady=10)
            self.tabview.add(_("web.tab_general"))
            self.tabview.add(_("gui.tab_backup"))

            # Tab General
            tab_gen = self.tabview.tab(_("web.tab_general"))
            ctk.CTkLabel(tab_gen, text=_("gui.lbl_debounce")).pack(pady=(20, 5))

            current_val = action_handler.debounce_delay if action_handler else 0.15
            self.lbl_debounce = ctk.CTkLabel(tab_gen, text=f"{int(current_val * 1000)} ms")
            self.lbl_debounce.pack()

            self.slider = ctk.CTkSlider(tab_gen, from_=0, to=1000, number_of_steps=100, command=self.update_label)
            self.slider.set(current_val * 1000)
            self.slider.pack(pady=10, padx=20, fill="x")

            ctk.CTkLabel(tab_gen, text=_("gui.lbl_debounce_hint"), text_color="gray", font=("Arial", 10)).pack()

            # Language Selector
            ctk.CTkLabel(tab_gen, text=_("gui.lbl_lang")).pack(pady=(15, 5))
            from config_manager import ConfigManager
            cm = ConfigManager()
            current_lang = cm.get("language", "fr")
            self.lang_combo = ctk.CTkComboBox(tab_gen, values=["fr", "en"], command=self.update_lang, state="readonly")
            self.lang_combo.set(current_lang)
            self.lang_combo.pack(pady=5)
            ctk.CTkLabel(tab_gen, text=_("gui.lbl_restart_hint"), text_color="gray", font=("Arial", 10)).pack()

            # Tab Backup
            tab_backup = self.tabview.tab(_("gui.tab_backup"))
            ctk.CTkButton(tab_backup, text=_("gui.btn_export_conf"), command=self.export_conf).pack(pady=20, padx=20, fill="x")
            ctk.CTkButton(tab_backup, text=_("gui.btn_import_conf"), command=self.import_conf).pack(pady=10, padx=20, fill="x")

            # Force set tab
            self.tabview.set(_("web.tab_general"))

            # Tab MIDI Output
            tab_midi = self.tabview.add(_("gui.lbl_midi_out"))
            ctk.CTkLabel(tab_midi, text=_("gui.lbl_midi_out")).pack(pady=(20, 5))
            
            self.midi_checkboxes = []
            self.scroll_midi = ctk.CTkScrollableFrame(tab_midi, width=300, height=200)
            self.scroll_midi.pack(pady=5, fill="both", expand=True)
            
            # Get Status (Available + Missing Configured)
            ports_status = self.midi_manager.get_ports_status()
            
            if not ports_status:
                ctk.CTkLabel(self.scroll_midi, text=_("gui.lbl_no_midi")).pack()
            
            for p in ports_status:
                name = p["name"]
                is_selected = p["selected"]
                is_connected = p["connected"]
                is_available = p["available"]
                
                # Label text logic
                lbl_text = name
                text_color = "white" # default (or None)
                
                if not is_available:
                    lbl_text += f" ({_('gui.lbl_absent')})"
                    text_color = "orange"
                elif is_selected and not is_connected:
                    lbl_text += f" ({_('gui.lbl_error')})"
                    text_color = "red"
                
                chk = ctk.CTkCheckBox(self.scroll_midi, text=lbl_text, text_color=text_color)
                if is_selected:
                    chk.select()
                
                chk.pack(anchor="w", pady=2, padx=5)
                # Store (checkbox_widget, port_name)
                self.midi_checkboxes.append((chk, name))

            ctk.CTkButton(tab_midi, text=_("gui.btn_apply"), command=self.save_midi_out).pack(pady=20)
            ctk.CTkLabel(tab_midi, text=_("gui.lbl_midi_multi_hint"), text_color="gray", font=("Arial", 10)).pack()

        except Exception as e:
            # log_debug handles the error silently or we just pass
            # with open("debug.log", "a") as f:
            #     import traceback
            #     f.write(f"SETTINGS ERROR: {e}\n{traceback.format_exc()}\n")
            CTkMessageBox.show_error(_("gui.msg_error"), f"{_('gui.msg_settings_error')}\n{e}")

    def save_midi_out(self):
        selected_ports = []
        for chk, name in self.midi_checkboxes:
            if chk.get() == 1:
                selected_ports.append(name)
        
        # Apply to Engine
        self.midi_manager.set_output_ports(selected_ports)
        
        # Persist to Config
        try:
            self.master.settings["midi_output_names"] = selected_ports
            cm = ConfigManager()
            cm.set("midi_output_names", selected_ports)
            
            # Legacy cleanup: clear single port config to avoid confusion? 
            # Or just leave it. Let's leave it.
            CTkMessageBox.show_info(_("gui.msg_info"), f"{_('gui.msg_ports_active')} : {len(selected_ports)}\n {_('gui.msg_saved')}")
        except Exception as e:
            CTkMessageBox.show_error(_("gui.msg_save_error"), str(e))

    def update_label(self, value):
        self.lbl_debounce.configure(text=f"{int(value)} ms")
        if self.action_handler:
            self.action_handler.set_debounce_delay(value / 1000.0)

    def update_lang(self, value):
        from config_manager import ConfigManager
        cm = ConfigManager()
        cm.set("language", value)
        CTkMessageBox.show_info(_("gui.msg_lang_changed_title"), _("gui.msg_lang_changed_text"))

    def export_conf(self):
        from tkinter import filedialog
        path = filedialog.asksaveasfilename(defaultextension=".zip", filetypes=[(_("gui.filetype_zip"), "*.zip")])
        if path:
            ok, msg = self.profile_manager.export_backup(path)
            if ok: CTkMessageBox.show_info(_("gui.msg_success"), _("gui.msg_export_success"))
            else: CTkMessageBox.show_error(_("gui.msg_error"), msg)

    def import_conf(self):
        from tkinter import filedialog
        path = filedialog.askopenfilename(filetypes=[(_("gui.filetype_zip"), "*.zip")])
        if path:
            if CTkMessageBox.ask_yes_no(_("gui.msg_warning"), _("gui.msg_import_confirm")):
                ok, msg = self.profile_manager.import_backup(path)
                if ok:
                    CTkMessageBox.show_info(_("gui.msg_success"), _("gui.msg_import_success"))
                else:
                    CTkMessageBox.show_error(_("gui.msg_error"), msg)

class DeviceEditorDialog(ctk.CTkToplevel):
    def __init__(self, parent, manager, current_def=None, callback=None):
        super().__init__(parent)
        self.manager = manager
        self.callback = callback
        self.title(_("gui.title_device_editor"))
        self.geometry("500x600")
        self.attributes("-topmost", True)

        self.definition = current_def if current_def else {"name": _("gui.new_device"), "buttons": []}

        # Name
        ctk.CTkLabel(self, text=_("gui.lbl_model_name")).pack(pady=(10,0))
        self.entry_name = ctk.CTkEntry(self)
        self.entry_name.insert(0, self.definition["name"])
        self.entry_name.pack(pady=5, padx=20, fill="x")

        # Buttons List
        self.scroll_frame = ctk.CTkScrollableFrame(self, label_text=_("gui.lbl_buttons_list"))
        self.scroll_frame.pack(pady=10, padx=20, fill="both", expand=True)

        self.rows = []
        for btn in self.definition.get("buttons", []):
            self.add_row(btn["cc"], btn["label"])

        # Add Button
        ctk.CTkButton(self, text=f"+ {_('gui.btn_add_button')}", command=lambda: self.add_row("", "")).pack(pady=5)

        # Save
        ctk.CTkButton(self, text=_("gui.btn_save"), fg_color="green", command=self.save).pack(pady=20, padx=20, fill="x")

    def add_row(self, cc, label):
        row = ctk.CTkFrame(self.scroll_frame)
        row.pack(fill="x", pady=2)

        e_cc = ctk.CTkEntry(row, width=60, placeholder_text=_("gui.placeholder_cc"))
        
        # Display logic
        val_display = ""
        if isinstance(cc, int) and cc < 0:
            val_display = _("gui.lbl_virtual")
            e_cc.configure(text_color="cyan")
        elif cc != "" and cc is not None:
             val_display = str(cc)
             
        e_cc.insert(0, val_display)
        e_cc.pack(side="left", padx=5)

        e_lbl = ctk.CTkEntry(row, placeholder_text=_("gui.placeholder_btn_name"))
        e_lbl.insert(0, str(label))
        e_lbl.pack(side="left", fill="x", expand=True, padx=5)

        btn_del = ctk.CTkButton(row, text="X", width=30, fg_color="red", command=lambda: self.delete_row(row))
        btn_del.pack(side="right", padx=5)

        # Store original CC to preserve ID if not changed
        self.rows.append((row, e_cc, e_lbl, cc))

    def delete_row(self, row_widget):
        for i, r in enumerate(self.rows):
            if r[0] == row_widget:
                self.rows.pop(i)
                break
        row_widget.destroy()

    def save(self):
        # 1. First pass: Collect explicit CCs and pending rows
        used_ccs = set()
        pending_rows = []

        for r in self.rows:
            # r = (row_widget, entry_cc, entry_lbl, original_cc)
            row_widget = r[0]
            e_cc = r[1]
            e_lbl = r[2]
            original_cc = r[3]
            
            val = e_cc.get().strip()
            
            # If user left "Virtuel" untouched, we try to keep original_cc if it was negative
            if val.lower() == "virtuel":
                if isinstance(original_cc, int) and original_cc < 0:
                    used_ccs.add(original_cc)
                    pending_rows.append((r, original_cc)) # Keep same ID
                else:
                    pending_rows.append((r, None)) # Re-assign
            elif val and (val.isdigit() or (val.startswith('-') and val[1:].isdigit())):
                 # Explicit number (positive or negative)
                 cc = int(val)
                 used_ccs.add(cc)
                 pending_rows.append((r, cc))
            else:
                 # Empty or invalid -> Needs assignment
                 pending_rows.append((r, None))

        # 2. Second pass: Assign available negative IDs
        next_virtual = -1
        new_buttons = []
        
        for r, assigned_cc in pending_rows:
            lbl = r[2].get().strip()
            
            final_cc = assigned_cc
            if final_cc is None:
                # Find free negative ID
                while next_virtual in used_ccs:
                    next_virtual -= 1
                final_cc = next_virtual
                used_ccs.add(final_cc)
            
            new_buttons.append({"cc": final_cc, "label": lbl})

        data = {
            "name": self.entry_name.get(),
            "buttons": new_buttons
        }
        self.manager.save_definition(data)

        if self.callback:
            self.callback()

        self.destroy()


class ProfileEditorDialog(ctk.CTkToplevel):
    def __init__(self, parent, current_profile, callback):
        super().__init__(parent)
        self.callback = callback
        self.current_profile = current_profile

        self.title(_("gui.title_profile_editor"))
        self.geometry("380x250")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        # Name
        ctk.CTkLabel(self, text=_("gui.lbl_profile_full_name")).pack(pady=(20, 5), padx=20, anchor="w")
        self.entry_name = ctk.CTkEntry(self, width=340)
        self.entry_name.pack(padx=20)
        self.entry_name.insert(0, current_profile.get("name", ""))

        # Master Vol Frame
        self.vol_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.vol_frame.pack(pady=(15, 5), padx=20, fill="x")
        
        # Label that will hold the percentage
        self.lbl_vol = ctk.CTkLabel(self.vol_frame, text=f"{_('gui.lbl_master_vol')} : 100%")
        self.lbl_vol.pack(anchor="w")
        
        # Slider
        self.slider_vol = ctk.CTkSlider(self.vol_frame, from_=0, to=100, number_of_steps=100, command=self.on_slider_change)
        self.slider_vol.pack(fill="x", pady=5)
        
        # Init value
        saved_vol = current_profile.get("target_volume", "")
        if saved_vol:
            try:
                val = float(saved_vol)
            except: val = 100.0
        else:
            val = 100.0
            
        self.slider_vol.set(val)
        self.on_slider_change(val)

        # Save Set
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(pady=25, fill="x", padx=20)
        btn_cancel = ctk.CTkButton(btn_frame, text=_("gui.btn_cancel"), width=120, fg_color="#555", hover_color="#777", command=self.destroy)
        btn_cancel.pack(side="left")
        btn_save = ctk.CTkButton(btn_frame, text=_("gui.btn_save"), width=120, fg_color="green", hover_color="darkgreen", command=self.save)
        btn_save.pack(side="right")

    def on_slider_change(self, value):
        self.lbl_vol.configure(text=f"{_('gui.lbl_master_vol')} : {int(value)}%")

    def save(self):
        new_name = self.entry_name.get().strip()
        new_val = str(int(self.slider_vol.get()))
        
        if not new_name:
            CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_profile_name_empty"))
            return

        self.callback(new_name, new_val)
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

        self.title(_("gui.title_edit_action") if initial_data else _("gui.title_add_action"))
        self.geometry("450x450")
        self.attributes("-topmost", True)

        ctk.CTkLabel(self, text=_("gui.lbl_action_name")).pack(pady=(10,0))
        self.entry_name = ctk.CTkEntry(self, placeholder_text=_("gui.placeholder_action_name"))
        self.entry_name.pack(pady=5, padx=20, fill="x")
        if initial_data:
            self.entry_name.insert(0, initial_data.get("name", ""))

        ctk.CTkLabel(self, text=_("gui.lbl_button_midi_cc")).pack(pady=(10,0))

        self.combo_cc = ctk.CTkComboBox(self)
        self.combo_cc.pack(pady=5, padx=20, fill="x")

        # Populate values
        values = []
        if device_def:
            for b in device_def.get("buttons", []):
                cc = b['cc']
                lbl = b['label']
                if cc < 0:
                     values.append(f"{cc} - {lbl} ({_('gui.lbl_virtual')})")
                else:
                     values.append(f"{cc} - {lbl}")

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
        ctk.CTkLabel(self, text=_("gui.lbl_icon_opt")).pack(pady=(10,0))
        self.combo_icon = ctk.CTkComboBox(self, values=[_("gui.lbl_auto"), "▶", "⏸", "■", "●", "⏪", "⏩", "⟳", "🔇", "🔊", "↔", "⏱", "♪", "◴", "📍", "▲", "▼", "◄", "►", "✓", "↶", "↷", "⚡", "⚙", "📂", "🎸", "🎤", "🎹"])
        self.combo_icon.pack(pady=5, padx=20, fill="x")

        if initial_data and initial_data.get("custom_icon"):
            self.combo_icon.set(initial_data.get("custom_icon"))
        else:
            self.combo_icon.set(_("gui.lbl_auto"))

        # Action Type Selector
        ctk.CTkLabel(self, text=_("gui.lbl_action_type")).pack(pady=(10,0))
        self.combo_type = ctk.CTkComboBox(self, values=[_("gui.type_hotkey"), _("gui.type_command"), _("gui.type_midi")], command=self.update_ui_state)
        self.combo_type.pack(pady=5, padx=20, fill="x")

        # --- Frames for different types ---
        self.frame_hotkey = ctk.CTkFrame(self, fg_color="transparent")
        self.frame_command = ctk.CTkFrame(self, fg_color="transparent")
        self.frame_midi = ctk.CTkFrame(self, fg_color="transparent")

        # 1. Hotkey UI
        ctk.CTkLabel(self.frame_hotkey, text=_("gui.lbl_keyboard_key")).pack(pady=(5,0))
        self.sub_hotkey = ctk.CTkFrame(self.frame_hotkey, fg_color="transparent")
        self.sub_hotkey.pack(fill="x")
        
        self.entry_key = ctk.CTkEntry(self.sub_hotkey, placeholder_text="space")
        self.entry_key.pack(side="left", fill="x", expand=True)

        self.btn_test = ctk.CTkButton(self.sub_hotkey, text="▶", width=30, fg_color="#444", hover_color="#666", command=self.test_mapping)
        self.btn_test.pack(side="right", padx=(5,0))

        self.btn_rec = ctk.CTkButton(self.sub_hotkey, text=_("gui.btn_rec"), width=60, fg_color="#cc3300", hover_color="#992200", command=self.start_recording)
        self.btn_rec.pack(side="right", padx=(5,0))
        
        self.lbl_scan_info = ctk.CTkLabel(self.frame_hotkey, text="", text_color="gray", font=("Arial", 10))
        self.lbl_scan_info.pack(pady=(0, 5))

        # 2. Command UI
        ctk.CTkLabel(self.frame_command, text=_("gui.lbl_command")).pack(pady=(5,0))
        self.entry_cmd = ctk.CTkEntry(self.frame_command, placeholder_text="media_play_pause")
        self.entry_cmd.pack(fill="x")

        # 3. MIDI Out UI
        ctk.CTkLabel(self.frame_midi, text=_("gui.lbl_midi_msg")).pack(pady=(5,0))
        
        f_midi_row = ctk.CTkFrame(self.frame_midi, fg_color="transparent")
        f_midi_row.pack(fill="x")
        
        # Channel
        ctk.CTkLabel(f_midi_row, text=_("gui.lbl_midi_ch")).pack(side="left", padx=2)
        self.entry_midi_ch = ctk.CTkEntry(f_midi_row, width=40)
        self.entry_midi_ch.pack(side="left", padx=2)
        self.entry_midi_ch.insert(0, "1")

        # CC
        ctk.CTkLabel(f_midi_row, text=_("gui.lbl_midi_cc")).pack(side="left", padx=2)
        self.entry_midi_cc = ctk.CTkEntry(f_midi_row, width=40)
        self.entry_midi_cc.pack(side="left", padx=2)
        
        # Value
        ctk.CTkLabel(f_midi_row, text=_("gui.lbl_midi_val")).pack(side="left", padx=2)
        self.entry_midi_val = ctk.CTkEntry(f_midi_row, width=40)
        self.entry_midi_val.pack(side="left", padx=2)
        self.entry_midi_val.insert(0, "127")


        # Load Initial Data
        if initial_data:
            a_type = initial_data.get("action_type", "hotkey")
            
            if a_type == "midi":
                 self.combo_type.set(_("gui.type_midi"))
                 self.entry_midi_ch.delete(0, "end")
                 self.entry_midi_ch.insert(0, str(initial_data.get("output_channel", 1)))
                 self.entry_midi_cc.delete(0, "end")
                 self.entry_midi_cc.insert(0, str(initial_data.get("output_cc", 0)))
                 self.entry_midi_val.delete(0, "end")
                 self.entry_midi_val.insert(0, str(initial_data.get("output_value", 127)))
                 
            elif a_type == "command":
                 self.combo_type.set(_("gui.type_command"))
                 self.entry_cmd.insert(0, initial_data.get("action_value", ""))
                 
            else:
                 self.combo_type.set(_("gui.type_hotkey"))
                 self.entry_key.insert(0, initial_data.get("action_value", ""))

            # Handle legacy "command" stored as hotkey with "media_" prefix?
            # Existing code handled "media_" in trigger_keystroke. 
            # We can expose it as Command type now if we want, but legacy compat is fine.

        self.update_ui_state(self.combo_type.get())

        self.btn_save = ctk.CTkButton(self, text=_("gui.btn_validate"), fg_color="green", hover_color="darkgreen", command=self.save_mapping)
        self.btn_save.pack(pady=10, padx=20, fill="x")

    def update_ui_state(self, choice):
        self.frame_hotkey.pack_forget()
        self.frame_command.pack_forget()
        self.frame_midi.pack_forget()
        
        if choice == _("gui.type_hotkey"):
            self.frame_hotkey.pack(fill="x", padx=20, pady=5)
        elif choice == _("gui.type_command"):
            self.frame_command.pack(fill="x", padx=20, pady=5)
        elif choice == _("gui.type_midi"):
            self.frame_midi.pack(fill="x", padx=20, pady=5)

    def start_recording(self):
        self.btn_rec.configure(text="...", state="disabled")
        self.entry_key.delete(0, "end")
        self.entry_key.insert(0, _("gui.msg_press_key"))

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
                # with open("debug.log", "a") as f:
                #     import traceback
                #     f.write(f"REC ERROR: {e}\n{traceback.format_exc()}\n")
                self.after(0, lambda: self.finish_recording(None))

        threading.Thread(target=_rec_thread, daemon=True).start()

    def finish_recording(self, result):
        if result:
            self.entry_key.delete(0, "end")
            self.entry_key.insert(0, result["name"])
            self.current_rec_data = result
            self.lbl_scan_info.configure(text=f"{_('gui.lbl_scan_code')}: {result['scan_code']} (+{len(result.get('modifier_scan_codes', []))} mods)")
        else:
            self.entry_key.delete(0, "end")
            self.entry_key.insert(0, _("gui.lbl_error"))
            self.lbl_scan_info.configure(text="")

        self.btn_rec.configure(text="REC", state="normal")

    def test_mapping(self):
        """Teste le mapping avec un compte à rebours pour laisser l'utilisateur changer le focus"""
        mapping_data = self._build_mapping_data_from_ui()
        if not mapping_data: return

        if not self.action_handler:
             CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_handler_missing"))
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
            CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_midi_cc_invalid"))
            return None

        scan_code = None
        modifiers = []
        modifier_scan_codes = []
        
        type_choice = self.combo_type.get()
        action_type = "hotkey"
        if type_choice == _("gui.type_command"): action_type = "command"
        elif type_choice == _("gui.type_midi"): action_type = "midi"
        
        action_val = ""
        
        # Output MIDI placeholders
        out_ch = 1
        out_cc = 0
        out_val = 127

        if type_choice == "Raccourci Clavier":
            action_type = "hotkey"
            action_val = self.entry_key.get()
            
            if self.current_rec_data and self.current_rec_data.get("name") == action_val:
                 scan_code = self.current_rec_data.get("scan_code")
                 modifiers = self.current_rec_data.get("modifiers")
                 modifier_scan_codes = self.current_rec_data.get("modifier_scan_codes", [])
            elif self.initial_data and self.initial_data.get("action_value") == action_val:
                 scan_code = self.initial_data.get("action_scan_code")
                 modifiers = self.initial_data.get("action_modifiers")
                 modifier_scan_codes = self.initial_data.get("action_modifier_scan_codes", [])

        elif action_type == "command":
            action_val = self.entry_cmd.get()
        elif action_type == "midi":
            try:
                out_ch = int(self.entry_midi_ch.get())
                out_cc = int(self.entry_midi_cc.get())
                out_val = int(self.entry_midi_val.get())
                action_val = f"MIDI ch{out_ch} cc{out_cc} v{out_val}" # For display
            except:
                CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_midi_vals_invalid"))
                return None

        icon_val = self.combo_icon.get()
        custom_icon = icon_val if icon_val != _("gui.lbl_auto") else None

        return {
            "name": self.entry_name.get() or _("gui.lbl_no_name"),
            "midi_cc": cc,
            "midi_channel": 16, # Input Channel
            "trigger_value": "any",
            
            "action_type": action_type,
            "action_value": action_val,
            
            # Hotkey specific
            "action_scan_code": scan_code,
            "action_modifiers": modifiers,
            "action_modifier_scan_codes": modifier_scan_codes,
            
            # MIDI specific
            "output_channel": out_ch,
            "output_cc": out_cc,
            "output_value": out_val,
            
            "custom_icon": custom_icon
        }

    def save_mapping(self):
        data = self._build_mapping_data_from_ui()
        if data:
            self.callback(data)
            self.destroy()


# VirtualPedalboard replaced by CompactPedalboardFrame from remote_gui.py

class MidiKbdApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(_("gui.main_title"))
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
        # V6.1: Force use of DATA_DIR for library stability
        lib_path = os.path.join(get_data_dir(), "library.json")
        self.library_manager = LibraryManager(lib_path)

        self.device_manager = DeviceManager()
        self.current_device_def = None

        self.profiles = []
        self.current_profile = None
        self.manual_override_profile = None # For Smart Launcher
        self.mapping_indicators = {}
        self.mapping_indicators = {}
        # New Stateful MidiManager (Radical Stabilization)
        self.midi_manager = MidiManager(self.midi_callback)
        
        self.action_handler = ActionHandler()
        self.action_handler.set_profile_manager(self.profile_manager)
        self.action_handler.set_midi_manager(self.midi_manager)
        self.action_handler.register_listener(self.on_data_received)
        self.action_handler.start_monitoring()
        self.settings = {"midi_device_name": "", "connection_mode": "MIDO"}
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
        # SILENT STARTUP: Removed explicit refresh
        # self.refresh_midi_ports()
        
        self.setup_tray()
        self.last_flash_time = 0
        self._revert_timer = None
        
        # Start Engine (Delayed)
        self.after(1000, self.start_engine)

    def start_engine(self):
        try:
            mode = self.settings.get("connection_mode", "MIDO") # BLE or MIDO
            
            # SMART PERSISTENCE LOAD
            target = ""
            if mode == "BLE":
                target = self.settings.get("midi_device_name_ble", "")
            else:
                target = self.settings.get("midi_device_name_usb", "")

            # Sync legacy field just in case
            self.settings["midi_device_name"] = target

            self.log_debug(f"Starting Engine (Silent): Mode={mode}, Target={target}")
            self.midi_manager.switch_mode(mode, target)
        except Exception as e:
            self.log_debug(f"Startup Error: {e}")

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
        # logging is now disabled to save disk space
        pass

    def create_sidebar(self):
        self.sidebar_frame = ctk.CTkFrame(self, width=220, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, rowspan=4, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(8, weight=1) # Spacer is row 8

        # 1. Logo
        try:
             pil_img = Image.open(LOGO_PATH)
             logo_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(220, 40))
             self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="", image=logo_img)
        except Exception as e:
             print(f"Logo Load Error: {e}")
             self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="MIDI-KBD\nControl", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=10, pady=(10, 5))

        # 2. MIDI Mode & Selector
        self.lbl_mode = ctk.CTkLabel(self.sidebar_frame, text=_("gui.lbl_conn_mode"), anchor="w")
        self.lbl_mode.grid(row=1, column=0, padx=20, pady=(5, 0), sticky="w")

        self.mode_combo = ctk.CTkComboBox(self.sidebar_frame, values=[_("gui.mode_usb"), _("gui.mode_ble")], command=self.change_mode, height=24)
        self.mode_combo.grid(row=2, column=0, padx=20, pady=(0, 5))

        self.lbl_device = ctk.CTkLabel(self.sidebar_frame, text=_("gui.lbl_device"), anchor="w")
        self.lbl_device.grid(row=3, column=0, padx=20, pady=(5, 0), sticky="w")

        self.device_combo = ctk.CTkComboBox(self.sidebar_frame, values=[_("gui.msg_searching")], command=self.change_midi_device, height=24)
        self.device_combo.grid(row=4, column=0, padx=20, pady=(0, 5))

        self.btn_refresh = ctk.CTkButton(self.sidebar_frame, text=_("gui.btn_refresh"), width=100, height=24, command=self.refresh_midi_ports)
        self.btn_refresh.grid(row=5, column=0, padx=20, pady=5)

        # 3. Device & Settings
        self.settings_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.settings_frame.grid(row=6, column=0, padx=10, pady=5)
        self.btn_edit_device = ctk.CTkButton(self.settings_frame, text=f"⚙ {_('gui.btn_buttons')}", width=90, height=24, fg_color="#555", command=self.open_device_editor)

        # Update text update logic
        if self.current_device_def:
            self.btn_edit_device.configure(text=f"⚙ {self.current_device_def['name'][:10]}")
        else:
            self.btn_edit_device.configure(text=f"⚙ {_('gui.btn_configure')}")
        
        # Missing Pack restored
        self.btn_edit_device.pack(side="left", padx=2)

        # Missing Settings Button restored
        self.btn_settings = ctk.CTkButton(self.settings_frame, text=f"🛠 {_('gui.btn_settings')}", width=90, height=24, fg_color="#555", command=self.open_settings)
        self.btn_settings.pack(side="left", padx=2)

        self.status_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.status_frame.grid(row=7, column=0, padx=20, pady=5, sticky="ew")

        # Connection State
        self.conn_frame = ctk.CTkFrame(self.status_frame, fg_color="transparent")
        self.conn_frame.pack(fill="x", pady=2)

        self.lbl_conn_led = ctk.CTkLabel(self.conn_frame, text="●", font=ctk.CTkFont(size=18), text_color="red")
        self.lbl_conn_led.pack(side="left", padx=(0, 5))
        self.lbl_conn_text = ctk.CTkLabel(self.conn_frame, text=_("gui.lbl_disconnected"), font=ctk.CTkFont(size=12, weight="bold"))
        self.lbl_conn_text.pack(side="left")

        # LCD Monitor
        self.monitor_frame = ctk.CTkFrame(self.status_frame, fg_color=("gray90", "gray20"), corner_radius=5)
        self.monitor_frame.pack(fill="x", pady=5)

        self.lbl_monitor_cc = ctk.CTkLabel(self.monitor_frame, text=f"{_('gui.lbl_monitor_cc')}: --", font=ctk.CTkFont(family="Consolas", size=14, weight="bold"))
        self.lbl_monitor_cc.pack(side="left", padx=10, pady=5)

        self.lbl_monitor_ch = ctk.CTkLabel(self.monitor_frame, text=f"{_('gui.lbl_monitor_ch')}: --", font=ctk.CTkFont(family="Consolas", size=11))
        self.lbl_monitor_ch.pack(side="right", padx=10, pady=5)

        # Auto-Scan Switch
        self.switch_scan = ctk.CTkSwitch(self.status_frame, text=_("gui.lbl_auto_scan"), command=self.toggle_scan, font=ctk.CTkFont(size=11), width=80, height=24)
        self.switch_scan.select()
        self.switch_scan.pack(pady=(5, 0), anchor="w")

        # Theme Switch
        self.theme_switch = ctk.CTkSwitch(self.status_frame, text=_("gui.lbl_dark_mode"), command=self.toggle_theme, font=ctk.CTkFont(size=11), width=80, height=24)

        # Load theme setting
        current_theme = self.settings.get("theme", "Dark")
        if current_theme == "Dark":
            self.theme_switch.select()
            ctk.set_appearance_mode("Dark")
        else:
            self.theme_switch.deselect()
            ctk.set_appearance_mode("Light")

        self.theme_switch.pack(pady=(5, 0), anchor="w")

        # Spacer (Row 8)
        ctk.CTkLabel(self.sidebar_frame, text="").grid(row=8, column=0)

        # 5. Startup
        is_startup = self.check_startup_status()
        self.startup_var = ctk.BooleanVar(value=is_startup)
        self.chk_startup = ctk.CTkCheckBox(self.sidebar_frame, text=_("gui.lbl_launch_at_startup"), variable=self.startup_var, command=self.toggle_startup, font=ctk.CTkFont(size=12))
        self.chk_startup.grid(row=9, column=0, padx=20, pady=10, sticky="w")

        # 6. Global Actions
        self.btn_remote = ctk.CTkButton(self.sidebar_frame, text=_("gui.btn_detach_remote"), command=self.open_remote_control, fg_color="#444", hover_color="#666", height=28)
        self.btn_remote.grid(row=10, column=0, padx=20, pady=(10, 2))

        self.btn_sync = ctk.CTkButton(self.sidebar_frame, text="☁ Sync", command=self.open_sync_dialog, fg_color="#0066cc", hover_color="#004499", height=28)
        self.btn_sync.grid(row=11, column=0, padx=20, pady=(2, 5))

        self.save_button = ctk.CTkButton(self.sidebar_frame, text=_("gui.btn_save_all"), command=lambda: self.save_all(silent=False), fg_color="green", hover_color="darkgreen", height=28)
        self.save_button.grid(row=12, column=0, padx=20, pady=(5, 20))

    def create_main_area(self):
        # Configuration de la grille principale
        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=0)
        self.grid_rowconfigure(2, weight=0)
        self.grid_rowconfigure(3, weight=1)

        # --- Zone 1: Sélection du Profil ---
        self.profile_frame = ctk.CTkFrame(self, corner_radius=5)
        self.profile_frame.grid(row=0, column=1, padx=5, pady=(5, 1), sticky="ew")

        ctk.CTkLabel(self.profile_frame, text=_("gui.lbl_profile", default="Profil :"), font=ctk.CTkFont(weight="bold")).pack(side="left", padx=(5, 2), pady=2)

        self.profile_combo = ctk.CTkComboBox(self.profile_frame, width=200, height=24, command=self.on_profile_change)
        self.profile_combo.pack(side="left", padx=2, pady=2)

        self.btn_new_profile = ctk.CTkButton(self.profile_frame, text="+", width=24, height=24, command=self.create_new_profile)
        self.btn_new_profile.pack(side="left", padx=2, pady=2)

        self.btn_dup_profile = ctk.CTkButton(self.profile_frame, text="❐", width=24, height=24, fg_color="#555", hover_color="#777", command=self.duplicate_current_profile)
        self.btn_dup_profile.pack(side="left", padx=2, pady=2)

        self.btn_edit_profile = ctk.CTkButton(self.profile_frame, text="✎", width=24, height=24, fg_color="#555", hover_color="#777", command=self.edit_current_profile)
        self.btn_edit_profile.pack(side="left", padx=2, pady=2)

        self.btn_del_profile = ctk.CTkButton(self.profile_frame, text=_("gui.btn_delete_short"), width=40, height=24, fg_color="red", hover_color="darkred", command=self.delete_current_profile)
        self.btn_del_profile.pack(side="left", padx=2, pady=2)

        # Shortcut Memo Button
        self.btn_shortcuts = ctk.CTkButton(self.profile_frame, text=f"📝 {_('gui.btn_memo')}", width=60, height=24, command=self.open_shortcuts_dialog)
        self.btn_shortcuts.pack(side="right", padx=5, pady=2)

        # --- Zone 2: Règles de Détection ---
        self.rules_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.rules_frame.grid(row=1, column=1, padx=5, pady=(1, 5), sticky="ew")

        ctk.CTkLabel(self.rules_frame, text=_("gui.lbl_rules"), width=60).grid(row=0, column=0, padx=(2,0), pady=1)

        self.entry_app_rule = ctk.CTkEntry(self.rules_frame, placeholder_text=_("gui.placeholder_process"), height=24)
        self.entry_app_rule.grid(row=0, column=1, padx=2, sticky="ew")

        self.btn_scan_app = ctk.CTkButton(self.rules_frame, text=_("gui.btn_scan_app"), width=60, height=24, command=lambda: self.scan_window("app"))
        self.btn_scan_app.grid(row=0, column=2, padx=2)

        self.entry_title_rule = ctk.CTkEntry(self.rules_frame, placeholder_text=_("gui.placeholder_title_opt"), height=24)
        self.entry_title_rule.grid(row=0, column=3, padx=2, sticky="ew")

        self.btn_scan_title = ctk.CTkButton(self.rules_frame, text=_("gui.btn_scan_title"), width=60, height=24, command=lambda: self.scan_window("title"))
        self.btn_scan_title.grid(row=0, column=4, padx=2)

        self.entry_vol_rule = ctk.CTkEntry(self.rules_frame, placeholder_text=_("gui.placeholder_os_vol"), height=24, width=70)
        self.entry_vol_rule.grid(row=0, column=5, padx=2)

        self.rules_frame.grid_columnconfigure(1, weight=1)
        self.rules_frame.grid_columnconfigure(3, weight=1)

        self.btn_apply_rules = ctk.CTkButton(self.rules_frame, text="✓", width=24, height=24, command=self.apply_rules_to_profile)
        self.btn_apply_rules.grid(row=0, column=6, padx=2)

        # --- Zone 3: Header Mappings (New) ---
        self.mappings_header = ctk.CTkFrame(self, fg_color="transparent")
        self.mappings_header.grid(row=2, column=1, padx=5, pady=(2, 0), sticky="ew")

        ctk.CTkLabel(self.mappings_header, text=_("gui.lbl_mappings"), font=ctk.CTkFont(size=14, weight="bold")).pack(side="left", padx=5)

        self.add_mapping_btn = ctk.CTkButton(self.mappings_header, text=f"+ {_('gui.btn_add')}", width=70, height=24, command=self.open_add_dialog)
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
        from utils import get_app_dir
        config_path = os.path.join(get_app_dir(), "config.json")
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.settings = data.get("settings", {"midi_device_name": "", "connection_mode": "MIDO"})
                    
                    if "midi_output_names" not in self.settings:
                        from config_manager import ConfigManager
                        cm = ConfigManager()
                        self.settings["midi_output_names"] = cm.get("midi_output_names", [])

                    mode = self.settings.get("connection_mode", "MIDO")
                    if mode == "BLE": 
                        self.mode_combo.set(_("gui.mode_ble"))
                        target = self.settings.get("midi_device_name_ble", self.settings.get("midi_device_name", ""))
                    else: 
                        self.mode_combo.set(_("gui.mode_usb"))
                        target = self.settings.get("midi_device_name_usb", self.settings.get("midi_device_name", ""))
                        
                    self.device_combo.set(target)
                    
                    # LOAD MIDI OUTPUT
                    # LOAD MIDI OUTPUT (Multi-Port Support)
                    out_ports = self.settings.get("midi_output_names", [])
                    
                    # Migration: If list empty but legacy single port exists
                    if not out_ports:
                        old_port = self.settings.get("midi_output_port", None)
                        if old_port:
                            out_ports = [old_port]
                            # Auto-migrate config in memory (will be saved on exit)
                            self.settings["midi_output_names"] = out_ports
                            
                            
                    resolved = self.midi_manager.set_output_ports(out_ports)
                    if resolved and resolved != out_ports:
                        self.settings["midi_output_names"] = resolved
                        # Persist smart match automatically
                        try:
                            from config_manager import ConfigManager
                            cm = ConfigManager()
                            cm.set("midi_output_names", resolved)
                        except: pass

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
        
        # If combo says "Recherche...", use the actual target for the current mode
        if port_name in [_("gui.msg_searching_full"), _("gui.msg_searching"), _("gui.lbl_none"), ""]:
            mode = self.settings.get("connection_mode", "MIDO")
            if mode == "BLE":
                port_name = self.settings.get("midi_device_name_ble", "")
            else:
                port_name = self.settings.get("midi_device_name_usb", "")

        new_def = self.device_manager.get_definition_for_port(port_name)

        # Fallback to AIRSTEP if nothing found (e.g. at startup or no device connected)
        # if not new_def:
        #      new_def = self.device_manager.get_definition_for_port("AIRSTEP")

        # Ultimate Fallback: Just take the first one available
        if not new_def and self.device_manager.definitions:
             new_def = self.device_manager.definitions[0]

        # Absolute Last Resort: Hardcoded default
        if not new_def:
            new_def = {"name": _("gui.lbl_no_device"), "buttons": []}

        self.current_device_def = new_def
        self.log_debug(f"Device Definition set to: {self.current_device_def.get('name')}")

        if hasattr(self, 'virtual_pedalboard'):
            self.virtual_pedalboard.set_device_def(self.current_device_def)

        # Update btn text for confirmation
        if self.current_device_def:
            self.btn_edit_device.configure(text=f"⚙ {self.current_device_def['name']}")
        else:
            self.btn_edit_device.configure(text=f"⚙ {_('gui.btn_configure')}")

    def open_device_editor(self):
        DeviceEditorDialog(self, self.device_manager, self.current_device_def, self.on_device_saved)

    def open_settings(self):
        SettingsDialog(self, self.profile_manager, self.action_handler, self.env_manager, self.midi_manager)

    def open_sync_dialog(self):
        from utils import get_app_dir
        import threading
        import json
        import os
        
        config_path = os.path.join(get_app_dir(), "config.json")
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                conf = json.load(f)
        except:
            conf = {}
        sync_conf = conf.get("sync", {"type": "sftp", "host": "", "port": 22, "username": "", "password": "", "remote_dir": "", "target_dir": ""})

        # Load saved categories or defaults
        stored_cats = sync_conf.get("categories", ["exe", "medias", "data", "system", "profiles", "devices"])

        dialog = ctk.CTkToplevel(self)
        dialog.title(_("sync.title"))
        dialog.geometry("520x450")
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()

        tabs = ctk.CTkTabview(dialog)
        tabs.pack(fill="both", expand=True, padx=10, pady=5)
        tab_sync = tabs.add("Synchronisation")
        tab_conf = tabs.add("SFTP")
        tab_webdav = tabs.add("WebDAV")
        tab_local = tabs.add("Local")

        # --- TAB SYNC ---
        ctk.CTkLabel(tab_sync, text=_("sync.title"), font=ctk.CTkFont(size=16, weight="bold")).pack(pady=(10, 5))
        
        type_var = ctk.StringVar(value=sync_conf.get("type", "sftp"))
        radio_frame = ctk.CTkFrame(tab_sync, fg_color="transparent")
        radio_frame.pack(pady=5)
        ctk.CTkRadioButton(radio_frame, text="SFTP", variable=type_var, value="sftp").pack(side="left", padx=10)
        ctk.CTkRadioButton(radio_frame, text="WebDAV", variable=type_var, value="webdav").pack(side="left", padx=10)
        ctk.CTkRadioButton(radio_frame, text="Local", variable=type_var, value="local").pack(side="left", padx=10)
        
        # Sync Mode selection
        ctk.CTkLabel(tab_sync, text="Mode de Synchronisation:", font=ctk.CTkFont(size=12, weight="bold")).pack(pady=(10, 0))
        mode_var = ctk.StringVar(value=sync_conf.get("mode", "Bidirectionnel (Auto)"))
        mode_menu = ctk.CTkOptionMenu(tab_sync, values=["Bidirectionnel (Auto)", "Réception (Pull Only)", "Envoi (Push Only)"], variable=mode_var)
        mode_menu.pack(pady=5)
        
        # Categories Frame
        cat_frame = ctk.CTkFrame(tab_sync)
        cat_frame.pack(fill="x", padx=20, pady=10)
        ctk.CTkLabel(cat_frame, text=_("sync.lbl_categories"), font=ctk.CTkFont(size=12, weight="bold")).pack(pady=5)
        
        cat_vars = {}
        categories = [
            ("exe", _("sync.cat_exe")),
            ("medias", _("sync.cat_medias")),
            ("data", _("sync.cat_data")),
            ("profiles", _("sync.cat_profiles")),
            ("devices", _("sync.cat_devices")),
            ("system", _("sync.cat_system"))
        ]
        
        def open_exceptions_modal(category_key, category_label):
            import traceback
            import logging
            
            try:
                from sync_manager import SyncManager, LocalProvider
                
                exc_dialog = ctk.CTkToplevel(dialog)
                exc_dialog.title(f"Exceptions : {category_label}")
                exc_dialog.geometry("500x600")
                exc_dialog.grab_set()
                
                lbl_info = ctk.CTkLabel(exc_dialog, text=f"Cochez les fichiers locaux que vous souhaitez IGNORER\nlors de la synchronisation (catégorie : {category_label}).", justify="left", font=ctk.CTkFont(weight="bold"))
                lbl_info.pack(pady=10, padx=10, fill="x")
                
                scroll_frame = ctk.CTkScrollableFrame(exc_dialog)
                scroll_frame.pack(fill="both", expand=True, padx=10, pady=5)
                
                # Charger les fichiers locaux
                app_dir = get_app_dir()
                mgr = SyncManager(app_dir, LocalProvider(app_dir))
                local_files = mgr._list_local_files()
                
                # Filtrer par catégorie
                cat_files = [p for p in local_files.keys() if mgr._is_in_selected_categories(p, [category_key])]
                cat_files.sort(key=str.lower)
                
                current_exceptions = sync_conf.get("exceptions", [])
                checkboxes = {}
                
                for file_path in cat_files:
                    var = ctk.BooleanVar(value=file_path in current_exceptions)
                    cb = ctk.CTkCheckBox(scroll_frame, text=file_path, variable=var, font=ctk.CTkFont(size=11))
                    cb.pack(fill="x", pady=2, padx=5)
                    checkboxes[file_path] = var
                    
                def save_exceptions():
                    # Nettoyer les anciennes exceptions de cette catégorie
                    new_exceptions = [e for e in current_exceptions if e not in cat_files]
                    # Ajouter les nouvelles
                    for file_path, var in checkboxes.items():
                        if var.get():
                            new_exceptions.append(file_path)
                    sync_conf["exceptions"] = new_exceptions
                    self.config_manager.set("sync", sync_conf)
                    exc_dialog.destroy()
                    
                btn_save_exc = ctk.CTkButton(exc_dialog, text=_("gui.btn_save"), command=save_exceptions)
                btn_save_exc.pack(pady=10)
            except Exception as e:
                logging.error(f"[EXCEPTIONS MODAL CRASH] {e}\n{traceback.format_exc()}")


        # Create grid for checkboxes
        cb_container = ctk.CTkFrame(cat_frame, fg_color="transparent")
        cb_container.pack(pady=5)
        for i, (key, label) in enumerate(categories):
            var = ctk.BooleanVar(value=key in stored_cats)
            cat_vars[key] = var
            
            cell = ctk.CTkFrame(cb_container, fg_color="transparent")
            cell.grid(row=i//2, column=i%2, padx=10, pady=3, sticky="w")
            
            cb = ctk.CTkCheckBox(cell, text=label, variable=var, font=ctk.CTkFont(size=11))
            cb.pack(side="left")
            
            btn_cfg = ctk.CTkButton(cell, text="⚙️", width=24, height=24, fg_color="transparent", 
                                  hover_color=("gray70", "gray30"), text_color=("black", "white"),
                                  command=lambda k=key, l=label: open_exceptions_modal(k, l))
            btn_cfg.pack(side="left", padx=5)


        # Progress status (minimal)
        lbl_status = ctk.CTkLabel(tab_sync, text=_("gui.status_wait"), text_color="gray")
        lbl_status.pack(pady=10)

        # --- TAB CONF SFTP ---
        # (Same as before but with better labels)
        ctk.CTkLabel(tab_conf, text="Serveur / Host:", anchor="w").pack(fill="x", padx=10)
        e_host = ctk.CTkEntry(tab_conf)
        e_host.insert(0, str(sync_conf.get("host", "")))
        e_host.pack(fill="x", padx=10, pady=(0, 5))

        ctk.CTkLabel(tab_conf, text="Port:", anchor="w").pack(fill="x", padx=10)
        e_port = ctk.CTkEntry(tab_conf)
        e_port.insert(0, str(sync_conf.get("port", "22")))
        e_port.pack(fill="x", padx=10, pady=(0, 5))

        ctk.CTkLabel(tab_conf, text="Utilisateur:", anchor="w").pack(fill="x", padx=10)
        e_user = ctk.CTkEntry(tab_conf)
        e_user.insert(0, str(sync_conf.get("username", "")))
        e_user.pack(fill="x", padx=10, pady=(0, 5))

        ctk.CTkLabel(tab_conf, text="Mot de passe:", anchor="w").pack(fill="x", padx=10)
        e_pass = ctk.CTkEntry(tab_conf, show="*")
        e_pass.insert(0, str(sync_conf.get("password", "")))
        e_pass.pack(fill="x", padx=10, pady=(0, 5))

        ctk.CTkLabel(tab_conf, text="Dossier Distant:", anchor="w").pack(fill="x", padx=10)
        e_dir = ctk.CTkEntry(tab_conf)
        e_dir.insert(0, str(sync_conf.get("remote_dir", "")))
        e_dir.pack(fill="x", padx=10, pady=(0, 5))
        
        ctk.CTkLabel(tab_conf, text=_("sync.manual_skew_hours"), anchor="w").pack(fill="x", padx=10)
        e_skew = ctk.CTkEntry(tab_conf)
        e_skew.insert(0, str(sync_conf.get("manual_skew_hours", "0")))
        e_skew.pack(fill="x", padx=10, pady=(0, 10))

        # --- TAB CONF WEBDAV ---
        ctk.CTkLabel(tab_webdav, text="URL WebDAV (ex: https://cloud.com/dav):", anchor="w").pack(fill="x", padx=10)
        e_wd_url = ctk.CTkEntry(tab_webdav)
        e_wd_url.insert(0, str(sync_conf.get("webdav_url", "")))
        e_wd_url.pack(fill="x", padx=10, pady=(0, 5))

        ctk.CTkLabel(tab_webdav, text="Utilisateur:", anchor="w").pack(fill="x", padx=10)
        e_wd_user = ctk.CTkEntry(tab_webdav)
        e_wd_user.insert(0, str(sync_conf.get("webdav_user", "")))
        e_wd_user.pack(fill="x", padx=10, pady=(0, 5))

        ctk.CTkLabel(tab_webdav, text="Mot de passe:", anchor="w").pack(fill="x", padx=10)
        e_wd_pass = ctk.CTkEntry(tab_webdav, show="*")
        e_wd_pass.insert(0, str(sync_conf.get("webdav_pass", "")))
        e_wd_pass.pack(fill="x", padx=10, pady=(0, 5))
        
        ctk.CTkLabel(tab_webdav, text=_("sync.manual_skew_hours"), anchor="w").pack(fill="x", padx=10)
        e_wd_skew = ctk.CTkEntry(tab_webdav)
        e_wd_skew.insert(0, str(sync_conf.get("manual_skew_hours", "0")))
        e_wd_skew.pack(fill="x", padx=10, pady=(0, 10))

        # --- TAB LOCAL ---
        ctk.CTkLabel(tab_local, text="Chemin du dossier (ex: Dropbox/AirstepSync):", anchor="w").pack(fill="x", padx=10, pady=(10,0))
        e_local_dir = ctk.CTkEntry(tab_local)
        e_local_dir.insert(0, str(sync_conf.get("target_dir", "")))
        e_local_dir.pack(fill="x", padx=10, pady=(0, 5))
        
        ctk.CTkLabel(tab_local, text=_("sync.manual_skew_hours"), anchor="w").pack(fill="x", padx=10)
        e_local_skew = ctk.CTkEntry(tab_local)
        e_local_skew.insert(0, str(sync_conf.get("manual_skew_hours", "0")))
        e_local_skew.pack(fill="x", padx=10, pady=(0, 10))
        
        def pick_local():
            import tkinter.filedialog
            folder = tkinter.filedialog.askdirectory(parent=dialog)
            if folder:
                e_local_dir.delete(0, "end")
                e_local_dir.insert(0, folder)
        ctk.CTkButton(tab_local, text="Parcourir", command=pick_local, fg_color="#555").pack(pady=5)

        def save_conf():
            try:
                sync_conf["host"] = e_host.get()
                sync_conf["port"] = int(e_port.get() or 22)
                sync_conf["username"] = e_user.get()
                sync_conf["password"] = e_pass.get()
                sync_conf["remote_dir"] = e_dir.get()
                sync_conf["target_dir"] = e_local_dir.get()
                sync_conf["webdav_url"] = e_wd_url.get()
                sync_conf["webdav_user"] = e_wd_user.get()
                sync_conf["webdav_pass"] = e_wd_pass.get()
                sync_conf["type"] = type_var.get()
                sync_conf["mode"] = mode_var.get()
                
                # Save manual skew (read from the correct tab)
                try:
                    if sync_conf["type"] == "sftp": skew_val = e_skew.get()
                    elif sync_conf["type"] == "webdav": skew_val = e_wd_skew.get()
                    else: skew_val = e_local_skew.get()
                    sync_conf["manual_skew_hours"] = float(skew_val or 0)
                except:
                    sync_conf["manual_skew_hours"] = 0
                
                # Save categories
                active_cats = [k for k, v in cat_vars.items() if v.get()]
                sync_conf["categories"] = active_cats
                
                conf["sync"] = sync_conf
                with open(config_path, "w", encoding="utf-8") as f:
                    json.dump(conf, f, indent=4)
                return True
            except Exception as e:
                lbl_status.configure(text=f"Erreur config: {e}", text_color="red")
                tabs.set("Synchronisation")
                return False

        ctk.CTkButton(tab_conf, text=_("gui.btn_save"), command=lambda: save_conf() and lbl_status.configure(text="Config SFTP Sauvée.", text_color="green") or tabs.set("Synchronisation"), fg_color="green", hover_color="darkgreen").pack(pady=10)
        ctk.CTkButton(tab_webdav, text=_("gui.btn_save"), command=lambda: save_conf() and lbl_status.configure(text="Config WebDAV Sauvée.", text_color="green") or tabs.set("Synchronisation"), fg_color="green", hover_color="darkgreen").pack(pady=10)
        ctk.CTkButton(tab_local, text=_("gui.btn_save"), command=lambda: save_conf() and lbl_status.configure(text="Config Locale Sauvée.", text_color="green") or tabs.set("Synchronisation"), fg_color="green", hover_color="darkgreen").pack(pady=10)

        # --- RUN logic ---
        def run_sync():
            if not save_conf(): return
            
            btn_sync.configure(state="disabled")
            lbl_status.configure(text=_("sync.status_analyzing"), text_color="orange")
            
            modal_container = [None] # To store modal reference
            
            def _thread():
                try:
                    from sync_manager import SyncManager, LocalProvider, SftpProvider, WebdavProvider
                    
                    with open(config_path, "r", encoding="utf-8") as f:
                        fresh_conf = json.load(f)
                    current_sync_conf = fresh_conf.get("sync", {})
                    shared_fields = current_sync_conf.get("shared_fields", None)
                    selected_cats = current_sync_conf.get("categories", None)
                    
                    if current_sync_conf.get("type", "sftp") == "sftp":
                        provider = SftpProvider(
                            current_sync_conf.get("host"), current_sync_conf.get("port", 22),
                            current_sync_conf.get("username"), current_sync_conf.get("password", ""),
                            current_sync_conf.get("remote_dir", "/var/www/airstep")
                        )
                    elif current_sync_conf.get("type") == "webdav":
                        provider = WebdavProvider(
                            current_sync_conf.get("webdav_url"),
                            current_sync_conf.get("webdav_user"),
                            current_sync_conf.get("webdav_pass")
                        )
                    else:
                        local_target = current_sync_conf.get("target_dir", "")
                        if not local_target:
                            raise ValueError("Le dossier Cloud local n'est pas configuré.")
                        provider = LocalProvider(local_target)
                        
                    mgr = SyncManager(get_app_dir(), provider, shared_fields=shared_fields)
                    
                    # Progress Callback setup
                    def on_progress(current, total, filename, stage, reason=None):
                        pct = current / total if total > 0 else 1
                        
                        # Use modal widgets if available
                        if modal_container[0]:
                            modal_container[0].progress_bar.set(pct)
                            r_text = f" ({reason})" if reason else ""
                            if stage == "pull":
                                modal_container[0].log_msg(_("sync.stage_pull", file=filename) + r_text)
                            elif stage == "push":
                                modal_container[0].log_msg(_("sync.stage_push", file=filename) + r_text)
                            elif stage == "delete_remote":
                                modal_container[0].log_msg(f"🗑️ [DEL REMOTE] {filename}")
                            elif stage == "delete_local":
                                modal_container[0].log_msg(f"🗑️ [DEL LOCAL] {filename}")
                        else:
                            if stage == "analyzing":
                                lbl_status.configure(text=_("sync.status_analyzing"))
                    
                    mgr.set_progress_callback(on_progress)
                    
                    sync_mode = current_sync_conf.get("mode", "Bidirectionnel (Auto)")
                    exceptions = current_sync_conf.get("exceptions", [])
                    manual_skew_h = current_sync_conf.get("manual_skew_hours", 0)
                    manual_skew_s = manual_skew_h * 3600
                    
                    try:
                        res = mgr.analyze(selected_categories=selected_cats, mode=sync_mode, exceptions=exceptions, manual_skew=manual_skew_s)
                    except Exception as e:
                        err_msg = str(e)
                        def show_err():
                            lbl_status.configure(text=f"Erreur réseau: {err_msg}", text_color="red")
                            btn_sync.configure(state="normal")
                        dialog.after(0, show_err)
                        return
                    
                    # V9.1: Apply Sync Mode filtering
                    sync_mode = current_sync_conf.get("mode", "Bidirectionnel (Auto)")
                    if "Réception" in sync_mode:
                        res["push"] = []
                        res["delete_remote"] = []
                    elif "Envoi" in sync_mode:
                        res["pull"] = []
                        res["delete_local"] = []
                    
                    # V9.1: Sync Confirmation Logic
                    sync_event = threading.Event()
                    final_choice = {"res": None}
                    
                    def on_user_choice(choice):
                        final_choice["res"] = choice
                        sync_event.set()
                    
                    if not any(res.values()):
                        def nothing_ui():
                            lbl_status.configure(text=_("sync.status_uptodate"), text_color="green")
                            btn_sync.configure(state="normal")
                        dialog.after(0, nothing_ui)
                        return
                    
                    # V9.6.22: Translated summary message
                    summary_text = _("sync.msg_analysis_res", pull=len(res['pull']), push=len(res['push']))
                    def info_ui():
                        lbl_status.configure(text=summary_text, text_color="green")
                    dialog.after(0, info_ui)

                    # Show dialog on main thread
                    def show_dialog():
                        modal_container[0] = SyncConfirmationDialog(dialog, res, on_user_choice)
                    
                    dialog.after(0, show_dialog)
                    
                    # Wait for user
                    def wait_ui():
                        lbl_status.configure(text="En attente du récapitulatif...", text_color="orange")
                    dialog.after(0, wait_ui)
                    
                    sync_event.wait()
                    
                    res = final_choice["res"]
                    if res is None: # Window closed via X
                        def cancel_ui():
                            lbl_status.configure(text=_("gui.status_wait"), text_color="gray")
                            btn_sync.configure(state="normal")
                        dialog.after(0, cancel_ui)
                        return
                        
                    if not any(res.values()):
                        def empty_ui():
                            lbl_status.configure(text="Aucune action sélectionnée.", text_color="orange")
                            btn_sync.configure(state="normal")
                        dialog.after(0, empty_ui)
                        return

                    def work_ui():
                        lbl_status.configure(text="Synchronisation en cours...", text_color="blue")
                    dialog.after(0, work_ui)
                    
                    mgr.sync(res, selected_categories=selected_cats)
                    
                    def done_ui():
                        lbl_status.configure(text=_("sync.status_finished"), text_color="green")
                        if modal_container[0]:
                            modal_container[0].log_msg("✅ " + _("sync.status_finished"))
                            modal_container[0].btn_cancel.configure(state="normal", text=_("web.btn_close"), fg_color="green")
                    dialog.after(0, done_ui)
                    
                    # Refresh library logic
                    if res['pull']:
                        try:
                            import urllib.request
                            req = urllib.request.Request("http://127.0.0.1:8000/api/local/refresh_from_sidecars", method="POST")
                            with urllib.request.urlopen(req, timeout=5) as response:
                                pass
                        except: pass
                    
                    # Restart logic for EXE update
                    if res['pull'] and any("MidiKbdControlStudio.exe" in p for p in res['pull']):
                        script = mgr.generate_bootstrapper_script()
                        import tkinter.messagebox
                        if tkinter.messagebox.askyesno("Mise à jour disponible", "Une nouvelle version de l'application a été téléchargée. Voulez-vous redémarrer pour l'installer ?"):
                            lbl_status.configure(text="Redémarrage pour mise à jour...", text_color="red")
                            import subprocess
                            subprocess.Popen(script, shell=True)
                            dialog.destroy()
                            self.quit_app()

                except Exception as e:
                    import traceback
                    logging.warning(f"[SYNC] Erreur critique durant la synchronisation : {e}")
                    logging.warning(traceback.format_exc())
                    lbl_status.configure(text=f"Erreur: {str(e)}", text_color="red")
                finally:
                    btn_sync.configure(state="normal")
            
            threading.Thread(target=_thread, daemon=True).start()

        btn_sync = ctk.CTkButton(tab_sync, text=_("sync.btn_analyze"), command=run_sync, fg_color="#0066cc", hover_color="#004499", height=32)
        btn_sync.pack(pady=(10, 5))
        ctk.CTkButton(dialog, text=_("web.btn_close"), command=dialog.destroy, fg_color="transparent", border_width=1, text_color="gray").pack(pady=5)

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
            "target_volume": "",
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
        
        self.entry_vol_rule.delete(0, "end")
        self.entry_vol_rule.insert(0, self.current_profile.get("target_volume", ""))

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
        dialog = ctk.CTkInputDialog(text=_("gui.msg_profile_name"), title=_("gui.title_new_profile"))
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
            "target_volume": "",
            "mappings": []
        }

        if self.profile_manager.save_profile(new_p):
            self.profiles = self.profile_manager.load_all_profiles()
            self.update_profile_combo()
            self.select_profile_by_name(name)

    def duplicate_current_profile(self):
        if not self.current_profile: return

        old_name = self.current_profile["name"]

        dialog = ctk.CTkInputDialog(text=_("gui.msg_new_profile_name"), title=_("gui.title_dup_profile"))

        new_name = dialog.get_input()
        if not new_name: return

        # Check if exists
        for p in self.profiles:
            if p["name"] == new_name:
                CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_profile_exists"))
                return

        # Deep copy manually
        import copy
        new_profile = copy.deepcopy(self.current_profile)
        new_profile["name"] = new_name

        if self.profile_manager.save_profile(new_profile):
            self.profiles = self.profile_manager.load_all_profiles()
            self.update_profile_combo()
            self.select_profile_by_name(new_name)
            CTkMessageBox.show_info(_("gui.msg_success"), f"{_('gui.msg_profile_duplicated')} : {new_name}")

    def edit_current_profile(self):
        if not self.current_profile: return
        ProfileEditorDialog(self, self.current_profile, self.on_profile_edited)

    def on_profile_edited(self, new_name, new_vol):
        old_name = self.current_profile.get("name")
        
        # Check name collision
        if new_name != old_name:
            for p in self.profiles:
                if p["name"] == new_name:
                    CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_profile_exists"))
                    return
        
        self.current_profile["name"] = new_name
        self.current_profile["target_volume"] = new_vol
        
        # Save new
        if self.profile_manager.save_profile(self.current_profile):
            # If renamed, delete the old file
            if old_name and old_name != new_name:
                self.profile_manager.delete_profile(old_name)
            
            self.profiles = self.profile_manager.load_all_profiles()
            self.update_profile_combo()
            self.select_profile_by_name(new_name)

    def delete_current_profile(self):
        if not self.current_profile: return
        name = self.current_profile["name"]
        if CTkMessageBox.ask_yes_no(_("gui.msg_confirm"), f"{_('gui.msg_delete_profile')} '{name}'?"):
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
        self.current_profile["target_volume"] = self.entry_vol_rule.get()
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
                 CTkMessageBox.show_info(_("gui.msg_warning"), _("gui.msg_no_profile_selected"))
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
            
            CTkMessageBox.show_error(_("gui.msg_error"), f"{_('gui.msg_open_error')}:\n{e}")

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
        # We NO LONGER read from device_combo here!
        # The combo box might still be showing "FS-1-WL" 
        # while taking 800ms to switch to "AIRSTEP" after a mode change.
        # Reading it here would aggressively overwrite the correct memory.
        # self.settings["midi_device_name"] is already maintained by change_mode and _finalize_refresh.
        
        try:
            from config_manager import ConfigManager
            cm = ConfigManager()
            for k, v in self.settings.items():
                cm.set(k, v)
        except Exception as e:
            if not silent: CTkMessageBox.show_error(_("gui.msg_error"), f"{_('gui.msg_config_error')}: {e}")
            return

        try:
            for p in self.profiles:
                self.profile_manager.save_profile(p)
            if not silent: CTkMessageBox.show_info(_("gui.msg_success"), _("gui.msg_config_saved"))
        except Exception as e:
            if not silent: CTkMessageBox.show_error(_("gui.msg_error"), f"{_('gui.msg_profiles_error')}: {e}")

    # --- Remote Control ---
    def toggle_remote_control(self):
        # If open, close it and show nothing (like on_remote_close)
        if hasattr(self, 'remote_win') and self.remote_win:
            try:
                if self.remote_win.winfo_exists():
                    self.remote_win.destroy()
                    self.remote_win = None
                    return
            except:
                self.remote_win = None
        
        # If closed, open it
        self.open_remote_control()

    def open_remote_control(self):
        if not self.current_device_def:
            CTkMessageBox.show_error(_("gui.msg_error"), _("gui.msg_no_device_def"))
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
                ignore = ["Remote -", "Midi-Kbd Remote", "Midi-Kbd Control Studio"]

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
        self.midi_manager.set_scanning(bool(self.switch_scan.get()))

    def toggle_theme(self):
        mode = "Dark" if self.theme_switch.get() else "Light"
        ctk.set_appearance_mode(mode)
        self.settings["theme"] = mode
        self.save_all(silent=True)

    def change_mode(self, choice):
        self.log_debug(f"change_mode called with choice: '{choice}'")
        
        # 1. SAVE CURRENT TARGET BEFORE SWITCHING
        old_mode = self.settings.get("connection_mode", "MIDO")
        current_target = self.settings.get("midi_device_name", "")
        if old_mode == "BLE":
             self.settings["midi_device_name_ble"] = current_target
        else:
             self.settings["midi_device_name_usb"] = current_target

        # 2. DETERMINE NEW MODE
        new_mode = "BLE" if "Bluetooth" in choice else "MIDO"
        self.settings["connection_mode"] = new_mode
        self.log_debug(f"Switching Mode: {old_mode} -> {new_mode}")
        
        # 3. RESTORE TARGET FOR NEW MODE
        new_target = ""
        if new_mode == "BLE":
            new_target = self.settings.get("midi_device_name_ble", "")
        else:
            new_target = self.settings.get("midi_device_name_usb", "")
            
        self.settings["midi_device_name"] = new_target
        
        # 4. SAVE SETTINGS
        try:
            self.save_all(silent=True)
        except Exception as e:
            self.log_debug(f"Error saving settings: {e}")

        # 5. EXECUTE SWITCH
        self.midi_manager.switch_mode(new_mode, new_target)

        # 6. REFRESH UI (Passive & Silent)
        self.refresh_midi_ports(silent=True)

    def refresh_midi_ports(self, silent=False):
        self.log_debug(f"Refresh requested (Silent={silent}).")
        
        # Use Manager's proxies
        self.log_debug("Setting scanning=True")
        self.midi_manager.set_scanning(True)
        try: self.switch_scan.select()
        except: pass
        
        # FORCE CLEAR CACHE
        self.log_debug("Calling force_rescan()")
        self.midi_manager.force_rescan()
        
        # UI Feedback
        self.log_debug(f"Updating UI to '{_('gui.msg_searching_full')}'")
        self.device_combo.set(_("gui.msg_searching_full"))
        self.device_combo.configure(state="disabled")
        self.btn_refresh.configure(state="disabled", text=f"{_('gui.btn_scan_short')}...")

        # Schedule Finalization based on Mode
        mode = self.settings.get("connection_mode", "MIDO")
        # Increase initial BLE wait time to give it a better chance
        delay = 4000 if mode == "BLE" else 800 
        
        self.log_debug(f"Scheduling _finalize_refresh in {delay}ms (Mode={mode})")
        # Pass silent flag to finalizer
        self.after(delay, lambda: self._finalize_refresh(silent=silent))

    def _finalize_refresh(self, silent=False, retry_count=0):
        self.log_debug(f"_finalize_refresh triggered (Silent={silent}, Retry={retry_count}).")
        
        ports = self.midi_manager.get_ports()
        mode = self.settings.get("connection_mode", "MIDO")
        
        # --- SMART RETRY LOGIC (BLE & USB) ---
        # If no ports found and we haven't retried yet, wait a bit silently
        if not ports and retry_count < 1:
             retry_delay = 3000 if mode == "BLE" else 1500
             self.log_debug(f"No {mode} devices found yet. Retrying in {retry_delay}ms...")
             self.after(retry_delay, lambda: self._finalize_refresh(silent=silent, retry_count=retry_count+1))
             return

        # --- FINALIZATION ---
        # Restore UI State
        self.device_combo.configure(state="normal")
        self.btn_refresh.configure(state="normal", text=_("gui.btn_refresh"))

        # SMART COMBOBOX HANDLING
        # Retrieve the intended target for the CURRENT mode
        if mode == "BLE":
            target_name = self.settings.get("midi_device_name_ble", "")
        else:
            target_name = self.settings.get("midi_device_name_usb", "")
            
        # Fallback to general if empty
        if not target_name:
            target_name = self.settings.get("midi_device_name", "")
        
        display_ports = list(ports)
        
        # --- SMART INDEX MATCHING (GUI) ---
        # If the exact target is missing, check if there is a version with a different trailing number
        if target_name and target_name not in display_ports and target_name != _("gui.lbl_none"):
            import re
            base_target = re.sub(r'\s*\d+$', '', target_name).strip()
            if base_target:
                 for p in display_ports:
                      base_p = re.sub(r'\s*\d+$', '', p).strip()
                      if base_target.lower() == base_p.lower():
                           # Found a sibling port! (e.g. target="FS1 1" but "FS1 2" exists)
                           # We seamlessly UPDATE our target to match reality
                           self.log_debug(f"GUI Smart Match: '{target_name}' -> updated to -> '{p}'")
                           target_name = p
                           
                           # Update persistence immediately so the config button works
                           self.settings["midi_device_name"] = p
                           if mode == "BLE":
                               self.settings["midi_device_name_ble"] = p
                           else:
                               self.settings["midi_device_name_usb"] = p
                               
                           cm = ConfigManager()
                           cm.set("midi_device_name", p)
                           if mode == "BLE": cm.set("midi_device_name_ble", p)
                           else: cm.set("midi_device_name_usb", p)
                           
                           break

        # --- LIST INJECTION ---
        # If still not found, inject it visually so user knows what we are looking for
        if target_name and target_name not in display_ports and target_name != _("gui.lbl_none"):
            if mode == "BLE":
                display_ports.insert(0, target_name) # Add text only
            elif target_name not in display_ports:
                 display_ports.insert(0, target_name)

        if not display_ports:
            display_ports = [_("gui.lbl_none")]

        self.device_combo.configure(values=display_ports)
        
        # Restore selection
        if target_name in display_ports:
            self.device_combo.set(target_name)
        elif display_ports:
            self.device_combo.set(display_ports[0])
            
        # VERY IMPORTANT: Update global settings so the rest of the app knows what's selected
        self.settings["midi_device_name"] = self.device_combo.get()
            
        # Update definition based on what is selected/target
        self.update_device_def()

        # --- DIAGNOSTIC POPUP (ONLY IF NOT SILENT) ---
        if not silent:
            info = f"{_('gui.lbl_current_mode')} : {mode}\n\n"
            if ports:
                info += f"{len(ports)} {_('gui.msg_devices_found')} :\n" + "\n".join([f"- {p}" for p in ports])
            else:
                info += f"{_('gui.msg_no_device_found')}.\n"
                if mode == "BLE":
                    info += f"{_('gui.msg_check_ble')}.\n({_('gui.msg_ble_delay')})."
                else:
                    info += f"{_('gui.msg_check_usb')}."

            CTkMessageBox.show_info(_("gui.title_diag"), info)

    def change_midi_device(self, choice):
        if not choice: return
        self.settings["midi_device_name"] = choice
        
        # SMART PERSISTENCE SAVE
        mode = self.settings.get("connection_mode", "MIDO")
        if mode == "BLE":
            self.settings["midi_device_name_ble"] = choice
        else:
            self.settings["midi_device_name_usb"] = choice

        # Persist immediately
        cm = ConfigManager()
        cm.set("midi_device_name", choice)
        cm.set("midi_device_name_ble", self.settings.get("midi_device_name_ble", ""))
        cm.set("midi_device_name_usb", self.settings.get("midi_device_name_usb", ""))
        
        self.update_device_def()

        # Feedback UI
        self.lbl_conn_text.configure(text=f"{_('gui.msg_connecting_to')} {choice}...")
        self.lbl_conn_led.configure(text_color="orange")
        self.update_idletasks() # Force UI Update

        # Switch via Manager (which handles restart)
        self.midi_manager.switch_mode(mode, choice)

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
                print(f"[MAIN] Message MIDI reçu de l'engine: {msg}") # Diagnostic Log
                self.action_handler.execute(cc, val, chan, self.profiles, self.manual_override_profile, midi_manager=self.midi_manager)

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
        connected = self.midi_manager.is_connected
        self.update_status(connected)
        
        # Loop 1s
        self.after(1000, self._monitor_connection_status)

    def update_status(self, connected, message=None):
        if connected:
            self.lbl_conn_led.configure(text_color="green")
            
            # Récupération du mode et du device REEL
            mode = self.settings.get("connection_mode", "MIDO")
            mode_str = "USB" if mode == "MIDO" else "Bluetooth"
            
            # Nom du device
            dev_name = self.midi_manager.active_device_name
            if not dev_name: 
                 dev_name = self.settings.get("midi_device_name", "Appareil")

            if dev_name in ["Recherche...", ""]: dev_name = "Appareil"
            
            self.lbl_conn_text.configure(text=f"{dev_name} ({mode_str})")
        else:
            self.lbl_conn_led.configure(text_color="red")
            self.lbl_conn_text.configure(text=_("gui.lbl_disconnected"))

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
                CTkMessageBox.show_error(_("gui.msg_error"), f"{_('gui.msg_startup_error')}: {e}")
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
                    pystray.MenuItem(_("gui.menu_remote"), self.open_remote_from_tray, default=True),
                    pystray.MenuItem(_("gui.menu_config"), self.open_conf_from_tray),
                    pystray.MenuItem(_("gui.menu_web"), self.open_web),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem(_("gui.menu_quit"), self.quit_app)
                )
                self.tray_icon = pystray.Icon("MidiKbdControlStudio", image, "Midi-Kbd Control Studio", menu)
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
            self.action_handler.execute(cc, 127, 16, self.profiles, force_target_profile=self.current_profile, midi_manager=self.midi_manager)

    def quit_app(self, icon=None, item=None):
        if self.tray_icon: self.tray_icon.stop()
        # Shutdown Manager
        if self.midi_manager and self.midi_manager.current_provider:
             self.midi_manager.current_provider.stop()
             
        if self.context_monitor: self.context_monitor.stop()
        self.quit()
