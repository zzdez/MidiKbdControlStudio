import os
import json
import sys

# Add src to path
sys.path.append(os.path.join(os.getcwd(), 'src'))

try:
    from utils import get_data_dir
    data_dir = get_data_dir()
    path = os.path.join(data_dir, "web_links.json")
    
    print(f"Checking path: {path}")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"Number of links: {len(data)}")
            for i, link in enumerate(data):
                print(f"Link {i}: {link.get('title')} | Cover: {link.get('cover')}")
    else:
        print("File NOT FOUND at this path.")
        
    # Check other possible locations
    root_path = os.path.join(os.getcwd(), "web_links.json")
    if os.path.exists(root_path):
         print(f"Found at ROOT: {root_path}")
         
except Exception as e:
    print(f"Error: {e}")
