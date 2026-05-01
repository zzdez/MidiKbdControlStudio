
import os
import sys
import logging
import json

# Add src to path
sys.path.append(r'X:\AirstepStudio\src')

from sync_manager import SyncManager, WebdavProvider

# Config from X:\TMP\AirStepStudio\config.json
webdav_url = "http://192.168.10.15:8080"
webdav_user = "GuitarPracticesync"
webdav_pass = "&aqwWSE4'rfv"
local_dir = r"X:\TMP\AirStepStudio"

logging.basicConfig(level=logging.WARNING)

try:
    print(f"Initializing WebdavProvider on {webdav_url}...")
    provider = WebdavProvider(webdav_url, webdav_user, webdav_pass)
    
    print(f"Initializing SyncManager on {local_dir}...")
    mgr = SyncManager(local_dir, provider)
    
    print("Starting analysis...")
    # Using categories from config
    cats = ["exe", "medias", "data", "profiles", "devices", "system"]
    res = mgr.analyze(selected_categories=cats)
    
    print("Analysis successful!")
    print(f"Pull: {len(res['pull'])}, Push: {len(res['push'])}")
    
except Exception as e:
    print(f"FAILED with error: {e}")
    import traceback
    traceback.print_exc()
