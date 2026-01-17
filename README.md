# AirstepStudio (Hybrid V3 Edition)

**AirstepStudio** est la station de contrôle ultime pour musiciens, combinant le meilleur de deux mondes :
1.  **Dashboard Web ("Le Cockpit") :** Une interface riche pour gérer vos médias (YouTube, Setlist) et vos configurations.
2.  **Overlay Natif ("La Remote") :** Une télécommande flottante ultra-compacte pour garder le contrôle sur vos logiciels (DAW) sans quitter l'écran des yeux.

## 🚀 Fonctionnalités Clés

*   **Setlist Intelligente :**
    *   Détection automatique des liens YouTube (Mode Intégré) vs Sites Externes (Songsterr, Tabs).
    *   Récupération automatique des titres via l'API YouTube.
*   **Contrôle Hybride :**
    *   **Mode WEB :** Pilotez le lecteur YouTube (Play, Pause, Vitesse, Seek) directement avec vos pédales.
    *   **Mode WINDOWS :** Simulez des raccourcis clavier pour contrôler vos logiciels ou sites externes.
*   **Apps Launcher :** Lancez vos outils (Reaper, Neural DSP, etc.) directement depuis le Dashboard.
*   **Overlay Persistant :** Une fenêtre "Always-on-Top" qui affiche l'état de votre pédalier, pliable en une simple "pillule" discrète.

## 🛠️ Installation (Développeurs)

1.  **Pré-requis :** Python 3.10+
2.  **Installation des dépendances :**
    `pip install -r requirements.txt`
    *(Inclut désormais `customtkinter`, `fastapi`, `uvicorn`, `requests`, `bleak`...)*
3.  **Lancement :**
    `python src/main.py`

## 🏗️ Architecture Hybride

*   **Backend (Python) :**
    *   **FastAPI :** Sert le Dashboard et l'API REST/WebSocket.
    *   **Moteur MIDI :** Gère la connexion Bluetooth/USB avec l'AIRSTEP.
    *   **Orchestrateur (`main.py`) :** Synchronise le serveur Web (Background) et l'interface Native (Main Thread).
*   **Frontend (Web) :**
    *   HTML5/CSS3/JS Vanilla.
    *   Communication temps réel via WebSocket.
*   **GUI Native (CustomTkinter) :**
    *   Interface légère pour le retour visuel immédiat.

## 📦 Compilation

Lancez `build.bat` pour générer l'exécutable portable unique qui contient tout le système.
