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

    def set_manual_override(self, profile_name):
        """
        Force un profil spécifique.
        Si None, reprend la détection automatique.
        """
        if profile_name:
            # Find the profile data
            found = next((p for p in self.profile_manager.profiles if p.get("name") == profile_name), None)
            if found:
                self.manual_override_profile = found
                print(f"[ContextMonitor] OVERRIDE SET: {profile_name}")
                # Force update immediately
                self.last_profile_name = None # Reset to trigger change detection logic
            else:
                print(f"[ContextMonitor] ERROR: Profile '{profile_name}' not found for override.")
        else:
            self.manual_override_profile = None
            print("[ContextMonitor] OVERRIDE CLEARED. Auto-detect resuming.")
            self.last_profile_name = None # Reset

    def run(self):
        self.running = True
        print("[ContextMonitor] Started monitoring active window...")

        while self.running:
            try:
                matched_profile = None

                # 1. CHECK OVERRIDE
                if self.manual_override_profile:
                    matched_profile = self.manual_override_profile
                else:
                    # 2. AUTO DETECT
                    profiles = self.profile_manager.profiles
                    matched_profile = self.action_handler.find_matching_profile(profiles)

                # 3. Determine name
                current_name = matched_profile.get('name') if matched_profile else "Global / Aucun"

                # 4. Detect Change
                if current_name != self.last_profile_name:
                    print(f"[ContextMonitor] Profile Changed: {self.last_profile_name} -> {current_name}")
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
