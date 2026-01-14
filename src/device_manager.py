import os
import json
import glob

DEVICE_DIR = "devices"

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

        # Ensure default AIRSTEP exists if empty
        if not self.definitions:
            self.create_default_airstep()

    def ensure_device_dir(self):
        # Use absolute path to ensure we look in the right place even if CWD changes
        self.abs_device_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", DEVICE_DIR)
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

        # Ultimate Fallback if nothing loaded
        if not self.definitions:
            print("WARNING: No devices found on disk. Using Hardcoded Fallback.")
            self.definitions.append(DEFAULT_AIRSTEP_DEF)

        self.definitions.sort(key=lambda x: x.get("name", "").lower())

    def save_definition(self, data):
        name = data.get("name", "Unknown")
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        if not safe_name: safe_name = "device"

        filename = f"{safe_name}.json"
        filepath = os.path.join(DEVICE_DIR, filename)

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
        Finds the best matching definition for a given MIDI port name.
        Logic: Case-insensitive substring match.
        """
        if not port_name: return None
        port_lower = port_name.lower()

        # 1. Exact Name Match (in JSON)
        for d in self.definitions:
            if d.get("name", "").lower() in port_lower:
                return d

        return None

    def create_default_airstep(self):
        # Default AIRSTEP configuration (Mode Toggle OFF / Momentary)
        # CC 52-56 corresponds to A-E usually on AIRSTEP
        data = {
            "name": "AIRSTEP",
            "buttons": [
                {"cc": 52, "label": "Bouton A (Gauche)"},
                {"cc": 53, "label": "Bouton B (Milieu G)"},
                {"cc": 54, "label": "Bouton C (Milieu)"},
                {"cc": 55, "label": "Bouton D (Milieu D)"},
                {"cc": 56, "label": "Bouton E (Droite)"},
                {"cc": 57, "label": "Long Press A"},
                {"cc": 58, "label": "Long Press B"},
                {"cc": 59, "label": "Long Press C"},
                {"cc": 60, "label": "Long Press D"},
                {"cc": 61, "label": "Long Press E"}
            ]
        }
        self.save_definition(data)
