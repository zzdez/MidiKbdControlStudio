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
except ImportError:
    from src.config_manager import ConfigManager
    from src.library_manager import LibraryManager
    from src.metadata_service import MetadataService

app = FastAPI()
library_manager = LibraryManager()
metadata_service = MetadataService()
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

@app.get("/api/metadata/blocked")
async def get_blocked_tags():
    return config_manager.get("blocked_tags", {})

@app.post("/api/metadata/block")
async def block_tag(data: Dict):
    field = data.get("field") # "category", "genre"
    value = data.get("value")
    
    if not field or not value:
        raise HTTPException(status_code=400, detail="Missing field or value")
    
    current_blocked = config_manager.get("blocked_tags", {})
    if field not in current_blocked:
        current_blocked[field] = []
    
    if value not in current_blocked[field]:
        current_blocked[field].append(value)
        config_manager.set("blocked_tags", current_blocked)
        
    return {"status": "ok", "blocked": current_blocked}

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
