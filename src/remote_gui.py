import customtkinter as ctk

class CompactPedalboardFrame(ctk.CTkFrame):
    """Grid layout for pedalboard (shared between Main and Remote)"""
    def __init__(self, parent, device_def, profile, callback_press):
        from i18n import _
        self._ = _
        super().__init__(parent, fg_color="transparent")
        self.device_def = device_def
        self.profile = profile
        self.callback_press = callback_press
        self.btn_map = {} # Map CC -> Button Widget

        self.update_layout()

    def set_profile(self, new_profile):
        self.profile = new_profile
        self.update_layout()

    def set_device_def(self, new_def):
        self.device_def = new_def
        self.update_layout()

    def flash_button(self, cc):
        """Simulate a visual flash on the specific button"""
        if cc in self.btn_map:
            btn = self.btn_map[cc]
            original_color = btn.cget("fg_color")
            # Flash Color: Bright Green/Cyan or White
            btn.configure(fg_color="#00E5FF", text_color="black") 
            self.after(150, lambda: btn.configure(fg_color=original_color, text_color="white"))

    def _get_icon_for_name(self, name):
        """Convertit les mots clés en icônes pour le mode Remote"""
        n = name.lower()
        # Transport
        if "play" in n and "pause" in n: return "⏯"
        if "play" in n: return "▶"
        if "pause" in n: return "⏸"
        if "stop" in n: return "■"
        if "rec" in n: return "●"
        if "prev" in n or "rewind" in n or "back" in n: return "⏪"
        if "next" in n or "forward" in n: return "⏩"
        if "loop" in n: return "⟳"
        # Audio
        if "mute" in n: return "🔇"
        if "vol" in n or "audio" in n: return "🔊"
        if "pan" in n: return "↔"
        # Tools
        if "speed" in n or "tempo" in n or "bpm" in n: return "⏱"
        if "pitch" in n or "key" in n or "tune" in n: return "♪"
        if "metro" in n: return "◴"
        if "marker" in n: return "📍"
        # Navigation
        if "up" in n: return "▲"
        if "down" in n: return "▼"
        if "left" in n: return "◄"
        if "right" in n: return "►"
        if "enter" in n or "ok" in n: return "✓"
        if "undo" in n: return "↶"
        if "redo" in n: return "↷"
        # Generic
        return "⚡"

    def update_layout(self):
        # Clear existing buttons
        for w in self.winfo_children():
            w.destroy()
        self.btn_map.clear()

        if not self.device_def or "buttons" not in self.device_def:
            msg = self._("gui.lbl_no_device_def")
            if self.device_def is None: msg += " (None)"
            elif "buttons" not in self.device_def: msg += " (No Buttons)"
            ctk.CTkLabel(self, text=msg).pack(pady=20)
            return

        buttons_def = self.device_def["buttons"]

        # Mapping Map : CC -> {name, custom_icon}
        mapping_map = {}
        if self.profile:
            for m in self.profile.get("mappings", []):
                cc = m.get("midi_cc")
                if cc is not None:
                    mapping_map[cc] = m

        # Grid logic
        # Grid logic
        cols = 10 # 10 Columns for standard AIRSTEP (5 Short + 5 Long)
        if len(buttons_def) > 10:
             cols = 10 # split into rows

        for i, btn_data in enumerate(buttons_def):
            cc = btn_data["cc"]
            default_label = btn_data["label"]

            # Clean Physical Index (Top Label)
            short_lbl = default_label.replace("Bouton ", "").replace("Button ", "").replace("Footswitch ", "")
            if "(" in short_lbl: short_lbl = short_lbl.split("(")[0].strip()
            
            # Handle Long Press Labels
            is_long_press = "Long Press" in default_label
            if is_long_press:
                base = default_label.replace("Long Press ", "").strip()
                if "(" in base: base = base.split("(")[0].strip()
                short_lbl = f"{base} ({self._('gui.lbl_hold')})"
            # Determine Icon & State
            mapping_data = mapping_map.get(cc, None)

            if mapping_data:
                action_name = mapping_data.get("name", "")
                custom_icon = mapping_data.get("custom_icon")
                if custom_icon: icon = custom_icon
                else: icon = self._get_icon_for_name(action_name)
                
                main_text = icon
                # Premium Colors
                btn_color = "#2B7DE9" # Modern Blue
                hover_color = "#1A5CB8"
                state = "normal"
                text_color = "white"
            else:
                main_text = ""
                btn_color = "#2A2A2A" # Dark Grey
                hover_color = "#2A2A2A"
                state = "disabled"
                text_color = "gray30"

            # Layout Calculation
            row = i // cols
            col = i % cols
            
            # Container
            container = ctk.CTkFrame(self, fg_color="transparent")
            container.grid(row=row, column=col, padx=4, pady=4, sticky="nsew")

            # 1. Top Label (Physical Index)
            lbl_phy = ctk.CTkLabel(
                container,
                text=short_lbl,
                font=ctk.CTkFont(family="Segoe UI", size=9, weight="bold"),
                text_color="gray60",
                height=12
            )
            lbl_phy.pack(side="top", pady=(0, 2))

            # 2. Main Button (Icon)
            # Modern Look: Rounded, Larger Icon
            btn = ctk.CTkButton(
                container,
                text=main_text,
                font=ctk.CTkFont(family="Segoe UI Symbol", size=16), # Compact Icon
                fg_color=btn_color,
                hover_color=hover_color,
                text_color=text_color,
                state=state,
                height=32, 
                width=36,
                corner_radius=6,
                command=lambda c=cc: self.on_btn_click(c)
            )
            btn.pack(side="top", fill="both", expand=True)
            
            # Store in map
            self.btn_map[cc] = btn

        # Configure columns weight for responsiveness
        for c in range(cols):
            self.grid_columnconfigure(c, weight=1)
        # Configure rows
        rows = (len(buttons_def) - 1) // cols + 1
        for r in range(rows):
            self.grid_rowconfigure(r, weight=1)

    def on_btn_click(self, cc):
        self.flash_button(cc) # Visual immediate feedback
        self.callback_press(cc)


class RemoteControl(ctk.CTkToplevel):
    def __init__(self, parent, device_def, profile, callback_press, callback_close, callback_open_conf=None, callback_open_web=None):
        super().__init__(parent)
        self.callback_press = callback_press
        self.callback_close = callback_close
        self.callback_open_web = callback_open_web
        from utils import I18nManager
        self._ = I18nManager.get_instance().translate
        self.device_def = device_def
        self.profile = profile

        self.is_minimized = False
        self.saved_geometry = "400x300+100+100"

        # Style
        self.bg_color = "#2b2b2b"
        self.header_color = "#1f1f1f"
        self.hover_color = "#3a3a3a"

        # Window Setup
        self.title(self._("gui.title_remote"))
        self.overrideredirect(True) # Frameless
        self.attributes("-topmost", True)
        self.configure(fg_color=self.bg_color)

        # Dragging logic
        self.x_offset = 0
        self.y_offset = 0
        self.bind("<ButtonPress-1>", self.start_move)
        self.bind("<B1-Motion>", self.do_move)

        self.build_ui()
        self.update_layout()

    def start_move(self, event):
        self.x_offset = event.x
        self.y_offset = event.y

    def do_move(self, event):
        x = self.winfo_x() + (event.x - self.x_offset)
        y = self.winfo_y() + (event.y - self.y_offset)
        self.geometry(f"+{x}+{y}")

    def build_ui(self):
        # --- Header (Barre de titre custom) ---
        self.header = ctk.CTkFrame(self, height=30, fg_color=self.header_color, corner_radius=0)
        self.header.pack(fill="x", side="top")

        # Bind move on header too
        self.header.bind("<ButtonPress-1>", self.start_move)
        self.header.bind("<B1-Motion>", self.do_move)

        # Title / Handle
        title_text = f"{self._('gui.lbl_remote_prefix')} - {self.profile.get('name', 'Profile')}" if self.profile else self._("gui.title_remote")
        if len(title_text) > 25: title_text = title_text[:25] + "..."

        self.lbl_title = ctk.CTkLabel(self.header, text=title_text, text_color="gray", width=120, anchor="w", font=ctk.CTkFont(size=11))
        self.lbl_title.pack(side="left", padx=10, fill="x", expand=True)
        self.lbl_title.bind("<ButtonPress-1>", self.start_move)
        self.lbl_title.bind("<B1-Motion>", self.do_move)

        # Close Button (X)
        self.btn_close = ctk.CTkButton(self.header, text="✕", width=30, height=24,
                                       fg_color="transparent", hover_color="#c42b1c",
                                       command=self.close_remote)
        self.btn_close.pack(side="right", padx=2, pady=2)

        # Minimize Button (_)
        self.btn_min = ctk.CTkButton(self.header, text="—", width=30, height=24,
                                     fg_color="transparent", hover_color="#444",
                                     command=self.toggle_minimize)
        self.btn_min.pack(side="right", padx=2, pady=2)

        # Config Button (Left) - Uses Segoe MDL2 Assets (Windows Native Icons)
        # \uE713 = Settings Gear (Wireframe) | "Cardan" style
        if self.callback_open_conf:
            self.btn_conf = ctk.CTkButton(self.header, text="\uE713", width=30, height=24,
                                          fg_color="transparent", hover_color="#444",
                                          font=ctk.CTkFont(family="Segoe MDL2 Assets", size=12),
                                          command=self.callback_open_conf)
            self.btn_conf.pack(side="left", padx=2, pady=2)

        # Web Button (Left) - Uses Segoe MDL2 Assets
        # \uE12B = World/Globe (Windows style)
        if self.callback_open_web:
            self.btn_web = ctk.CTkButton(self.header, text="\uE12B", width=30, height=24,
                                         fg_color="transparent", hover_color="#444",
                                         font=ctk.CTkFont(family="Segoe MDL2 Assets", size=12),
                                         command=self.callback_open_web)
            self.btn_web.pack(side="left", padx=2, pady=2)

        # --- Main Container (Holds Content) ---
        self.main_container = ctk.CTkFrame(self, fg_color="transparent")
        self.main_container.pack(fill="both", expand=True)

        # --- Content (Grid of Buttons) ---
        self.content_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        self.content_frame.pack(side="top", fill="both", expand=True, padx=5, pady=5)

        # Instantiate Component
        self.pedalboard_frame = CompactPedalboardFrame(self.content_frame, self.device_def, self.profile, self.on_btn_click)
        self.pedalboard_frame.pack(fill="both", expand=True)

    def update_layout(self):
        # Just resize window logic, frame handles buttons
        self.update_idletasks()
        
        w = self.content_frame.winfo_reqwidth() + 20
        h = self.content_frame.winfo_reqheight() + 40 # + header

        # Clamp min size
        w = max(200, w)
        h = max(100, h)

        # Center on screen if first launch, else keep position
        if "+" not in self.geometry():
            screen_w = self.winfo_screenwidth()
            screen_h = self.winfo_screenheight()
            x = (screen_w // 2) - (w // 2)
            y = (screen_h // 2) - (h // 2)
            self.geometry(f"{w}x{h}+{x}+{y}")
        else:
            # Just resize, keep x/y
            curr_x = self.winfo_x()
            curr_y = self.winfo_y()
            self.geometry(f"{w}x{h}+{curr_x}+{curr_y}")

    def on_btn_click(self, cc):
        # Flash visual effect could be added here
        self.callback_press(cc)

    def flash_button(self, cc):
        """Delegates flash to the frame"""
        if self.pedalboard_frame:
            self.pedalboard_frame.flash_button(cc)

    def toggle_minimize(self):
        """Minimizes to Taskbar (Standard Behavior)"""
        # To minimize a frameless window (overrideredirect), we must temporarily enable the frame
        self.overrideredirect(False)
        self.iconify()
        self.bind("<Map>", self.on_restore)

    def on_restore(self, event):
        """Restores frameless state when opened from Taskbar"""
        if self.state() == "normal":
            self.overrideredirect(True)
            self.unbind("<Map>")

    def set_profile(self, new_profile):
        if not new_profile: return
        # Check if changed (by name)
        current_name = self.profile.get("name") if self.profile else ""
        new_name = new_profile.get("name")
        print(f"[REMOTE DEBUG] set_profile called with: {new_name}")
        
        if current_name != new_name:
            print(f"[REMOTE DEBUG] Applying profile change: {current_name} -> {new_name}")
            self.profile = new_profile
            self.pedalboard_frame.set_profile(new_profile)

            # Update Title
            title_text = f"{self._('gui.lbl_remote_prefix')} - {new_name}"
            if len(title_text) > 25: title_text = title_text[:25] + "..."
            self.lbl_title.configure(text=title_text)

            self.update_layout()

    def close_remote(self):
        self.callback_close()
        self.destroy()
