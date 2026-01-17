# Documentation Technique (AGENTS) - Architecture V3 (Hybride)

**ATTENTION :** Ce projet utilise une architecture **Hybride Complexe**. Il mélange un serveur Web asynchrone et une interface graphique native synchrone.

## 🏗️ Architecture "Orchestrée"

L'application ne se lance pas simplement. Le fichier `src/main.py` est un orchestrateur critique.

### 1. Gestion des Threads (`src/main.py`)
*   **Main Thread (Bloquant) :** Réservé EXCLUSIVEMENT à `customtkinter` (GUI Native). Tkinter DOIT tourner dans le thread principal.
*   **Background Thread 1 :** Serveur Uvicorn (FastAPI).
*   **Background Thread 2 :** Services Backend (MidiEngine, ContextMonitor).

### 2. Flux de Données (Synchronisation)
Quand un événement survient (ex: Changement de fenêtre active) :
1.  **`ContextMonitor`** détecte le changement.
2.  Il met à jour le **`ActionHandler`** (État global).
3.  Il notifie le **Web** via `broadcast_sync` (WebSocket JSON).
4.  Il notifie la **Remote** via `remote_gui.after(...)` (Thread-safe call).

### 3. Composants Clés
*   **`src/server.py` :** API REST (`/api/setlist`, `/api/trigger`) et WebSocket (`/ws`). Gère la persistance JSON.
*   **`web/app.js` :** Cerveau du Frontend. Gère le routage "WEB vs WIN".
    *   *ExecuteWebAction* : Pilote l'IFrame YouTube.
    *   *TriggerAction* : Appelle l'API Python pour les keystrokes.
*   **`src/remote_gui.py` :** Interface Overlay. Ne contient pas de logique métier, juste de l'affichage et des callbacks.

## ⚠️ Règles de Développement V3

1.  **Orchestration :** Ne JAMAIS lancer Uvicorn dans le thread principal. Cela gèlerait l'interface native.
2.  **Imports :** Utilisez toujours le bloc `try/except ImportError` pour gérer la dualité "Mode Dev (dossier `src/`)" vs "Mode Frozen (PyInstaller flat)".
3.  **Ressources Web :** Toujours utiliser `sys._MEIPASS` pour localiser le dossier `web/` en production.
4.  **CORS & IFrame :** Le contrôle JS des Iframes génériques (non-YouTube) est impossible. Forcez toujours le mode "WIN" (Clavier) pour ces cas-là.
