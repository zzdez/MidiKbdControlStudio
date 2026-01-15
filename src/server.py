import os
import sys
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global loop reference
server_loop = None

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

@app.get("/api/status")
async def get_status():
    return {"status": "ok"}

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

        # Execute (Channel 1 hardcoded for UI triggers, or add it to payload)
        # We rely on action_handler.current_profile or legacy scanning
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
