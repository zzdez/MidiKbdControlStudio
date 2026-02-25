import os
import json
import glob
from utils import get_app_dir

DEVICE_DIR = os.path.join(get_app_dir(), "devices")

# Hardcoded Fallback to ensure UI is never empty
DEFAULT_AIRSTEP_DEF = {
    "name": "AIRSTEP",
    "buttons": [
        {"cc": 50, "label": "Bouton A (Gauche)"},
        {"cc": 52, "label": "Bouton B (Milieu G)"},
        {"cc": 54, "label": "Bouton C (Milieu)"},
        {"cc": 56, "label": "Bouton D (Milieu D)"},
        {"cc": 58, "label": "Bouton E (Droite)"},
        {"cc": 51, "label": "Long Press A"},
        {"cc": 53, "label": "Long Press B"},
        {"cc": 55, "label": "Long Press C"},
        {"cc": 57, "label": "Long Press D"},
        {"cc": 59, "label": "Long Press E"},
        {"cc": 80, "label": "Bouton 1 (Boss)"},
        {"cc": 81, "label": "Bouton 2 (Boss)"},
        {"cc": 82, "label": "Bouton 3 (Boss)"}
    ]
}

class DeviceManager:
    def __init__(self):
        self.definitions = []
        self.ensure_device_dir()
        self.load_all_definitions()

        # Do not force AIRSTEP artificially
        pass

    def ensure_device_dir(self):
        # Use absolute path to ensure we look in the right place even if CWD changes
        self.abs_device_dir = os.path.join(get_app_dir(), DEVICE_DIR)
        if not os.path.exists(self.abs_device_dir):
            try:
                os.makedirs(self.abs_device_dir)
            except: pass # Might fail if permission denied, but we try

    def load_all_definitions(self):
        self.definitions = []
        # Fallback to local if abs path fails (dev env)
        search_path = getattr(self, 'abs_device_dir', DEVICE_DIR)

        files = glob.glob(os.path.join(search_path, "*.json"))
        # Also try relative path just in case
        if not files:
             files = glob.glob(os.path.join(DEVICE_DIR, "*.json"))

        for fpath in files:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "name" in data and "buttons" in data:
                        self.definitions.append(data)
            except Exception as e:
                print(f"Error loading device {fpath}: {e}")

        # Do not force AIRSTEP artificially
        pass

        self.definitions.sort(key=lambda x: x.get("name", "").lower())

    def save_definition(self, data):
        name = data.get("name", "Unknown")
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        if not safe_name: safe_name = "device"

        filename = f"{safe_name}.json"
        filepath = os.path.join(self.abs_device_dir, filename)

        # Update memory
        existing_idx = next((i for i, d in enumerate(self.definitions) if d.get("name") == name), -1)
        if existing_idx >= 0:
            self.definitions[existing_idx] = data
        else:
            self.definitions.append(data)

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            return True
        except Exception as e:
            print(f"Error saving device {name}: {e}")
            return False

    def get_definition_for_port(self, port_name):
        """
        Finds or Creates a definition for a given MIDI port name.
        """
        if not port_name: return None
        port_lower = port_name.lower()

        # 1. Exact Name Match (in JSON)
        for d in self.definitions:
            if d.get("name", "").lower() in port_lower:
                return d
        
        # 2. If no match, we create a TEMPORARY default one in memory
        # The user will have to save it to persist it.
        # But we check if "Default" exists first? No, we create one for THIS port.
        print(f"[DeviceManager] No known layout for '{port_name}'. Creating default.")
        
        new_def = {
            "name": port_name, # Use the port name as the device name
            "buttons": [] # Start empty
        }
        # No longer automatically forcing AIRSTEP layout for unmatched ports
        pass
        
        # We Add it to definitions so it's live
        self.definitions.append(new_def)
        return new_def

    def create_default_airstep(self):
        # We keep this for now as a fallback if folder is causing issues, 
        # but usage is minimized.
        self.save_definition(DEFAULT_AIRSTEP_DEF)

