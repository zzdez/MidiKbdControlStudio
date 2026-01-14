# Documentation Technique (AGENTS) - Architecture V2 (Web)

**ATTENTION :** Ce projet a migré vers une architecture **Web Locale (FastAPI)**. Ne tentez JAMAIS d'importer `tkinter` ou `customtkinter`.

## 🏗️ Architecture "Local Server"
### 1. Backend (Python / FastAPI)
*   **`main.py` :** Point d'entrée. Lance le serveur Uvicorn et ouvre le navigateur.
*   **`server.py` :** Application FastAPI. Sert les fichiers statiques (`web/`) et gère le WebSocket (`/ws`).
*   **`config_manager.py` :** Gère la config (`.env` > `config.json`).
*   **Legacy conservé :** `midi_engine.py` (Connexion physique) et `action_handler.py` (Actions OS).

### 2. Frontend (HTML / JS)
Le dossier `web/` contient l'interface utilisateur (HTML5, CSS3, Vanilla JS).

## ⚠️ Règles de Développement
1.  **Chemins (Frozen vs Dev) :** Pour servir le dossier `web/`, utilisez toujours `sys._MEIPASS` si `sys.frozen` est True.
2.  **Configuration :** Ne jamais commiter de secrets. Utilisez `config_manager`.
3.  **Multimédia :** YouTube et Audio sont gérés par le Frontend (JS), pas par Python.
