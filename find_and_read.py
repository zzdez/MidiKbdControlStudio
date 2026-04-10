import os
import json

def find_file(name, path):
    for root, dirs, files in os.walk(path):
        if name in files:
            return os.path.join(root, name)
    return None

target_file = "web_links.json"
found_path = find_file(target_file, "X:\\AirstepStudio")

if found_path:
    print(f"FOUND: {found_path}")
    try:
        with open(found_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"Entries: {len(data)}")
            for i, item in enumerate(data):
                print(f"Item {i}: {item.get('title')} | Cover: {item.get('cover')}")
    except Exception as e:
        print(f"Error reading: {e}")
else:
    print("File not found on X:")
