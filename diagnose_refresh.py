import sys, os, json
sys.path.append(r'X:\AirstepStudio\src')
from utils import resolve_portable_path, get_app_dir

# Force app dir to match the user's test folder
import utils
utils.get_app_dir = lambda: r'X:\Airstep\AirStepStudio'

lib_path = r'X:\Airstep\AirStepStudio\data\local_lib.json'
with open(lib_path, 'r', encoding='utf-8') as f:
    items = json.load(f)

for item in items:
    if "Blind Man" in item.get('title', ''):
        path = item.get('path')
        resolved = resolve_portable_path(path)
        sidecar = resolved + '.json'
        print(f"Item: {item.get('title')}")
        print(f"  Path in Lib: {path}")
        print(f"  Resolved: {resolved}")
        print(f"  Sidecar: {sidecar}")
        print(f"  Sidecar Exists: {os.path.exists(sidecar)}")
        if os.path.exists(sidecar):
            with open(sidecar, 'r', encoding='utf-8') as f2:
                data = json.load(f2)
                print(f"  BPM in Sidecar: {data.get('bpm')}")
