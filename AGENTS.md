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
    *   Shortcuts : `Space/K` (Play/Pause), `ArrowLeft/Right` (Seek +/- 5s), `ArrowUp/Down` (Speed +/- 0.05x), `Shift+Up/Down` (Pitch +/-), `Shift+Left/Right` (Loop Prev/Next), `R` (Loop Toggle), `0` (Restart).

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

### 14. Évolution V8 : Support Multi-Sous-titres & UI Dynamique
*   **Moteur de Sous-titres Locaux (`server.py` & `app.js`) :**
    *   **Scanner Auto (`glob`) :** Détection automatique des fichiers `.srt` et `.vtt` associés à la vidéo via API REST (`/api/local/subs_list/{index}`).
    *   **Track Switching "Live" :** Possibilité de changer de langue à la volée pendant la lecture vidéo sans rechargement, avec synchronisation immédiate en mémoire.
*   **UI/UX Premium (`app.js`) :**
    *   Création d'une modale universelle (`#modal-subtitle-tracks`) pour remplacer les menus déroulants (`<select>`) natifs peu esthétiques.
    *   **Live Preview :** L'ajustement de la hauteur (`posY`) des sous-titres depuis l'éditeur modifie la position en direct sur le lecteur en arrière-plan.
    *   Gestion intelligente du curseur `[CC]` : feedback couleur (Bleu/Gris) synchronisé pour indiquer précisément l'activation courante via `updateCCIconState`.

### 15. Évolution V9 : Audio Master Plan & Éditeur de Profils Natif
*   **Moteur OS & Context Switch (`profile_manager.py`) :**
    *   **Intégration `pycaw` :** Lors d'un changement de profil (soit par clic, soit par appel contextuel via le moniteur), le backend Windows modifie instantanément le volume maître du système si le `target_volume` (0-100) est défini.
    *   **Seamless Switching :** Permet de passer de Reaper (100% volume OS) à YouTube (30%) sans endommager l'audition.
*   **Contrôle Audio Fin (`app.js` & `server.py`) :**
    *   **Volume Tracking :** Chaque Média Web (Youtube Iframe, Local Audio WaveSurfer, Local HTML5 Video) intègre son propre dictionnaire de sauvegarde live de la valeur `volume` (0..1).
    *   **Save Auto :** Toute modification de curseur sur l'interface graphique renvoie avec un throttle une validation au backend pour rendre le volume persistant, afin d'éliminer la nécessité d'une modale de sauvegarde dédiée.
*   **UI Modifications :**
    *   **Modales Verticales :** Les Sliders dans les modales `index.html` ont été stylisés avec des `[type=range]` verticaux accompagnés d'un Label Pourcentage mis à jour par JavaScript.
    *   **`gui.py` Profil Editor :** Fin des limitations d'interface, la version Native possède un `ProfileEditorDialog` qui lit/sauvegarde le profil ET supprime dynamiquement le nom `.json` précédent du disque lors d'un renommage en direct.

### 16. Évolution V10 : Système de Bouclage A-B Avancé & UX Séquentielle
*   **A-B Loop Engine (`app.js`) :**
    *   **Backend Storage :** Routes `/api/local/loops/{index}` et modification des payloads pour inclure un dictionnaire dynamique de "Boucles Sauvegardées" par morceau (avec nommage).
    *   **Render UI (Regions) :** Fin des listes verticales. Les boucles sont maintenant dessinées directement sous forme de "Dom elements" (`.saved-loop-region`) persistants en gris sur la Timeline Vidéo (`updateTimelineUI` et `renderLoopsUI`).
    *   **Textes Persistants :** Rendu des noms de boucles en sous-titre directement attachés aux régions pour cartographier visuellement la structure d'un morceau.
    *   **Chapitres Indépendants :** Reprise du CSS des `.timeline-marker` (rouge corail) pour éviter tout conflit visuel avec les bordures de boucles.
*   **3-State Toggle Engine :**
    *   **State Machine (`toggleLoopState`) :** Le bouton d'activation boucle passe intelligemment par 3 états : 1. OFF -> 2. SINGLE (Répéter active) -> 3. SEQUENTIAL (Passer à la boucle suivante).
    *   **Auto-Start Intelligence :** Si un utilisateur active la boucle alors qu'aucune boucle manuelle n'est tracée, l'Engine "snap" automatiquement à la boucle sauvegardée qui survole le curseur temporel, OU démarre la toute première boucle du morceau.
    *   **Navigation & Piégeage (`checkLoop`) :** Le piège de progression prend en compte la globale `isSequentialLoop`. Au lieu d'un `seekPlayerTo(loopA)`, il lance un `playSavedLoop` sur l'index de la boucle suivante `+1 % length`.

### 17. Évolution V11 : Parité YouTube & Mémoire Subtitles (Drag & Drop)
*   **A-B Loop pour YouTube (`app.js`) :**
    *   **Timeline Unifiée :** Les vidéos YouTube affichent désormais leur propre `video-timeline-container` avec un rendu complet des régions de boucles sauvegardées et des marqueurs de temps, assurant une parité parfaite avec le lecteur local.
    *   **Backend Sync Fix :** La fonction `saveLoopsToBackend()` utilise désormais `currentPlayingIndex` mappé depuis `track.originalIndex` lors du lecteur YouTube, garantissant que les boucles YouTube survivent aux rafraîchissements de page.
*   **Mémoire Sous-titres Globale (`localStorage`) :**
    *   **UX Drag & Drop :** L'événement `mouseup` du conteneur de sous-titres (`#subtitle-overlay`) enregistre désormais un pourcentage d'offset Y (`lastSubtitlePosY`) dans le navigateur.
    *   **Héritage Dynamique :** Lors du chargement d'une nouvelle vidéo locale, si aucune position n'est assignée dans le fichier JSON (`subtitle_pos_y`), le lecteur injecte par défaut la hauteur préférée globale à la place de la valeur statique de `80%`.
*   **Isolation des Lecteurs :**
    *   **Flush State :** La fonction `playTrack()` a été durcie. Le moteur natif iframe (YouTube CC) et le moteur de sous-titres Airstep.js sont strictement isolés (flush des tableaux `currentSubtitles` et masquage du bouton UI) pour prévenir les « fuites » de texte d'une vidéo locale vers un stream.

### 18. Évolution V12 : Persistance Absolue & MIDI Smart Matching
*   **Path Persistence (`utils.py`) :**
    *   **Dossier Agnostique :** Centralisation via `get_app_dir()` pour garantir que le dossier de données (`config.json`, `profiles/`, `devices/`, `library.json`, etc.) réside **toujours** à côté de l'exécutable PyInstaller (`sys.executable`), même si l'application est lancée depuis un raccourci bureau qui modifie le CWD (Current Working Directory).
    *   **Sécurité des Données :** Suppression stricte des accès par chemins relatifs dans tous les managers (`config_manager.py`, `profile_manager.py`, `device_manager.py`, `library_manager.py`, `server.py`).
*   **Smart Matching MIDI Output (`midi_engine.py`) :**
    *   **Résolution Dynamique :** Le moteur est désormais capable de se reconnecter automatiquement à un port de sortie renommé par Windows MM. Si "Midi 1" est déconnecté puis redétecté comme "Midi 2", le moteur retire le suffixe numérique, matche la racine "Midi", se connecte, et **met à jour la configuration silencieusement** pour préserver la case cochée dans GUI.
    *   **Ghost Config Fix :** La mémoire tampon de l'interface `self.settings` ne subit plus de dérive (drift) lors des appels `save_all`. Les ports d'E/S actifs sont strictement synchronisés dynamiquement avant chaque sauvegarde, évitant l'écrasement intempestif par un `config.json` vide.
*   **Mode "Light" Agnostique (`main.py`) :**
    *   Le système de `.flag` (Désactivation Web/Moniteur de Focus) est désormais robuste et fonctionne n'importe où grâce à l'implémentation de `get_app_dir()`. De plus, le `.env` de sécurité YouTube obsolète a été banni de l'UI.

### 19. Évolution V13 : Lecteur Audio Multipistes (Stems)
*   **Moteur Multitrack (`app.js` & `wavesurfer-multitrack.js`) :**
    *   **DAW Mode :** Support de dossiers contenant des fichiers audio multiples (stems) pour une lecture WebAudio synchronisée. Chaque piste possède son propre contrôle de Volume, Panoramique (via StereoPannerNode), et états Mute/Solo.
    *   **UI Ultra-Compacte :** L'interface a été optimisée au millimètre (sliders ultra-fins, hauteur forcée à 70px) pour permettre l'affichage de 7 stems simultanés sans scroll vertical.
    *   **Features Avancées :** Renommage dynamique des stems (double-clic) et réordonnancement manuel (déplacement des pistes haut/bas). Ajout d'un "Mode Théâtre" dédié pour étendre la vue des formes d'onde.
*   **Intégration Backend (`library_manager.py` & `server.py`) :**
    *   **Smart Detection :** Détection automatique des dossiers contenant de multiples fichiers audio (`is_multitrack = True`) lors du scan de la bibliothèque.
    *   **Zero-Latency Preload :** Pour garantir une synchronisation parfaite des pistes (zéro décalage), les stems sont pré-téléchargés en mémoire vive (Blob) via `fetch` asynchrone avant l'initialisation du lecteur HTML5. Les `peaks` JSON des waveforms sont générés côté serveur en Python pour soulager le CPU du navigateur.
### 20. Évolution V14 : Standardisation UI & Centrage Précis
*   **Standardisation des Commandes (55px) :**
    *   **Unified Height :** Toutes les barres de contrôle (`.media-controls-bar`) sont désormais fixées à une hauteur de **55px** avec un padding interne de `0 20px`.
    *   **Nettoyage Layout :** Suppression de l'élément `#pedalboard-container` en bas de page pour épurer l'interface et éviter les redirections visuelles inutiles.
*   **Centrage & Timer Intégré (`app.js` & `style.css`) :**
    *   **Flex-Centering :** Utilisation de `justify-content: center` pour les boutons de contrôle, garantissant une symétrie parfaite sur tous les players.
    *   **Absolute Timer :** Pour éviter que le compteur de temps (Elapsed/Remaining) ne décale les boutons, celui-ci est désormais en `position: absolute; left: 20px;`. Cela permet de l'épingler à gauche tout en laissant les boutons se centrer par rapport à la largeur totale de la barre.
*   **Fix Multipistes (14px Offset) :**
    *   **Standardisation des Spacers :** Alignement du `mt-spacer` (200px) et réduction de son `padding-right` à **10px** (au lieu de 15px) pour correspondre exactement au padding des conteneurs de formes d'onde.
    *   **Box-Sizing :** Application systématique de `box-sizing: border-box` sur les lignes du multipiste pour éviter les débordements de pixels calculés.
*   **Roadmap Stems :**
    *   Validation du passage futur à `demucs-rs` (Rust) pour la séparation locale, visant une réduction de latence par rapport au moteur Python actuel.
