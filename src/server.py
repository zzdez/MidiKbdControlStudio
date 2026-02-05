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
import logging
import base64
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TCON, TDRC, TRCK, error as ID3Error
from mutagen.easyid3 import EasyID3
from mutagen.easymp4 import EasyMP4
from mutagen.flac import Picture, FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE
from mutagen.mp4 import MP4, MP4Cover
from pydantic import BaseModel

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
    import import_service
except ImportError:
    from src.config_manager import ConfigManager
    from src.library_manager import LibraryManager
    from src.metadata_service import MetadataService
    from src import import_service

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

def fetch_youtube_title(video_id: str, api_key: str):
    details = fetch_youtube_details(video_id, api_key)
    return details["title"] if details else None

def search_youtube(query: str, api_key: str):
    if not api_key:
        return []

    # Check if query is a direct link
    video_id = extract_youtube_id(query)
    if video_id:
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

@app.post("/api/import")
async def api_import(request: Request):
    try:
        data = await request.json()
        result = await import_service.process_import(data)
        return result
    except Exception as e:
        print(f"Import Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class TranslationRequest(BaseModel):
    filepath: str
    source_lang: str
    target_lang: str
    context: str = ""
    remove_duplicates: bool = True
    remove_non_speech: bool = True

@app.post("/api/subtitles/translate")
async def translate_subtitle_endpoint(request: TranslationRequest):
    filepath = request.filepath
    if not os.path.exists(filepath):
         raise HTTPException(status_code=404, detail="File not found")

    api_key = config_manager.get("GEMINI_API_KEY")
    if not api_key:
         raise HTTPException(status_code=400, detail="Missing GEMINI_API_KEY")

    try:
        new_path = await import_service.translate_vtt_file(
             filepath,
             request.source_lang,
             request.target_lang,
             api_key,
             request.context,
             request.remove_duplicates,
             request.remove_non_speech
        )
        return {"status": "success", "new_file": new_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/youtube/search")
async def api_youtube_search(q: str):
    api_key = config_manager.get("YOUTUBE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing YOUTUBE_API_KEY")

    return search_youtube(q, api_key)

@app.get("/api/open_external")
async def open_external(url: str):
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
    field = data.get("field")
    value = data.get("value")
    
    if not field or not value:
        raise HTTPException(status_code=400, detail="Missing field or value")
    
    current_blocked = config_manager.get("blocked_tags", {"category": [], "genre": []})
    if field not in current_blocked: current_blocked[field] = []

    if value not in current_blocked[field]:
        current_blocked[field].append(value)
        config_manager.set("blocked_tags", current_blocked)
        
    return {"status": "ok", "blocked": current_blocked}

@app.post("/api/profile/active")
async def set_active_profile(data: Dict):
    profile_name = data.get("name")
    if not profile_name:
         raise HTTPException(status_code=400, detail="Missing profile name")
         
    if library_manager.force_profile_callback:
        try:
             library_manager.force_profile_callback(profile_name)
             return {"status": "ok", "profile": profile_name}
        except Exception as e:
             print(f"Profile Switch Error: {e}")
             raise HTTPException(status_code=500, detail=str(e))
             
    return {"status": "ignored", "reason": "No callback registered"}

@app.get("/api/metadata/search")
async def api_metadata_search(q: str):
    return metadata_service.search(q)

@app.get("/api/stream")
async def stream_file(path: str):
    decoded_path = urllib.parse.unquote(path)
    logging.info(f"STREAM API HIT: {decoded_path}") 
    if not os.path.exists(decoded_path):
        logging.error(f"STREAM MISSING: {decoded_path}")
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(decoded_path)

@app.get("/api/status")
async def get_status():
    return {"status": "ok"}

@app.post("/api/debug_log")
async def debug_log_endpoint(data: Dict):
    msg = data.get("message", "")
    print(f"[JS_CONSOLE] {msg}")
    return {"status": "ok"}

@app.get("/api/setlist")
async def get_setlist():
    if os.path.exists(SETLIST_FILE):
        try:
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                items = json.load(f)
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
    try:
        url = item.get("url", "")
        manual_mode = item.get("manual_mode", "auto")
        target_profile = item.get("target_profile", "Auto")
        category = item.get("category", "Général")

        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        is_web = url.startswith("http")
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
                open_mode = "iframe" if profile_name == "YouTube" else "external"
        else:
            profile_name = "Local Media"
            open_mode = "local"

        video_id = extract_youtube_id(url)
        title = item.get("title")
        if not title:
            if open_mode == "iframe" and video_id:
                api_key = config_manager.get("YOUTUBE_API_KEY")
                title = fetch_youtube_title(video_id, api_key)
            elif open_mode == "local":
                title = os.path.basename(url)
            if not title:
                title = url

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
            url = item.get("url", "")
            manual_mode = item.get("manual_mode", "auto")
            target_profile = item.get("target_profile", "Auto")
            category = item.get("category", "Général")
            title = item.get("title", "Sans titre")

            if not url:
                raise HTTPException(status_code=400, detail="URL is required")

            is_web = url.startswith("http")
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
                    open_mode = "iframe" if profile_name == "YouTube" else "external"
            else:
                profile_name = "Local Media"
                open_mode = "local"

            video_id = extract_youtube_id(url)
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

@app.get("/api/settings")
async def get_settings():
    config_manager._load_config()
    return {
        "YOUTUBE_API_KEY": config_manager.get("YOUTUBE_API_KEY", ""),
        "GEMINI_API_KEY": config_manager.get("GEMINI_API_KEY", ""),
        "media_folders": config_manager.get("media_folders", [])
    }

@app.post("/api/settings")
async def update_settings(settings: Dict):
    for key, value in settings.items():
        config_manager.set(key, value)
    return {"status": "ok", "settings": settings}

@app.post("/api/open_native_editor")
async def open_native_editor():
    if hasattr(app.state, "open_settings_callback"):
        app.state.open_settings_callback()
        return {"status": "opened"}
    return {"status": "error", "message": "Callback not linked"}

@app.post("/api/open_settings")
async def open_settings_alias():
    return await open_native_editor()

@app.post("/api/library/add_folder")
async def add_library_folder():
    if hasattr(app.state, "select_folder_callback"):
        path = app.state.select_folder_callback()
        if path:
            folders = config_manager.get("media_folders", [])
            if path not in folders:
                folders.append(path)
                config_manager.set("media_folders", folders)
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
    return library_manager.get_library()

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
        try:
            audio = mutagen.File(path)
            if audio:
                if hasattr(audio, 'tags') and audio.tags:
                    for key in audio.tags.keys():
                        if key.startswith('APIC'):
                            frame = audio.tags[key]
                            if hasattr(frame, 'data'):
                                return Response(content=frame.data, media_type=frame.mime)
                if 'covr' in audio:
                    return Response(content=audio['covr'][0], media_type="image/jpeg")
                if hasattr(audio, 'pictures') and audio.pictures:
                    return Response(content=audio.pictures[0].data, media_type=audio.pictures[0].mime)
                if isinstance(audio, mutagen.oggvorbis.OggVorbis):
                    if 'metadata_block_picture' in audio:
                        try:
                            b64_data = audio['metadata_block_picture'][0]
                            pic_data = base64.b64decode(b64_data)
                            pic = Picture(pic_data)
                            return Response(content=pic.data, media_type=pic.mime)
                        except Exception: pass
        except Exception: pass

        directory = os.path.dirname(path)
        for cand in ["folder.jpg", "cover.jpg", "album.jpg", "folder.png", "cover.png"]:
            cand_path = os.path.join(directory, cand)
            if os.path.exists(cand_path):
                return FileResponse(cand_path)
        
        base_name = os.path.splitext(os.path.basename(path))[0]
        for ext in [".jpg", ".png", ".jpeg"]:
           img_path = os.path.join(directory, base_name + ext)
           if os.path.exists(img_path):
               return FileResponse(img_path)

    except Exception as e:
        logging.error(f"Art Fatal Error: {e}")

    return Response(status_code=404)

@app.post("/api/local/add")
async def add_local_file():
    try:
        if hasattr(app.state, "select_file_callback"):
            path = app.state.select_file_callback()
            if path:
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
                        "filename": os.path.basename(path),
                        "target_folders": folders
                    }
                
                try:
                    file_data = scan_file_metadata(path)
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
                     logging.error(f"Scan Error on Add: {e}")
                     return {"status": "error", "message": str(e)}

        return {"status": "cancelled"}
    except Exception as e:
        print(f"Add File Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/confirm_import")
async def confirm_import(data: Dict):
    source_path = data.get("source_path", "").strip()
    action = data.get("action")
    target_folder = data.get("target_folder", "").strip()
    
    if not source_path or not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Source file not found")

    final_path = source_path
    
    try:
        if action in ["copy", "move"]:
            if target_folder: target_folder = os.path.normpath(target_folder)
            if not target_folder or not os.path.isdir(target_folder):
                 raise HTTPException(status_code=400, detail=f"Target folder invalid: {target_folder}")
                 
            filename = os.path.basename(source_path)
            destination = os.path.join(target_folder, filename)
            base, ext = os.path.splitext(destination)
            counter = 1
            while os.path.exists(destination):
                destination = f"{base}_{counter}{ext}"
                counter += 1
            
            if action == "copy": shutil.copy2(source_path, destination)
            elif action == "move": shutil.move(source_path, destination)
            final_path = destination

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
            current["title"] = item.get("title", current["title"])
            current["artist"] = item.get("artist", current.get("artist", ""))
            current["album"] = item.get("album", current.get("album", ""))
            current["genre"] = item.get("genre", current.get("genre", ""))
            current["category"] = item.get("category", current.get("category", "Général"))
            current["year"] = item.get("year", current.get("year", ""))
            current["target_profile"] = item.get("target_profile", current.get("target_profile", "Auto"))
            current["user_notes"] = item.get("user_notes", current.get("user_notes", ""))
            
            with open(LOCAL_LIB_FILE, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=4)

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

@app.post("/api/set_mode")
async def set_mode(request: Request):
    try:
        body = await request.json()
        mode = body.get("mode")
        forced_profile_name = body.get("forced_profile_name")
        print(f"[DEBUG API] Reçu demande set_mode: Mode={mode}, Profil={forced_profile_name}")

        if hasattr(app.state, "set_mode_callback") and app.state.set_mode_callback:
            app.state.set_mode_callback(mode, forced_profile_name)

        if hasattr(request.app.state, "context_monitor"):
            context_monitor = request.app.state.context_monitor
            web_modes = ["WEB", "YOUTUBE", "AUDIO", "VIDEO"]
            if mode in web_modes and forced_profile_name:
                context_monitor.set_manual_override(forced_profile_name)
            elif mode == "WIN":
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
        if hasattr(request.app.state, "action_handler"):
            action_handler = request.app.state.action_handler
            profiles = request.app.state.profiles
            action_handler.execute(int(cc), int(value), 1, profiles)
        return {"status": "triggered", "cc": cc}
    except Exception as e:
        print(f"Trigger Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

if getattr(sys, 'frozen', False):
    base_path = sys._MEIPASS
else:
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

web_path = os.path.join(base_path, "web")
if os.path.exists(web_path):
    app.mount("/", StaticFiles(directory=web_path, html=True), name="static")
else:
    print(f"WARNING: Web directory not found at {web_path}")
