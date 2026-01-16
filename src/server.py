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

def fetch_youtube_title(video_id: str, api_key: str):
    if not api_key: return None
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
    Smart Add to Setlist.
    Analyzes URL to determine mode and profile.
    """
    try:
        url = item.get("url", "")
        if not url:
            raise HTTPException(status_code=400, detail="URL is required")

        # 1. Determine Mode & Profile
        open_mode = "external"
        profile_name = "Web Generic"

        if "youtube.com" in url or "youtu.be" in url:
            open_mode = "iframe"
            profile_name = "YouTube"
        elif "songsterr.com" in url:
            open_mode = "external"
            profile_name = "Songsterr" # Ensure this profile exists or defaults to Generic

        # 2. Extract ID (YouTube Only)
        video_id = ""
        if open_mode == "iframe":
            video_id = extract_youtube_id(url)

        # 3. Get Title
        title = item.get("title")
        if not title:
            # Try API for YouTube
            if open_mode == "iframe" and video_id:
                api_key = config_manager.get("YOUTUBE_API_KEY")
                title = fetch_youtube_title(video_id, api_key)

            # Fallback
            if not title:
                title = url

        # 4. Save
        new_item = {
            "title": title,
            "url": url,
            "id": video_id,
            "open_mode": open_mode,
            "profile_name": profile_name
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
