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

def get_resource_path(relative_path):
    """
    Finds resource files in both Dev and PyInstaller EXE.
    - Dev: returns path relative to project root.
    - EXE: returns path inside the temporary _MEIPASS folder.
    """
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(get_app_dir(), relative_path)

def to_portable_path(absolute_path):
    """
    Converts an absolute path to a portable path using ${APP_DIR} 
    if the path is inside the application directory.
    Otherwise, returns the absolute path unchanged.
    """
    if not absolute_path or not isinstance(absolute_path, str):
        return absolute_path
        
    app_dir = get_app_dir()
    try:
        # Use os.path.relpath to check if it's inside
        rel_path = os.path.relpath(absolute_path, app_dir)
        # If it doesn't start with '..' and is not absolute, it's inside
        if not rel_path.startswith("..") and not os.path.isabs(rel_path):
            # Normalize with forward slashes for JSON
            rel_path_unix = rel_path.replace("\\", "/")
            return f"${{APP_DIR}}/{rel_path_unix}"
    except ValueError:
        # Might happen if paths are on different drives on Windows
        pass
        
    # Standardize output for absolute paths too
    return absolute_path.replace("\\", "/") if "\\" in absolute_path else absolute_path

def get_internal_media_dirs():
    """
    Returns a list of absolute paths for internal media storage.
    """
    base_media = os.path.join(get_app_dir(), "Medias")
    subs = ["Audios", "Videos", "Midi", "Multipistes"]
    
    results = []
    for sub in subs:
        path = os.path.join(base_media, sub)
        if not os.path.exists(path):
            try:
                os.makedirs(path, exist_ok=True)
            except Exception as e:
                print(f"Error creating internal media dir {sub}: {e}")
        results.append(os.path.abspath(path))
    return results

def resolve_portable_path(stored_path):
    """
    Converts a portable path (starting with ${APP_DIR}) 
    back to an absolute path for the current system.
    Supports case-insensitive prefix detection.
    """
    if not stored_path or not isinstance(stored_path, str):
        return stored_path
        
    s_path = stored_path.strip()
    # Detection case-insensitive of ${APP_DIR} prefix
    if s_path.upper().startswith("${APP_DIR}"):
        prefix_len = len("${APP_DIR}")
        rel_part = s_path[prefix_len:].lstrip("\\/")
        
        # Convert forward slashes to system separators
        rel_part = os.path.normpath(rel_part)
        
        return os.path.normpath(os.path.join(get_app_dir(), rel_part))
        
    # Already an absolute path, normalize it
    return os.path.normpath(s_path)
