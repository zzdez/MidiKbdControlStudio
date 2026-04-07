import json
import os
import subprocess
import webbrowser
import sys
import shutil
from utils import get_app_dir, get_data_dir, to_portable_path, resolve_portable_path

class LibraryManager:
    def __init__(self, library_file="library.json"):
        if os.path.isabs(library_file):
            self.library_file = library_file
        else:
            self.library_file = os.path.join(get_data_dir(), library_file)
        self.data = []
        self.callback_force_profile = None # Injected callback
        self.load_library()
        self.import_legacy_data()

    def set_force_profile_callback(self, cb):
        self.callback_force_profile = cb

    def load_library(self):
        if os.path.exists(self.library_file):
            try:
                with open(self.library_file, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception as e:
                print(f"Library Load Error: {e}")
                self.data = []
        else:
            self.data = []

    def save_library(self):
        try:
            with open(self.library_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=4)
        except Exception as e:
            print(f"Library Save Error: {e}")

    def import_apps_from_profiles(self, profile_manager):
        """Smart Launcher: Import apps defined in profiles"""
        if not profile_manager or not profile_manager.profiles:
            return

        # Find or create "Apps" folder
        apps_folder = next((item for item in self.data if item.get("type") == "folder" and item.get("name") == "Apps (Smart)"), None)
        if not apps_folder:
            apps_folder = {"type": "folder", "name": "Apps (Smart)", "children": []}
            self.data.append(apps_folder)

        existing_names = [c["name"] for c in apps_folder["children"]]

        added = False
        for p in profile_manager.profiles:
            app_ctx = p.get("app_context")
            name = p.get("name", "Unknown")

            if app_ctx and name not in existing_names:
                apps_folder["children"].append({
                    "type": "app",
                    "name": name,
                    "path": to_portable_path(app_ctx),
                    "profile": name # Store profile link
                })
                added = True

        if added:
            self.save_library()

    def import_legacy_data(self):
        # Only import if library is empty to avoid duplicates on every run
        if self.data:
            return

        migrated = False

        # 1. Import Setlist (setlist.json)
        setlist_path = os.path.join(get_data_dir(), "setlist.json")
        if os.path.exists(setlist_path):
            try:
                with open(setlist_path, "r", encoding="utf-8") as f:
                    setlist = json.load(f)
                    if setlist:
                        folder = {
                            "type": "folder",
                            "name": "Setlist Importée",
                            "children": []
                        }
                        for item in setlist:
                            # Map legacy fields to new structure
                            folder["children"].append({
                                "type": "url", # Usually setlist items are web
                                "name": item.get("title", "Sans titre"),
                                "path": to_portable_path(item.get("url", "")),
                                "profile": item.get("profile_name", "") # Optional context
                            })
                        self.data.append(folder)
                        migrated = True
            except: pass

        # 2. Import Apps (apps.json)
        apps_path = os.path.join(get_data_dir(), "apps.json")
        if os.path.exists(apps_path):
            try:
                with open(apps_path, "r", encoding="utf-8") as f:
                    apps = json.load(f)
                    if apps:
                        folder = {
                            "type": "folder",
                            "name": "Applications",
                            "children": []
                        }
                        for app in apps:
                            folder["children"].append({
                                "type": "app",
                                "name": app.get("name", "App"),
                                "path": to_portable_path(app.get("path", ""))
                            })
                        self.data.append(folder)
                        migrated = True
            except: pass

        if migrated:
            self.save_library()
            print("[LibraryManager] Legacy data migrated.")

    def launch_item(self, item):
        itype = item.get("type")
        path = item.get("path")
        if path:
            path = resolve_portable_path(path)
        linked_profile = item.get("profile") # Get linked profile

        print(f"[Library] Launching: {item.get('name')} ({itype})")

        # 1. Force Profile Switch if linked
        if linked_profile and self.callback_force_profile:
            print(f"[Library] Forcing Profile: {linked_profile}")
            self.callback_force_profile(linked_profile)

        try:
            if itype == "url":
                if path:
                    webbrowser.open(path)
                    return True, "URL Launched"

            elif itype == "app":
                if path:
                    # Try to resolve path if not absolute
                    target = path
                    if not os.path.isabs(path):
                        resolved = shutil.which(path)
                        if resolved: target = resolved

                    # Launch
                    subprocess.Popen(target, shell=True)
                    return True, "App Launched"
                else:
                    return False, "No path"

            elif itype == "file":
                if path and os.path.exists(path):
                    os.startfile(path)
                    return True, "File Opened"
                else:
                    return False, f"File not found: {path}"

            return False, "Unknown Type"

        except Exception as e:
            return False, str(e)

    def get_library(self):
        return self.data
