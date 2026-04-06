import os
import sys

# Simulation de utils.py
def get_app_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.dirname(os.path.abspath(current_dir))

def get_data_dir():
    return os.path.join(get_app_dir(), "data")

print(f"PYTHON_EXE: {sys.executable}")
print(f"IS_FROZEN: {getattr(sys, 'frozen', False)}")
print(f"APP_DIR: {get_app_dir()}")
print(f"DATA_DIR: {get_data_dir()}")
print(f"CWD: {os.getcwd()}")

web_links_path = os.path.join(get_data_dir(), "web_links.json")
print(f"TARGET_FILE: {web_links_path}")
print(f"EXISTS: {os.path.exists(web_links_path)}")

# Liste du dossier data pour être sûr
if os.path.exists(get_data_dir()):
    print(f"Contents of {get_data_dir()}:")
    print(os.listdir(get_data_dir()))
else:
    print("DATA DIR DOES NOT EXIST")
