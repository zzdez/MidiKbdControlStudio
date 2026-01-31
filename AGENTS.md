# Documentation Technique (AGENTS) - Architecture V3 (Hybride & Service Mode)

**ATTENTION :** Ce projet utilise une architecture **Hybride Complexe**. Il mélange un serveur Web asynchrone, une interface graphique native synchrone, et fonctionne comme un **Service d'arrière-plan**.

## 🏗️ Architecture "Orchestrée"

L'application ne se lance pas simplement. Le fichier `src/main.py` est un orchestrateur critique.

### 1. Mode Service (Startup)
*   **Démarrage Silencieux :** Au lancement, `src/main.py` initialise l'application native (`AirstepApp`) mais la cache immédiatement (`withdraw`).
*   **System Tray :** L'application réside dans la zone de notification. L'icône est gérée par `pystray` dans `src/gui.py`.
*   **Pas de Navigateur Auto :** Le navigateur Web ne s'ouvre plus automatiquement pour respecter ce mode discret.

### 2. Gestion des Threads (`src/main.py`)
*   **Main Thread (Bloquant) :** Réservé EXCLUSIVEMENT à `customtkinter` (GUI Native - `AirstepApp` & `RemoteControl`). Tkinter DOIT tourner dans le thread principal (`mainloop`).
*   **Background Thread 1 :** Serveur Uvicorn (FastAPI).
*   **Background Thread 2 :** Services Backend (MidiEngine, ContextMonitor).

### 3. Flux de Données & Câblage
*   **MIDI Bridge :** `src/main.py` intercepte les messages MIDI bruts.
    *   -> Envoi au Web via WebSocket (Broadcast).
    *   -> Envoi à l'App Native via `app.after()` (Thread-safe) pour les LEDs/Feedback.
    *   -> Exécution de l'Action (Keystroke) via `ActionHandler`.
*   **Settings Bridge :** L'API `/api/open_settings` déclenche un callback injecté dans `app.state`, qui exécute `app.deiconify()` sur le thread principal.

### 4. Composants Clés
*   **`src/gui.py` :** L'application native principale (`AirstepApp`). Gère les fenêtres de configuration, le Tray Icon, et l'instanciation de la Remote. Utilise `get_resource_path` pour les assets (`icon.png`).
*   **`src/remote_gui.py` :** La télécommande flottante. Contient désormais un **Drawer (Tiroir)** vers le bas pour afficher la Bibliothèque. Gère la minimisation en barre des tâches.
*   **`src/library_manager.py` :** Gère la structure hiérarchique (`library.json`) et le "Smart Launcher" (import automatique des apps depuis les profils).
*   **`src/server.py` :** API REST (`/api/library`, `/api/setlist`) et WebSocket.
*   **`web/app.js` :** Frontend. Gère désormais le contrôle direct YouTube via MIDI (CC 50-59) et l'affichage de la Setlist groupée par catégories. Intègre désormais une **Modale Avancée** pour la recherche et l'édition.

### 5. Nouveautés Setlist V3 (Modal & Smart Search)
*   **Recherche API :** Route `GET /api/youtube/search` qui détecte intelligemment les URLs directes (pour fetching précis) ou les mots-clés.
*   **Données Riches :** Le backend stocke désormais `genre`, `artist`, `channel`, `youtube_description` et `user_notes`.
*   **Streaming Local :** Route `GET /api/stream` pour servir des fichiers locaux. Le frontend utilise un lecteur HTML5 standard pour ces fichiers.
*   **ActionHandler Hardening :** Utilisation de `ctypes.keybd_event` (Win32 API) pour simuler les touches Espace/Flèches de manière bas-niveau, contournant les protections de focus des applis Electron (Moises).
*   **Sécurité Frontend :** Le tri des tableaux utilise une propriété persistante `originalIndex` pour garantir la compatibilité item/action.

## ⚠️ Règles de Développement V3

1.  **Thread Safety :** Toute interaction depuis le serveur ou le MIDI vers la GUI doit utiliser `app.after(0, lambda: ...)`.
2.  **Imports :** Utilisez toujours le bloc `try/except ImportError` pour gérer la dualité "Mode Dev (dossier `src/`)" vs "Mode Frozen (PyInstaller flat)".
3.  **Ressources :** Toujours utiliser `sys._MEIPASS` (via `get_resource_path` dans `gui.py`) pour localiser les icônes et le dossier `web/` en production.
4.  **Contexte :** `ContextMonitor` ignore les processus internes (`python.exe`, `Airstep...`) pour éviter les boucles de détection (Ghost Profiles).


### 7. Évolution V4 : Gestion Avancée des Fichiers Locaux & UI
*   **Auto-Tagging (iTunes API) :**
    *   Remplacement de MusicBrainz par l'API iTunes Search (plus efficace pour la musique commerciale).
    *   **Nettoyage Regex** : Prétraitement des noms de fichiers pour améliorer la pertinence.
    *   **Cover Art** : Téléchargement automatique des pochettes HD (600x600) via URL.
*   **Physical Tagging (Backend - Mutagen Hardening) :**
    *   **MP3 :** Architecture Split (Texte=`EasyID3` / Image=`ID3+APIC`) pour garantir la compatibilité Windows/VLC.
    *   **M4A / MP4 :** Architecture Split (Texte=`EasyMP4` / Image=`MP4+covr`) pour contourner les limitations des atomes iTunes.
    *   **OGG / FLAC :** Support des blocs images `Base64` et métadonnées Vorbis.
*   **UI Modernization (Phosphor Icons) :**
    *   Remplacement total des émojis par la librairie vectorielle **Phosphor Icons**.
    *   Intégration via CDN, icônes typées pour Audio (`ph-music-notes`) et Vidéo (`ph-film-strip`).

### 8. Évolution V3.5 : Profils Web Universels & Smart Embed
*   **Détection Universelle (`ContextMonitor` Hardening) :**
    *   Problème résolu : "Airstep Studio V3" était un titre trop générique qui confondait le moniteur de contexte.
    *   **Solution Frontend :** Injection dynamique du nom du profil cible dans `document.title` (`Airstep Studio - [Nom du Profil]`).
    *   **Résultat :** `ContextMonitor` détecte nativement "Web Dailymotion", "Web Vimeo", etc., sans aucune logique hardcodée côté backend.
*   **Smart Embed Logic (`app.js`) :**
    *   Conversion automatique à la volée des URLs "Watch" (ex: `dailymotion.com/video/x...`) en URLs "Embed" (`/embed/video/...`) pour contourner les restrictions `X-Frame-Options`.
    *   Support natif transparent pour Dailymotion et Vimeo ajoutés à la volée.

### 9. Évolution V3.6 : Moteur Media Unifié & Clavier
*   **Unified Speed Control Engine (`app.js`) :**
    *   **Backend MediaElement :** Migration de WaveSurfer vers `backend: 'MediaElement'` pour garantir le **Time Stretching natif sans Chipmunk Effect** (Pitch Lock).
    *   **Granularité Fine :** Implémentation d'une logique de pas de 0.05x pour la vitesse (Audio & Vidéo).
*   **Native Keyboard Bridge :**
    *   Support d'écouteurs d'événements `keydown` pour l'interface Web, permettant un mapping direct Clavier -> Action pour les profils AIRSTEP (plus besoin de WebSocket pour les actions simples).
    *   Shortcuts : `Space` (Play/Pause), `ArrowLeft/Right` (Seek +/- 5s), `ArrowUp/Down` (Speed +/- 0.05x), `0` (Restart).
