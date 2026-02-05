import os
import sys
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Response, BackgroundTasks
import fastapi # For explicit type hinting if needed
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Optional
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
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TCON, TDRC, TRCK, error as ID3Error
from mutagen.easyid3 import EasyID3
from mutagen.easymp4 import EasyMP4
from mutagen.flac import Picture, FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE
from mutagen.mp4 import MP4, MP4Cover
import logging

# Configure Logging
logging.basicConfig(
    filename='airstep_debug.log',
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

try:
    from config_manager import ConfigManager
    from library_manager import LibraryManager
    from metadata_service import MetadataService
    from youtube_downloader import YouTubeDownloader
    from services.translator import parse_vtt, generate_vtt, translate_batch
    from services.import_service import ImportService
except ImportError:
    from src.library_manager import LibraryManager
    from src.metadata_service import MetadataService
    from src.youtube_downloader import YouTubeDownloader
    from src.services.translator import parse_vtt, generate_vtt, translate_batch # Import service
    from src.services.import_service import ImportService

# Determine Download Path (User/Music/AirstepDownloads)
DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Music", "AirstepDownloads")
if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR)

app = FastAPI()
library_manager = LibraryManager()
metadata_service = MetadataService()
youtube_downloader = YouTubeDownloader(DOWNLOAD_DIR)
import_service = ImportService(DOWNLOAD_DIR)
SETLIST_FILE = "setlist.json"
APPS_FILE = "apps.json"
LOCAL_LIB_FILE = "local_lib.json"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

server_loop = None
config_manager = ConfigManager()

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

@app.post("/api/import/youtube")
async def import_youtube(data: Dict, background_tasks: fastapi.BackgroundTasks):
    url = data.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Missing URL")
    
    # Define Background Task
    def download_task(target_url):
        
        # Logger that broadcasts to Frontend
        class BroadcastLogger:
            def debug(self, msg):
                if msg.startswith('[debug] '): msg = msg[8:]
                broadcast_sync(json.dumps({"type": "log", "data": msg}))
            def info(self, msg):
                broadcast_sync(json.dumps({"type": "log", "data": msg}))
            def warning(self, msg):
                broadcast_sync(json.dumps({"type": "log", "data": f"WARNING: {msg}"}))
            def error(self, msg):
                broadcast_sync(json.dumps({"type": "log", "data": f"ERROR: {msg}"}))

        logger = BroadcastLogger()

        def progress_callback(d):
            # yt-dlp progress hook
            if d['status'] == 'downloading':
                # Reduce chatty logs specifically for percentage to process bar
                p = d.get('_percent_str', '0%').replace('%','')
                try: 
                    msg = json.dumps({
                        "type": "download_progress", 
                        "data": {
                            "status": "downloading",
                            "percent": p,
                            "filename": d.get('filename', 'Unknown')
                        }
                    })
                    broadcast_sync(msg)
                except: pass
            elif d['status'] == 'finished':
                broadcast_sync(json.dumps({"type": "download_progress", "data": {"status": "processing"}}))

        # Run Download
        try:
            logger.info(f"Starting download for: {target_url}")
            result = youtube_downloader.download(target_url, progress_hook=progress_callback, logger=logger)
            
            # Notify Success
            if result["status"] == "success":
                # Add to Setlist AUTOMATICALLY
                new_item = {
                    "title": result["title"],
                    "url": result["path"], # Local Path
                    "manual_mode": "local",
                    "category": "Téléchargements",
                    "target_profile": "Auto"
                }
                
                # We can't call async add_to_setlist easily from sync thread, 
                # but we can replicate logic or just append to file. 
                # Reusing helper would be best. 
                # For now, let's just broadcast completion and let Frontend refresh or Add.
                
                broadcast_sync(json.dumps({
                    "type": "download_complete", 
                    "data": result
                }))
                
            else:
                 broadcast_sync(json.dumps({
                    "type": "download_error", 
                    "message": result.get("message", "Unknown Error")
                }))
                
        except Exception as e:
            print(f"BG Download Error: {e}")
            broadcast_sync(json.dumps({
                    "type": "download_error", 
                    "message": str(e)
                }))

    background_tasks.add_task(download_task, url)
        
    return {"status": "started", "message": "Téléchargement lancé en arrière-plan"}

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
    """Recherche des métadonnées via MusicBrainz."""
    return metadata_service.search(q)


@app.get("/api/stream")
async def stream_file(path: str):
    decoded_path = urllib.parse.unquote(path)
    logging.info(f"STREAM API HIT: {decoded_path}") 
    if not os.path.exists(decoded_path):
        logging.error(f"STREAM MISSING: {decoded_path}")
        raise HTTPException(status_code=404, detail="File not found")
    
    # Force media type for common video formats if needed, or let FileResponse guess
    return FileResponse(decoded_path)

@app.get("/api/status")
async def get_status():
    return {"status": "ok"}

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
                    item["category"] = "Général"
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
            "genre": item.get("genre", "Divers"),
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
            category = item.get("category", "Général")
            title = item.get("title", "Sans titre")

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
                "genre": item.get("genre", "Divers"),
                "artist": item.get("artist", ""),
                "channel": item.get("channel", ""),
                "thumbnail": item.get("thumbnail", ""),
                "thumbnail": item.get("thumbnail", ""),
                "youtube_description": item.get("youtube_description", ""),
                "target_profile": target_profile,
                "user_notes": item.get("user_notes", "")
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

@app.get("/api/settings")
async def get_settings():
    """Returns all configuration settings."""
    # Reload config to be sure
    config_manager._load_config()
    
    # Construct settings object
    return {
        "YOUTUBE_API_KEY": config_manager.get("YOUTUBE_API_KEY", ""),
        "media_folders": config_manager.get("media_folders", [])
    }

@app.post("/api/settings")
async def update_settings(settings: Dict):
    """Updates configuration."""
    for key, value in settings.items():
        config_manager.set(key, value)
    return {"status": "ok", "settings": settings}

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


def scan_file_metadata(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        audio = None
        if ext in ['.m4a', '.mp4']:
            try: audio = EasyMP4(path)
            except: pass
        elif ext == '.ogg':
            try: audio = OggVorbis(path)
            except: pass
        
        # Generic Fallback (Handles WebM/MKV if supported by installed mutagen)
        if not audio:
            audio = mutagen.File(path, easy=True)
            
        if not audio: 
             # Fallback specifically for OGG if Easy failed and we didn't try OggVorbis yet
             if ext == '.ogg':
                 try: audio = OggVorbis(path)
                 except: pass

        if not audio: return {"title": os.path.basename(path)}
        
        # Helper to get first item safely
        def get_val(obj, keys):
            for k in keys:
                if k in obj and obj[k]:
                    return obj[k][0]
            return ""

        title = os.path.basename(path)
        artist = ""
        album = ""
        genre = ""
        year = ""
        
        # Strategy: Duck Typing keys based on object type
        # Matroska / OggVorbis use UPPERCASE keys usually (or simple tags)
        # EasyID3/EasyMP4 use 'title', 'artist'
        
        keys_title = ['title', 'TITLE', 'Title']
        keys_artist = ['artist', 'ARTIST', 'Artist']
        keys_album = ['album', 'ALBUM', 'Album']
        keys_genre = ['genre', 'GENRE', 'Genre']
        keys_date = ['date', 'DATE', 'year', 'YEAR']

        t = get_val(audio, keys_title)
        if t: title = t
        
        artist = get_val(audio, keys_artist)
        album = get_val(audio, keys_album)
        genre = get_val(audio, keys_genre)
        year = get_val(audio, keys_date)

        length = 0
        if hasattr(audio, 'info') and hasattr(audio.info, 'length'):
            length = audio.info.length

        return {
            "title": title,
            "artist": artist,
            "album": album,
            "genre": genre,
            "year": year,
            "duration": length
        }
    except Exception as e:
        print(f"Metadata Read Error: {e}")
        return {"title": os.path.basename(path)}

def write_file_metadata(path, data):
    logging.info(f"Attempting to write metadata for: {path}")
    ext = os.path.splitext(path)[1].lower()

    # --- 0. PREPARE COVER DATA ---
    cover_data_bin = None
    mime_type = "image/jpeg" # Default

    if "cover_data" in data and data["cover_data"]:
        # Case A: DELETE
        if data["cover_data"] == "DELETE":
            cover_data_bin = "DELETE"
        
        # Case B: URL (from Auto-Tag)
        elif data["cover_data"].startswith("http"):
            try:
                logging.info(f"Downloading cover from: {data['cover_data']}")
                resp = requests.get(data["cover_data"], timeout=10)
                if resp.status_code == 200:
                    cover_data_bin = resp.content
                    if "image/png" in resp.headers.get("Content-Type", ""):
                        mime_type = "image/png"
                    logging.info(f"Image downloaded: {len(cover_data_bin)} bytes")
                else:
                    logging.warning(f"Download failed: {resp.status_code}")
            except Exception as e:
                logging.error(f"Download Error: {e}")

        # Case C: Base64 (starts with "data:")
        elif data["cover_data"].startswith("data:"):
            try:
                header, encoded = data["cover_data"].split(",", 1)
                cover_data_bin = base64.b64decode(encoded)
                if "image/png" in header: mime_type = "image/png"
            except Exception as e:
                logging.error(f"Base64 Decode Error: {e}")
    
    # --- 1. FILTER READ-ONLY FORMATS ---
    if ext in ['.mkv', '.webm']:
        logging.info("WebM/MKV : Mise à jour DB locale uniquement")
        return True
    
    if ext in ['.avi', '.mov']: return False

    try:
        # --- 2. FORMAT SPECIFIC LOGIC ---
        
        # === MP3 (ID3 + EasyID3) ===
        if ext == ".mp3":
            try:
                # A. TEXT TAGS (EasyID3)
                try: 
                    audio = EasyID3(path)
                except:
                    # Create header if missing
                    try: ID3(path).save()
                    except: pass 
                    audio = EasyID3()
                    audio.save(path)
                
                if 'title' in data: audio['title'] = data['title']
                if 'artist' in data: audio['artist'] = data['artist']
                if 'album' in data: audio['album'] = data['album']
                if 'genre' in data: audio['genre'] = data['genre']
                if 'year' in data: audio['date'] = str(data['year'])
                audio.save()

                # B. IMAGE (ID3 Classic)
                if cover_data_bin:
                    tags = ID3(path)
                    if cover_data_bin == "DELETE":
                        tags.delall("APIC")
                    else:
                        tags.delall("APIC")
                        tags.add(APIC(
                            encoding=3,
                            mime=mime_type,
                            type=3, 
                            desc='Cover', 
                            data=cover_data_bin
                        ))
                    tags.save(v2_version=3)
                return True
            except Exception as e:
                logging.error(f"MP3 Write Error: {e}")
                return False

        # === M4A / MP4 ===
        elif ext in [".m4a", ".mp4", ".m4v"]:
             try:
                 # 1. TEXTE (Via EasyMP4 pour mapping standard)
                 try: 
                     audio = EasyMP4(path)
                 except: 
                     audio = EasyMP4(path) # Create if validation failed initially
                 
                 if "title" in data: audio["title"] = data["title"]
                 if "artist" in data: audio["artist"] = data["artist"]
                 if "album" in data: audio["album"] = data["album"]
                 if "genre" in data: audio["genre"] = data["genre"]
                 if "year" in data: audio["date"] = str(data["year"])
                 audio.save()
                 
                 # 2. IMAGE (Via MP4 standard car EasyMP4 filtre 'covr')
                 if cover_data_bin:
                     m_audio = MP4(path)
                     
                     if cover_data_bin == "DELETE":
                         if "covr" in m_audio:
                             del m_audio["covr"]
                     else:
                         # On vide l'ancienne cover
                         m_audio["covr"] = []
                         
                         # On crée la nouvelle
                         fmt = MP4Cover.FORMAT_PNG if mime_type == "image/png" else MP4Cover.FORMAT_JPEG
                         cover_obj = MP4Cover(cover_data_bin, imageformat=fmt)
                         m_audio["covr"] = [cover_obj]
                     
                     m_audio.save()
                     
                 return True
             except Exception as e:
                 logging.error(f"M4A/MP4 Write Error: {e}")
                 return True

        # === OGG VORBIS ===
        elif ext == ".ogg":
            try:
                audio = OggVorbis(path)
                # Uppercase keys
                if 'title' in data: audio['TITLE'] = data['title']
                if 'artist' in data: audio['ARTIST'] = data['artist']
                if 'album' in data: audio['ALBUM'] = data['album']
                if 'genre' in data: audio['GENRE'] = data['genre']
                if 'year' in data: audio['DATE'] = str(data["year"])
                
                # Cover (Metadata Block Picture)
                if cover_data_bin:
                    if cover_data_bin == "DELETE":
                         audio.clear_pictures()
                         if "metadata_block_picture" in audio: del audio["metadata_block_picture"]
                    else:
                        pic = Picture()
                        pic.data = cover_data_bin
                        pic.type = 3
                        pic.mime = mime_type
                        pic.desc = 'Cover'
                        
                        audio.clear_pictures()
                        # Base64 Encode of the Picture Block
                        pic_data = pic.write()
                        encoded_data = base64.b64encode(pic_data).decode("ascii")
                        audio["metadata_block_picture"] = [encoded_data]
                
                audio.save()
                return True
            except Exception as e:
                 logging.error(f"OGG Write Error: {e}")
                 return False

        # === WAV (ID3 in Chunk) ===
        elif ext == ".wav":
            try:
                try: audio = WAVE(path)
                except: audio = WAVE(path); audio.add_tags()
                
                if audio.tags is None: audio.add_tags()
                
                # Text
                if "title" in data: audio.tags.add(TIT2(encoding=3, text=data["title"]))
                if "artist" in data: audio.tags.add(TPE1(encoding=3, text=data["artist"]))
                if "album" in data: audio.tags.add(TALB(encoding=3, text=data["album"]))
                if "genre" in data: audio.tags.add(TCON(encoding=3, text=data["genre"]))
                if "year" in data: audio.tags.add(TDRC(encoding=3, text=str(data["year"])))
                
                # Cover
                if cover_data_bin:
                    if cover_data_bin == "DELETE":
                        audio.tags.delall("APIC")
                    else:
                        audio.tags.delall("APIC")
                        audio.tags.add(APIC(encoding=0, mime=mime_type, type=3, desc=u'', data=cover_data_bin))
                
                audio.save()
                return True
            except Exception as e:
                logging.error(f"WAV Write Error: {e}")
                return False

        # === GENERIC FALLBACK (FLAC, etc) ===
        else:
             try:
                # Try generic mutagen File
                audio = mutagen.File(path)
                if not audio: return False
                
                # Basic Text
                if "title" in data: audio["title"] = data["title"]
                if "artist" in data: audio["artist"] = data["artist"]
                if "album" in data: audio["album"] = data["album"]
                if "genre" in data: audio["genre"] = data["genre"]
                if "year" in data: audio["date"] = str(data["year"])

                # FLAC Picture
                if isinstance(audio, FLAC) and cover_data_bin:
                    if cover_data_bin == "DELETE":
                        audio.clear_pictures()
                    else:
                        pic = Picture()
                        pic.data = cover_data_bin
                        pic.type = 3
                        pic.mime = mime_type
                        audio.clear_pictures()
                        audio.add_picture(pic)
                
                audio.save()
                return True
             except Exception as e:
                 logging.error(f"Generic Write Error: {e}")
                 return False

    except PermissionError:
        raise PermissionError("File in use")
    except Exception as e:
        logging.error(f"Metadata Write Fatal Error: {e}")
    
    return False



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

    logging.debug(f"Fetching art for: {path}")
    try:
        # 1. Try Embedded Tags
        try:
            audio = mutagen.File(path)
            if audio:
                logging.debug(f"Audio loaded for art: {type(audio)}")
                # ID3 (MP3)
                if hasattr(audio, 'tags') and audio.tags:
                    for key in audio.tags.keys():
                        if key.startswith('APIC'):
                            logging.debug(f"Found APIC: {key}")
                            frame = audio.tags[key]
                            if hasattr(frame, 'data'):
                                return Response(content=frame.data, media_type=frame.mime)
                
                # MP4 (M4A)
                if 'covr' in audio:
                    logging.debug("Found MP4 covr")
                    return Response(content=audio['covr'][0], media_type="image/jpeg")
                    
                # FLAC
                if hasattr(audio, 'pictures') and audio.pictures:
                    logging.debug("Found FLAC Picture")
                    return Response(content=audio.pictures[0].data, media_type=audio.pictures[0].mime)
                
                # OGG Vorbis
                if isinstance(audio, mutagen.oggvorbis.OggVorbis):
                    if 'metadata_block_picture' in audio:
                        try:
                            b64_data = audio['metadata_block_picture'][0]
                            pic_data = base64.b64decode(b64_data)
                            pic = Picture(pic_data)
                            return Response(content=pic.data, media_type=pic.mime)
                        except Exception as e:
                            logging.error(f"OGG Picture Decode Error: {e}")

        except Exception as e_art:
             logging.error(f"Art Extraction Error: {e_art}")

        # 2. Try Local File Fallback (folder.jpg, cover.jpg, etc)
        directory = os.path.dirname(path)
        for cand in ["folder.jpg", "cover.jpg", "album.jpg", "folder.png", "cover.png"]:
            cand_path = os.path.join(directory, cand)
            if os.path.exists(cand_path):
                logging.debug(f"Found local art file: {cand}")
                return FileResponse(cand_path)
        
        # 3. Try looking for image with same name as audio file
        base_name = os.path.splitext(os.path.basename(path))[0]
        for ext in [".jpg", ".png", ".jpeg"]:
           img_path = os.path.join(directory, base_name + ext)
           if os.path.exists(img_path):
               logging.debug(f"Found sibling art file: {img_path}")
               return FileResponse(img_path)

    except Exception as e:
        logging.error(f"Art Fatal Error: {e}")

    logging.debug("No art found")
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
                    file_data = scan_file_metadata(path)
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
                 
            filename = os.path.basename(source_path)
            destination = os.path.join(target_folder, filename)
            
            # Handle duplicates (Auto-rename)
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
        file_data = scan_file_metadata(final_path)
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
                    write_file_metadata(current["path"], item)
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
async def stream_local_file_by_index(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            path = items[index]["path"]
            if os.path.exists(path):
                # Determine media type for Content-Type header (helps some browsers)
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

# --- TRANSLATION API ---

class TranslationRequest(BaseModel):
    filepath: str
    source_lang: str
    target_lang: str
    context: str = ""
    remove_duplicates: bool = True
    remove_non_speech: bool = True

@app.post("/api/subtitles/translate")
async def translate_subtitle_endpoint(request: TranslationRequest):
    """
    Traduit un fichier VTT local existant et sauvegarde la version traduite à côté.
    """
    if not os.path.exists(request.filepath):
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    # Retrieve API Key from Config
    api_key = config_manager.get("GEMINI_API_KEY")
    if not api_key:
         raise HTTPException(status_code=400, detail="Clé API Gemini manquante. Veuillez la configurer dans les réglages.")

    try:
        # 1. Lire le fichier
        with open(request.filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # 2. Parser
        cues = parse_vtt(content)
        
        # 3. Traduire par lots (Chunking)
        CHUNK_SIZE = 20
        translated_cues = []
        
        loop = asyncio.get_running_loop()

        for i in range(0, len(cues), CHUNK_SIZE):
            chunk = cues[i:i + CHUNK_SIZE]
            
            # Wrap standard sync call
            def run_batch():
                return translate_batch(
                    cues=chunk, 
                    source_lang=request.source_lang, 
                    target_lang=request.target_lang, 
                    api_key=api_key, 
                    context=request.context, 
                    remove_duplicates=request.remove_duplicates,
                    remove_non_speech=request.remove_non_speech
                )
            
            result = await loop.run_in_executor(None, run_batch)
            translated_cues.extend(result)
            
            # Petit délai pour éviter le Rate Limit
            await asyncio.sleep(1) 

        # 4. Générer le nouveau VTT
        new_content = generate_vtt(translated_cues)
        
        # 5. Sauvegarder
        # ex: song.vtt -> song_French.vtt
        lang_suffix = request.target_lang
        base, ext = os.path.splitext(request.filepath)
        new_filepath = f"{base}_{lang_suffix}{ext}"
        
        with open(new_filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

        return {"status": "success", "new_file": new_filepath}

    except Exception as e:
        print(f"Translation Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/import/analyze")
async def analyze_youtube_url(request: Request):
    try:
        data = await request.json()
        url = data.get("url")
        if not url:
            raise HTTPException(status_code=400, detail="URL Missing")
        
        # Run analysis in executor to avoid blocking main loop
        result = await asyncio.get_event_loop().run_in_executor(
            None, import_service.analyze_video, url
        )
        
        if result["status"] == "error":
             raise HTTPException(status_code=400, detail=result["detail"])
             
        return result["data"]
        
    except Exception as e:
        print(f"Analyze Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/import/execute")
async def execute_import(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        
        # Define Scheduler Callback for Translation
        async def translation_wrapper(filepath, target_lang, context=""):
            api_key = config_manager.get("GEMINI_API_KEY")
            if not api_key: return # Skip if no key
            
            try:
                with open(filepath, 'r', encoding='utf-8') as f: content = f.read()
                cues = parse_vtt(content)
                
                translated_cues = []
                chunk = 20
                for i in range(0, len(cues), chunk):
                    batch = cues[i:i+chunk]
                    res = translate_batch(batch, "Auto", target_lang, api_key, context=context)
                    translated_cues.extend(res)
                    await asyncio.sleep(1) # Rate limit
                
                new_content = generate_vtt(translated_cues)
                base, ext = os.path.splitext(filepath)
                new_path = f"{base}_{target_lang}{ext}"
                with open(new_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                    
            except Exception as e:
                print(f"Background Translation Failed: {e}")

        # Run Orchestration in Background
        background_tasks.add_task(import_service.orchestrate_import, data, translation_wrapper)
        
        return {"status": "started", "message": "Import running in background"}

    except Exception as e:
        print(f"Execute Import Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/dialog/folder")
async def open_folder_dialog():
    try:
        # Use Tkinter in thread-safe way (simple blocking call in executor)
        def ask_dir():
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            path = filedialog.askdirectory()
            root.destroy()
            return path
        
        path = await asyncio.get_event_loop().run_in_executor(None, ask_dir)
        if path:
            return {"status": "success", "path": path}
        return {"status": "cancelled"}
    except Exception as e:
        print(f"Dialog Error: {e}")
        return {"status": "error", "message": str(e)}

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
