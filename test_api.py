import sys
import os

# Set working directory to src so imports work
import sys
sys.path.insert(0, r"x:\AirstepStudio\src")

from config_manager import ConfigManager
from music_api import MusicAPI

# Initialize exactly like the server
config_manager = ConfigManager()
api = MusicAPI(config_manager)

print("--- Testing API Keys ---")
keys = {
    "getsongbpm": config_manager.get("getsongbpm_api_key", ""),
    "getsongkey": config_manager.get("getsongkey_api_key", "")
}
for name, k in keys.items():
    print(f"{name}: {'SET' if k else 'EMPTY'}")

print("\n--- Testing Fetch Metadata ---")
artist = "AC/DC"
title = "Highway to Hell"

print(f"Searching for: {artist} - {title}")
res = api.fetch_metadata(artist, title)
print(f"FINAL RESULT: {res}")

print("\n--- Detailed GetSongBPM ---")
print(api.search_getsongbpm(artist, title))

print("\n--- Detailed GetSongKey ---")
print(api.search_getsongkey(artist, title))
