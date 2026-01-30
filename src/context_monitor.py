import threading
import time
import json
import logging

try:
    from server import broadcast_sync
except ImportError:
    from src.server import broadcast_sync

class ContextMonitor(threading.Thread):
    def __init__(self, profile_manager, action_handler, callback=None):
        super().__init__(daemon=True)
        self.profile_manager = profile_manager
        self.action_handler = action_handler
        self.callback = callback
        self.running = False
        self.last_profile_name = None
        self.interval = 0.5 # 500ms check

        # Override Logic
        self.manual_override_profile = None

    def log_to_file(self, msg):
        try:
            with open("debug.log", "a", encoding="utf-8") as f:
                timestamp = time.strftime("%H:%M:%S")
                f.write(f"[CTX] [{timestamp}] {msg}\n")
        except: pass

    def set_manual_override(self, profile_name):
        """
        Force un profil spécifique.
        Si None, reprend la détection automatique.
        """
        self.log_to_file(f"SET OVERRIDE REQUEST: '{profile_name}'")
        if profile_name:
            # Normalize for comparison
            target_name = profile_name.strip()
            # Debug: List available names
            avail = [p.get("name") for p in self.profile_manager.profiles]
            
            # Find the profile data
            found = next((p for p in self.profile_manager.profiles if p.get("name") == target_name), None)
            
            if found:
                self.manual_override_profile = found
                self.log_to_file(f"OVERRIDE SET SUCCESS: {target_name}")
                # Force update immediately
                self.last_profile_name = None # Reset to trigger change detection logic
            else:
                self.log_to_file(f"ERROR: Profile '{target_name}' not found. Avail: {avail}")
                self.manual_override_profile = None # Clear override if invalid
        else:
            self.manual_override_profile = None
            self.log_to_file("OVERRIDE CLEARED. Auto-detect resuming.")
            self.last_profile_name = None # Reset

    def run(self):
        self.running = True
        self.log_to_file("Started monitoring active window...")

        while self.running:
            try:
                matched_profile = None

                # 1. CHECK OVERRIDE
                if self.manual_override_profile:
                    matched_profile = self.manual_override_profile
                else:
                    # --- BLACKLIST CHECK ---
                    active_process = self.action_handler.get_active_process_name().lower()
                    active_title = self.action_handler.get_active_window_title().lower()

                    blacklist_apps = ["python.exe", "airstepsmartcontrol.exe", "airstepstudio.exe"]
                    # Fix: Allow "Airstep Studio" (Web) but block "Airstep Smart Control" (Native)
                    if (active_process in blacklist_apps) or ("airstep smart control" in active_title):
                        # Ignored self-focus. Keep previous profile.
                        time.sleep(self.interval)
                        continue

                    # 2. AUTO DETECT
                    profiles = self.profile_manager.profiles
                    matched_profile = self.action_handler.find_matching_profile(profiles)

                    # --- FALLBACK LOGIC ---
                    if not matched_profile:
                        # Fallback to "Global / Desktop"
                        matched_profile = next((p for p in profiles if p.get("name") == "Global / Desktop"), None)

                # 3. Determine name
                current_name = matched_profile.get('name') if matched_profile else "Global / Aucun"

                # 4. Detect Change
                if current_name != self.last_profile_name:
                    self.log_to_file(f"Profile Changed: {self.last_profile_name} -> {current_name}")
                    self.last_profile_name = current_name


                    # 5. Callback Update
                    if self.callback:
                        self.callback(matched_profile) # Pass full object or None

            except Exception as e:
                # Avoid spamming logs if something goes wrong repeatedly
                pass

            time.sleep(self.interval)

    def stop(self):
        self.running = False
