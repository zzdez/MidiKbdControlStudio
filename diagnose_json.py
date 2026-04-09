import json
import os
import traceback

def check_json(path):
    print(f"Checking {path}...")
    if not os.path.exists(path):
        print("File does not exist.")
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"Success! Loaded {len(data)} items.")
            # Check for generic item structure
            for i, item in enumerate(data):
                if not isinstance(item, dict):
                    print(f"Item {i} is not a dictionary.")
    except Exception as e:
        print(f"Error loading {path}:")
        traceback.print_exc()
        return None

def simulate_server():
    print("\n--- SIMULATING SERVER LOGIC ---")
    data_dir = "data"
    local_lib = os.path.join(data_dir, "local_lib.json")
    setlist = os.path.join(data_dir, "setlist.json")
    web_links = os.path.join(data_dir, "web_links.json")
    
    file_map = {
        'lib': local_lib,
        'set': setlist,
        'web': web_links
    }
    
    if not os.path.exists(local_lib):
        print("FAIL: local_lib.json not found.")
        return

    try:
        with open(local_lib, "r", encoding="utf-8") as f:
            items = json.load(f)
        print(f"Loaded {len(items)} items from local_lib.json.")

        # Simulate migrate_legacy_links logic (simplified)
        uid_map = {}
        for prefix, path in file_map.items():
            if os.path.exists(path):
                print(f"  Mapping UIDs from {path} ({prefix})...")
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        lib_data = json.load(f)
                        for i, it in enumerate(lib_data):
                            uid = it.get("uid")
                            if uid:
                                uid_map[f"{prefix}:{i}"] = uid
                except Exception as e:
                     print(f"  Warning: failed to map {path}: {e}")

        print(f"UID Map created with {len(uid_map)} entries.")
        
        changed = False
        for item in items:
            links = item.get("linked_ids", [])
            for l in links:
                if ":" in l and not "_" in l:
                    if l in uid_map:
                        changed = True
        
        print(f"Migration simulation finished. Changed: {changed}")
        print("Final item count:", len(items))

    except Exception as e:
        print("CRITICAL ERROR IN SERVER SIMULATION:")
        traceback.print_exc()

simulate_server()
