import customtkinter as ctk

class CompactPedalboardFrame(ctk.CTkFrame):
    """Grid layout for pedalboard (shared between Main and Remote)"""
    def __init__(self, parent, device_def, profile, callback_press):
        super().__init__(parent, fg_color="transparent")
        self.device_def = device_def
        self.profile = profile
        self.callback_press = callback_press

        self.update_layout()

    def set_profile(self, new_profile):
        self.profile = new_profile
        self.update_layout()

    def set_device_def(self, new_def):
        self.device_def = new_def
        self.update_layout()

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

        if not self.device_def or "buttons" not in self.device_def:
            # Should not happen with new fallbacks, but useful for debug
            msg = "Aucune définition d'appareil"
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

        # Grid logic (Wider layout as requested)
        # 10 columns allows displaying a full AIRSTEP + extras on fewer rows
        cols = 10

        for i, btn_data in enumerate(buttons_def):
            cc = btn_data["cc"]
            default_label = btn_data["label"]

            # Clean Physical Index (Top Label)
            # "Bouton A (Gauche)" -> "A"
            # "Long Press A" -> "A (L)"
            # "Footswitch 1" -> "1"
            short_lbl = default_label
            short_lbl = short_lbl.replace("Bouton ", "").replace("Button ", "").replace("Footswitch ", "")

            # Remove parenthesis content like "(Gauche)"
            if "(" in short_lbl:
                short_lbl = short_lbl.split("(")[0].strip()

            if "Long Press" in default_label:
                # Extract letter if possible "Long Press A" -> "A"
                base = default_label.replace("Long Press ", "").strip()
                if "(" in base: base = base.split("(")[0].strip()
                short_lbl = f"{base}(L)"

            # Determine Icon (Bottom Button)
            mapping_data = mapping_map.get(cc, None)

            if mapping_data:
                action_name = mapping_data.get("name", "")
                custom_icon = mapping_data.get("custom_icon")

                # Priority: Custom > Auto > Fallback
                if custom_icon:
                    icon = custom_icon
                else:
                    icon = self._get_icon_for_name(action_name)

                main_text = icon
                btn_color = "#1f6aa5" # Blueish
                hover_color = "#144a75"
                state = "normal"
            else:
                main_text = "N/A"
                btn_color = "#222222" # Darker
                hover_color = "#222222"
                state = "disabled"

            row = i // cols
            col = i % cols

            # Container for STACKED layout (Label on Top, Button Below)
            container = ctk.CTkFrame(self, fg_color="transparent")
            # Minimal padding to tighten layout
            container.grid(row=row, column=col, padx=1, pady=1)

            # 1. Top Label (Physical Index)
            lbl_phy = ctk.CTkLabel(
                container,
                text=short_lbl,
                font=ctk.CTkFont(size=10, weight="bold"),
                text_color="gray70",
                height=12
            )
            lbl_phy.pack(side="top", pady=0)

            # 2. Main Button (Icon)
            btn = ctk.CTkButton(
                container,
                text=main_text,
                font=ctk.CTkFont(size=20),
                fg_color=btn_color,
                hover_color=hover_color,
                state=state,
                text_color_disabled="gray30",
                height=40, # Ultra Compact 40x40
                width=40,
                command=lambda c=cc: self.on_btn_click(c)
            )
            btn.pack(side="top")

        # Configure columns weight
        # Set weight to 0 to prevent stretching (compact mode)
        for c in range(cols):
            self.grid_columnconfigure(c, weight=0)

    def on_btn_click(self, cc):
        self.callback_press(cc)


class RemoteControl(ctk.CTkToplevel):
    def __init__(self, parent, device_def, profile, callback_press, callback_close, library_manager=None):
        super().__init__(parent)
        self.callback_press = callback_press
        self.callback_close = callback_close
        self.device_def = device_def
        self.profile = profile
        self.library_manager = library_manager

        self.is_minimized = False
        self.drawer_open = False
        self.saved_geometry = "400x300+100+100"

        # Style
        self.bg_color = "#2b2b2b"
        self.header_color = "#1f1f1f"
        self.hover_color = "#3a3a3a"
        self.drawer_width = 200

        # Window Setup
        self.title("Airstep Remote")
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
        title_text = f"Remote - {self.profile.get('name', 'Profile')}" if self.profile else "Airstep Remote"
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

        # Library Drawer Button
        if self.library_manager:
            self.btn_lib = ctk.CTkButton(self.header, text="📚", width=30, height=24,
                                         fg_color="transparent", hover_color="#444",
                                         command=self.toggle_drawer)
            self.btn_lib.pack(side="right", padx=2, pady=2)

        # --- Main Container (Holds Content + Drawer) ---
        self.main_container = ctk.CTkFrame(self, fg_color="transparent")
        self.main_container.pack(fill="both", expand=True)

        # --- Content (Grid of Buttons) ---
        self.content_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        self.content_frame.pack(side="left", fill="both", expand=True, padx=5, pady=5)

        # Instantiate Component
        self.pedalboard_frame = CompactPedalboardFrame(self.content_frame, self.device_def, self.profile, self.on_btn_click)
        self.pedalboard_frame.pack(fill="both", expand=True)

        # --- Drawer (Hidden by default) ---
        self.drawer_frame = ctk.CTkFrame(self.main_container, width=0, fg_color="#222")
        # Not packed initially

        # --- Pill Widget (Hidden by default) ---
        self.pill_frame = ctk.CTkFrame(self, fg_color=self.header_color, corner_radius=15)
        # We don't pack it yet

        self.btn_restore = ctk.CTkButton(self.pill_frame, text="⤢", width=30, height=30,
                                         fg_color="transparent", font=ctk.CTkFont(size=16),
                                         command=self.toggle_minimize)
        self.btn_restore.pack(fill="both", expand=True)
        # Bind dragging on pill
        self.btn_restore.bind("<ButtonPress-1>", self.start_move)
        self.btn_restore.bind("<B1-Motion>", self.do_move)

    def toggle_drawer(self):
        if not self.library_manager: return

        if self.drawer_open:
            # Close
            self.drawer_frame.pack_forget()
            self.drawer_open = False
            # Shrink window
            curr_w = self.winfo_width()
            new_w = max(200, curr_w - self.drawer_width)
            self.geometry(f"{new_w}x{self.winfo_height()}")
        else:
            # Open
            self.drawer_frame.pack(side="right", fill="y", padx=0, pady=0)
            self.build_drawer_content()
            self.drawer_open = True
            # Expand window
            curr_w = self.winfo_width()
            new_w = curr_w + self.drawer_width
            self.geometry(f"{new_w}x{self.winfo_height()}")

    def build_drawer_content(self):
        # Clear existing
        for w in self.drawer_frame.winfo_children(): w.destroy()

        lbl = ctk.CTkLabel(self.drawer_frame, text="Bibliothèque", font=ctk.CTkFont(weight="bold"))
        lbl.pack(pady=5)

        scroll = ctk.CTkScrollableFrame(self.drawer_frame, width=self.drawer_width-20)
        scroll.pack(fill="both", expand=True, padx=5, pady=5)

        data = self.library_manager.get_library()
        self.populate_tree(scroll, data)

    def populate_tree(self, parent_widget, items, indent=0):
        for item in items:
            itype = item.get("type", "unknown")
            name = item.get("name", "Item")

            if itype == "folder":
                lbl_folder = ctk.CTkLabel(parent_widget, text=f"{'  '*indent}📁 {name}", anchor="w")
                lbl_folder.pack(fill="x", pady=2)
                # Recursion
                children = item.get("children", [])
                self.populate_tree(parent_widget, children, indent + 1)
            else:
                # Leaf (Action)
                icon = "🌐" if itype == "url" else "🚀" if itype == "app" else "📄"
                btn = ctk.CTkButton(parent_widget, text=f"{'  '*indent}{icon} {name}",
                                    anchor="w", fg_color="transparent", hover_color="#444",
                                    height=24,
                                    command=lambda i=item: self.library_manager.launch_item(i))
                btn.pack(fill="x", pady=1)

    def update_layout(self):
        # Just resize window logic, frame handles buttons
        self.update_idletasks()
        if self.drawer_open:
             # Keep size if drawer is open, maybe just adjust height
             pass
        else:
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

    def toggle_minimize(self):
        if self.is_minimized:
            # RESTORE
            self.pill_frame.pack_forget()
            self.header.pack(fill="x", side="top")
            self.content_frame.pack(fill="both", expand=True, padx=5, pady=5)

            # Restore size
            self.geometry(self.saved_geometry)
            self.is_minimized = False
        else:
            # MINIMIZE
            self.saved_geometry = self.geometry() # Save full pos/size

            self.header.pack_forget()
            self.content_frame.pack_forget()

            # Show pill
            self.pill_frame.pack(fill="both", expand=True)

            # Resize to small square
            # Keep current X/Y but change W/H
            curr_x = self.winfo_x()
            curr_y = self.winfo_y()
            self.geometry(f"50x50+{curr_x}+{curr_y}")

            self.is_minimized = True

    def set_profile(self, new_profile):
        if not new_profile: return
        # Check if changed (by name)
        current_name = self.profile.get("name") if self.profile else ""
        new_name = new_profile.get("name")

        if current_name != new_name:
            self.profile = new_profile
            self.pedalboard_frame.set_profile(new_profile)

            # Update Title
            title_text = f"Remote - {new_name}"
            if len(title_text) > 25: title_text = title_text[:25] + "..."
            self.lbl_title.configure(text=title_text)

            self.update_layout()

    def close_remote(self):
        self.callback_close()
        self.destroy()
