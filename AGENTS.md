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

### 3. Fonctionnalités Web (Airstep Interface)
- **Interface** : HTML5 / CSS3 (Style sombre, "Cockpit").
- **Players** :
    - **YouTube** : Iframe API.
    - **Audio Local** : WaveSurfer.js (Waveform, Spectrogramme).
    - **Vidéo Local** : HTML5 Video Element.
- **DSP / Audio Processing** :
    - **Pitch Shifting** : Implémentation via `Jungle` (Time-Domain Pitch Shifter) utilisant `AudioContext`.
    - **Signal Flow** : `MediaElementSource` -> `PitchShifter (Delay + Crossfade)` -> `Destination`.
    - **Précision** : Pas de 0.1 demi-tons, plage +/- 6.
    - **Sync Volume** : Gain de sortie synchronisé avec le volume du média source pour éviter les sauts de niveau.
- **Communication** : WebSocket (Port 8000) pour feedback bi-directionnel (Python <-> JS).

### 9. Évolution V3.6 : Moteur Media Unifié & Clavier
*   **Unified Speed Control Engine (`app.js`) :**
    *   **Backend MediaElement :** Migration de WaveSurfer vers `backend: 'MediaElement'` pour garantir le **Time Stretching natif sans Chipmunk Effect** (Pitch Lock).
    *   **Granularité Fine :** Implémentation d'une logique de pas de 0.05x pour la vitesse (Audio & Vidéo).
*   **Native Keyboard Bridge :**
    *   Support d'écouteurs d'événements `keydown` pour l'interface Web, permettant un mapping direct Clavier -> Action pour les profils AIRSTEP (plus besoin de WebSocket pour les actions simples).
    *   Shortcuts : `Space` (Play/Pause), `ArrowLeft/Right` (Seek +/- 5s), `ArrowUp/Down` (Speed +/- 0.05x), `0` (Restart).

### 10. Évolution V4 : Chapitrage & Modernisation UI
*   **Support Chapitres YouTube (`download_service.py`) :**
    *   **Extraction :** `yt-dlp` configuré pour extraire les métadonnées de chapitres lors du téléchargement.
    *   **Stockage :** Sauvegarde dans `local_lib.json`.
    *   **UI Frontend (`app.js`) :**
        *   **Timeline Interactive :** Marqueurs visuels sur la barre de progression vidéo.
        *   **Tooltip :** Affichage du titre du chapitre au survol (Zone invisible 10px pour UX).
        *   **Navigation :** Boutons dédiés `|◀` et `▶|` pour sauter de chapitre.
*   **Modernisation UI (Phosphor Icons) :**
    *   **Harmonisation :** Remplacement de tous les emojis par des icônes vectorielles Phosphor.
    *   **Play/Pause Dynamique :** Toggle d'icône instantané sur événement `play/pause`.
    *   **Speed Pill :** Nouveau contrôle de vitesse compact et précis.


### 11. Évolution V5 : Connection Intelligence & Modernisation Remote
*   **Connection Intelligence (`midi_engine.py`) :**
    *   **BLE Fallback :** Algorithme de détection agnostique. Si les identifiants MIDI standards échouent, le moteur scanne tous les services et se connecte à la première caractéristique "Notify" disponible.
    *   **Mode HID/Typing :** Support officiel du mode "Clavier" de l'AIRSTEP. Si le canal MIDI est bloqué par Windows (exclusivité), l'application bascule en mode "écoute seule" (LED Verte) pour garantir que les indicateurs visuels fonctionnent toujours via les hooks clavier.
    *   **Status Monitor :** Boucle de surveillance dédiée dans `gui.py` pour garantir que l'état affiché (LED/Texte) est toujours synchronisé avec la réalité du hardware (Détection débranchement USB).
*   **Remote Control Refactoring (`remote_gui.py`) :**
    *   **Singleton Pattern :** Architecture robuste empêchant les instances multiples de la télécommande.
    *   **Smart Close :** La fermeture de la télécommande ne rouvre plus la fenêtre principale (Workflow "Tray-First").
    *   **Compact UI :** Redesign complet pour réduire l'empreinte écran (-40% hauteur), polices ajustées, et suppression du tiroir "Bibliothèque" (déporté sur le Web).
*   **Fix Critique Feedback Visuel :**
    *   Correction de la signature du callback `on_data_received` (`cc, value, channel`) qui empêchait le clignotement des boutons lors des appuis physiques.

### 12. Évolution V6 : Multi-Output MIDI & Robustesse
*   **Architecture Multi-Output (`midi_engine.py`) :**
    *   **Router 1-to-N :** Le `MidiManager` gère désormais une liste active de ports de sortie. Un message entrant (AIRSTEP) est dupliqué vers toutes les sorties cochées (Fender + loopMIDI).
    *   **Persistance Robuste :** Les ports configurés mais absents (ex: synthè éteint) sont marqués "Absent" (Orange) dans l'UI mais conservés en mémoire.
    *   **Fail-Safe :** Chaque envoi est isolé dans un try/except. Si un port plante (buffer full), les autres continuent de fonctionner.
*   **Intégration loopMIDI :**
    *   Documentation explicite sur la nécessité de `loopMIDI` pour contourner l'exclusivité des drivers MIDI Windows.
    *   Logs détaillés : `[MIDI OUT] Tentative d'envoi vers ['loopMIDI Port', 'Fender']` pour le débogage.
*   **Polishing (Réactivité & Stabilité) :**
    *   **Debounce (`context_monitor.py`) :** Le basculement vers le profil "Global / Desktop" nécessite désormais une confirmation de stabilité (2 cycles / ~1s) pour éviter le "flickering" lors des changements de focus rapides.
    *   **Input Priming (`action_handler.py`) :** Injection d'une micro-impulsion "Shift" (Win32 API) lors de l'activation d'un profil pour forcer Windows à réveiller le hook d'input immédiatement. Élimine la latence du "premier appui".
    *   **Direct Sync :** L'`ActionHandler` est mis à jour directement depuis le thread de monitoring contextuel pour une réactivité <100ms.

### 13. Évolution V7 : MidiKbd Control Studio (Universel)
*   **Refonte "Device Agnostic" (`midi_engine.py`) :**
    *   Suppression des filtres de noms ("Airstep only").
    *   **Architecture Provider :** `MidoProvider` (USB) et `BleakProvider` (BLE) unifiés sous une interface `MidiProvider`.
    *   **Scanner Indépendant (`midi_scanner.py`) :** Processus séparé (Multiprocessing) pour le scan USB (0.5s intervalle) afin d'éviter de geler l'interface graphique si le driver Windows MM bloque.
*   **Discovery & Persistance :**
    *   **Dynamic Device Definition :** Si un appareil inconnu est trouvé (ex: "Boss FS-1-WL"), un fichier JSON de définition est créé à la volée dans `devices/`.
    *   **Smart Rescan :** Logique "Force Rescan" qui permet de scanner les nouveaux périphériques même si une connexion est déjà active (Bypass temporaire du flag `is_connected`).
    *   **UX Sync :** La sélection du périphérique dans l'interface est intelligemment préservée après un rafraîchissement.
*   **Logging :**
    *   Logs détaillés sur le scanner (`debug.log` séparé pour le sous-processus) et le provider actif.
