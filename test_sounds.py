import os
import sys

def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def get_data_dir():
    return os.path.join(os.path.abspath("."), "data")

def get_metronome_sounds():
    kits = {}
    
    sounds_dir = os.path.join(get_resource_path("assets"), "metronome")
    print(f"Scanning: {sounds_dir}")
    if os.path.exists(sounds_dir):
        for filename in os.listdir(sounds_dir):
            if filename.endswith(".mp3"):
                parts = filename.rsplit("_", 1)
                if len(parts) == 2:
                    prefix = parts[0]
                    suffix = parts[1].replace(".mp3", "").lower()
                    if prefix not in kits:
                        kits[prefix] = {}
                    kits[prefix][suffix] = f"/assets/metronome/{filename}"
                    
    user_sounds_dir = os.path.join(get_data_dir(), "metronome")
    print(f"Scanning user: {user_sounds_dir}")
    if os.path.exists(user_sounds_dir):
        for filename in os.listdir(user_sounds_dir):
            if filename.endswith(".mp3"):
                parts = filename.rsplit("_", 1)
                if len(parts) == 2:
                    prefix = parts[0]
                    suffix = parts[1].replace(".mp3", "").lower()
                    if prefix not in kits:
                        kits[prefix] = {}
                    kits[prefix][suffix] = f"/assets/metronome_user/{filename}"
                    
    return kits

print(get_metronome_sounds())
