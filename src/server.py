import os
import sys
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import json
import requests
import re

# Import ConfigManager (assuming fallback imports or path setup in main.py works for this module too
# but server.py is imported BY main.py, so we need to be careful about imports here if run standalone.
# However, this app is run via main.py, so sys.path is set.
try:
    from config_manager import ConfigManager
except ImportError:
    from src.config_manager import ConfigManager

app = FastAPI()
SETLIST_FILE = "setlist.json"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global loop reference
server_loop = None

# Config Instance (Lazy load or init)
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
    """Helper to broadcast from sync threads (e.g. MIDI callback)"""
    if server_loop:
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), server_loop)

# --- HELPERS ---
def extract_youtube_id(url: str):
    """Extracts Video ID from various YouTube URL formats."""
    # Patterns:
    # youtube.com/watch?v=ID
    # youtu.be/ID
    # youtube.com/embed/ID
    regex = r"(?:v=|\/)([0-9A-Za-z_-]{11}).*"
    match = re.search(regex, url)
    if match:
        return match.group(1)
    return None

def fetch_youtube_title(video_id: str, api_key: str):
    """Fetches video title from YouTube API."""
    if not api_key:
        return None

    url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={video_id}&key={api_key}"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if "items" in data and len(data["items"]) > 0:
                return data["items"][0]["snippet"]["title"]
    except Exception as e:
        print(f"YouTube API Error: {e}")
    return None

# --- ROUTES ---

@app.get("/api/status")
async def get_status():
    return {"status": "ok"}

@app.get("/api/setlist")
async def get_setlist():
    if os.path.exists(SETLIST_FILE):
        try:
            with open(SETLIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

@app.post("/api/setlist")
async def add_to_setlist(item: Dict):
    """
    Ajoute un item à la setlist.
    Attend: {"url": "..."}
    Optionnel: {"title": "..."} (sinon auto-detect)
    """
    try:
        url = item.get("url", "")
        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        # 1. Extract ID
        video_id = extract_youtube_id(url)
        if not video_id:
             # Fallback logic if not a valid YT ID, assume generic link?
             # But requirement is YouTube. Let's accept it but ID is None.
             video_id = ""

        # 2. Get Title
        title = item.get("title")
        if not title:
            # Try API
            api_key = config_manager.get("YOUTUBE_API_KEY")
            if video_id and api_key:
                title = fetch_youtube_title(video_id, api_key)

            # Fallback Title
            if not title:
                title = url

        # 3. Save
        new_item = {
            "title": title,
            "url": url,
            "id": video_id
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
    """Supprime un item de la setlist par index"""
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

@app.post("/api/trigger")
async def trigger_action(request: Request):
    """
    Trigger an action via HTTP (Virtual Pedalboard).
    Payload: {"cc": 50, "value": 127}
    """
    try:
        body = await request.json()
        cc = body.get("cc")
        value = body.get("value", 127)

        # Access state injected in main.py
        if not hasattr(request.app.state, "action_handler"):
            raise HTTPException(status_code=503, detail="Action Handler not ready")

        action_handler = request.app.state.action_handler
        profiles = request.app.state.profiles

        # Execute
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
