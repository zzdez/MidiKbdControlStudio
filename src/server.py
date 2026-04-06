import os
import sys
import asyncio
import io
import mido
import json
import requests
import re
import subprocess
import tkinter as tk
from tkinter import filedialog
import urllib.parse
import shutil
import time
import logging
import base64
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from utils import get_app_dir, get_data_dir, to_portable_path, resolve_portable_path
from i18n import _

# Configure Logging
log_path = os.path.join(os.getcwd(), 'midikbd_debug.log')
print(f"DIAGNOSTIC: Logging to {log_path}")
logging.basicConfig(
    filename=log_path,
    level=logging.WARNING,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logging.warning(f"=== SERVER STARTING AT {os.getcwd()} ===")
logging.warning(f"APP_DIR: {get_app_dir()}")
logging.warning(f"DATA_DIR: {get_data_dir()}")

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
WEB_LINKS_FILE = os.path.join(get_data_dir(), "web_links.json")
try:
    _abs_web = os.path.abspath(WEB_LINKS_FILE)
    logging.warning(f"[INIT] WEB_LINKS_FILE is at: {_abs_web}")
    if not os.path.exists(os.path.dirname(_abs_web)):
        os.makedirs(os.path.dirname(_abs_web), exist_ok=True)
except: pass
DRUM_SETTINGS_FILE = os.path.join(get_data_dir(), "drum_settings.json")

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

# --- MOUNT USER METRONOME SOUNDS ---
user_sounds_dir = os.path.join(get_data_dir(), "metronome")
if not os.path.exists(user_sounds_dir):
    try:
        os.makedirs(user_sounds_dir)
    except Exception as e:
        print(f"Error creating user metronome dir: {e}")

if os.path.exists(user_sounds_dir):
    app.mount("/assets_user", StaticFiles(directory=user_sounds_dir), name="metronome_user")

server_loop = None
config_manager = ConfigManager()
music_api_client = MusicAPI(config_manager)

@app.post("/api/debug_log")
async def debug_log(data: Dict):
    """Mirror frontend logs to backend terminal/file."""
    msg = data.get("msg", "")
    logging.warning(f"[BROWSER] {msg}")
    return {"status": "ok"}

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
    decoded_path = resolve_portable_path(decoded_path)
    logging.info(f"STREAM API HIT: {decoded_path}") 
    if not os.path.exists(decoded_path):
        logging.error(f"STREAM MISSING: {decoded_path}")
        raise HTTPException(status_code=404, detail="File not found")
    
    import mimetypes
    mime_type, _ = mimetypes.guess_type(decoded_path)
    return FileResponse(decoded_path, media_type=mime_type, filename=os.path.basename(decoded_path))

@app.get("/api/cover")
async def get_cover_image(path: str):
    """Alias for streaming specifically covers with optional caching support."""
    try:
        decoded_path = urllib.parse.unquote(path)
        resolved = resolve_portable_path(decoded_path)
        logging.info(f"[COVER] Requested: {path} -> Decoded: {decoded_path} -> Resolved: {resolved}")
        
        if not os.path.exists(resolved):
            logging.error(f"[COVER] File not found: {resolved}")
            raise HTTPException(status_code=404, detail=f"Cover not found: {resolved}")
        import mimetypes
        mime_type, _ = mimetypes.guess_type(resolved)
        
        # V55: If the file is not an image (e.g. .mp3, .m4v or a DIRECTORY), try to extract embedded art
        if os.path.isdir(resolved) or (mime_type and not mime_type.startswith("image/")):
            logging.info(f"[COVER] Not an image or is directory ({mime_type}), attempting extraction for: {resolved}")

            try:
                data, extracted_mime = metadata_service.get_file_cover(resolved)
                if data:
                    logging.info(f"[COVER] Successfully extracted art ({extracted_mime}) from {resolved}")
                    return Response(content=data, media_type=extracted_mime)
            except Exception as ex:
                logging.error(f"[COVER] Extraction failed for {resolved}: {ex}")

        # Safety Fallback: Don't attempt to serve a directory via FileResponse
        if os.path.isdir(resolved):
            logging.warning(f"[COVER] Path is a directory and no art was extracted: {resolved}")
            raise HTTPException(status_code=404, detail="No cover found for this directory")

        # Default: serve the file
        if mime_type is None:
            mime_type = "application/octet-stream"
            
        return FileResponse(resolved, media_type=mime_type)

    except Exception as e:
        logging.error(f"[COVER] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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

@app.get("/api/metronome/sounds")
async def get_metronome_sounds():
    """Returns available metronome sound kits grouped by prefix with URLs."""
    kits = {}
    
    # 1. Scan default sounds (assets/metronome)
    sounds_dir = os.path.join(get_resource_path("assets"), "metronome")
    if os.path.exists(sounds_dir):
        try:
            for filename in os.listdir(sounds_dir):
                if filename.endswith(".mp3"):
                    parts = filename.rsplit("_", 1)
                    if len(parts) == 2:
                        prefix = parts[0].lower()
                        suffix = parts[1].replace(".mp3", "").lower()
                        if prefix not in kits:
                            kits[prefix] = {}
                        kits[prefix][suffix] = f"/assets/metronome/{filename}"
        except Exception as e:
            logging.error(f"Error scanning default metronome sounds: {e}")

    # 2. Scan user sounds (data/metronome)
    user_sounds_dir = os.path.join(get_data_dir(), "metronome")
    if os.path.exists(user_sounds_dir):
        try:
            for filename in os.listdir(user_sounds_dir):
                if filename.endswith(".mp3"):
                    parts = filename.rsplit("_", 1)
                    if len(parts) == 2:
                        prefix = parts[0].lower()
                        suffix = parts[1].replace(".mp3", "").lower()
                        if prefix not in kits:
                            kits[prefix] = {}
                        # User sounds override default if same name
                        kits[prefix][suffix] = f"/assets_user/{filename}"
        except Exception as e:
            logging.error(f"Error scanning user metronome sounds: {e}")

    return kits

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

            # Ensure autoplay/autoreplay are strictly boolean or not outputted if undefined to avoid JS type issues
            for item in items:
                if item.get("url") and not item["url"].startswith("http"):
                    try:
                        resolved = resolve_portable_path(item["url"])
                        item["is_missing"] = not os.path.exists(resolved)
                    except:
                        item["is_missing"] = True
                else:
                    item["is_missing"] = False

                if "autoplay" in item and item["autoplay"] is not None:
                    item["autoplay"] = bool(item["autoplay"])
                if "autoreplay" in item and item["autoreplay"] is not None:
                    item["autoreplay"] = bool(item["autoreplay"])

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
        final_url = to_portable_path(url) if open_mode == "local" else url
        new_item = {
            "title": title,
            "url": final_url,
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
            final_url = to_portable_path(url) if open_mode == "local" else url
            updated_item = {
                "title": title,
                "url": final_url,
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
                "scale": item.get("scale", ""),
            "instrument": item.get("instrument", ""),
                "tuning": item.get("tuning", "standard"),
                "original_pitch": item.get("original_pitch", ""),
                "target_pitch": item.get("target_pitch", ""),
                "youtube_description": item.get("youtube_description", ""),
                "target_profile": target_profile,
                "user_notes": item.get("user_notes", ""),
                "volume": item.get("volume", items[index].get("volume", 100)),
                "subtitle_enabled": item.get("subtitle_enabled", items[index].get("subtitle_enabled", False)),
                "subtitle_pos_y": item.get("subtitle_pos_y", items[index].get("subtitle_pos_y", 80)),
                "loops": item.get("loops", items[index].get("loops", [])),
                "audio_cues": item.get("audio_cues", items[index].get("audio_cues", [])),
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

@app.post("/api/setlist/edit/{index}")
async def edit_setlist_item(index: int, item: Dict):
    try:
        items = []
        if os.path.exists(SETLIST_FILE):
             with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)

        if 0 <= index < len(items):
            current = items[index]
            # Update fields
            current["title"] = item.get("title", current["title"])
            current["artist"] = item.get("artist", current.get("artist", ""))
            current["category"] = item.get("category", current.get("category", "Général"))
            current["user_notes"] = item.get("user_notes", current.get("user_notes", ""))
            current["volume"] = item.get("volume", current.get("volume", 100))
            current["loops"] = item.get("loops", current.get("loops", []))
            current["audio_cues"] = item.get("audio_cues", current.get("audio_cues", []))
            current["bpm"] = item.get("bpm", current.get("bpm", ""))
            current["key"] = item.get("key", current.get("key", ""))
            current["scale"] = item.get("scale", current.get("scale", ""))
            current["instrument"] = item.get("instrument", current.get("instrument", ""))
            current["tuning"] = item.get("tuning", current.get("tuning", "standard"))
            current["autoplay"] = item.get("autoplay", current.get("autoplay", False))
            current["autoreplay"] = item.get("autoreplay", current.get("autoreplay", False))

            # --- RELOCATION / URL UPDATE LOGIC ---
            new_url = item.get("url")
            if new_url and new_url != current.get("url") and not new_url.startswith("http"):
                from utils import to_portable_path
                current["url"] = to_portable_path(new_url)
                # Force re-scan stems if it's a multitrack
                if current.get("is_multitrack"):
                    try:
                        abs_new_url = resolve_portable_path(new_url)
                        new_meta = metadata_service.scan_file_metadata(abs_new_url)
                        if new_meta.get("stems"):
                            current["stems"] = [to_portable_path(s) for s in new_meta["stems"]]
                        current["is_missing"] = False
                    except Exception as ex:
                        logging.error(f"Error re-scanning setlist stems after manual relocate: {ex}")
                else:
                    current["is_missing"] = False

            with open(SETLIST_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)
            return {"status": "ok", "items": items}
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Edit Setlist Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# [REMOVED DUPLICATE WEB LINKS ROUTES]

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
        "language": config_manager.get("language", "fr"),
        "autoplay": config_manager.get("autoplay", False),
        "autoreplay": config_manager.get("autoreplay", False),
        "sidebar_autohide": config_manager.get("sidebar_autohide", False),
        "sidebar_default_hidden": config_manager.get("sidebar_default_hidden", False),
        "sidebar_hover_trigger": config_manager.get("sidebar_hover_trigger", False)
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

# --- DRUM MACHINE SETTINGS ---
DRUM_SETTINGS_FILE = os.path.join(get_data_dir(), "drum_settings.json")

@app.get("/api/drums/settings")
async def get_drum_settings():
    """Returns persistent drum machine settings (volumes, kit, bpm)."""
    if os.path.exists(DRUM_SETTINGS_FILE):
        try:
            with open(DRUM_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"Error loading drum settings: {e}")
            return {}
    return {}

@app.post("/api/drums/settings")
async def save_drum_settings(settings: Dict):
    """Saves drum machine settings to disk."""
    try:
        with open(DRUM_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4)
        return {"status": "ok"}
    except Exception as e:
        logging.error(f"Error saving drum settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- DRUM MACHINE MIDI WIZARD ---

@app.post("/api/drums/analyze_midi")
async def analyze_drum_midi(data: Dict):
    try:
        content_b64 = data.get("file_b64")
        if not content_b64:
            raise HTTPException(status_code=400, detail="Missing file_b64")
            
        content = base64.b64decode(content_b64)
        midi = mido.MidiFile(file=io.BytesIO(content))
        
        tracks_info = []
        for i, track in enumerate(midi.tracks):
            notes = set()
            note_count = 0
            channels = set()
            track_name = f"Track {i}"
            
            for msg in track:
                if msg.is_meta and msg.type == 'track_name':
                    track_name = msg.name
                if msg.type == 'note_on' and msg.velocity > 0:
                    notes.add(msg.note)
                    note_count += 1
                    if hasattr(msg, 'channel'):
                        channels.add(msg.channel + 1) # 1-indexed for user
            
            if note_count > 0:
                avg_note = sum(notes) / len(notes) if notes else 0
                tracks_info.append({
                    "index": i,
                    "name": track_name,
                    "note_count": note_count,
                    "channels": list(channels),
                    "unique_notes": sorted(list(notes)),
                    "avg_note": avg_note
                })
                
        return {
            "status": "ok",
            "tracks": tracks_info,
            "ticks_per_beat": midi.ticks_per_beat
        }
    except Exception as e:
        print(f"MIDI Analysis Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- LOCAL LIBRARY ---

# --- DRUM MACHINE MIDI IMPORT ---

@app.post("/api/drums/parse_midi")
async def parse_drum_midi_endpoint(data: Dict):
    try:
        content_b64 = data.get("file_b64")
        if not content_b64:
            raise HTTPException(status_code=400, detail="Missing file_b64")
            
        mapping_override = data.get("mapping_override", {})
        selected_tracks = data.get("selected_tracks", None)
        track_instruments = data.get("track_instruments", {})
        transpose_val = int(data.get("transpose", 0))
        
        print(f"[MIDI PARSE] Transpose: {transpose_val}, Selected Tracks: {selected_tracks}")
            
        content = base64.b64decode(content_b64)
        midi = mido.MidiFile(file=io.BytesIO(content))
        
        # Base GM Mapping
        base_mapping = {
            35: 'kick', 36: 'kick', 33: 'kick',
            38: 'snare', 40: 'snare',
            42: 'hihat', 44: 'hihat', 46: 'openhat',
            39: 'clap',
            41: 'tom3', 43: 'tom3', 45: 'tom2', 47: 'tom2', 48: 'tom1', 50: 'tom1',
            49: 'cymbal', 51: 'cymbal', 52: 'cymbal', 53: 'cymbal', 
            55: 'cymbal', 57: 'cymbal', 59: 'cymbal',
            56: 'cowbell', 37: 'rim'
        }
        
        # Merge with override (override takes precedence)
        # Convert string keys to int if necessary
        final_mapping = base_mapping.copy()
        for k, v in mapping_override.items():
            final_mapping[int(k)] = v
        
        ticks_per_beat = midi.ticks_per_beat
        ticks_per_step = ticks_per_beat / 4 
        
        max_steps = 20000 
        tracks_data = {}
        abs_last_step = 15
        
        for i, track in enumerate(midi.tracks):
            # Skip if track selection was provided and this track is not in it
            if selected_tracks is not None and i not in selected_tracks:
                continue
                
            # Track-level instrument assignment (Priority 1)
            # Keys in JSON come as strings
            track_inst = track_instruments.get(str(i))
            
            current_tick = 0
            for msg in track:
                current_tick += msg.time
                if msg.type == 'note_on' and msg.velocity > 0:
                    step = round(current_tick / ticks_per_step)
                    if 0 <= step < max_steps:
                        # Instrument determination logic
                        if track_inst:
                            inst = track_inst
                        else:
                            inst = final_mapping.get(msg.note)
                            
                        if inst:
                            if inst not in tracks_data:
                                tracks_data[inst] = {} 
                            
                            if step > abs_last_step:
                                abs_last_step = step
                                
                            # Pour la basse, on stocke la NOTE MIDI (pitch) + la VELOCITY (dynamique)
                            # Format: (note * 128) + velocity
                            if inst == 'bass':
                                vel = getattr(msg, 'velocity', 100)
                                tracks_data[inst][step] = (msg.note + transpose_val) * 128 + vel
                            else:
                                val = 2 if msg.velocity > 100 else 1
                                tracks_data[inst][step] = max(tracks_data[inst].get(step, 0), val)
        
        # Determine final steps (rounded to next bar)
        final_steps = ((abs_last_step // 16) + 1) * 16
        print(f"[MIDI PARSE] Mapping used: {final_mapping}")
        print(f"[MIDI PARSE] Total steps calculated: {final_steps}")
        
        # Convert sparse dicts to dense lists for the frontend
        dense_tracks = {}
        # Ajout de 'bass' à la liste des instruments gérés
        all_insts = ['kick', 'snare', 'hihat', 'openhat', 'tom1', 'tom2', 'tom3', 'clap', 'cymbal', 'cowbell', 'rim', 'bass']
        for inst in all_insts:
            if inst in tracks_data:
                count = len(tracks_data[inst])
                print(f"[MIDI PARSE] Instrument '{inst}': {count} notes found.")
                dense_list = [0] * final_steps
                for s, v in tracks_data[inst].items():
                    if s < final_steps:
                        dense_list[s] = v
                dense_tracks[inst] = dense_list
            else:
                dense_tracks[inst] = [0] * final_steps
            
        return {
            "status": "ok",
            "pattern": {
                "steps": final_steps,
                "isSongMode": (final_steps > 64),
                "lastStep": final_steps,
                "tracks": dense_tracks
            }
        }
    except Exception as e:
        print(f"MIDI Parse Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/local/files")
async def get_local_files():
    if os.path.exists(LOCAL_LIB_FILE):
        try:
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)

            for item in items:
                if "path" in item:
                    try:
                        resolved = resolve_portable_path(item["path"])
                        item["is_missing"] = not os.path.exists(resolved)
                    except Exception:
                        item["is_missing"] = True
                else:
                    item["is_missing"] = True

                if "autoplay" in item and item["autoplay"] is not None:
                    item["autoplay"] = bool(item["autoplay"])
                if "autoreplay" in item and item["autoreplay"] is not None:
                    item["autoreplay"] = bool(item["autoreplay"])

            return items
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
                    if path: path = resolve_portable_path(path)
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
                    # Resolve to show real paths in UI
                    resolved_folders = [resolve_portable_path(f) for f in folders]
                    return {
                        "status": "import_needed",
                        "source_path": path,
                        "filename": os.path.basename(path),
                        "target_folders": resolved_folders
                    }
                
                # If already managed, proceed normally
                try:
                    # Update to use metadata_service
                    file_data = metadata_service.scan_file_metadata(path)
                    file_data["path"] = to_portable_path(path)
                    if file_data.get("stems"):
                        file_data["stems"] = [to_portable_path(s) for s in file_data["stems"]]
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
                    # Resolve to show real paths in UI
                    resolved_folders = [resolve_portable_path(f) for f in folders]
                    return {
                        "status": "import_needed",
                        "source_path": path,
                        "filename": os.path.basename(path.rstrip('/\\')),
                        "target_folders": resolved_folders
                    }
                
                # If already managed, proceed normally
                try:
                    file_data = metadata_service.scan_file_metadata(path)
                    file_data["path"] = to_portable_path(path)
                    if file_data.get("stems"):
                        file_data["stems"] = [to_portable_path(s) for s in file_data["stems"]]
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

@app.get("/api/local/pick_path")
async def pick_path(type: str = "file"):
    """
    Opens a system dialog to pick a file or folder and returns the path.
    type: 'file' or 'folder'
    """
    try:
        if type == "folder":
            if hasattr(app.state, "select_folder_callback"):
                path = app.state.select_folder_callback()
                return {"status": "ok", "path": path}
        else:
            if hasattr(app.state, "select_file_callback"):
                path = app.state.select_file_callback()
                return {"status": "ok", "path": path}
        return {"status": "error", "message": "Picker callback not available"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

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
            # Normalize and RESOLVE target folder (might be ${APP_DIR}...)
            if target_folder:
                target_folder = resolve_portable_path(target_folder)
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
        file_data["path"] = to_portable_path(final_path)
        if file_data.get("stems"):
            file_data["stems"] = [to_portable_path(s) for s in file_data["stems"]]
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
            current["audio_cues"] = item.get("audio_cues", current.get("audio_cues", []))
            current["bpm"] = item.get("bpm", current.get("bpm", ""))
            current["key"] = item.get("key", current.get("key", ""))
            current["media_key"] = item.get("media_key", current.get("media_key", ""))
            current["scale"] = item.get("scale", current.get("scale", ""))
            current["instrument"] = item.get("instrument", current.get("instrument", ""))
            current["tuning"] = item.get("tuning", current.get("tuning", "standard"))
            current["original_pitch"] = item.get("original_pitch", current.get("original_pitch", ""))
            current["target_pitch"] = item.get("target_pitch", current.get("target_pitch", ""))
            current["autoplay"] = item.get("autoplay", current.get("autoplay", False))
            current["autoreplay"] = item.get("autoreplay", current.get("autoreplay", False))
            
            # --- RELOCATION / PATH UPDATE LOGIC ---
            new_path = item.get("path")
            if new_path and new_path != current.get("path"):
                from utils import to_portable_path
                current["path"] = to_portable_path(new_path)
                # Force re-scan stems if it's a multitrack
                if current.get("is_multitrack"):
                    try:
                        abs_new_path = resolve_portable_path(new_path)
                        new_meta = metadata_service.scan_file_metadata(abs_new_path)
                        if new_meta.get("stems"):
                            current["stems"] = [to_portable_path(s) for s in new_meta["stems"]]
                        current["is_missing"] = False
                    except Exception as ex:
                        logging.error(f"Error re-scanning stems after manual relocate: {ex}")

            # 1. Save JSON (Database Priority)
            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

            # 2. Write to disk tags (Physical)
            warning_msg = None
            resolved_path = resolve_portable_path(current["path"])
            ext = os.path.splitext(resolved_path)[1].lower()
            
            if ext in ['.webm', '.mkv']:
                warning_msg = "Métadonnées sauvegardées dans la base locale uniquement (Format vidéo non éditable)."
            else:
                try:
                    # Update to use metadata_service
                    metadata_service.write_file_metadata(resolved_path, item)
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
            path = resolve_portable_path(path)
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
                    path = resolve_portable_path(path)
                    if os.path.exists(path):
                        peaks = metadata_service.generate_peaks(path)
                        return peaks
        return []
    except Exception as e:
        logging.error(f"Peaks Endpoint Error: {e}")
        return []

@app.post("/api/local/smart_relocate/{type}/{index}")
async def smart_relocate(type: str, index: int, apply: bool = True):
    """
    Tries to find a missing file by scanning internal Media folders.
    If apply=True, updates ALL occurrences. If False, just returns the found path.
    """
    try:
        from utils import get_internal_media_dirs, to_portable_path, resolve_portable_path
        
        file_db = SETLIST_FILE if type == "setlist" else LOCAL_LIB_FILE
        if not os.path.exists(file_db):
            raise HTTPException(status_code=404, detail="Database not found")
        
        with open(file_db, "r", encoding="utf-8") as f:
            items = json.load(f)
            
        if index < 0 or index >= len(items):
            raise HTTPException(status_code=404, detail="Item not found")
            
        target_item = items[index]
        path_key = "url" if type == "setlist" else "path"
        old_path = target_item.get(path_key)
        
        if not old_path or old_path.startswith("http"):
            return {"status": "error", "message": "Not a local file"}
            
        filename = os.path.basename(old_path.rstrip('/\\'))
        if not filename:
             return {"status": "error", "message": "Invalid filename"}

        # 1. Scan Internal Dirs first (Fast)
        internal_parents = get_internal_media_dirs()
        new_found_path = None
        
        # Phase 1: Internal, Phase 2: All Drives
        found = False
        import string
        from ctypes import windll

        def get_drives():
            drives = []
            bitmask = windll.kernel32.GetLogicalDrives()
            for letter in string.ascii_uppercase:
                if bitmask & 1:
                    drives.append(letter + ":\\")
                bitmask >>= 1
            return drives

        for phase, parents in enumerate([internal_parents, get_drives()]):
            if found: break
            for parent in parents:
                if found: break
                if not os.path.exists(parent): continue
                for root, dirs, files in os.walk(parent):
                    if filename.lower() in [f.lower() for f in files] or filename.lower() in [d.lower() for d in dirs]:
                        found_name = next((f for f in files if f.lower() == filename.lower()), None)
                        if not found_name:
                             found_name = next((d for d in dirs if d.lower() == filename.lower()), filename)
                        
                        new_found_path = os.path.join(root, found_name)
                        found = True
                        break

        if not new_found_path:
             return {"status": "error", "message": f"Fichier '{filename}' non trouvé."}
                
        # If we just want to find
        if not apply:
            return {
                "status": "ok", 
                "found_path": os.path.abspath(new_found_path),
                "portable_path": to_portable_path(new_found_path)
            }

        if new_found_path:
            portable_new_path = to_portable_path(new_found_path)
            updated_count = 0
            
            # Update DB (Simplified call to apply logic internally or reuse same logic)
            # For now, keep the legacy immediate update for backward compatibility if needed
            new_stems = []
            if target_item.get("is_multitrack"):
                try:
                    new_meta = metadata_service.scan_file_metadata(new_found_path)
                    if new_meta.get("stems"):
                        new_stems = [to_portable_path(s) for s in new_meta["stems"]]
                except: pass

            for db_path in [LOCAL_LIB_FILE, SETLIST_FILE]:
                if not os.path.exists(db_path): continue
                changed = False
                with open(db_path, "r", encoding="utf-8") as f:
                    db_items = json.load(f)
                curr_path_key = "url" if db_path == SETLIST_FILE else "path"
                for item in db_items:
                    item_path = item.get(curr_path_key, "")
                    if item_path and not item_path.startswith("http"):
                        item_fn = os.path.basename(item_path.rstrip('/\\'))
                        if item_fn.lower() == filename.lower():
                            item[curr_path_key] = portable_new_path
                            item["is_missing"] = False
                            if item.get("is_multitrack"):
                                item["stems"] = new_stems
                            changed = True
                            updated_count += 1
                if changed:
                    with open(db_path, "w", encoding="utf-8") as f:
                        json.dump(db_items, f, indent=4)
            
            target_item[path_key] = portable_new_path
            target_item["is_missing"] = False
            return {"status": "ok", "new_path": portable_new_path, "updated_count": updated_count}

    except Exception as e:
        print(f"[SmartRelocate] Error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/api/local/relocate_apply")
async def relocate_apply(data: dict):
    """
    Applies the final relocation action (link, copy, move).
    Updates all occurrences in all databases.
    """
    try:
        from utils import get_app_dir, to_portable_path, resolve_portable_path
        import shutil

        # Extract data
        action = data.get("action") # 'link', 'copy', 'move'
        item_type = data.get("type") # 'library', 'setlist'
        index = data.get("index")
        new_source_path = data.get("new_path") # Absolute source path found

        if not action or index is None or not new_source_path:
            return {"status": "error", "message": "Missing parameters"}

        # 1. Load the item to get filename and properties
        db_file = SETLIST_FILE if item_type == "setlist" else LOCAL_LIB_FILE
        with open(db_file, "r", encoding="utf-8") as f:
            items = json.load(f)
        
        target_item = items[index]
        is_multitrack = target_item.get("is_multitrack", False)
        filename = os.path.basename(new_source_path.rstrip('/\\'))

        # Update metadata if requested (V49)
        updated_artist = data.get("updated_artist")
        if updated_artist and updated_artist.strip():
            target_item["artist"] = updated_artist.strip()
            # Save DB update immediately so the rest of the logic uses new metadata
            with open(db_file, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4, ensure_ascii=False)
        
        final_dest_path = new_source_path

        # 2. Handle Copy / Move to Internal Folders
        if action in ['copy', 'move']:
            # Determine Target Subfolder
            target_folder = data.get("target_folder")
            create_artist_folder = data.get("create_artist_folder", False)

            # Pre-calculate safe artist name
            import re
            artist = target_item.get("artist", "").strip()
            if artist:
                safe_artist = re.sub(r'[\\/*?:"<>|]', '_', artist)
            else:
                safe_artist = "Divers"
            
            if target_folder and os.path.exists(target_folder):
                dest_dir = target_folder
                if create_artist_folder:
                    dest_dir = os.path.join(dest_dir, safe_artist)
            else:
                # Default Routing Logic (Internal auto-routing)
                subfolder = "Audios"
                ext = os.path.splitext(filename)[1].lower()
                if is_multitrack: subfolder = "Multipistes"
                elif ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']: subfolder = "Videos"
                elif ext in ['.mid', '.midi']: subfolder = "Midi"
                
                dest_dir = os.path.join(get_app_dir(), "Medias", subfolder, safe_artist)
            
            # Normalization to avoid double slashes and Windows path issues
            dest_dir = os.path.normpath(dest_dir)
            if os.path.isfile(dest_dir):
                return {"status": "error", "message": f"Conflit: '{dest_dir}' est un fichier, pas un dossier."}
            os.makedirs(dest_dir, exist_ok=True)
            
            # Destination absolute path
            filename = os.path.basename(filename) # Double safety
            final_dest_path = os.path.normpath(os.path.join(dest_dir, filename))
            
            # Handle duplicates (Suffix _1, _2...)
            src_abs = os.path.abspath(new_source_path).lower()
            if os.path.exists(final_dest_path) and os.path.abspath(final_dest_path).lower() != src_abs:
                base_name, ext_part = os.path.splitext(filename)
                counter = 1
                while os.path.exists(os.path.join(dest_dir, f"{base_name}_{counter}{ext_part}")):
                    counter += 1
                final_dest_path = os.path.normpath(os.path.join(dest_dir, f"{base_name}_{counter}{ext_part}"))

            # Perform physical operation
            try:
                dest_abs = os.path.abspath(final_dest_path).lower()
                if dest_abs != src_abs:
                    if action == 'copy':
                        if os.path.isdir(new_source_path):
                            # dirs_exist_ok allows copying into an existing folder (Python 3.8+)
                            shutil.copytree(new_source_path, final_dest_path, dirs_exist_ok=True)
                        else:
                            shutil.copy2(new_source_path, final_dest_path)
                    else: # Move
                        shutil.move(new_source_path, final_dest_path)

                    # --- Sidecar Files Persistence (JSON + Subtitles) ---
                    if not is_multitrack:
                        import glob
                        base_src, _ = os.path.splitext(new_source_path)
                        base_dest, _ = os.path.splitext(final_dest_path)
                        
                        # Use glob for precise matches
                        for ext in ['.json', '.srt', '.vtt']:
                            # Handle both direct base matches and variants (e.g., .fr.srt)
                            pattern = glob.escape(base_src) + "*" + ext
                            for src_file in glob.glob(pattern):
                                try:
                                    s_filename = os.path.basename(src_file)
                                    # Calculate dest name relative to base
                                    suffix = s_filename[len(os.path.basename(base_src)):]
                                    s_dest = base_dest + suffix
                                    
                                    if action == 'copy':
                                        shutil.copy2(src_file, s_dest)
                                    else:
                                        shutil.move(src_file, s_dest)
                                except Exception as e_side:
                                    print(f"Sidecar Error ({s_filename}): {e_side}")
            except Exception as e:
                return {"status": "error", "message": f"Erreur système (Fichier): {str(e)}"}

        # 3. Universal DB Update (All DBs, all matches)
        portable_final_path = to_portable_path(final_dest_path)
        updated_count = 0
        
        # Pre-scan stems for multitrack
        new_stems = []
        if is_multitrack:
            try:
                new_meta = metadata_service.scan_file_metadata(final_dest_path)
                if new_meta.get("stems"):
                    new_stems = [to_portable_path(s) for s in new_meta["stems"]]
            except: pass

        for db_path in [LOCAL_LIB_FILE, SETLIST_FILE]:
            if not os.path.exists(db_path): continue
            changed = False
            with open(db_path, "r", encoding="utf-8") as f:
                db_items = json.load(f)
            
            path_key = "url" if db_path == SETLIST_FILE else "path"
            
            # Search by filename match (legacy search logic)
            orig_filename = os.path.basename(target_item.get(path_key, "").rstrip('/\\'))
            
            for it in db_items:
                it_path = it.get(path_key, "")
                if it_path and not it_path.startswith("http"):
                    it_fn = os.path.basename(it_path.rstrip('/\\'))
                    if it_fn.lower() == orig_filename.lower():
                        it[path_key] = portable_final_path
                        it["is_missing"] = False
                        if it.get("is_multitrack"):
                             it["stems"] = new_stems
                        changed = True
                        updated_count += 1
            
            if changed:
                with open(db_path, "w", encoding="utf-8") as f:
                    json.dump(db_items, f, indent=4)

        return {
            "status": "ok",
            "new_path": portable_final_path,
            "updated_count": updated_count,
            "action": action
        }

    except Exception as e:
        print(f"[RelocateApply] Error: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/local/subs_list/{index}")
async def get_local_subs_list(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            video_path = items[index]["path"]
            video_path = resolve_portable_path(video_path)
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
            video_path = resolve_portable_path(video_path)
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
                    stem_path_resolved = resolve_portable_path(stem_path)
                    
                    # 1. Delete physical file
                    if os.path.exists(stem_path_resolved):
                        try:
                            os.remove(stem_path_resolved)
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
            path = resolve_portable_path(path)
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
            path_resolved = resolve_portable_path(path)

            # Sync autoplay/autoreplay properties back to the main items DB too
            if "autoplay" in settings:
                items[index]["autoplay"] = settings["autoplay"]
            if "autoreplay" in settings:
                items[index]["autoreplay"] = settings["autoreplay"]

            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

            if os.path.isdir(path_resolved):
                settings_file = os.path.join(path_resolved, "airstep_meta.json")
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
            path = resolve_portable_path(path)
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


@app.post("/api/local/edit/{index}")
async def edit_local_file(index: int, item: Dict):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)

        if 0 <= index < len(items):
            current = items[index]
            # --- RELOCATION LOGIC ---
            new_path = item.get("path")
            if new_path and new_path != current.get("path"):
                from utils import to_portable_path
                current["path"] = to_portable_path(new_path)
                # Re-scan stems if it's a multitrack
                if current.get("is_multitrack"):
                    try:
                        abs_new_path = resolve_portable_path(new_path)
                        new_meta = metadata_service.scan_file_metadata(abs_new_path)
                        if new_meta.get("stems"):
                            current["stems"] = [to_portable_path(s) for s in new_meta["stems"]]
                        current["is_missing"] = False
                    except Exception as ex:
                        logging.error(f"Error re-scanning stems after manual relocate: {ex}")
                else:
                    current["is_missing"] = False

            # Update other fields...
            for key in ["title", "artist", "genre", "category", "bpm", "key", "scale", "instrument", "tuning", "user_notes"]:
                if key in item: current[key] = item[key]
            
            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)
            return {"status": "ok", "items": items}
        return {"status": "error", "message": "Index missing"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/setlist/edit/{index}")
async def edit_setlist_item(index: int, item: Dict):
    try:
        items = []
        if os.path.exists(SETLIST_FILE):
             with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)

        if 0 <= index < len(items):
            current = items[index]
            # --- RELOCATION LOGIC ---
            new_url = item.get("url")
            if new_url and new_url != current.get("url") and not new_url.startswith("http"):
                from utils import to_portable_path
                current["url"] = to_portable_path(new_url)
                # Re-scan stems if it's a multitrack
                if current.get("is_multitrack"):
                    try:
                        abs_new_url = resolve_portable_path(new_url)
                        new_meta = metadata_service.scan_file_metadata(abs_new_url)
                        if new_meta.get("stems"):
                            current["stems"] = [to_portable_path(s) for s in new_meta["stems"]]
                        current["is_missing"] = False
                    except Exception as ex:
                        logging.error(f"Error re-scanning setlist stems after manual relocate: {ex}")
                else:
                    current["is_missing"] = False
            
            # Update others...
            for key in ["title", "artist", "category", "user_notes", "bpm", "key"]:
                if key in item: current[key] = item[key]

            with open(SETLIST_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)
            return {"status": "ok", "items": items}
        return {"status": "error", "message": "Index missing"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/relocate/{index}")
async def relocate_media(index: int):
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if 0 <= index < len(items):
            if hasattr(app.state, "select_folder_callback"):
                new_folder = app.state.select_folder_callback()
                if not new_folder:
                    return {"status": "cancelled"}
                    
                target_item = items[index]
                old_path_resolved = resolve_portable_path(target_item["path"])
                filename = os.path.basename(old_path_resolved.rstrip('/\\'))
                
                new_path = os.path.join(new_folder, filename)
                if not os.path.exists(new_path):
                     return {"status": "error", "message": f"Fichier/Dossier '{filename}' introuvable dans le dossier sélectionné."}
                     
                target_item["path"] = to_portable_path(new_path)
                
                fixed_count = 1
                for i, item in enumerate(items):
                    if i != index:
                        p = resolve_portable_path(item["path"])
                        if not os.path.exists(p):
                            f_name = os.path.basename(p.rstrip('/\\'))
                            guess = os.path.join(new_folder, f_name)
                            if os.path.exists(guess):
                                item["path"] = to_portable_path(guess)
                                if item.get("stems"):
                                    new_stems = []
                                    for stem in item["stems"]:
                                        s_name = os.path.basename(resolve_portable_path(stem))
                                        s_guess = os.path.join(new_folder, s_name)
                                        if os.path.exists(s_guess):
                                            new_stems.append(to_portable_path(s_guess))
                                        else:
                                            new_stems.append(stem)
                                    item["stems"] = new_stems
                                fixed_count += 1
                                
                if target_item.get("stems"):
                    new_stems = []
                    for stem in target_item["stems"]:
                        s_name = os.path.basename(resolve_portable_path(stem))
                        s_guess = os.path.join(new_folder, s_name)
                        if os.path.exists(s_guess):
                            new_stems.append(to_portable_path(s_guess))
                        else:
                            new_stems.append(stem)
                    target_item["stems"] = new_stems
                
                with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                    json.dump(items, f, indent=4)
                    
                return {"status": "ok", "fixed_count": fixed_count}
            else:
                return {"status": "error", "message": "Callback not linked"}
        else:
             raise HTTPException(status_code=404, detail="Index not found")
    except Exception as e:
        print(f"Relocate Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/consolidate")
async def consolidate_library():
    try:
        items = []
        if os.path.exists(LOCAL_LIB_FILE):
             with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                 items = json.load(f)
                 
        if not items:
            return {"status": "ok", "consolidated_count": 0}
            
        from utils import get_internal_media_dirs
        internal_dirs = get_internal_media_dirs() 
        # internal_dirs: [Audios, Videos, Midi]
        
        audio_exts = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg']
        video_exts = ['.mp4', '.mkv', '.avi', '.mov', '.webm']
        
        consolidated_count = 0
        
        for item in items:
            original_path = item["path"]
            resolved_path = resolve_portable_path(original_path)
            
            if not str(original_path).startswith("${APP_DIR}") and os.path.exists(resolved_path):
                filename = os.path.basename(resolved_path.rstrip('/\\'))
                ext = os.path.splitext(filename)[1].lower()
                
                # Determine subfolder
                target_root = internal_dirs[0] # Default Audios
                if item.get("is_multitrack"):
                    target_root = internal_dirs[3] # Multipistes
                elif ext in video_exts:
                    target_root = internal_dirs[1] # Videos
                elif ext in ['.mid', '.midi']:
                    target_root = internal_dirs[2] # Midi
                
                dest = os.path.join(target_root, filename)
                
                base, fext = os.path.splitext(dest)
                counter = 1
                while os.path.exists(dest) and os.path.abspath(dest) != os.path.abspath(resolved_path):
                    dest = f"{base}_{counter}{fext}"
                    counter += 1
                
                if os.path.abspath(dest) != os.path.abspath(resolved_path):
                    if os.path.isdir(resolved_path):
                        shutil.copytree(resolved_path, dest)
                    else:
                        shutil.copy2(resolved_path, dest)
                    
                    item["path"] = to_portable_path(dest)
                    consolidated_count += 1
                    
            # Handle stems
            if item.get("stems"):
                new_stems = []
                for stem in item["stems"]:
                    res_stem = resolve_portable_path(stem)
                    if not str(stem).startswith("${APP_DIR}") and os.path.exists(res_stem):
                        stem_filename = os.path.basename(res_stem)
                        # Stems always go to Audios
                        stem_dest = os.path.join(internal_dirs[0], stem_filename)
                        base, fext = os.path.splitext(stem_dest)
                        counter = 1
                        while os.path.exists(stem_dest) and os.path.abspath(stem_dest) != os.path.abspath(res_stem):
                            stem_dest = f"{base}_{counter}{fext}"
                            counter += 1
                        if os.path.abspath(stem_dest) != os.path.abspath(res_stem):
                            shutil.copy2(res_stem, stem_dest)
                            new_stems.append(to_portable_path(stem_dest))
                            consolidated_count += 1
                        else:
                            new_stems.append(to_portable_path(stem_dest))
                    else:
                        new_stems.append(stem)
                item["stems"] = new_stems
                
        with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=4)
            
        return {"status": "ok", "consolidated_count": consolidated_count}
    except Exception as e:
        print(f"Consolidate Error: {e}")
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

@app.get("/api/utils/select_folder")
async def api_select_folder(request: Request):
    """Triggers the native OS folder dialog and returns the selected path."""
    try:
        if hasattr(request.app.state, "select_folder_callback"):
            callback = request.app.state.select_folder_callback
            if callback:
                path = callback()
                return {"status": "ok", "path": path}
        return {"status": "error", "message": "Callback not connected"}
    except Exception as e:
        print(f"SelectFolder Error: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/config/managed_folders")
async def get_managed_folders():
    """Returns the list of library folders configured by the user."""
    from config_manager import ConfigManager
    config = ConfigManager()
    folders = config.get("media_folders", [])
    print(f"[DEBUG API] Sending managed folders to UI: {folders}")
    return {"status": "ok", "folders": folders}

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

@app.get("/api/drums/settings")
async def get_drum_settings():
    if os.path.exists(DRUM_SETTINGS_FILE):
        try:
            with open(DRUM_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

@app.post("/api/drums/settings")
async def save_drum_settings(settings: Dict):
    try:
        with open(DRUM_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/api/local/missing_items")
async def get_missing_items():
    """Returns a unified list of all missing local items from Library and Setlist."""
    missing = []
    
    def is_web(p):
        if not p: return True
        return p.lower().startswith("http") or p.lower().startswith("https")
    
    if os.path.exists(LOCAL_LIB_FILE):
        try:
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                lib_items = json.load(f)
                for i, item in enumerate(lib_items):
                    raw_path = item.get("path", "")
                    if not raw_path: continue
                    path = resolve_portable_path(raw_path)
                    if path and not is_web(path) and not os.path.exists(path):
                        print(f"[MISSING CHECK] Library item {i} is missing: {path}")
                        missing.append({
                            "type": "library", "index": i,
                            "title": item.get("title", f"Item {i}"),
                            "old_path": path, "is_multitrack": item.get("is_multitrack", False)
                        })
        except Exception as e:
            print(f"[MISSING CHECK] Error reading Library: {e}")
                    
    if os.path.exists(SETLIST_FILE):
        try:
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                set_items = json.load(f)
                for i, item in enumerate(set_items):
                    raw_url = item.get("url", "")
                    if not raw_url: continue
                    url = resolve_portable_path(raw_url)
                    if url and not is_web(url) and not os.path.exists(url):
                        print(f"[MISSING CHECK] Setlist item {i} is missing: {url}")
                        missing.append({
                            "type": "setlist", "index": i,
                            "title": item.get("title", f"Item {i}"),
                            "old_path": url, "is_multitrack": item.get("is_multitrack", False)
                        })
        except Exception as e:
            print(f"[MISSING CHECK] Error reading Setlist: {e}")
    
    return missing

@app.post("/api/local/search_folder")
async def search_folder_bulk(data: dict):
    folder_path = data.get("folder_path")
    missing_items = data.get("items", [])
    
    if not folder_path or not os.path.exists(folder_path):
        return {"status": "error", "message": "Dossier ou chemin invalide."}
        
    results = []
    to_find = {}
    for i, item in enumerate(missing_items):
        fn = os.path.basename(item["old_path"].rstrip('/\\')).lower()
        if fn not in to_find: to_find[fn] = []
        to_find[fn].append(i)
        
    found_count = 0
    for root, dirs, files in os.walk(folder_path):
        all_entries_lower = [f.lower() for f in files] + [d.lower() for d in dirs]
        for fn_lower in list(to_find.keys()):
            if fn_lower in all_entries_lower:
                actual_name = next((f for f in files if f.lower() == fn_lower), None)
                if not actual_name:
                    actual_name = next((d for d in dirs if d.lower() == fn_lower), fn_lower)
                
                full_found_path = os.path.join(root, actual_name)
                for item_idx in to_find[fn_lower]:
                    results.append({"item_list_index": item_idx, "found_path": full_found_path})
                    found_count += 1
                del to_find[fn_lower]
        if not to_find: break
    return {"status": "ok", "results": results, "found_count": found_count}

@app.post("/api/local/relocate_bulk")
async def relocate_bulk(data: dict):
    """
    Applies bulk relocation action (link, copy, move).
    If target_folder is 'AUTO', routes each item to its app-default Medias/ subfolder.
    """
    action = data.get("action", "link")
    mappings = data.get("mappings", [])
    target_folder = data.get("target_folder", "") # Can be a path or 'AUTO'
    
    success_count = 0
    errors = []

    from utils import get_internal_media_dirs
    # Map internal types to actual paths
    # Index 0: Audios, 1: Videos, 2: Midi, 3: Multipistes (order from utils.py)
    internal_dirs = get_internal_media_dirs()
    
    for m in mappings:
        try:
            current_target = m.get("new_path") # This is WHERE it was found during scan
            
            # If target_folder is NOT AUTO and NOT empty, we might want to override scan result?
            # Actually, if it's COPY/MOVE, the user wants it to go to 'target_folder'.
            # BUT if it's 'AUTO', we route by type.
            
            final_dest = None
            if action in ['copy', 'move']:
                # If target_folder is provide and is a valid directory, use it.
                if target_folder and os.path.isdir(target_folder):
                    final_dest = target_folder
                else: 
                    # Default to AUTO logic if no valid folder provided for physical op
                    # Determine subfolder by type
                    m_type = m.get("type", "library")
                    is_mt = m.get("is_multitrack", False)
                    
                    if is_mt: sub_idx = 3 # Multipistes
                    else:
                        # Simple type detection by extension of found path
                        ext = os.path.splitext(current_target)[1].lower()
                        if ext in ['.mp4', '.mkv', '.webm', '.avi']: sub_idx = 1 # Videos
                        elif ext in ['.mid', '.midi']: sub_idx = 2 # Midi
                        else: sub_idx = 0 # Audios
                    
                    final_dest = internal_dirs[sub_idx]

            res = await relocate_apply({
                "action": action, 
                "type": m["type"], 
                "index": m["index"], 
                "new_path": current_target,
                "target_folder": final_dest if action in ['copy', 'move'] else None
            })
            
            if res.get("status") == "ok": 
                success_count += 1
            else: 
                errors.append(f"{os.path.basename(m['new_path'])}: {res.get('message')}")
        except Exception as e: 
            errors.append(f"Erreur fatale index {m['index']}: {str(e)}")
            
    # Success if AT LEAST one file was handled.
    # Otherwise return error with the reason of the FIRST error for clarity.
    status = "ok" if success_count > 0 else "error"
    main_msg = "" if status == "ok" else (errors[0] if errors else "Inconnu")
    return {"status": status, "success_count": success_count, "total": len(mappings), "errors": errors, "message": main_msg}

@app.get("/api/web_links")
async def get_web_links():
    if os.path.exists(WEB_LINKS_FILE):
        try:
            with open(WEB_LINKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

@app.post("/api/web_links")
async def add_web_link(item: Dict):
    try:
        logging.warning(f"[SAVE_WEB] Attempting to ADD: {item.get('title')} (Content: {list(item.keys())})")
        links = []
        if os.path.exists(WEB_LINKS_FILE):
            with open(WEB_LINKS_FILE, "r", encoding="utf-8") as f:
                links = json.load(f)
        links.append(item)
        with open(WEB_LINKS_FILE, "w", encoding="utf-8") as f:
            json.dump(links, f, indent=4)
        logging.warning(f"[SAVE_WEB] Successfully ADDED. Total links: {len(links)}")
        return {"status": "ok"}
    except Exception as e:
        logging.error(f"[SAVE_WEB] ADD Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/web_links/{index}")
async def update_web_link(index: int, item: Dict):
    try:
        abs_path = os.path.abspath(WEB_LINKS_FILE)
        logging.warning(f"[SAVE_WEB] PUT index {index}. Payload cover: {item.get('cover')}")
        
        links = []
        if os.path.exists(abs_path):
            with open(abs_path, "r", encoding="utf-8") as f:
                links = json.load(f)
        else:
            logging.error(f"[SAVE_WEB] File {abs_path} NOT FOUND during PUT!")
        
        if 0 <= index < len(links):
            # Preserve existing cover if new one is null but we had one? 
            # Non, si l'user a fait "Supprimer la pochette", on respecte le null.
            links[index] = item
            
            with open(abs_path, "w", encoding="utf-8") as f:
                json.dump(links, f, indent=4)
                f.flush()
                # os.fsync(f.fileno()) # Supprimé pour compatibilité plus large
            
            logging.warning(f"[SAVE_WEB] Write successful. Re-verifying...")
            with open(abs_path, "r", encoding="utf-8") as f:
                check = json.load(f)
                logging.warning(f"[SAVE_WEB] VERIFIED: Index {index} cover is now: {check[index].get('cover')}")
            
            return {"status": "ok"}
        
        return {"status": "error", "message": f"Index {index} out of range ({len(links)})"}
    except Exception as e:
        logging.error(f"[SAVE_WEB] CRITICAL UPDATE ERROR: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.delete("/api/web_links/{index}")
async def delete_web_link_api(index: int):
    try:
        if os.path.exists(WEB_LINKS_FILE):
            with open(WEB_LINKS_FILE, "r", encoding="utf-8") as f:
                links = json.load(f)
            if 0 <= index < len(links):
                links.pop(index)
                with open(WEB_LINKS_FILE, "w", encoding="utf-8") as f:
                    json.dump(links, f, indent=4)
                return {"status": "ok"}
        raise HTTPException(status_code=404, detail="Link not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload_cover_generic")
async def upload_cover_generic(request: Request):
    """Uploads a cover art image and returns its portable path."""
    from fastapi import UploadFile, File
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(status_code=400, detail="No file")

    filename = file.filename
    # Destination in medias/covers/
    dest_dir = os.path.join(get_data_dir(), "medias", "covers")
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)

    dest_path = os.path.join(dest_dir, filename)
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"status": "ok", "path": to_portable_path(dest_path)}

@app.get("/api/local/find_artist_folder")
async def find_artist_folder(name: str):
    """
    Scans managed folders to see if a subfolder with this artist name already exists.
    Useful to suggest destination to the user (V50).
    """
    if not name or not name.strip() or name.strip() == "Divers":
        return {"status": "ok", "matches": []}
    
    # Secure Name (same as relocation logic)
    import re
    safe_name = re.sub(r'[\\/*?Source: server.py:"<>|]', '_', name.strip())
    
    from config_manager import ConfigManager
    config = ConfigManager()
    base_folders = config.get("media_folders", [])
    
    matches = []
    for base in base_folders:
        try:
            resolved_base = resolve_portable_path(base)
            if not resolved_base or not os.path.exists(resolved_base):
                continue
                
            # Check direct subfolder
            potential = os.path.join(resolved_base, safe_name)
            if os.path.exists(potential) and os.path.isdir(potential):
                matches.append({
                    "root": base, # Portable path for the UI select
                    "full_path": potential
                })
        except:
            continue
            
    return {"status": "ok", "matches": matches}

@app.post("/api/media/link_bidirectional")
async def link_bidirectional(data: Dict):
    """Etablit une liaison bidirectionnelle entre deux médias (YT, Local, Web)."""
    try:
        source_type = data.get("source_type") # 'setlist', 'library', 'web_links'
        source_index = data.get("source_index")
        target_type = data.get("target_type")
        target_index = data.get("target_index")
        action = data.get("action", "link")  # 'link' or 'unlink'

        if not source_type or not target_type:
            return {"status": "error", "message": "Missing types"}


        files = {
            "setlist": SETLIST_FILE,
            "library": LOCAL_LIB_FILE,
            "web_links": WEB_LINKS_FILE
        }

        # Helper pour charger/sauvegarder
        def get_db(t):
            if os.path.exists(files[t]):
                with open(files[t], "r", encoding="utf-8") as f:
                    return json.load(f)
            return []

        def save_db(t, content):
            with open(files[t], "w", encoding="utf-8") as f:
                json.dump(content, f, indent=4)

        # Si l'index est -1, on ne peut pas établir de liaison physique car l'item n'existe pas encore.
        # L'Auto-Sync aura quand même lieu en mémoire côté frontend.
        if source_index == -1 or target_index == -1:
            return {"status": "ok", "synced": True, "message": "Memory sync only (new item)"}

        db_s = get_db(source_type)
        db_t = get_db(target_type)

        if source_index < 0 or source_index >= len(db_s): return {"status": "error", "message": "Source out of range"}
        if target_index < 0 or target_index >= len(db_t): return {"status": "error", "message": "Target out of range"}

        s_uid = f"{source_type[:3]}:{source_index}"
        t_uid = f"{target_type[:3]}:{target_index}"

        # 1. Mise à jour Source
        if "linked_ids" not in db_s[source_index]: db_s[source_index]["linked_ids"] = []
        if action == "link":
            if t_uid not in db_s[source_index]["linked_ids"]: db_s[source_index]["linked_ids"].append(t_uid)
        else:
            if t_uid in db_s[source_index]["linked_ids"]: db_s[source_index]["linked_ids"].remove(t_uid)
        
        # 2. Mise à jour Cible
        if "linked_ids" not in db_t[target_index]: db_t[target_index]["linked_ids"] = []
        if action == "link":
            if s_uid not in db_t[target_index]["linked_ids"]: db_t[target_index]["linked_ids"].append(s_uid)
        else:
            if s_uid in db_t[target_index]["linked_ids"]: db_t[target_index]["linked_ids"].remove(s_uid)

        save_db(source_type, db_s)
        # Si même DB (ex: YT vers YT), on a déjà sauvé. Sinon, sauver la cible.
        if source_type != target_type:
            save_db(target_type, db_t)

        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Static Files Logic
if getattr(sys, 'frozen', False):
    base_path = sys._MEIPASS
else:
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

web_path = os.path.join(base_path, "web")
assets_path = os.path.join(base_path, "assets")

if os.path.exists(web_path):
    app.mount("/", StaticFiles(directory=web_path, html=True), name="static_web")

if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="static_assets")
else:
    print(f"WARNING: Assets directory not found at {assets_path}")
