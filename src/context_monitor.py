import threading
import time
import json
import logging

try:
    from server import broadcast_sync
except ImportError:
    from src.server import broadcast_sync

class ContextMonitor(threading.Thread):
    def __init__(self, profile_manager, action_handler):
        super().__init__(daemon=True)
        self.profile_manager = profile_manager
        self.action_handler = action_handler
        self.running = False
        self.last_profile_name = None
        self.interval = 0.5 # 500ms check

    def run(self):
        self.running = True
        print("[ContextMonitor] Started monitoring active window...")

        while self.running:
            try:
                # 1. Get current profiles (in case they change)
                profiles = self.profile_manager.profiles

                # 2. Find matching profile for current window
                # ActionHandler has the logic to get active window and match
                matched_profile = self.action_handler.find_matching_profile(profiles)

                # 3. Determine name
                current_name = matched_profile.get('name') if matched_profile else "Global / Aucun"

                # 4. Detect Change
                if current_name != self.last_profile_name:
                    print(f"[ContextMonitor] Profile Changed: {self.last_profile_name} -> {current_name}")
                    self.last_profile_name = current_name

                    # 5. Broadcast to Web
                    msg = json.dumps({
                        "type": "profile_change",
                        "profile": current_name
                    })
                    broadcast_sync(msg)

            except Exception as e:
                # Avoid spamming logs if something goes wrong repeatedly
                pass

            time.sleep(self.interval)

    def stop(self):
        self.running = False
