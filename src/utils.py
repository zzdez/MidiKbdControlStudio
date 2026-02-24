import os
import sys

def get_app_dir():
    """
    Returns the absolute path to the directory where user data should be stored.
    - If running as a frozen PyInstaller executable, returns the directory containing the .exe.
    - If running as a normal Python script in dev mode, returns the project root directory.
    """
    if getattr(sys, 'frozen', False):
        # PyInstaller mode: We want the directory containing the actual .exe
        return os.path.dirname(sys.executable)
    else:
        # Dev mode: The root of the project (parent of src)
        current_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.dirname(current_dir)

def get_data_dir():
    """
    Returns the absolute path to the 'data' directory.
    Creates it if it doesn't exist.
    """
    data_dir = os.path.join(get_app_dir(), "data")
    if not os.path.exists(data_dir):
        try:
            os.makedirs(data_dir)
        except Exception as e:
            print(f"Error creating data dir: {e}")
    return data_dir
