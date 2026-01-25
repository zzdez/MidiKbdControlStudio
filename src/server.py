import os
import sys
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing import List, Dict
import json
import requests
import re
import subprocess
import tkinter as tk
from tkinter import filedialog
import urllib.parse

import mutagen
import base64
from mutagen.id3 import ID3, APIC, error as ID3Error
from mutagen.easyid3 import EasyID3
from mutagen.easymp4 import EasyMP4
from mutagen.flac import Picture, FLAC
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
except ImportError:
    from src.config_manager import ConfigManager
    from src.library_manager import LibraryManager

app = FastAPI()
library_manager = LibraryManager()
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

@app.get("/api/stream")
async def stream_file(path: str):
    decoded_path = urllib.parse.unquote(path)
    if not os.path.exists(decoded_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(decoded_path)

@app.get("/api/status")
async def get_status():
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
            "youtube_description": item.get("youtube_description", ""),
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
                "youtube_description": item.get("youtube_description", ""),
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
    try:
        audio = mutagen.File(path, easy=True)
        if not audio: return {}
        
        # Safe extraction
        def get_tag(k): return audio.get(k, [""])[0]
        
        length = 0
        if hasattr(audio, 'info') and hasattr(audio.info, 'length'):
            length = audio.info.length

        return {
            "title": get_tag("title") or os.path.basename(path),
            "artist": get_tag("artist"),
            "album": get_tag("album"),
            "genre": get_tag("genre"),
            "year": get_tag("date"),
            "duration": length
        }
    except Exception as e:
        print(f"Metadata Read Error: {e}")
        return {"title": os.path.basename(path)}

def write_file_metadata(path, data):
    logging.info(f"Attempting to write metadata for: {path}")
    ext = os.path.splitext(path)[1].lower()
    
    # Skip video files for safety (only allow audio formats we are sure of)
    if ext in ['.mkv', '.avi', '.mov', '.webm']:
        # We now allow .mp4 as it might contain audio tags we want to edit.
        logging.info("Skipping excluded extension")
        return False

    try:
        audio = None
        
        # 1. Try Easy methods based on extension first for precision
        if ext == ".mp3":
            try:
                audio = EasyID3(path)
            except Exception as e:
                logging.warning(f"EasyID3 load failed, attempting init: {e}")
                try:
                    # Provide ID3 Header
                    try: 
                        ID3(path)
                    except ID3Error:
                        logging.info("Creating new ID3 Header (v2.3)")
                        tags = ID3()
                        tags.save(path, v2_version=3)
                    audio = EasyID3(path)
                except Exception as e2:
                    logging.error(f"Failed to init MP3 tags: {e2}")
                    return False

        elif ext in [".m4a", ".mp4"]:
            try:
                audio = EasyMP4(path)
            except Exception as e:
                logging.error(f"EasyMP4 load failed: {e}")
                # Try standard MP4?
                pass
        
        # 2. Generic Fallback
        if not audio:
            try:
                audio = mutagen.File(path, easy=True)
            except Exception as e:
                logging.error(f"mutagen.File easy=True failed: {e}")

        if audio is not None:
            logging.info(f"Audio object loaded: {type(audio)}")
            # Map standard keys
            if "title" in data: audio["title"] = data["title"]
            if "artist" in data: audio["artist"] = data["artist"]
            if "album" in data: audio["album"] = data["album"]
            if "genre" in data: audio["genre"] = data["genre"]
            if "year" in data: audio["date"] = data["year"]
            
            if ext == ".mp3":
                audio.save(v2_version=3)
            else:
                audio.save()
            logging.info("Text tags saved successfully")

            # --- Handle Cover Art ---
            if "cover_data" in data and data["cover_data"]:
                logging.info("Processing cover art...")
                try:
                    header, encoded = data["cover_data"].split(",", 1)
                    image_data = base64.b64decode(encoded)
                    logging.info(f"Image data decoded, size: {len(image_data)} bytes")
                    
                    mime_type = "image/jpeg"
                    if "image/png" in header:
                        mime_type = "image/png"

                    # 1. MP3
                    if ext == ".mp3":
                        tags = ID3(path) # Re-open for ID3 specific manipulation
                        tags.delall("APIC") # Remove existing covers
                        tags.add(APIC(
                            encoding=0, # 0=Latin-1 (Safe for v2.3), 3=UTF-8 (Not supported in v2.3)
                            mime=mime_type,
                            type=3, 
                            desc=u'', # Empty description for max compatibility
                            data=image_data
                        ))
                        tags.save(path, v2_version=3)

                    # 2. FLAC
                    elif ext == ".flac":
                        f_audio = FLAC(path)
                        pic = Picture()
                        pic.type = 3
                        pic.mime = mime_type
                        pic.desc = 'Cover'
                        pic.data = image_data
                        f_audio.clear_pictures()
                        f_audio.add_picture(pic)
                        f_audio.save()

                    # 3. M4A / MP4
                    elif ext in [".m4a", ".mp4"]:
                        m_audio = MP4(path)
                        fmt = MP4Cover.FORMAT_PNG if mime_type == "image/png" else MP4Cover.FORMAT_JPEG
                        m_audio["covr"] = [MP4Cover(image_data, imageformat=fmt)]
                        m_audio.save()
                    
                    logging.info("Cover art saved")

                except Exception as e:
                    logging.error(f"Cover Art Write Error: {e}")

            return True
        else:
            logging.error("Failed to load audio object for tagging")

    except PermissionError:
        logging.error("PermissionDenied: File is locked")
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
        root = tk.Tk()
        root.attributes("-topmost", True)
        root.withdraw()
        path = filedialog.askopenfilename(parent=root, filetypes=[("Audio/Video", "*.mp3 *.wav *.mp4 *.mkv *.avi *.flac")])
        root.destroy()

        if not path:
            return {"status": "cancelled"}

        if not os.path.exists(path):
             raise HTTPException(status_code=404, detail="File not found")

        # Analyze
        meta = scan_file_metadata(path)
        
        new_item = {
            "path": path,
            "title": meta.get("title", os.path.basename(path)),
            "artist": meta.get("artist", ""),
            "album": meta.get("album", ""),
            "genre": meta.get("genre", ""),
            "category": "Général", # Default Category
            "year": meta.get("year", ""),
            "user_notes": "",
            "duration": meta.get("duration", 0)
        }

        items = []
        if os.path.exists(LOCAL_LIB_FILE):
            with open(LOCAL_LIB_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)
        
        items.append(new_item)

        with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=4)
        
        return items
    except Exception as e:
        print(f"Add Local Error: {e}")
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
            current["user_notes"] = item.get("user_notes", current.get("user_notes", ""))
            
            # 1. Save JSON (Database Priority)
            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

            # 2. Write to disk tags (Physical)
            warning_msg = None
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
async def get_profiles():
    # Access state or reload
    if hasattr(app.state, "profiles"):
        return app.state.profiles
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

        # Access Context Monitor
        if not hasattr(request.app.state, "context_monitor"):
             # Might happen if not fully initialized or wrong injection
             # But context_monitor should be injected in main.py
             pass
        else:
            context_monitor = request.app.state.context_monitor

            if mode == "WEB" and forced_profile_name:
                context_monitor.set_manual_override(forced_profile_name)
            elif mode == "WIN" and forced_profile_name:
                # Even in WIN mode, if we are "Hybrid" (External Browser),
                # we want to force the profile so the user sees the right buttons
                # without needing the window to be focused 100% of the time,
                # OR we might want to let auto-detect work.
                # Requirement: "Si mode == 'WIN' : Appelle context_monitor.set_manual_override(None)"?
                # Actually requirement says:
                # "Cas 2 (External) ... Mode WIN ... et forced_profile_name"
                # "Si mode == 'WIN' : Appelle context_monitor.set_manual_override(forced_profile_name)" seems implied by "Verrouillage".
                # But logic "B" says: "Si mode == 'WIN' : Appelle context_monitor.set_manual_override(None)."
                # Wait, "Cas 2 ... Appelle /api/set_mode avec mode: WIN et forced_profile_name"
                # So if I receive WIN + Name, I should probably override?
                # Let's look closely at "B. Mise à jour de POST /api/set_mode":
                # "Si mode == 'WEB' : Appelle ... set_manual_override(forced_profile_name)"
                # "Si mode == 'WIN' : Appelle ... set_manual_override(None)"

                # CONTRADICTION CHECK:
                # Frontend Plan for Case 2 says: "Appelle /api/set_mode avec mode: WIN ... et forced_profile_name"
                # Backend Plan for Set Mode says: "Si mode == WIN ... set_manual_override(None)"

                # INTERPRETATION:
                # If I open external, I am in Windows Mode. I rely on Auto-Detect (Active Window).
                # So I should clear override.
                # BUT the user might want to see the specific profile "Songsterr" even if they click away.
                # However, sticking to the explicit instruction B: "Si mode == 'WIN' : Appelle ... set_manual_override(None)"

                # WAIT, Case 2 in Frontend section says: "Appelle /api/set_mode avec mode: WIN ... et forced_profile_name"
                # Maybe the backend instruction B was a simplification or referring to a "Reset" action?
                # Let's follow the most robust path:
                # If a profile name is provided, use it.
                # If "WIN" is sent without profile, clear it.
                # Actually, let's implement exactly what logic A and B combined imply:
                # Frontend sends Name. Backend decides what to do.

                # Let's follow Logic B strictly as requested:
                # "Si mode == 'WEB' : set_manual_override(forced_profile_name)"
                # "Si mode == 'WIN' : set_manual_override(None)"

                # But wait, if I open Songsterr (External), I want the "Songsterr" buttons on my screen.
                # If I set override to None, ContextMonitor will scan windows.
                # If Songsterr is active, it will pick Songsterr profile.
                # If I click back to the Web App to change settings, it will switch to Chrome/Web Generic.
                # This seems correct for "WIN" mode (Context Sensitive).

                # So I will follow Logic B strictly.
                pass

            if mode == "WEB":
                context_monitor.set_manual_override(forced_profile_name)
            else:
                # WIN Mode -> Release Lock (Auto-Detect)
                context_monitor.set_manual_override(None)

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
