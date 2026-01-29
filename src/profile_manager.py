import os
import json
import shutil
import glob
import zipfile

PROFILE_DIR = "profiles"

class ProfileManager:
    def __init__(self, config_file="config.json"):
        self.config_file = config_file
        self.profiles = []
        self.ensure_profile_dir()
        self.ensure_web_profiles()

    def ensure_profile_dir(self):
        if not os.path.exists(PROFILE_DIR):
            os.makedirs(PROFILE_DIR)

    def ensure_web_profiles(self):
        """Creates default Web profiles if they don't exist."""
        defaults = [
            {"name": "Web YouTube", "desc": "Controls for YouTube Player"},
            {"name": "Web Audio Local", "desc": "Controls for Local Audio Files"},
            {"name": "Web Video Local", "desc": "Controls for Local Video Files"}
        ]
        
        for d in defaults:
            safe_name = "".join([c for c in d["name"] if c.isalnum() or c in (' ', '-', '_')]).strip()
            filepath = os.path.join(PROFILE_DIR, f"{safe_name}.json")
            
            if not os.path.exists(filepath):
                # Create basic profile
                profile = {
                    "name": d["name"],
                    "app_context": "chrome.exe", # Default context
                    "window_title_filter": "",
                    "mappings": []
                }
                # Pre-fill some defaults if needed (optional)
                self.save_profile(profile)
                print(f"Created default profile: {d['name']}")

    def export_backup(self, target_path):
        try:
            with zipfile.ZipFile(target_path, 'w') as zipf:
                if os.path.exists(self.config_file):
                    zipf.write(self.config_file)

                for root_dir in [PROFILE_DIR, "devices"]:
                    if os.path.exists(root_dir):
                        for root, dirs, files in os.walk(root_dir):
                            for file in files:
                                zipf.write(os.path.join(root, file))
            return True, "Succès"
        except Exception as e:
            return False, str(e)

    def import_backup(self, source_path):
        try:
            with zipfile.ZipFile(source_path, 'r') as zipf:
                zipf.extractall(".")
            return True, "Succès"
        except Exception as e:
            return False, str(e)

    def load_all_profiles(self):
        self.profiles = []
        files = glob.glob(os.path.join(PROFILE_DIR, "*.json"))
        for fpath in files:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # Basic validation
                    if "name" in data and "mappings" in data:
                        self.profiles.append(data)
            except Exception as e:
                print(f"Error loading profile {fpath}: {e}")

        # Sort profiles by name
        self.profiles.sort(key=lambda x: x.get("name", "").lower())
        return self.profiles

    def save_profile(self, profile_data):
        """Saves a single profile to a JSON file."""
        name = profile_data.get("name", "Unknown")
        # Sanitize filename
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        if not safe_name: safe_name = "profile"

        filename = f"{safe_name}.json"
        filepath = os.path.join(PROFILE_DIR, filename)

        # Update the list in memory
        existing_idx = next((i for i, p in enumerate(self.profiles) if p.get("name") == name), -1)
        if existing_idx >= 0:
            self.profiles[existing_idx] = profile_data
        else:
            self.profiles.append(profile_data)

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(profile_data, f, indent=4)
            return True
        except Exception as e:
            print(f"Error saving profile {name}: {e}")
            return False

    def delete_profile(self, profile_name):
        """Deletes a profile file and removes from memory."""
        # Find in memory
        profile = next((p for p in self.profiles if p.get("name") == profile_name), None)
        if not profile:
            return False

        self.profiles.remove(profile)

        # Determine filename (same logic as save)
        safe_name = "".join([c for c in profile_name if c.isalnum() or c in (' ', '-', '_')]).strip()
        filename = f"{safe_name}.json"
        filepath = os.path.join(PROFILE_DIR, filename)

        if os.path.exists(filepath):
            try:
                os.remove(filepath)
                return True
            except:
                return False
        return True

    def migrate_legacy_config(self):
        """
        Reads config.json. If it contains 'mappings' (legacy list),
        it splits them into profiles and saves them to profiles/ directory.
        Then removes 'mappings' from config.json.
        """
        if not os.path.exists(self.config_file):
            return

        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
        except:
            return

        legacy_mappings = config.get("mappings")
        if not legacy_mappings:
            return # Already migrated or empty

        print("Migrating legacy mappings to profiles...")

        # Group by app_context + window_title_filter
        grouped = {}

        for m in legacy_mappings:
            app = m.get("app_context", "")
            title = m.get("window_title_filter", "")

            # Create a unique key for grouping
            key = (app, title)

            if key not in grouped:
                # Suggest a profile name
                profile_name = title if title else app
                if not profile_name: profile_name = "Global"

                # If "Global" exists from another key (e.g. empty/empty), handle conflict
                # But for now let's just make unique name later if needed.

                grouped[key] = {
                    "name": profile_name,
                    "app_context": app,
                    "window_title_filter": title,
                    "mappings": []
                }

            # Clean mapping (remove context fields)
            clean_m = m.copy()
            clean_m.pop("app_context", None)
            clean_m.pop("window_title_filter", None)

            grouped[key]["mappings"].append(clean_m)

        # Save each group as a profile
        for key, profile_data in grouped.items():
            # Ensure unique name if multiple groups resolved to same name?
            # Simple approach: append 2, 3...
            base_name = profile_data["name"]
            count = 1
            while any(p.get("name") == profile_data["name"] for p in self.profiles):
                count += 1
                profile_data["name"] = f"{base_name} {count}"

            self.save_profile(profile_data)

        # Remove mappings from config.json and save
        del config["mappings"]

        # We must preserve settings
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=4)
        except Exception as e:
            print(f"Error updating config.json: {e}")
