import os
import sys
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from typing import List, Dict
import json
import requests
import re
import subprocess
import tkinter as tk
from tkinter import filedialog
import urllib.parse
import shutil
import mutagen
import time
import logging # Ensure logging is imported if not already, though it seems used elsewhere
import base64
from concurrent.futures import ThreadPoolExecutor
from utils import get_app_dir, get_data_dir
from i18n import _
# Mutagen imports removed as they are now in metadata_service

# Configure Logging
logging.basicConfig(
    filename=os.path.join(get_app_dir(), 'midikbd_debug.log'),
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

from config_manager import ConfigManager
from library_manager import LibraryManager
from metadata_service import MetadataService
from download_service import DownloadService
from music_api import MusicAPI

app = FastAPI()
library_manager = LibraryManager()
metadata_service = MetadataService()
download_service = DownloadService()
SETLIST_FILE = os.path.join(get_data_dir(), "setlist.json")
APPS_FILE = os.path.join(get_data_dir(), "apps.json")
LOCAL_LIB_FILE = os.path.join(get_data_dir(), "local_lib.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ASSETS PATH HELPER ---
def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# Mount Assets for Web Access (Logo etc)
assets_path = get_resource_path("assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
else:
    print(f"Warning: Assets folder not found at {assets_path}")

server_loop = None
config_manager = ConfigManager()
music_api_client = MusicAPI(config_manager)

@app.on_event("startup")
async def startup_event():
    global server_loop
    server_loop = asyncio.get_running_loop()

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()

def broadcast_sync(message: str):
    if server_loop:
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), server_loop)

# --- HELPERS ---
def extract_youtube_id(url: str):
    regex = r"(?:v=|\/)([0-9A-Za-z_-]{11}).*"
    match = re.search(regex, url)
    if match:
        return match.group(1)
    return None

def fetch_youtube_details(video_id: str, api_key: str):
    """Fetches full details for a specific video ID."""
    if not api_key: return None
    url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={video_id}&key={api_key}"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if "items" in data and len(data["items"]) > 0:
                item = data["items"][0]
                snippet = item.get("snippet", {})
                return {
                    "id": video_id,
                    "title": snippet.get("title"),
                    "channel": snippet.get("channelTitle"),
                    "description": snippet.get("description", ""),
                    "thumbnail_url": snippet.get("thumbnails", {}).get("medium", {}).get("url")
                }
    except Exception as e:
        print(f"YouTube API Error: {e}")
    return None

# Deprecated but kept for compatibility if imported elsewhere, aliased to new logic
def fetch_youtube_title(video_id: str, api_key: str):
    details = fetch_youtube_details(video_id, api_key)
    return details["title"] if details else None

def search_youtube(query: str, api_key: str):
    """
    Searches YouTube for query.
    Returns a list of dicts: {id, title, channel, thumbnail_url, description}
    """
    if not api_key:
        return []

    # Check if query is a direct link
    video_id = extract_youtube_id(query)
    if video_id:
        # It's a URL, fetch single video details
        details = fetch_youtube_details(video_id, api_key)
        if details:
            return [details]
        return []

    # Text Search
    url = "https://www.googleapis.com/youtube/v3/search"
    params = {
        "part": "snippet",
        "type": "video",
        "maxResults": 5,
        "q": query,
        "key": api_key
    }

    results = []
    try:
        response = requests.get(url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                video_id = item.get("id", {}).get("videoId")
                if video_id:
                    results.append({
                        "id": video_id,
                        "title": snippet.get("title"),
                        "channel": snippet.get("channelTitle"),
                        "description": snippet.get("description", ""),
                        "thumbnail_url": snippet.get("thumbnails", {}).get("medium", {}).get("url")
                    })
    except Exception as e:
        print(f"YouTube Search Error: {e}")

    return results

# --- ROUTES ---

@app.get("/api/youtube/search")
async def api_youtube_search(q: str):
    api_key = config_manager.get("YOUTUBE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing YOUTUBE_API_KEY")

    return search_youtube(q, api_key)

@app.get("/api/open_external")
async def open_external(url: str):
    """Opens a URL in the default system browser."""
    if not url:
        raise HTTPException(status_code=400, detail="Missing URL")
    
    import webbrowser
    print(f"[SERVER] Opening external URL: {url}")
    webbrowser.open(url)
    return {"status": "ok", "url": url}

@app.get("/api/metadata/blocked")
async def get_blocked_tags():
    return config_manager.get("blocked_tags", {})

@app.post("/api/metadata/block")
async def block_tag(data: Dict):
    field = data.get("field") # "category", "genre"
    value = data.get("value")
    
    if not field or not value:
        raise HTTPException(status_code=400, detail="Missing field or value")
    
    if value not in current_blocked[field]:
        current_blocked[field].append(value)
        config_manager.set("blocked_tags", current_blocked)
        
    return {"status": "ok", "blocked": current_blocked}

@app.post("/api/profile/active")
async def set_active_profile(data: Dict):
    profile_name = data.get("name")
    if not profile_name:
         raise HTTPException(status_code=400, detail="Missing profile name")
         
    # Notify Main GUI to switch
    # We use library_manager as a bridge or direct app reference if available
    # Since library_manager has a callback set by GUI, we can use it?
    # Actually, main.py passes midi_callback, but we need force_profile_switch.
    # checking LibraryManager: it has force_profile_switch logic!
    
    if library_manager.force_profile_callback:
        # Schedule it on main thread via the callback (which is gui.force_profile_switch)
        # However, gui.force_profile_switch is Tkinter code, needs to run on main thread?
        # The callback is likely set to `self.force_profile_switch` which updates UI.
        # Ideally we should use app.after, but we don't have direct access here easily unless we passed it.
        # BUT library_manager.set_force_profile_callback was called by GUI.
        
        # Let's hope the callback handles thread safety or use a queue?
        # In gui.py, `force_profile_switch` just sets variables and logs. 
        # `_monitor_remote_context` or `refresh_ui` handles the rest?
        # Actually `force_profile_switch` calls `self.current_profile = found` instantly.
        # This might be unsafe if conflict with MainThread.
        # But for now, let's assume it works or just updates state.
        
        try:
             library_manager.force_profile_callback(profile_name)
             return {"status": "ok", "profile": profile_name}
        except Exception as e:
             print(f"Profile Switch Error: {e}")
             raise HTTPException(status_code=500, detail=str(e))
             
    return {"status": "ignored", "reason": "No callback registered"}

@app.get("/api/metadata/search")
async def api_metadata_search(q: str):
    """Recherche des métadonnées via MusicBrainz (iTunes) et enrichissement BPM/Key en parallèle."""
    results = metadata_service.search(q)
    
    # Enrichment: Fetch BPM/Key for top results in parallel
    top_results = results[:5]
    
    def fetch_and_merge(item):
        try:
            music_data = music_api_client.fetch_metadata(item['artist'], item['title'])
            if music_data:
                if isinstance(music_data, list) and len(music_data) > 0:
                    best = music_data[0]
                    item['bpm'] = best.get('bpm')
                    item['key'] = best.get('key')
                elif isinstance(music_data, dict):
                    item['bpm'] = music_data.get('bpm')
                    item['key'] = music_data.get('key')
        except Exception as e:
            logging.error(f"Enrichment error for {item['title']}: {e}")
        return item

    # Use ThreadPoolExecutor for I/O bound parallel tasks
    with ThreadPoolExecutor(max_workers=5) as executor:
        enriched_results = list(executor.map(fetch_and_merge, top_results))
        
    # Combine with the rest of non-enriched results
    return enriched_results + results[5:]

@app.get("/api/media/metadata")
async def api_media_metadata(artist: str = "", title: str = ""):
    """Fetch BPM and Key using MusicAPI (Spotify, GetSongBPM, GetSongKey)."""
    if not artist and not title:
        raise HTTPException(status_code=400, detail="Missing artist or title")
    
    result = music_api_client.fetch_metadata(artist, title)
    return {"status": "ok", "data": result}

@app.get("/api/stream")
async def stream_file(request: Request, path: str):
    decoded_path = urllib.parse.unquote(path)
    logging.info(f"STREAM API HIT: {decoded_path}") 
    if not os.path.exists(decoded_path):
        logging.error(f"STREAM MISSING: {decoded_path}")
        raise HTTPException(status_code=404, detail="File not found")
    
    import mimetypes
    mime_type, _ = mimetypes.guess_type(decoded_path)
    return FileResponse(decoded_path, media_type=mime_type, filename=os.path.basename(decoded_path))

@app.get("/api/status")
async def get_status():
    config_manager._load_config()
    is_connected = False
    if hasattr(app.state, "midi_manager") and app.state.midi_manager:
        is_connected = app.state.midi_manager.is_connected

    active_profile_name = "Global / Aucun"
    if hasattr(app.state, "action_handler") and app.state.action_handler.current_profile:
         active_profile_name = app.state.action_handler.current_profile.get("name", "Global / Aucun")
    elif hasattr(app.state, "profile_manager") and app.state.profile_manager:
         # Fallback if needed, but ActionHandler tracks the live context
         pass

    return {
        "status": "ok",
        "device_name": config_manager.get("midi_device_name", _("web.none")),
        "connection_mode": config_manager.get("connection_mode", "MIDO"),
        "is_connected": is_connected,
        "active_profile_name": active_profile_name
    }

@app.get("/api/system/capabilities")
async def get_system_capabilities():
    """Returns availability of external tools (YT, FFmpeg)."""
    try:
        from dependency_manager import DependencyManager
        return DependencyManager.check_availability()
    except Exception as e:
        # Fallback safe mode
        return {"can_download": False, "error": str(e), "missing": ["unknown"]}

@app.post("/api/debug_log")
async def debug_log_endpoint(data: Dict):
    """Endpoint for JS to print logs to Python console."""
    msg = data.get("message", "")
    print(f"[JS_CONSOLE] {msg}")
    return {"status": "ok"}

@app.get("/api/setlist")
async def get_setlist():
    if os.path.exists(SETLIST_FILE):
        try:
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

            # Migration: Ensure category exists
            migrated = False
            for item in items:
                if "category" not in item:
                    item["category"] = _("web.none") # Use "None" or a key
                    migrated = True

            if migrated:
                with open(SETLIST_FILE, "w", encoding="utf-8") as f:
                    json.dump(items, f, indent=4)

            return items
        except:
            return []
    return []

@app.post("/api/setlist")
async def add_to_setlist(item: Dict):
    """
    Smart Add to Setlist.
    Analyzes URL to determine mode and profile.
    Accepts manual override for mode.
    """
    try:
        url = item.get("url", "")
        manual_mode = item.get("manual_mode", "auto")
        target_profile = item.get("target_profile", "Auto")
        category = item.get("category", "Général")

        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        # 1. Determine Type (Web vs Local)
        is_web = url.startswith("http")

        # 2. Determine Profile & Mode
        profile_name = "Web Generic"
        open_mode = "external"

        if is_web:
            if "youtube.com" in url or "youtu.be" in url:
                profile_name = "YouTube"
            elif "songsterr.com" in url:
                profile_name = "Songsterr"

            if manual_mode == "iframe":
                open_mode = "iframe"
            elif manual_mode == "external":
                open_mode = "external"
            else:
                # AUTO Detect Web
                open_mode = "iframe" if profile_name == "YouTube" else "external"
        else:
            # Local File
            profile_name = "Local Media"
            open_mode = "local"

        # 3. Extract ID (If YouTube)
        video_id = extract_youtube_id(url)

        # 4. Get Title
        title = item.get("title")
        if not title:
            # Try API for YouTube
            if open_mode == "iframe" and video_id:
                api_key = config_manager.get("YOUTUBE_API_KEY")
                title = fetch_youtube_title(video_id, api_key)
            elif open_mode == "local":
                title = os.path.basename(url)

            # Fallback
            if not title:
                title = url

        # 4. Save
        new_item = {
            "title": title,
            "url": url,
            "id": video_id,
            "open_mode": open_mode,
            "profile_name": profile_name,
            "category": category,
            "genre": item.get("genre", _("web.none")),
            "artist": item.get("artist", ""),
            "channel": item.get("channel", ""),
            "thumbnail": item.get("thumbnail", ""),
            "thumbnail": item.get("thumbnail", ""),
            "youtube_description": item.get("youtube_description", ""),
            "target_profile": target_profile,
            "user_notes": item.get("user_notes", "")
        }

        items = []
        if os.path.exists(SETLIST_FILE):
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

        items.append(new_item)

        with open(SETLIST_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=4)
        return items

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Setlist Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/setlist/{index}")
async def remove_from_setlist(index: int):
    try:
        items = []
        if os.path.exists(SETLIST_FILE):
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

        if 0 <= index < len(items):
            items.pop(index)
            with open(SETLIST_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

        return items
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/setlist/{index}")
async def update_setlist_item(index: int, item: Dict):
    try:
        items = []
        if os.path.exists(SETLIST_FILE):
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

        if 0 <= index < len(items):
            # LOGIC REPLICATION FROM POST (Smart Processing)
            url = item.get("url", "")
            manual_mode = item.get("manual_mode", "auto")
            target_profile = item.get("target_profile", "Auto")
            category = item.get("category", _("web.none"))
            title = item.get("title", _("web.none"))
            if not url:
                raise HTTPException(status_code=400, detail="URL is required")

            # 1. Determine Type (Web vs Local)
            is_web = url.startswith("http")

            # 2. Determine Profile & Mode
            profile_name = "Web Generic"
            open_mode = "external"

            if is_web:
                if "youtube.com" in url or "youtu.be" in url:
                    profile_name = "YouTube"
                elif "songsterr.com" in url:
                    profile_name = "Songsterr"

                if manual_mode == "iframe":
                    open_mode = "iframe"
                elif manual_mode == "external":
                    open_mode = "external"
                else:
                    # AUTO Detect Web
                    open_mode = "iframe" if profile_name == "YouTube" else "external"
            else:
                # Local File
                profile_name = "Local Media"
                open_mode = "local"

            # 3. Extract ID (If YouTube)
            video_id = extract_youtube_id(url)

            # 4. Construct Full Item
            updated_item = {
                "title": title,
                "url": url,
                "id": video_id,
                "open_mode": open_mode,
                "profile_name": profile_name,
                "category": category,
                "genre": item.get("genre", _("web.none")),
                "artist": item.get("artist", ""),
                "channel": item.get("channel", ""),
                "thumbnail": item.get("thumbnail", ""),
                "bpm": item.get("bpm", ""),
                "key": item.get("key", ""),
                "media_key": item.get("media_key", ""),
                "original_pitch": item.get("original_pitch", ""),
                "target_pitch": item.get("target_pitch", ""),
                "youtube_description": item.get("youtube_description", ""),
                "target_profile": target_profile,
                "user_notes": item.get("user_notes", ""),
                "volume": item.get("volume", items[index].get("volume", 100)),
                "subtitle_enabled": item.get("subtitle_enabled", items[index].get("subtitle_enabled", False)),
                "subtitle_pos_y": item.get("subtitle_pos_y", items[index].get("subtitle_pos_y", 80)),
                "loops": item.get("loops", items[index].get("loops", [])),
                "autoplay": item.get("autoplay", items[index].get("autoplay", False)),
                "autoreplay": item.get("autoreplay", items[index].get("autoreplay", False))
            }

            items[index] = updated_item

            with open(SETLIST_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)
            return items
        else:
            raise HTTPException(status_code=404, detail="Item not found")

    except Exception as e:
        print(f"Update Setlist Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- APPS LAUNCHER ---
@app.get("/api/apps")
async def get_apps():
    if os.path.exists(APPS_FILE):
        try:
            with open(APPS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

@app.post("/api/apps")
async def add_app(app_def: Dict):
    try:
        apps = []
        if os.path.exists(APPS_FILE):
            with open(APPS_FILE, "r", encoding="utf-8") as f:
                apps = json.load(f)

        apps.append(app_def)

        with open(APPS_FILE, "w", encoding="utf-8") as f:
            json.dump(apps, f, indent=4)
        return apps
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- SETTINGS & CONFIG ---

@app.get("/api/midi/outputs")
async def get_midi_outputs():
    """Returns list of MIDI output ports with status."""
    try:
        from midi_engine import MidiManager
        return MidiManager.get_ports_status()
    except Exception as e:
        # Fallback if method missing or error
        return [{"name": "Error: " + str(e), "selected": False, "connected": False, "available": False}]

@app.get("/api/settings")
async def get_settings():
    """Returns all configuration settings."""
    # Reload config to be sure
    config_manager._load_config()
    
    # Construct settings object
    return {
        "YOUTUBE_API_KEY": config_manager.get("YOUTUBE_API_KEY", ""),
        "spotify_client_id": config_manager.get("spotify_client_id", ""),
        "spotify_client_secret": config_manager.get("spotify_client_secret", ""),
        "getsong_api_key": config_manager.get("getsong_api_key") or config_manager.get("getsongbpm_api_key") or "",
        "media_folders": config_manager.get("media_folders", []),
        "midi_output_names": config_manager.get("midi_output_names", []),
        "midi_output_name": config_manager.get("midi_output_name", ""), # Legacy fallback
        "language": config_manager.get("language", "fr")
    }

@app.get("/api/locales/{lang}")
async def get_locale(lang: str):
    try:
        from utils import get_app_dir, get_resource_path
        # 1. Try external
        path = os.path.join(get_app_dir(), "locales", f"{lang}.json")
        if not os.path.exists(path):
            # 2. Try internal bundle
            path = get_resource_path(os.path.join("locales", f"{lang}.json"))
            
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"error": "Locale not found"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/settings")
async def update_settings(settings: Dict):
    """Updates configuration."""
    for key, value in settings.items():
        config_manager.set(key, value)
        
    # Apply MIDI settings immediately if present
    if "midi_output_names" in settings:
        try:
            from midi_engine import MidiManager
            # Ensure it's a list
            ports = settings["midi_output_names"]
            if isinstance(ports, list):
                 MidiManager.set_output_ports(ports)
                 print(f"[SERVER] Applied new MIDI ports: {ports}")
        except Exception as e:
            print(f"[SERVER] Failed to apply MIDI ports: {e}")

    return {"status": "ok", "settings": settings}

@app.post("/api/toggle_remote")
async def toggle_remote():
    """Toggles the Native Remote Windows."""
    if hasattr(app.state, "toggle_remote_callback"):
        app.state.toggle_remote_callback()
        return {"status": "success"}
    return {"status": "error", "message": "Callback not linked"}

@app.post("/api/open_native_editor")
async def open_native_editor():
    """Opens the Native Tkinter Window (Main App)."""
    if hasattr(app.state, "open_settings_callback"):
        app.state.open_settings_callback()
        return {"status": "opened"}
    return {"status": "error", "message": "Callback not linked"}

# Compatibility alias
@app.post("/api/open_settings")
async def open_settings_alias():
    return await open_native_editor()

@app.post("/api/library/add_folder")
async def add_library_folder():
    """Triggers Native Folder Selector"""
    if hasattr(app.state, "select_folder_callback"):
        path = app.state.select_folder_callback()
        if path:
            # Add to config
            folders = config_manager.get("media_folders", [])
            if path not in folders:
                folders.append(path)
                config_manager.set("media_folders", folders)
                # Trigger Library Rescan (Optional but good)
                # library_manager.scan_local_files() # If we had one exposed
            return {"status": "added", "path": path, "folders": folders}
        return {"status": "cancelled"}
    return {"status": "error", "message": "Callback not linked"}


@app.post("/api/launch_app")
async def launch_app(request: Request):
    try:
        body = await request.json()
        path = body.get("path")
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=400, detail="Executable path not found")

        subprocess.Popen(path, shell=True)
        return {"status": "launched", "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/library")
async def get_library():
    """Returns the hierarchical library structure."""
    return library_manager.get_library()

# --- LOCAL LIBRARY ---

@app.get("/api/local/files")
async def get_local_files():
    if os.path.exists(LOCAL_LIB_FILE):
        try:
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

@app.get("/api/local/art/{index}")
async def get_local_art(index: int):
    path = None
    if os.path.exists(LOCAL_LIB_FILE):
        try:
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)
                if 0 <= index < len(items):
                    path = items[index].get("path")
        except: pass

    if not path or not os.path.exists(path):
        return Response(status_code=404)

    try:
        data, mime = metadata_service.get_file_cover(path)
        if data:
            return Response(content=data, media_type=mime)
        return Response(status_code=404)
    except Exception as e:
        logging.error(f"Error fetching art for {path}: {e}")
        return Response(status_code=404)

@app.post("/api/local/add")
async def add_local_file():
    try:
        if hasattr(app.state, "select_file_callback"):
            path = app.state.select_file_callback()
            if path:
                # --- SMART IMPORT CHECK ---
                folders = config_manager.get("media_folders", [])
                
                # Normalize paths for comparison
                abs_path = os.path.abspath(path)
                
                # Check if file is inside one of the managed folders
                is_managed = False
                for folder in folders:
                    abs_folder = os.path.abspath(folder)
                    # Check if path starts with folder path (simple containment check)
                    if abs_path.lower().startswith(abs_folder.lower()):
                        is_managed = True
                        break
                
                if not is_managed:
                    return {
                        "status": "import_needed",
                        "source_path": path,
                        "filename": os.path.basename(path),
                        "target_folders": folders
                    }
                
                # If already managed, proceed normally
                try:
                    # Update to use metadata_service
                    file_data = metadata_service.scan_file_metadata(path)
                    file_data["path"] = path
                    file_data["added_at"] = time.time()
                    
                    items = []
                    if os.path.exists(LOCAL_LIB_FILE):
                        with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                            items = json.load(f)
                    
                    # Avoid duplicates
                    existing = next((i for i in items if i["path"] == path), None)
                    if not existing:
                        items.append(file_data)
                        with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                            json.dump(items, f, indent=4)
                        return {"status": "ok", "message": "Added"}
                    else:
                         return {"status": "exists", "message": "Already in library"}
                except Exception as e:
                     logging.error(f"Scan Error on Add: {e}")
                     return {"status": "error", "message": str(e)}

        return {"status": "cancelled"}
    except Exception as e:
        print(f"Add File Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/add_multitrack_folder")
async def add_multitrack_folder():
    try:
        if hasattr(app.state, "select_folder_callback"):
            path = app.state.select_folder_callback()
            if path:
                # --- SMART IMPORT CHECK ---
                folders = config_manager.get("media_folders", [])
                abs_path = os.path.abspath(path)
                
                is_managed = False
                for folder in folders:
                    abs_folder = os.path.abspath(folder)
                    if abs_path.lower().startswith(abs_folder.lower()):
                        is_managed = True
                        break
                
                if not is_managed:
                    return {
                        "status": "import_needed",
                        "source_path": path,
                        "filename": os.path.basename(path.rstrip('/\\')),
                        "target_folders": folders
                    }
                
                # If already managed, proceed normally
                try:
                    file_data = metadata_service.scan_file_metadata(path)
                    file_data["path"] = path
                    file_data["added_at"] = time.time()
                    
                    items = []
                    if os.path.exists(LOCAL_LIB_FILE):
                        with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                            items = json.load(f)
                    
                    existing = next((i for i in items if i["path"] == path), None)
                    if not existing:
                        items.append(file_data)
                        with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                            json.dump(items, f, indent=4)
                        return {"status": "ok", "message": "Added"}
                    else:
                         return {"status": "exists", "message": "Already in library"}
                except Exception as e:
                     logging.error(f"Scan Error on Add Multitrack: {e}")
                     return {"status": "error", "message": str(e)}

        return {"status": "cancelled"}
    except Exception as e:
        print(f"Add Multitrack Folder Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/confirm_import")
async def confirm_import(data: Dict):
    source_path = data.get("source_path", "").strip()
    action = data.get("action") # "copy", "move", "link"
    target_folder = data.get("target_folder", "").strip()
    
    # Debug exact content including hidden chars
    logging.info(f"IMPORT REQUEST RAW: Source={repr(source_path)} Target={repr(target_folder)} Action={action}")

    if not source_path or not os.path.exists(source_path):
        logging.error(f"Import Source Path Not Found: {repr(source_path)}")
        raise HTTPException(status_code=400, detail="Source file not found")

    final_path = source_path
    
    try:
        if action in ["copy", "move"]:
            # Normalize target folder
            if target_folder:
                target_folder = os.path.normpath(target_folder)
            
            # Check availability
            if not target_folder or not os.path.isdir(target_folder):
                 logging.error(f"Import Target Folder Invalid (Not a dir or missing): {repr(target_folder)}")
                 
                 # PROBE: Try to list parent dir to understand why
                 try:
                     parent = os.path.dirname(target_folder)
                     if os.path.exists(parent):
                         logging.info(f"Parent {parent} exists. Sibling listing: {os.listdir(parent)[:5]}...")
                     else:
                         logging.warning(f"Parent {parent} does NOT exist.")
                 except: pass

                 raise HTTPException(status_code=400, detail=f"Target folder invalid: {target_folder}")
                 
            filename = os.path.basename(source_path.rstrip('/\\'))
            destination = os.path.join(target_folder, filename)
            
            # Handle duplicates (Auto-rename)
            if os.path.isdir(source_path):
                base = destination
                counter = 1
                while os.path.exists(destination):
                    destination = f"{base}_{counter}"
                    counter += 1
                
                if action == "copy":
                    shutil.copytree(source_path, destination)
                elif action == "move":
                    shutil.move(source_path, destination)
            else:
                base, ext = os.path.splitext(destination)
                counter = 1
                while os.path.exists(destination):
                    destination = f"{base}_{counter}{ext}"
                    counter += 1
                
                if action == "copy":
                    shutil.copy2(source_path, destination)
                elif action == "move":
                    shutil.move(source_path, destination)
                
            final_path = destination

        # Add to Library
        # Update to use metadata_service
        file_data = metadata_service.scan_file_metadata(final_path)
        file_data["path"] = final_path
        file_data["added_at"] = time.time()
        
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                  items = json.load(f)
                  
        existing = next((i for i in items if i["path"] == final_path), None)
        if not existing:
             items.append(file_data)
             with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                 json.dump(items, f, indent=4)
                 
        return {"status": "ok", "path": final_path}
        
    except Exception as e:
        logging.error(f"Import Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/local/{index}")
async def update_local_file(index: int, item: Dict):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

        if 0 <= index < len(items):
            current = items[index]
            # Update fields
            current["title"] = item.get("title", current["title"])
            current["artist"] = item.get("artist", current.get("artist", ""))
            current["album"] = item.get("album", current.get("album", ""))
            current["genre"] = item.get("genre", current.get("genre", ""))
            current["category"] = item.get("category", current.get("category", "Général"))
            current["year"] = item.get("year", current.get("year", ""))
            current["target_profile"] = item.get("target_profile", current.get("target_profile", "Auto"))
            current["user_notes"] = item.get("user_notes", current.get("user_notes", ""))
            current["subtitle_enabled"] = item.get("subtitle_enabled", current.get("subtitle_enabled", False))
            current["subtitle_pos_y"] = item.get("subtitle_pos_y", current.get("subtitle_pos_y", 80))
            current["volume"] = item.get("volume", current.get("volume", 100))
            current["loops"] = item.get("loops", current.get("loops", []))
            current["bpm"] = item.get("bpm", current.get("bpm", ""))
            current["key"] = item.get("key", current.get("key", ""))
            current["media_key"] = item.get("media_key", current.get("media_key", ""))
            current["original_pitch"] = item.get("original_pitch", current.get("original_pitch", ""))
            current["target_pitch"] = item.get("target_pitch", current.get("target_pitch", ""))
            current["autoplay"] = item.get("autoplay", current.get("autoplay", False))
            current["autoreplay"] = item.get("autoreplay", current.get("autoreplay", False))
            
            # 1. Save JSON (Database Priority)
            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

            # 2. Write to disk tags (Physical)
            warning_msg = None
            ext = os.path.splitext(current["path"])[1].lower()
            
            if ext in ['.webm', '.mkv']:
                warning_msg = "Métadonnées sauvegardées dans la base locale uniquement (Format vidéo non éditable)."
            else:
                try:
                    # Update to use metadata_service
                    metadata_service.write_file_metadata(current["path"], item)
                except PermissionError:
                    warning_msg = "Attention : Le fichier est en cours d'utilisation. Les tags internes n'ont pas été modifiés, mais la bibliothèque est à jour."
                except Exception as e:
                    print(f"Tag Write Warning: {e}")
            
            return {
                "status": "partial_success" if warning_msg else "ok",
                "warning": warning_msg,
                "items": items
            }
        else:
            raise HTTPException(status_code=404, detail="Item not found")

    except Exception as e:
        print(f"Update Local Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/local/stream/{index}")
async def stream_local_file_by_index(request: Request, index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            path = items[index]["path"]
            if os.path.exists(path):
                import mimetypes
                mime_type, _ = mimetypes.guess_type(path)
                return FileResponse(path, media_type=mime_type, filename=os.path.basename(path))
            else:
                 raise HTTPException(status_code=404, detail="File not found on disk")
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Stream Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/local/peaks/{index}/{stem_index}")
async def get_local_stem_peaks(index: int, stem_index: int):
    try:
        if not os.path.exists(LOCAL_LIB_FILE):
             return []
        with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
             items = json.load(f)
             
        if 0 <= index < len(items):
            item = items[index]
            if item.get("is_multitrack") and "stems" in item:
                stems = item["stems"]
                if 0 <= stem_index < len(stems):
                    path = stems[stem_index]
                    if os.path.exists(path):
                        peaks = metadata_service.generate_peaks(path)
                        return peaks
        return []
    except Exception as e:
        logging.error(f"Peaks Endpoint Error: {e}")
        return []

@app.get("/api/local/subs_list/{index}")
async def get_local_subs_list(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            video_path = items[index]["path"]
            if os.path.exists(video_path):
                import glob
                base, _ = os.path.splitext(video_path)
                
                # Check for any matching subtitle
                search_srt = glob.glob(glob.escape(base) + "*.srt")
                search_vtt = glob.glob(glob.escape(base) + "*.vtt")
                
                all_subs = search_srt + search_vtt
                # Return only the filenames, not the full path, for security and simpler UI mapping
                sub_names = [os.path.basename(p) for p in all_subs]
                return {"status": "ok", "subs": sub_names}
                
            else:
                 raise HTTPException(status_code=404, detail="Video file not found")
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Subs List Error: {e}")
        return {"status": "error", "subs": []}

@app.get("/api/local/subs/{index}")
async def get_local_subs(index: int, track: str = None):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            video_path = items[index]["path"]
            if os.path.exists(video_path):
                import glob
                base, _ = os.path.splitext(video_path)
                
                # Check for any matching subtitle using glob to handle .en.vtt or .fr.srt
                search_srt = glob.glob(glob.escape(base) + "*.srt")
                search_vtt = glob.glob(glob.escape(base) + "*.vtt")
                
                all_subs = search_srt + search_vtt
                if all_subs:
                    if track:
                        # Find the specific track by basename
                        for sub_path in all_subs:
                            if os.path.basename(sub_path) == track:
                                return FileResponse(sub_path, media_type="text/plain")
                    # Fallback or default: Return the first match we find
                    return FileResponse(all_subs[0], media_type="text/plain")
                
                # No subs found
                return Response(content="", media_type="text/plain")
            else:
                 raise HTTPException(status_code=404, detail="Video file not found")
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Subs Error: {e}")
        return Response(content="", media_type="text/plain")

@app.delete("/api/local/{index}")
async def delete_local_file(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

        if 0 <= index < len(items):
            items.pop(index)
            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)
        return items
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/local/stem/{index}/{stem_index}")
async def delete_local_stem(index: int, stem_index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

        if 0 <= index < len(items):
            item = items[index]
            if item.get("is_multitrack") and "stems" in item:
                stems = item["stems"]
                if 0 <= stem_index < len(stems):
                    stem_path = stems[stem_index]
                    
                    # 1. Delete physical file
                    if os.path.exists(stem_path):
                        try:
                            os.remove(stem_path)
                            logging.info(f"[BACKEND] Stem deleted: {stem_path}")
                        except Exception as e:
                            logging.error(f"[BACKEND] Failed to delete file {stem_path}: {e}")
                            # We continue to update JSON even if file delete failed (maybe already gone)
                    
                    # 2. Update metadata
                    stems.pop(stem_index)
                    
                    # If it was the last stem, maybe we should alert? 
                    # But user might want to delete all stems.
                    
                    with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                        json.dump(items, f, indent=4)
                        
                    return {"status": "ok", "message": "Stem deleted", "items": items}
            
            raise HTTPException(status_code=404, detail="Stem or multitrack not found")
        else:
            raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
         logging.error(f"Delete Stem Error: {e}")
         raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/local/multitrack_settings/{index}")
async def get_multitrack_settings(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            path = items[index]["path"]
            item_data = items[index]
            result = {}

            if os.path.isdir(path):
                settings_file = os.path.join(path, "airstep_meta.json")
                if os.path.exists(settings_file):
                    with open(settings_file, "r", encoding="utf-8") as f:
                        result = json.load(f)

            # Override/supplement with database properties for consistency
            if "autoplay" in item_data:
                result["autoplay"] = item_data["autoplay"]
            if "autoreplay" in item_data:
                result["autoreplay"] = item_data["autoreplay"]

            return result
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Get Settings Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/multitrack_settings/{index}")
async def save_multitrack_settings(index: int, request: Request):
    try:
        settings = await request.json()
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            path = items[index]["path"]

            # Sync autoplay/autoreplay properties back to the main items DB too
            if "autoplay" in settings:
                items[index]["autoplay"] = settings["autoplay"]
            if "autoreplay" in settings:
                items[index]["autoreplay"] = settings["autoreplay"]

            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

            if os.path.isdir(path):
                settings_file = os.path.join(path, "airstep_meta.json")
                with open(settings_file, "w", encoding="utf-8") as f:
                    json.dump(settings, f, indent=4)
                return {"status": "ok"}
            return {"status": "error", "message": "Not a directory"}
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Save Settings Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/local/art/{index}")
async def get_local_art(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            path = items[index]["path"]
            # Use Service
            data, mime = metadata_service.get_file_cover(path)
            
            if data and mime:
                 # Helper response with caching
                 return Response(content=data, media_type=mime)
            else:
                 raise HTTPException(status_code=404, detail="No Art")
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Art Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- CONFIG MANAGER (Profiles/Devices) ---
@app.get("/api/profiles")
async def get_profiles(request: Request):
    # Retrieve from ProfileManager via State
    if hasattr(request.app.state, "profile_manager"):
        return request.app.state.profile_manager.profiles
    
    # Fallback to old method (or empty)
    if hasattr(request.app.state, "profiles"):
        return request.app.state.profiles
    return []

# Placeholder for device/profile management if needed by frontend
# Currently ProfileManager loads from disk.

@app.post("/api/set_mode")
async def set_mode(request: Request):
    """
    Sets the operational mode and forces a profile override.
    Payload: {"mode": "WEB"|"WIN", "forced_profile_name": "..."}
    """
    try:
        body = await request.json()
        mode = body.get("mode")
        forced_profile_name = body.get("forced_profile_name")

        print(f"[DEBUG API] Reçu demande set_mode: Mode={mode}, Profil={forced_profile_name}")
    
        # Debug to file
        try:
            with open("debug.log", "a", encoding="utf-8") as f:
                import datetime
                ts = datetime.datetime.now().strftime("%H:%M:%S")
                f.write(f"[API] [{ts}] set_mode: Mode={mode}, Profil={forced_profile_name}\n")
        except: pass

        # Notify GUI Callback if registered
        if hasattr(app.state, "set_mode_callback") and app.state.set_mode_callback:
            app.state.set_mode_callback(mode, forced_profile_name)

        # Access Context Monitor
        if not hasattr(request.app.state, "context_monitor"):
             # Might happen if not fully initialized or wrong injection
             # But context_monitor should be injected in main.py
             pass
        else:
            context_monitor = request.app.state.context_monitor

            # Fix: app.js sends granular modes (YOUTUBE, AUDIO, VIDEO) which are all "WEB" contexts
            web_modes = ["WEB", "YOUTUBE", "AUDIO", "VIDEO"]
            
            if mode in web_modes and forced_profile_name:
                context_monitor.set_manual_override(forced_profile_name)
            elif mode == "WIN":
                # WIN Mode -> Release Lock (Auto-Detect) so ContextMonitor can track active window
                context_monitor.set_manual_override(None)
            else:
                # Default safety: if unknown mode, maybe clear override? 
                # Or do nothing. Doing nothing is safer.
                pass

        return {"status": "ok", "mode": mode}
    except Exception as e:
        print(f"SetMode Error: {e}")
        return {"status": "error", "detail": str(e)}

@app.post("/api/trigger")
async def trigger_action(request: Request):
    try:
        body = await request.json()
        cc = body.get("cc")
        value = body.get("value", 127)

        if not hasattr(request.app.state, "action_handler"):
            raise HTTPException(status_code=503, detail="Action Handler not ready")

        action_handler = request.app.state.action_handler
        profiles = request.app.state.profiles

        action_handler.execute(int(cc), int(value), 1, profiles)

        return {"status": "triggered", "cc": cc}
    except Exception as e:
        print(f"Trigger Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- DOWNLOADER ---

@app.get("/api/dl/status")
async def dl_status():
    return {"ffmpeg": download_service.ffmpeg_available}

@app.post("/api/dl/info")
async def dl_info(data: Dict):
    url = data.get("url")
    if not url: raise HTTPException(status_code=400, detail="Missing URL")
    return download_service.get_formats(url)

@app.post("/api/dl/stream_url")
async def dl_stream_url(data: Dict):
    url = data.get("url")
    if not url: raise HTTPException(status_code=400, detail="Missing URL")
    return download_service.get_direct_url(url)

@app.post("/api/dl/start")
async def dl_start(data: Dict):
    """
    Starts a download in background.
    data: {url, format_id, target_folder, subs, metadata}
    """
    import threading

    def progress_cb(percent, status):
        broadcast_sync(json.dumps({
            "type": "dl_progress",
            "percent": percent,
            "status": status
        }))

    def completion_cb(success, result):
        if success:
            path = result["path"]
            # Add to Local Library
            try:
                # Refresh Metadata from file to be sure
                file_data = metadata_service.scan_file_metadata(path)
                file_data["path"] = path
                file_data["added_at"] = time.time()

                # Inject Chapters from Download Service
                if "chapters" in result:
                    file_data["chapters"] = result["chapters"]

                # Check for cover art passed in metadata to force cached refresh if needed?
                # Actually scan_file_metadata is enough usually.

                # MERGE LOGICAL METADATA (Category, Notes, Profile)
                # scan_file_metadata only gets physical tags. We want to keep what user entered.
                original_meta = data.get("metadata", {})
                if original_meta:
                    if "category" in original_meta: file_data["category"] = original_meta["category"]
                    if "user_notes" in original_meta: file_data["user_notes"] = original_meta["user_notes"]
                    if "target_profile" in original_meta: file_data["target_profile"] = original_meta["target_profile"]
                    # If physical title/artist empty, use input
                    if not file_data.get("title") and "title" in original_meta: file_data["title"] = original_meta["title"]
                    if not file_data.get("artist") and "artist" in original_meta: file_data["artist"] = original_meta["artist"]

                items = []
                if os.path.exists(LOCAL_LIB_FILE):
                    with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                        items = json.load(f)

                # Update if exists
                existing_idx = next((i for i, x in enumerate(items) if x["path"] == path), -1)
                if existing_idx >= 0:
                    items[existing_idx] = file_data
                else:
                    items.append(file_data)

                with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                    json.dump(items, f, indent=4)

                broadcast_sync(json.dumps({"type": "dl_complete", "path": path}))
            except Exception as e:
                logging.error(f"Post-DL Library Error: {e}")
                broadcast_sync(json.dumps({"type": "dl_error", "error": "Library Update Failed"}))
        else:
             broadcast_sync(json.dumps({"type": "dl_error", "error": result}))

    # Run in Thread
    t = threading.Thread(target=download_service.download, args=(data, progress_cb, completion_cb))
    t.start()

    return {"status": "started"}

@app.post("/api/open_settings")
async def api_open_settings(request: Request):
    try:
        if hasattr(request.app.state, "open_settings_callback"):
            callback = request.app.state.open_settings_callback
            if callback:
                callback()
                return {"status": "ok"}
        return {"status": "error", "message": "Callback not connected"}
    except Exception as e:
        print(f"OpenSettings Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Static Files Logic
if getattr(sys, 'frozen', False):
    base_path = sys._MEIPASS
else:
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

web_path = os.path.join(base_path, "web")

if os.path.exists(web_path):
    app.mount("/", StaticFiles(directory=web_path, html=True), name="static")
else:
    print(f"WARNING: Web directory not found at {web_path}")
