import json
import os
import subprocess
import webbrowser
import sys

class LibraryManager:
    def __init__(self, library_file="library.json"):
        self.library_file = library_file
        self.data = []
        self.load_library()
        self.import_legacy_data()

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

    def import_legacy_data(self):
        # Only import if library is empty to avoid duplicates on every run
        if self.data:
            return

        migrated = False

        # 1. Import Setlist (setlist.json)
        if os.path.exists("setlist.json"):
            try:
                with open("setlist.json", "r", encoding="utf-8") as f:
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
                                "path": item.get("url", ""),
                                "profile": item.get("profile_name", "") # Optional context
                            })
                        self.data.append(folder)
                        migrated = True
            except: pass

        # 2. Import Apps (apps.json)
        if os.path.exists("apps.json"):
            try:
                with open("apps.json", "r", encoding="utf-8") as f:
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
                                "path": app.get("path", "")
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

        print(f"[Library] Launching: {item.get('name')} ({itype})")

        try:
            if itype == "url":
                if path:
                    webbrowser.open(path)
                    return True, "URL Launched"

            elif itype == "app":
                if path and os.path.exists(path):
                    subprocess.Popen(path, shell=True)
                    return True, "App Launched"
                else:
                    return False, f"Executable not found: {path}"

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
