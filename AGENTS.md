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
    *   **UI Premium :** Interface modernisée avec **Phosphor Icons** pour une lisibilité parfaite. Surlignage intelligent et défilement automatique vers le morceau actif.

### 7.2 Évolution V7.2 : Moteur de Recherche Fuzzy
*   **Algorithme Levenshtein :** Implémentation d'une recherche floue dans `library_manager.py` pour tolérer les fautes de frappe dans les noms de morceaux.
*   **Indexation In-Memory :** Création d'un index inversé au démarrage pour des recherches instantanées (< 10ms) sur des bibliothèques de +1000 titres.

### 7.3 Évolution V7.3 : Support MIDI SysEx
*   **Communication Étendue :** Support des messages System Exclusive (SysEx) pour la configuration avancée des pédaliers (ex: changement de mode de switch).
*   **Dump & Restore :** Possibilité de sauvegarder/restaurer la configuration complète d'un pédalier via un fichier `.syx`.

### 7.4 Évolution V7.4 : Mode "Performance" (Low Latency)
*   **Priorité Processus :** Le backend Windows passe en mode `HIGH_PRIORITY_CLASS` lors de l'activation d'un profil de jeu ou de musique.
*   **Buffer Audio :** Réduction du buffer de lecture WebAudio à 128 samples pour minimiser la latence de monitoring.

### 7.5 Évolution V7.5 : Système de Logs Distribués
*   **Centralisation :** Tous les logs (GUI, Server, MIDI) sont désormais envoyés vers un fichier `debug.log` unique avec des tags de niveau (INFO, WARN, ERROR).
*   **Rotation :** Mise en place d'une rotation automatique des logs (max 5MB) pour éviter la saturation disque.

### 7.6 Évolution V7.6 : Support Multi-Langues (i18n)
*   **Internationalisation :** Extraction de toutes les chaînes de caractères de l'UI vers des fichiers JSON (`locales/fr.json`, `locales/en.json`).
*   **Détection Auto :** Basculement automatique de la langue selon la locale système de l'utilisateur.

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

### 20. Évolution V14 : Système Sidecar JSON Universel & Multitrack V2
*   **Persistance Sidecar (`metadata_service.py`) :**
    *   **Architecture "Sidecar-First"** : Pour les fichiers locaux (Audio, Vidéo, Multipiste), le backend cherche désormais un fichier `.json` correspondant (ex: `song.mp3.json` ou `folder.multitrack.json`).
    *   **Métadonnées Étendues** : Stockage persistant de `bpm`, `key`, `original_pitch` et `target_pitch` directement à côté du média, garantissant l'intégrité des données même après un scan de bibliothèque.
*   **Modale Multipiste Avancée (`index.html` & `app.js`) :**
    *   **UI Grid Harmonisée** : Refonte de la modale multipiste pour intégrer les nouveaux champs de métadonnées et un affichage du poster optimisé.
    *   **Gestion des Sliders** : Utilisation de `writing-mode: vertical-lr` pour les sliders de volume et position de sous-titres, avec feedback en pourcentage (%) temps réel.

### 21. Évolution V14 : Header Cockpit V14 & Interconnexion
*   **Structure à 3 Colonnes (Horizontal)** :
    - **Col 1 (Logo/Statut)** : Statut de connexion et logo.
    - **Col 2 (Media Cover)** : Affichage de la pochette en **80px pleine hauteur**.
    - **Col 3 (Info/Links)** : Colonne centrale à deux lignes :
        - Ligne 1 : Titre, BPM, Gamme/Badge.
        - Ligne 2 : Icônes d'interconnexion (Songsterr, Spotify, etc.).
*   **Moteur d'Affichage Dynamique** : Appel systématique à `updateInterconnectionUI` lors de l'initialisation des médias (y compris multipistes) pour peupler la deuxième ligne.

### 22. Évolution V15 : Persistance Sidecar Hardening (Merge Logic)
*   **Sidecar Merge (`metadata_service.py`)** :
    - Passage d'un mode "Overwrite" à un mode "Merge" pour `airstep_meta.json`.
    - Le service charge désormais le JSON existant avant de le mettre à jour avec les nouveaux champs (Titre, BPM, Gamme, `linked_ids`).
*   **Stabilisation API (`server.py`)** :
    - Correction de la propagation du champ `linked_ids` dans `update_local_file` (`PUT /api/local/{index}`).
*   **Fallback d'Indexation (`app.js`)** :
    - La fonction `getLinkedItem` intègre désormais un fallback automatique vers l'index tableau si `originalIndex` est manquant ou désynchronisé, garantissant l'affichage des icônes d'interconnexion.
Évolution V15 : Harmonisation UI YouTube & Notes Unifiées
*   **Refonte Modale YouTube (`media-modal`) :**
    *   **Compactage Global** : Application de la classe `.edit-form` pour forcer une hauteur de champ de 22px et une police de 11px, assurant une parité visuelle stricte avec les modales locales.
    *   **Zone Titre Sous-Poster** : Déplacement du titre sous l'image pour un meilleur équilibre visuel et ajout du bouton "Notes & Desc" avec `flex-shrink: 0` pour éviter tout chevauchement.
    *   **Optimisation Hauteur** : Réduction agressive des marges internes du `dl-options-container` (cible < 187px) pour garantir une expérience sans scroll vertical lors du déploiement des options de téléchargement.
*   **Système de Notes Unifiées :**
    *   **Modale `#modal-notes-desc`** : Création d'une interface d'édition plein écran (fond sombre) fusionnant la description YouTube et les notes utilisateur en un seul bloc éditable et persistant.
### 22. Évolution V16 : Métadonnées Étendues & Robustesse API
*   **Optimisation UI (Single-Line Metadata) :**
    *   **Consolidation** : Regroupement horizontal des 5 champs techniques (BPM, Tonalité Orig., Tonalité Média, Pitch Orig., Pitch Média) sur une seule ligne dans toutes les modales.
    *   **Abréviations Intelligentes** : Utilisation de labels compacts ("T. Orig.", "Orig. Key") et de liens externes abrégés ("GetSongBPM.com") pour garantir une lisibilité sans scroll.
*   **Support "Tonalité Média" (Media Key) :**
    *   **Persistance Sidecar** : Extension du schéma sidecar JSON pour inclure `media_key`, permettant de différencier la tonalité originale de la tonalité modifiée par le lecteur.

### 23. Évolution V24 : Fretboard CAGED & Virtual Nut Paradigm (Unification)
Le système d'entraînement du manche (`fretboard.js`) a subi une refonte mathématique et pédagogique fondamentale pour synchroniser l'affichage Visuel et la Génération d'Exercices :
*   **Ancrage Absolu (Root Anchor) :** L'attribution d'une boîte à l'Octave 1 (`[0, 12]`) ou Octave 2 (`[12, 24]`) n'utilise plus les frontières de la boîte, mais uniquement la position de sa **Tonique sur la corde de Mi**. Cela permet d'assigner proprement une position à une octave même si la forme s'étale de 11 à 15 (Root = 12 -> Octave 2 gagnante).
*   **Asymétrie Physique du Manche :**
    *   **Sillet (Début) :** Une boîte allant de `-1` à `3` est **validée**. Le système filtre géométriquement les notes négatives, transformant l'ensemble en l'accord ouvert parfait `[0, 3]`. Le sillet agit comme un doigt virtuel.
    *   **Vide (Fin) :** Une boîte allant de `22` à `26` sur une guitare 24 cases est **invalidée et détruite**. Toute boîte dont le `absEnd > fretsCount` est mathématiquement injouable et supprimée de `globalValidBoxes`.
*   **Théorème du Sillet Virtuel (Virtual Nut) :** Pour forcer la démarcation stricte de 12 cases par octave tout en préservant l'intégrité des boîtes (ex: Pos 3 allant de 11 à 15 en Octave 2), la frette `12` opère comme un *Sillet Virtuel*. La fonction géométrique `isNoteInPosition` exécute un slicer absolu : toute note `< 12` en Octave 2 est atomisée. La Pos 3 s'affiche et se joue naturellement en `[12, 15]`, symétrie exacte de sa forme avec cordes à vide `[0, 3]`.
*   **Protection contre la Dérive Instrumentale :** Le calcul de géométrie force la base `E` comme ancre ("AnchorString") même si l'instrument est "Drop D", "Basse 5" ou "Guitare 7", empêchant un glissement accidentel des grilles CAGED sur les plages standard. En revanche, un accordage full-drop (Eb, D) provoque un glissement parfait de la matrice. l'œuvre et la tonalité réelle du fichier média (après Pitch Shifting éventuel).
    *   **Flux de Données** : Intégration complète dans `app.js` (Frontend), `server.py` (API REST) et `metadata_service.py` (Backend).
*   **Robustesse MusicAPI :**
    *   **Error Hardening** : Isolation stricte des appels API GetSongBPM/Key et Spotify via des blocs `try/except` globaux.
    *   **Timeouts de Sécurité** : Ajout de délais d'expiration (10s) pour éviter les blocages de threads lors de l'enrichissement automatique des métadonnées.
    *   **Fallback Silencieux** : Le système garantit le retour des résultats de recherche primaires (iTunes/YouTube) même en cas d'échec total des sources de données techniques.

### 23. Évolution V17 : Stabilisation & Harmonisation Visuelle Multitrack
*   **Architecture "Sync-First" (`app.js`) :**
    - Définition prioritaire de la fonction `syncAllMultitrackStates` dès l'initialisation du lecteur pour assurer une réactivité immédiate des contrôles (Mute/Solo/Volume).
    - Migration vers une sélection par classe CSS (`.btn-mute`, `.btn-solo`) au lieu des IDs, éliminant les conflits lors des rechargements asynchrones ou des réorganisations de pistes.
*   **Harmonisation Visuelle & "Pixel-Perfect" Tuning :**
    - **Bordures Dynamiques :** Unification des bordures horizontales (Haut/Bas) des en-têtes et des waveforms avec la couleur spécifique de chaque stem, injectée par le moteur JS.
    - **Alignement Rigoureux :** Ajustement de la hauteur des en-têtes à **73px** et ajout d'une marge de **1px** pour un alignement vertical parfait avec les ondes graphiques.
    - **Neutralisation du Curseur :** Changement de la couleur du curseur multitrack vers le blanc (`#fff`) pour éviter toute confusion visuelle au démarrage (ligne verticale violette "fantôme" à 0s).
- **Hardening interaction :** Isolation des événements `oncontextmenu` sur les waveforms pour garantir l'accès au menu de colorisation des stems partout dans la rangée.

### 24. Évolution V18 : Fiabilisation de l'État de Lecture (Autoplay/Autoreplay)
*   **Isolement UI de l'Éditeur d'Arrière-Plan :**
    *   **Prévention des Collisions :** La sauvegarde d'un item via une modale (ex: changer l'autoplay du Track B) vérifie désormais strictement si `window.currentPlayingIndex` correspond à l'item édité *avant* d'appliquer le `updatePlaybackOptionsUI`. Cela empêche l'UI du lecteur principal d'être écrasée visuellement par les réglages d'une autre piste.
    *   **Sécurisation des Variables Globales :** La fonction `syncPlaybackSettingsToModals` a été purgée de toute réaffectation des variables globales (`window.currentAutoreplay`), garantissant qu'elle ne sert plus qu'à pré-remplir les cases à cocher du DOM.
*   **Direct-to-Save depuis les Switches :**
    *   Les modifications effectuées depuis les interrupteurs (Autoplay/Autoreplay) des modales déclenchent désormais une mise à jour silencieuse immédiate (`saveItemQuiet` / `saveLocalItemQuiet`) vers le backend, éliminant le besoin de valider par le bouton "Sauvegarder".

### 25. Évolution V19 : Fretboard Interactif & Gammes (MVP)
*   **Architecture Frontend (`fretboard.js`) :**
    *   **Séparation des responsabilités :** Toute la logique musicale (calcul des intervalles de gamme, rendu du DOM à la volée, mapping des notes sur le manche) a été isolée dans un script dédié pour ne pas alourdir `app.js`.
    *   **Composant Flottant :** Le Fretboard utilise un système de Drag-and-Drop natif (via onmousedown/mousemove) appliqué à son header, évitant ainsi le blocage visuel de la balise `<dialog>`.
    *   **Responsive CSS :** Les cordes et les notes (15 cases) sont positionnées en pourcentage CSS absolu pour garantir une adaptation au resize futur.
*   **Intégration Backend (`metadata_service.py` & `server.py`) :**
    *   **Support du paramètre `scale` :** Injection stricte du nouveau champ `scale` (ex: "minor_pentatonic") dans tous les flux de sauvegarde locaux et distants.
    *   **Sidecar Fallback :** Le script de scan de la librairie locale (`scan_file_metadata`) a été patché pour ouvrir systématiquement le `[fichier].json` associé afin de récupérer la `scale` étendue que Mutagen ne supporte pas nativement.
*   **Harmonisation Visuelle de Lecture :**
    *   **Header Global Vidéo :** Création du conteneur `#global-video-info` dans la `header-right` pour afficher le Titre et le BPM des vidéos (YouTube/Local), évitant de surcharger le lecteur central avec du texte par-dessus l'image.
    *   **Header Multipiste Dynamique :** Fusion de la pochette (`#multitrack-art`) et des stats musicales directement dans la barre de titre du Mini-DAW via Flexbox pour minimiser l'impact vertical (hauteur critique pour conserver un maximum de pistes visibles).
### 26. Évolution V20 : Métronome Haute Précision (Web Audio)
*   **Audio Engine (`metronome.js`) :**
    *   **Phase accurate :** Remplacement des implémentations `setInterval` par un Scheduler AudioContext Web Audio via lookahead, garantissant un clic immuable même sous haute charge CPU.
    *   **Visual ticks :** Animation LED réactive pilotée par un Web Worker asynchrone pour une synchronisation tempo/visuelle parfaite.
*   **UI interactif (`ui_metronome.js`) :**
    *   **Draggable Float :** Conception d’une fenêtre flottante en verre dépoli (`backdrop-filter`) avec Tap Tempo et sélection de signature rythmique.
    *   **Sync Médias :** Pont dynamique multipliant le BPM original par le coefficient de vitesse (`playbackRate`) en temps réel, incluant la gestion d'un Offset MS pour épingler le temps 1.

### 28. Évolution V22 : Harmonisation Modales & Repères Visuels
*   **Harmonisation des Modales (`web/index.html` & `style.css`) :**
    *   **Repères & Métronome :** Alignement strict sur la grille `.edit-form` / `.row-inputs` pour un rendu compact (< 800px) sans débordement de champs. Interrupteurs bascules placés en ligne.
    *   **Barre de Contrôle :** Désactivation du wrapping (`flex-wrap: nowrap`) et resserrement des espacements (`gap: 8px`) pour forcer l'alignement sur une seule ligne.
*   **Ergonomie & UX (`app.js`) :**
    *   **Repères d'un Clic :** Remplacement du bouton footer "Supprimer" par une icône corbeille `<i class="ph ph-trash"></i>` directe sur chaque ligne de la liste des repères.
    *   **Repères Visuels Timeline :** Programmation de marqueurs `.cue-marker` dynamiques (Jaunes Néon, `calc(100% + 8px)`) débordant de la barre de progression dès la lecture lancée (Tous Médias, incluant WaveSurfer et Multipistes).

### 29. Évolution V24 : Grille Géométrique Dynamique & Gammes (Refonte Fretboard)
* **Système de Bounding Box Dynamique (`fretboard.js`) :**
    - Suppression complète des `positionModifiers` (offsets en dur) qui bridaient les gammes aux simples pentatoniques. L'algorithme scanne désormais les notes actives sur le manche autour de la frette racine et calcule la largeur (span) et le décalage idéals pour former une "Boîte d'Ergonomie Parfaite" (3 à 5 frettes). Le système est donc robuste face à **n'importe quel accordage** (Drop D, Open G) et **n'importe quelle gamme** (Diatonique, Blues, etc.).
* **Fiabilisation des Validations Modulo :**
    - La fonction `isNoteInPosition` n'utilise plus de logique modulo complexe pour l'appartenance à un bloc. Les positions sont validées par limites physiques absolues (`minFret`, `maxFret`) projetées aux différentes octaves, évitant les sauts de notes de bordure.
* **Exercices Continus (All Positions) :**
    - Au lieu d'essayer de souder artificiellement les boîtes (qui se chevauchent naturellement dans l'apprentissage académique, ex: positions CAGED), l'exercice construit un chemin par boîte en respectant la direction `asc` ou `desc` demandée par l'utilisateur, et alterne parfaitement en cas de `Zig-Zag`. La limite basse des boîtes accepte désormais toutes les frettes jusqu'au sillet ($0$).

### 30. Évolution V25 : Subdivisions Rythmiques & Fretboard Trainer HD
*   **Audio Engine (Subdivisions) :** Le métronome (`metronome.js`) a été profondément étendu pour supporter les subdivisions rythmiques (Croches `[2]`, Triolets `[3]`, Doubles `[4]`). Il utilise un sous-cycle de scheduling pour générer des clics secondaires (`_div`) avec un volume réduit (60%), tout en maintenant un ancrage solide de la pulsation principale avec un Fix de dérive (Indépendance absolue entre le "Mute" audio et les boucles de calcul).
*   **Routing des Kicks/Samples :** Possibilité de jouer sa gamme d'entraînement sans polluer l'écoute avec le clic de base du métronome. Le système route intelligemment la sélection du kit ("drum", "synth", "click") vers le métronome ou la gamme sans conflits.
*   **The "100% Theory" Trainer :** Le défilement du Fretboard s'aligne rigoureusement sur les théories d'apprentissage des Gammes/Arpèges.
    *   **Noire (1:1)** : 1 note jouée par Temps / Pulsation.
    *   **Croche (2:1)** : 2 notes défilent par Temps / Pulsation.
    *   **Double (4:1)** : 4 notes défilent par Temps.
    *   La surbrillance fluo s'active dynamiquement sur *chaque battement (fort ou faible)* grâce à la remontée d'un callback asynchrone `onSubdivisionBeat`, transformant le Fretboard en véritable outil d'Alternate Picking à ultra haute vitesse.

### 31. Évolution V7.2 - V7.4 : Ergonomie Setlist & Stabilité Sidebar
*   **Système "Active Track" Universel (`app.js`) :**
    - Implémentation du surlignage via attributs `data-index` pour garantir une performance maximale même sur de longues listes.
    - **Scroll Auto** : La setlist défile désormais automatiquement pour centrer le morceau actif au lancement (`scrollToActiveTrack`).
    - **Unification YouTube/Local** : Ces fonctionnalités ergonomiques ont été portées sur tous les onglets de la bibliothèque.
*   **Stabilité de la Sidebar (`style.css` & `app.js`) :**
    - **User Override** : Introduction du flag `sidebarUserOverride`. Si l'utilisateur ouvre manuellement la barre ou si elle est révélée par une modale d'édition, le masquage automatique du Mode Théâtre est suspendu.
    - **Auto-Reveal** : Ouverture forcée de la sidebar lors de l'appel des modales d'édition (YouTube, Local, Multipiste) pour maintenir le contexte visuel.
    - **Hardening CSS** : Utilisation de styles `.active` avec `!important` en fin de fichier pour garantir la priorité visuelle du morceau en cours.

### 32. Évolution V7.5 - V7.6 : Fiabilisation Métadonnées & Tagging
*   **Correction Bug Tagging iTunes (`app.js`)** : Résolution d'une `ReferenceError` qui empêchait l'application du BPM et de la Tonalité lors de l'utilisation de la recherche universelle.
*   **Inversion Artiste/Catégorie Multipiste (`metadata_service.py`)** : Correction du moteur de scan. Les projets multipistes (dossiers) reçoivent désormais correctement la catégorie "Multipiste" par défaut, laissant le champ Artiste libre pour l'identification réelle du morceau.

### 32. Évolution V27 : MIDI Import Wizard & Full Song Mode
*   **Moteur MIDI "Full Song" (`server.py` & `drums.js`) :**
    *   **Parsing Longue Durée :** Le backend supporte désormais l'importation de fichiers MIDI complexes (jusqu'à 20 000 pas), convertissant les ticks MIDI en une grille de 16ème de notes précise.
    *   **Song Mode Logic :** Implémentation d'un flag `isSongMode` qui désactive le bouclage automatique de 16 pas pour permettre au séquenceur de jouer l'intégralité d'un morceau sans interruption.
*   **Assistant d'Importation (Wizard) :**
    *   **Analyseur de Pistes :** Nouvel endpoint `/api/drums/analyze_midi` qui scanne le fichier pour lister les noms de pistes, les canaux (détection auto du canal 10) et les notes uniques.
    *   **Mapping Dynamique :** Interface utilisateur permettant de mapper n'importe quelle note MIDI vers l'un des 11 instruments de la Drum Machine avec sauvegarde immédiate du pattern en mémoire vive.
*   **Asset Hardening & Debugging :**
    *   **Restauration des Samples :** Normalisation du dossier `assets/drums/` avec un jeu complet de 11 fichiers par kit (`kick`, `snare`, `hihat`, `openhat`, `tom1`, `tom2`, `tom3`, `clap`, `cymbal`, `cowbell`, `rim`).
    *   **Traçabilité :** Ajout de logs verbeux (`[DRUM] Triggering...`) et de métadonnées de buffer pour garantir que chaque note est audible.
### 33. Évolution V28 : Studio Bass Engine (Multi-Zone)
*   **Moteur de Basse Mélodique (`drums.js` & `server.py`) :**
    *   **Parsing Pitché :** Le backend a été étendu pour traiter l'instrument `bass` de manière mélodique. Contrairement aux percussions (0/1/2), la ligne de basse stocke la valeur brute de la note MIDI (0-127).
    *   **Algorithme de Pitch-Shifting Dynamique :** Le frontend utilise une stratégie de "Multi-Zones". Il charge plusieurs échantillons (ex: E1, G2, C4) et calcule en temps réel le `playbackRate` le plus proche pour minimiser la distorsion. 
*   **Compatibilité Haute Fidélité :**
    *   **Support WAV :** Le moteur de chargement d'assets tente désormais de charger des fichiers `.wav` si les `.mp3` sont absents, permettant l'utilisation de banques de sons professionnelles non compressées.
    *   **Mapping UI :** Le séquenceur affiche dynamiquement le nom de la note (ex: "Am2") pour les pas de basse, et le Wizard d'import permet désormais de mapper n'importe quelle piste MIDI à l'instrument virtuel `bass`.

### 34. Évolution V29 : Architecture Objet Unifiée (Drum Machine)
*   **Refonte Structurelle (`drums.js`) :** Migration de toutes les fonctions globales (`toggleMute`, `renderMixer`, etc.) dans l'objet `window.DrumMachine`. Cette approche garantit l'isolation du code, facilite le débogage et élimine les conflits de portée (scope).
*   **Unification Événementielle :** Centralisation de la gestion des clics (Mute, Solo, Sélection) via un unique écouteur global en phase de capture. Suppression systématique des attributs `onclick` HTML pour une séparation stricte des responsabilités (Content vs Logic).
*   **Hardening du Mixer :** Implémentation d'une logique de rafraîchissement d'UI (`renderMixer`) capable de gérer dynamiquement les états Solo/Mute croisés, avec un feedback visuel immédiat (indicateurs textuels et VU-mètres synchronisés).
### 35. Évolution V30 : Internationalisation & Raffinement Drum Machine
*   **Internationalisation Complète (i18n) :**
    *   **Midi Import Wizard :** Migration de toutes les chaînes de caractères (titres, étapes, labels d'instruments) vers le système de locales JSON (`fr.json`, `en.json`). Support bilingue intégral.
*   **Raffinement de la Boîte à Rythmes (`drums.js`) :**
    *   **Affichage Conditionnel de la Basse :** La piste de basse et le synthétiseur interne sont désormais **masqués** par défaut pour les rythmes standards (mode TR-808) afin de préserver une expérience "pure percussion". Ils s'activent **automatiquement** uniquement lors du chargement d'un fichier MIDI importé (`imported_`).
    *   **Synchronisation du Mixeur :** Correction du bug de rafraîchissement ; le mixeur recalcule désormais dynamiquement ses pistes lors de chaque changement de pattern.
    *   **Nettoyage UI :** Suppression des labels de debug ("Drum mixer v5", "MIDI TR-808 Engine") et élargissement de la modale principale à 950px pour un meilleur confort visuel.
### 36. Évolution V31 : Expérience Utilisateur & Harmonisation Visuelle
*   **Gestion des Boucles & Navigation (`app.js`) :**
    *   **Annulation Express :** Ajout du raccourci clavier `Echap` pour réinitialiser instantanément les points A/B d'une boucle en cours de sélection.
    *   **Auto-Restart Universel :** Harmonisation du comportement de fin de lecture pour tous les moteurs (YouTube, Audio, Vidéo, Multipiste). Le curseur revient automatiquement à `00:00` en fin de morceau (hors mode boucle active).
    *   **Fiabilisation Multipiste :** Implémentation d'un "heartbeat" à 50ms pour pallier l'instabilité des événements `onfinish` de WaveSurfer et correction du bug de réactivation des stems en fin de lecture.
*   **Refonte du Header & Métadonnées (`index.html` & `app.js`) :**
    *   **Smart Badge "Scale" :** Consolidation de la Tonalité et de la Gamme dans une "Pill" interactive unique dans le header. Ce badge est cliquable et ouvre directement le manche (Fretboard).
    *   **Feedback Visuel :** Les boutons d'accès au manche changent de couleur (violet) lorsqu'une gamme est prédéfinie dans les métadonnées du morceau.
    *   **Nettoyage UI :** Suppression des textes redondants (`mt-scale-display`) dans les barres de transport.
*   **Harmonisation des Dimensions (Pixel-Perfect UI) :**
    *   **Standardisation Transport :** Réduction de la hauteur des barres de contrôle Vidéo et Multipiste de 76px à **55px** pour une cohérence parfaite avec le lecteur audio.
    *   **Header Premium :** Augmentation de la hauteur du Header à **76px** (Zone info à 74px) pour une meilleure mise en valeur du titre et de la pochette.
*   **Support "Wide Art" (16:9) :**
    *   **Architecture Flexible (`style.css`) :** Remplacement des contraintes carrées par un système `width: fit-content` avec `max-width: 320px`.
    *   **Détection Automatique (`app.js`) :** Les pochettes issues de vidéos pour des fichiers audio standards sont désormais détectées et affichées dans leur format large (16:9) réel, éliminiant les bandes noires ou les déformations dans les modales et le header.
### 37. Évolution V32 : Relocalisation Universelle & Smart Drive Scan
*   **Moteur de Recherche Multicouches (Backend - `server.py`) :**
    *   **Phase 1 (Interne) :** Recherche ultra-rapide dans les dossiers `Medias/` de l'application.
    *   **Phase 2 (Globale) :** En cas d'échec, le serveur utilise `GetLogicalDrives` (Win32 API) pour scanner la racine de tous les lecteurs physiques (`C:\`, `D:\`, etc.) à une profondeur contrôlée de 3 niveaux.
    *   **Auto-Correction Stems :** Toute relocalisation (manuelle ou intelligente) d'un dossier multipiste déclenche un re-scan immédiat via `metadata_service` pour reconstruire les liens des pistes individuelles.
*   **Protocole de Communication Robuste :**
    *   **Migration POST Universelle :** Abandon des méthodes `PUT` pour l'édition de la bibliothèque et de la setlist au profit de routes `POST` dédiées (`/api/local/edit/` et `/api/setlist/edit/`). 
    *   **Cache-Busting Frontend :** Incrémentation forcée de la version du script (`app.js?v=6`) dans `index.html` pour garantir l'utilisation de la nouvelle logique de synchronisation.
*   **Résolution de Chemins (Case-Insensitive) :**
    *   Refonte de `resolve_portable_path` dans `utils.py` pour accepter indifféremment `${app_dir}` ou `${APP_DIR}`, éliminant les erreurs 404 sur les stems causées par des incohérences de casse dans les métadonnées.

### 38. Évolution V33 : Relocalisation Avancée & Gestion de Portabilité
*   **Workflow en Deux Étapes (`index.html` & `app.js`) :**
    - **Isolation de la Recherche** : La modale de fichier manquant sépare désormais la phase de détection (Smart/Manual) de la phase d'action.
    - **Step 2 (Choix d'Action)** : Une nouvelle interface de confirmation présente le chemin trouvé et propose trois options : **Lier** (MàJ base uniquement), **Copier** (Sécurité), ou **Déplacer** (Organisation).
*   **Moteur d'Action Physique (`server.py` - `relocate_apply`) :**
    - **Gestion Intelligente des Dossiers** : Le backend redirige automatiquement les fichiers vers les sous-dossiers standardisés (`Audios`, `Videos`, `Midi`, `Multipistes`) situés dans `Medias/`.
    - **Opérations `shutil`** : Utilisation de `shutil.copy2` (préservation des métadonnées) et `shutil.move` pour les manipulations physiques. 
    - **Sécurité des Doublons** : Implémentation d'un algorithme de renommage automatique (incrémentation numérique `_1`, `_2`) si un fichier cible existe déjà, évitant toute perte de données.
*   **Internationalisation & UX :**
    - **i18n Intégrale** : Support complet des labels et messages d'erreur en Français et Anglais via `fr.json` et `en.json`.
    - **Sync Universelle** : La relocalisation d'un fichier met à jour toutes ses occurrences dans la Médiathèque et la Setlist de manière atomique.

### 23. Évolution V40 : Wizard de Relocalisation "Self-Healing" (Source/Action/Dest)
*   **Architecture Transfert 3-Étapes (`index.html`)** : Workflow visuel Source -> Action -> Destination. Suppression des contrôles redondants dans le pied de page pour une interface épurée.
*   **UI Réactive (`app.js`)** : Le champ **Destination** est dynamiquement **grisé / désactivé** lors d'une action "Lier uniquement". 
*   **Gestion Dynamique i18n** : Les messages de succès précisent désormais l'action effectuée (Lier, Copier, Déplacer) en FR et EN.
*   **Résilience du Moteur de Fichiers (`server.py`)** : 
    *   **Sécurisation Atomique** : Implémentation de blocs `try-except` pour capturer les erreurs d'accès disque (fichiers verrouillés, permissions).
    *   **Fix WinError 183** : Normalisation stricte des chemins (`os.path.normpath`) et support de `dirs_exist_ok=True` pour les dossiers multipistes.
    *   **Auto-Fallback Destination** : Le programme bascule automatiquement sur les dossiers Medias internes (mode AUTO) si la destination fournie est invalide pour une copie.

### 24. Évolution V41 : Organisation & Gestion de Bibliothèque (Artist-Routing & Manager)
*   **Classement par Artiste Intégré (`server.py`)** : Le moteur de relocalisation extrait désormais le champ `artist` pour créer dynamiquement une arborescence `Medias/{Type}/{Artiste}/`. Inclut une sanitarisation Regex des caractères Windows interdits (`/`, `:`, `*`...) et un fallback `Divers`.
*   **Déménagement Unitaire en Édition (`app.js` & `index.html`)** :
    - **UI Directe** : Intégration de l'affichage du chemin physique et de boutons d'action rapide (Copier/Déplacer) dans les modales `modal-local` et `modal-multitrack`.
    - **Logic RelocateFromEdit** : Capacité à déménager un média sain vers n'importe quel dossier manuel, avec mise à jour immédiate du lien en base de données.
*   **Gestionnaire de Bibliothèque Global (`lib-manager`)** :
    - **Vue de Masse** : Nouvelle modale `modal-library-manager` permettant de traiter l'intégralité de la bibliothèque locale (recherche, filtre, sélection multiple).
    - **Actions Groupées** : Exécution séquentielle d'opérations physiques (Copy/Move) vers une destination fixe ou via l'Auto-routage par Artiste pour une réorganisation complète instantanée.
*   **Renforcement i18n & UX** : Ajout de clés de traduction pour la gestion avancée et indicateurs de progression spécifiques pour les opérations de masse.

### 25. Évolution V53 : Restauration Pixel-Perfect & Unification des Modales de Médias
*   **Unification du Workflow d'Édition (`index.html` & `app.js`)** :
    - **Fusion YouTube / Local** : Suppression de `modal-local` (orpheline) au profit d'un `media-modal` unique gérant intelligemment les deux types de contenus.
    - **Logic Redirection** : `openEditLocalModal` et `saveLocalItem` redirigent désormais vers les IDs standardisés (`edit-url`, `edit-title`, etc.), simplifiant la maintenance.
    - **Gestion Dynamique UI** : Masquage contextuel de la zone de recherche YouTube lors de l'édition de fichiers locaux.
*   **Restauration Design "Studio" (`style.css` & `index.html`)** :
    - **Alignement Pixel-Perfect** : Retour aux paddings et marges de la version stable pour éliminer les scrollbars parasites dans toutes les modales.
    - **Harmonisation Art** : Utilisation systématique de la classe `wide-art` (16:9) pour une cohérence visuelle entre les types de médias.
*   **Fiabilisation de l'Interface** :
    - **Nettoyage des Duplicatas d'ID** : Élimination des conflits sur `local-path-display` qui empêchaient l'affichage du chemin.
    - **Correction Structurelle HTML** : Résolution des erreurs de balises `<dialog>` orphelines qui bloquaient le rendu du navigateur.
*   **Système de Notes Unifiées :**
    *   **Modale `#modal-notes-desc`** : Création d'une interface d'édition plein écran (fond sombre) fusionnant la description YouTube et les notes utilisateur en un seul bloc éditable et persistant.
### 22. Évolution V16 : Métadonnées Étendues & Robustesse API
*   **Optimisation UI (Single-Line Metadata) :**
    *   **Consolidation** : Regroupement horizontal des 5 champs techniques (BPM, Tonalité Orig., Tonalité Média, Pitch Orig., Pitch Média) sur une seule ligne dans toutes les modales.
    *   **Abréviations Intelligentes** : Utilisation de labels compacts ("T. Orig.", "Orig. Key") et de liens externes abrégés ("GetSongBPM.com") pour garantir une lisibilité sans scroll.
*   **Support "Tonalité Média" (Media Key) :**
    *   **Persistance Sidecar** : Extension du schéma sidecar JSON pour inclure `media_key`, permettant de différencier la tonalité originale de la tonalité modifiée par le lecteur.

### 23. Évolution V24 : Fretboard CAGED & Virtual Nut Paradigm (Unification)
Le système d'entraînement du manche (`fretboard.js`) a subi une refonte mathématique et pédagogique fondamentale pour synchroniser l'affichage Visuel et la Génération d'Exercices :
*   **Ancrage Absolu (Root Anchor) :** L'attribution d'une boîte à l'Octave 1 (`[0, 12]`) ou Octave 2 (`[12, 24]`) n'utilise plus les frontières de la boîte, mais uniquement la position de sa **Tonique sur la corde de Mi**. Cela permet d'assigner proprement une position à une octave même si la forme s'étale de 11 à 15 (Root = 12 -> Octave 2 gagnante).
*   **Asymétrie Physique du Manche :**
    *   **Sillet (Début) :** Une boîte allant de `-1` à `3` est **validée**. Le système filtre géométriquement les notes négatives, transformant l'ensemble en l'accord ouvert parfait `[0, 3]`. Le sillet agit comme un doigt virtuel.
    *   **Vide (Fin) :** Une boîte allant de `22` à `26` sur une guitare 24 cases est **invalidée et détruite**. Toute boîte dont le `absEnd > fretsCount` est mathématiquement injouable et supprimée de `globalValidBoxes`.
*   **Théorème du Sillet Virtuel (Virtual Nut) :** Pour forcer la démarcation stricte de 12 cases par octave tout en préservant l'intégrité des boîtes (ex: Pos 3 allant de 11 à 15 en Octave 2), la frette `12` opère comme un *Sillet Virtuel*. La fonction géométrique `isNoteInPosition` exécute un slicer absolu : toute note `< 12` en Octave 2 est atomisée. La Pos 3 s'affiche et se joue naturellement en `[12, 15]`, symétrie exacte de sa forme avec cordes à vide `[0, 3]`.
*   **Protection contre la Dérive Instrumentale :** Le calcul de géométrie force la base `E` comme ancre ("AnchorString") même si l'instrument est "Drop D", "Basse 5" ou "Guitare 7", empêchant un glissement accidentel des grilles CAGED sur les plages standard. En revanche, un accordage full-drop (Eb, D) provoque un glissement parfait de la matrice. l'œuvre et la tonalité réelle du fichier média (après Pitch Shifting éventuel).
    *   **Flux de Données** : Intégration complète dans `app.js` (Frontend), `server.py` (API REST) et `metadata_service.py` (Backend).
*   **Robustesse MusicAPI :**
    *   **Error Hardening** : Isolation stricte des appels API GetSongBPM/Key et Spotify via des blocs `try/except` globaux.
    *   **Timeouts de Sécurité** : Ajout de délais d'expiration (10s) pour éviter les blocages de threads lors de l'enrichissement automatique des métadonnées.
    *   **Fallback Silencieux** : Le système garantit le retour des résultats de recherche primaires (iTunes/YouTube) même en cas d'échec total des sources de données techniques.

### 23. Évolution V17 : Stabilisation & Harmonisation Visuelle Multitrack
*   **Architecture "Sync-First" (`app.js`) :**
    - Définition prioritaire de la fonction `syncAllMultitrackStates` dès l'initialisation du lecteur pour assurer une réactivité immédiate des contrôles (Mute/Solo/Volume).
    - Migration vers une sélection par classe CSS (`.btn-mute`, `.btn-solo`) au lieu des IDs, éliminant les conflits lors des rechargements asynchrones ou des réorganisations de pistes.
*   **Harmonisation Visuelle & "Pixel-Perfect" Tuning :**
    - **Bordures Dynamiques :** Unification des bordures horizontales (Haut/Bas) des en-têtes et des waveforms avec la couleur spécifique de chaque stem, injectée par le moteur JS.
    - **Alignement Rigoureux :** Ajustement de la hauteur des en-têtes à **73px** et ajout d'une marge de **1px** pour un alignement vertical parfait avec les ondes graphiques.
    - **Neutralisation du Curseur :** Changement de la couleur du curseur multitrack vers le blanc (`#fff`) pour éviter toute confusion visuelle au démarrage (ligne verticale violette "fantôme" à 0s).
- **Hardening interaction :** Isolation des événements `oncontextmenu` sur les waveforms pour garantir l'accès au menu de colorisation des stems partout dans la rangée.

### 24. Évolution V18 : Fiabilisation de l'État de Lecture (Autoplay/Autoreplay)
*   **Isolement UI de l'Éditeur d'Arrière-Plan :**
    *   **Prévention des Collisions :** La sauvegarde d'un item via une modale (ex: changer l'autoplay du Track B) vérifie désormais strictement si `window.currentPlayingIndex` correspond à l'item édité *avant* d'appliquer le `updatePlaybackOptionsUI`. Cela empêche l'UI du lecteur principal d'être écrasée visuellement par les réglages d'une autre piste.
    *   **Sécurisation des Variables Globales :** La fonction `syncPlaybackSettingsToModals` a été purgée de toute réaffectation des variables globales (`window.currentAutoreplay`), garantissant qu'elle ne sert plus qu'à pré-remplir les cases à cocher du DOM.
*   **Direct-to-Save depuis les Switches :**
    *   Les modifications effectuées depuis les interrupteurs (Autoplay/Autoreplay) des modales déclenchent désormais une mise à jour silencieuse immédiate (`saveItemQuiet` / `saveLocalItemQuiet`) vers le backend, éliminant le besoin de valider par le bouton "Sauvegarder".

### 25. Évolution V19 : Fretboard Interactif & Gammes (MVP)
*   **Architecture Frontend (`fretboard.js`) :**
    *   **Séparation des responsabilités :** Toute la logique musicale (calcul des intervalles de gamme, rendu du DOM à la volée, mapping des notes sur le manche) a été isolée dans un script dédié pour ne pas alourdir `app.js`.
    *   **Composant Flottant :** Le Fretboard utilise un système de Drag-and-Drop natif (via onmousedown/mousemove) appliqué à son header, évitant ainsi le blocage visuel de la balise `<dialog>`.
    *   **Responsive CSS :** Les cordes et les notes (15 cases) sont positionnées en pourcentage CSS absolu pour garantir une adaptation au resize futur.
*   **Intégration Backend (`metadata_service.py` & `server.py`) :**
    *   **Support du paramètre `scale` :** Injection stricte du nouveau champ `scale` (ex: "minor_pentatonic") dans tous les flux de sauvegarde locaux et distants.
    *   **Sidecar Fallback :** Le script de scan de la librairie locale (`scan_file_metadata`) a été patché pour ouvrir systématiquement le `[fichier].json` associé afin de récupérer la `scale` étendue que Mutagen ne supporte pas nativement.
*   **Harmonisation Visuelle de Lecture :**
    *   **Header Global Vidéo :** Création du conteneur `#global-video-info` dans la `header-right` pour afficher le Titre et le BPM des vidéos (YouTube/Local), évitant de surcharger le lecteur central avec du texte par-dessus l'image.
    *   **Header Multipiste Dynamique :** Fusion de la pochette (`#multitrack-art`) et des stats musicales directement dans la barre de titre du Mini-DAW via Flexbox pour minimiser l'impact vertical (hauteur critique pour conserver un maximum de pistes visibles).
### 26. Évolution V20 : Métronome Haute Précision (Web Audio)
*   **Audio Engine (`metronome.js`) :**
    *   **Phase accurate :** Remplacement des implémentations `setInterval` par un Scheduler AudioContext Web Audio via lookahead, garantissant un clic immuable même sous haute charge CPU.
    *   **Visual ticks :** Animation LED réactive pilotée par un Web Worker asynchrone pour une synchronisation tempo/visuelle parfaite.
*   **UI interactif (`ui_metronome.js`) :**
    *   **Draggable Float :** Conception d’une fenêtre flottante en verre dépoli (`backdrop-filter`) avec Tap Tempo et sélection de signature rythmique.
    *   **Sync Médias :** Pont dynamique multipliant le BPM original par le coefficient de vitesse (`playbackRate`) en temps réel, incluant la gestion d'un Offset MS pour épingler le temps 1.

### 28. Évolution V22 : Harmonisation Modales & Repères Visuels
*   **Harmonisation des Modales (`web/index.html` & `style.css`) :**
    *   **Repères & Métronome :** Alignement strict sur la grille `.edit-form` / `.row-inputs` pour un rendu compact (< 800px) sans débordement de champs. Interrupteurs bascules placés en ligne.
    *   **Barre de Contrôle :** Désactivation du wrapping (`flex-wrap: nowrap`) et resserrement des espacements (`gap: 8px`) pour forcer l'alignement sur une seule ligne.
*   **Ergonomie & UX (`app.js`) :**
    *   **Repères d'un Clic :** Remplacement du bouton footer "Supprimer" par une icône corbeille `<i class="ph ph-trash"></i>` directe sur chaque ligne de la liste des repères.
    *   **Repères Visuels Timeline :** Programmation de marqueurs `.cue-marker` dynamiques (Jaunes Néon, `calc(100% + 8px)`) débordant de la barre de progression dès la lecture lancée (Tous Médias, incluant WaveSurfer et Multipistes).

### 29. Évolution V24 : Grille Géométrique Dynamique & Gammes (Refonte Fretboard)
*   **Système de Bounding Box Dynamique (`fretboard.js`) :**
    - Suppression complète des `positionModifiers` (offsets en dur) qui bridaient les gammes aux simples pentatoniques. L'algorithme scanne désormais les notes actives sur le manche autour de la frette racine et calcule la largeur (span) et le décalage idéals pour former une "Boîte d'Ergonomie Parfaite" (3 à 5 frettes). Le système est donc robuste face à **n'importe quel accordage** (Drop D, Open G) et **n'importe quelle gamme** (Diatonique, Blues, etc.).
*   **Fiabilisation des Validations Modulo :**
    - La fonction `isNoteInPosition` n'utilise plus de logique modulo complexe pour l'appartenance à un bloc. Les positions sont validées par limites physiques absolues (`minFret`, `maxFret`) projetées aux différentes octaves, évitant les sauts de notes de bordure.
*   **Exercices Continus (All Positions) :**
    - Au lieu d'essayer de souder artificiellement les boîtes (qui se chevauchent naturellement dans l'apprentissage académique, ex: positions CAGED), l'exercice construit un chemin par boîte en respectant la direction `asc` ou `desc` demandée par l'utilisateur, et alterne parfaitement en cas de `Zig-Zag`. La limite basse des boîtes accepte désormais toutes les frettes jusqu'au sillet ($0$).

### 30. Évolution V25 : Subdivisions Rythmiques & Fretboard Trainer HD
*   **Audio Engine (Subdivisions) :** Le métronome (`metronome.js`) a été profondément étendu pour supporter les subdivisions rythmiques (Croches `[2]`, Triolets `[3]`, Doubles `[4]`). Il utilise un sous-cycle de scheduling pour générer des clics secondaires (`_div`) avec un volume réduit (60%), tout en maintenant un ancrage solide de la pulsation principale avec un Fix de dérive (Indépendance absolue entre le "Mute" audio et les boucles de calcul).
*   **Routing des Kicks/Samples :** Possibilité de jouer sa gamme d'entraînement sans polluer l'écoute avec le clic de base du métronome. Le système route intelligemment la sélection du kit ("drum", "synth", "click") vers le métronome ou la gamme sans conflits.
*   **The "100% Theory" Trainer :** Le défilement du Fretboard s'aligne rigoureusement sur les théories d'apprentissage des Gammes/Arpèges.
    *   **Noire (1:1)** : 1 note jouée par Temps / Pulsation.
    *   **Croche (2:1)** : 2 notes défilent par Temps / Pulsation.
    *   **Double (4:1)** : 4 notes défilent par Temps.
    *   La surbrillance fluo s'active dynamiquement sur *chaque battement (fort ou faible)* grâce à la remontée d'un callback asynchrone `onSubdivisionBeat`, transformant le Fretboard en véritable outil d'Alternate Picking à ultra haute vitesse.

### 31. Évolution V7.2 - V7.4 : Ergonomie Setlist & Stabilité Sidebar
*   **Système "Active Track" Universel (`app.js`) :**
    - Implémentation du surlignage via attributs `data-index` pour garantir une performance maximale même sur de longues listes.
    - **Scroll Auto** : La setlist défile désormais automatiquement pour centrer le morceau actif au lancement (`scrollToActiveTrack`).
    - **Unification YouTube/Local** : Ces fonctionnalités ergonomiques ont été portées sur tous les onglets de la bibliothèque.
*   **Stabilité de la Sidebar (`style.css` & `app.js`) :**
    - **User Override** : Introduction du flag `sidebarUserOverride`. Si l'utilisateur ouvre manuellement la barre ou si elle est révélée par une modale d'édition, le masquage automatique du Mode Théâtre est suspendu.
    - **Auto-Reveal** : Ouverture forcée de la sidebar lors de l'appel des modales d'édition (YouTube, Local, Multipiste) pour maintenir le contexte visuel.
    - **Hardening CSS** : Utilisation de styles `.active` avec `!important` en fin de fichier pour garantir la priorité visuelle du morceau en cours.

### 32. Évolution V7.5 - V7.6 : Fiabilisation Métadonnées & Tagging
*   **Correction Bug Tagging iTunes (`app.js`)** : Résolution d'une `ReferenceError` qui empêchait l'application du BPM et de la Tonalité lors de l'utilisation de la recherche universelle.
*   **Inversion Artiste/Catégorie Multipiste (`metadata_service.py`)** : Correction du moteur de scan. Les projets multipistes (dossiers) reçoivent désormais correctement la catégorie "Multipiste" par défaut, laissant le champ Artiste libre pour l'identification réelle du morceau.

### 32. Évolution V27 : MIDI Import Wizard & Full Song Mode
*   **Moteur MIDI "Full Song" (`server.py` & `drums.js`) :**
    *   **Parsing Longue Durée :** Le backend supporte désormais l'importation de fichiers MIDI complexes (jusqu'à 20 000 pas), convertissant les ticks MIDI en une grille de 16ème de notes précise.
    *   **Song Mode Logic :** Implémentation d'un flag `isSongMode` qui désactive le bouclage automatique de 16 pas pour permettre au séquenceur de jouer l'intégralité d'un morceau sans interruption.
*   **Assistant d'Importation (Wizard) :**
    *   **Analyseur de Pistes :** Nouvel endpoint `/api/drums/analyze_midi` qui scanne le fichier pour lister les noms de pistes, les canaux (détection auto du canal 10) et les notes uniques.
    *   **Mapping Dynamique :** Interface utilisateur permettant de mapper n'importe quelle note MIDI vers l'un des 11 instruments de la Drum Machine avec sauvegarde immédiate du pattern en mémoire vive.
*   **Asset Hardening & Debugging :**
    *   **Restauration des Samples :** Normalisation du dossier `assets/drums/` avec un jeu complet de 11 fichiers par kit (`kick`, `snare`, `hihat`, `openhat`, `tom1`, `tom2`, `tom3`, `clap`, `cymbal`, `cowbell`, `rim`).
    *   **Traçabilité :** Ajout de logs verbeux (`[DRUM] Triggering...`) et de métadonnées de buffer pour garantir que chaque note est audible.
### 33. Évolution V28 : Studio Bass Engine (Multi-Zone)
*   **Moteur de Basse Mélodique (`drums.js` & `server.py`) :**
    *   **Parsing Pitché :** Le backend a été étendu pour traiter l'instrument `bass` de manière mélodique. Contrairement aux percussions (0/1/2), la ligne de basse stocke la valeur brute de la note MIDI (0-127).
    *   **Algorithme de Pitch-Shifting Dynamique :** Le frontend utilise une stratégie de "Multi-Zones". Il charge plusieurs échantillons (ex: E1, G2, C4) et calcule en temps réel le `playbackRate` le plus proche pour minimiser la distorsion. 
*   **Compatibilité Haute Fidélité :**
    *   **Support WAV :** Le moteur de chargement d'assets tente désormais de charger des fichiers `.wav` si les `.mp3` sont absents, permettant l'utilisation de banques de sons professionnelles non compressées.
    *   **Mapping UI :** Le séquenceur affiche dynamiquement le nom de la note (ex: "Am2") pour les pas de basse, et le Wizard d'import permet désormais de mapper n'importe quelle piste MIDI à l'instrument virtuel `bass`.

### 34. Évolution V29 : Architecture Objet Unifiée (Drum Machine)
*   **Refonte Structurelle (`drums.js`) :** Migration de toutes les fonctions globales (`toggleMute`, `renderMixer`, etc.) dans l'objet `window.DrumMachine`. Cette approche garantit l'isolation du code, facilite le débogage et élimine les conflits de portée (scope).
*   **Unification Événementielle :** Centralisation de la gestion des clics (Mute, Solo, Sélection) via un unique écouteur global en phase de capture. Suppression systématique des attributs `onclick` HTML pour une séparation stricte des responsabilités (Content vs Logic).
*   **Hardening du Mixer :** Implémentation d'une logique de rafraîchissement d'UI (`renderMixer`) capable de gérer dynamiquement les états Solo/Mute croisés, avec un feedback visuel immédiat (indicateurs textuels et VU-mètres synchronisés).
### 35. Évolution V30 : Internationalisation & Raffinement Drum Machine
*   **Internationalisation Complète (i18n) :**
    *   **Midi Import Wizard :** Migration de toutes les chaînes de caractères (titres, étapes, labels d'instruments) vers le système de locales JSON (`fr.json`, `en.json`). Support bilingue intégral.
*   **Raffinement de la Boîte à Rythmes (`drums.js`) :**
    *   **Affichage Conditionnel de la Basse :** La piste de basse et le synthétiseur interne sont désormais **masqués** par défaut pour les rythmes standards (mode TR-808) afin de préserver une expérience "pure percussion". Ils s'activent **automatiquement** uniquement lors du chargement d'un fichier MIDI importé (`imported_`).
    *   **Synchronisation du Mixeur :** Correction du bug de rafraîchissement ; le mixeur recalcule désormais dynamiquement ses pistes lors de chaque changement de pattern.
    *   **Nettoyage UI :** Suppression des labels de debug ("Drum mixer v5", "MIDI TR-808 Engine") et élargissement de la modale principale à 950px pour un meilleur confort visuel.
### 36. Évolution V31 : Expérience Utilisateur & Harmonisation Visuelle
*   **Gestion des Boucles & Navigation (`app.js`) :**
    *   **Annulation Express :** Ajout du raccourci clavier `Echap` pour réinitialiser instantanément les points A/B d'une boucle en cours de sélection.
    *   **Auto-Restart Universel :** Harmonisation du comportement de fin de lecture pour tous les moteurs (YouTube, Audio, Vidéo, Multipiste). Le curseur revient automatiquement à `00:00` en fin de morceau (hors mode boucle active).
    *   **Fiabilisation Multipiste :** Implémentation d'un "heartbeat" à 50ms pour pallier l'instabilité des événements `onfinish` de WaveSurfer et correction du bug de réactivation des stems en fin de lecture.
*   **Refonte du Header & Métadonnées (`index.html` & `app.js`) :**
    *   **Smart Badge "Scale" :** Consolidation de la Tonalité et de la Gamme dans une "Pill" interactive unique dans le header. Ce badge est cliquable et ouvre directement le manche (Fretboard).
    *   **Feedback Visuel :** Les boutons d'accès au manche changent de couleur (violet) lorsqu'une gamme est prédéfinie dans les métadonnées du morceau.
    *   **Nettoyage UI :** Suppression des textes redondants (`mt-scale-display`) dans les barres de transport.
*   **Harmonisation des Dimensions (Pixel-Perfect UI) :**
    *   **Standardisation Transport :** Réduction de la hauteur des barres de contrôle Vidéo et Multipiste de 76px à **55px** pour une cohérence parfaite avec le lecteur audio.
    *   **Header Premium :** Augmentation de la hauteur du Header à **76px** (Zone info à 74px) pour une meilleure mise en valeur du titre et de la pochette.
*   **Support "Wide Art" (16:9) :**
    *   **Architecture Flexible (`style.css`) :** Remplacement des contraintes carrées par un système `width: fit-content` avec `max-width: 320px`.
    *   **Détection Automatique (`app.js`) :** Les pochettes issues de vidéos pour des fichiers audio standards sont désormais détectées et affichées dans leur format large (16:9) réel, éliminiant les bandes noires ou les déformations dans les modales et le header.
### 37. Évolution V32 : Relocalisation Universelle & Smart Drive Scan
*   **Moteur de Recherche Multicouches (Backend - `server.py`) :**
    *   **Phase 1 (Interne) :** Recherche ultra-rapide dans les dossiers `Medias/` de l'application.
    *   **Phase 2 (Globale) :** En cas d'échec, le serveur utilise `GetLogicalDrives` (Win32 API) pour scanner la racine de tous les lecteurs physiques (`C:\`, `D:\`, etc.) à une profondeur contrôlée de 3 niveaux.
    *   **Auto-Correction Stems :** Toute relocalisation (manuelle ou intelligente) d'un dossier multipiste déclenche un re-scan immédiat via `metadata_service` pour reconstruire les liens des pistes individuelles.
*   **Protocole de Communication Robuste :**
    *   **Migration POST Universelle :** Abandon des méthodes `PUT` pour l'édition de la bibliothèque et de la setlist au profit de routes `POST` dédiées (`/api/local/edit/` et `/api/setlist/edit/`). 
    *   **Cache-Busting Frontend :** Incrémentation forcée de la version du script (`app.js?v=6`) dans `index.html` pour garantir l'utilisation de la nouvelle logique de synchronisation.
*   **Résolution de Chemins (Case-Insensitive) :**
    *   Refonte de `resolve_portable_path` dans `utils.py` pour accepter indifféremment `${app_dir}` ou `${APP_DIR}`, éliminant les erreurs 404 sur les stems causées par des incohérences de casse dans les métadonnées.

### 38. Évolution V33 : Relocalisation Avancée & Gestion de Portabilité
*   **Workflow en Deux Étapes (`index.html` & `app.js`) :**
    - **Isolation de la Recherche** : La modale de fichier manquant sépare désormais la phase de détection (Smart/Manual) de la phase d'action.
    - **Step 2 (Choix d'Action)** : Une nouvelle interface de confirmation présente le chemin trouvé et propose trois options : **Lier** (MàJ base uniquement), **Copier** (Sécurité), ou **Déplacer** (Organisation).
*   **Moteur d'Action Physique (`server.py` - `relocate_apply`) :**
    - **Gestion Intelligente des Dossiers** : Le backend redirige automatiquement les fichiers vers les sous-dossiers standardisés (`Audios`, `Videos`, `Midi`, `Multipistes`) situés dans `Medias/`.
    - **Opérations `shutil`** : Utilisation de `shutil.copy2` (préservation des métadonnées) et `shutil.move` pour les manipulations physiques. 
    - **Sécurité des Doublons** : Implémentation d'un algorithme de renommage automatique (incrémentation numérique `_1`, `_2`) si un fichier cible existe déjà, évitant toute perte de données.
*   **Internationalisation & UX :**
    - **i18n Intégrale** : Support complet des labels et messages d'erreur en Français et Anglais via `fr.json` et `en.json`.
    - **Sync Universelle** : La relocalisation d'un fichier met à jour toutes ses occurrences dans la Médiathèque et la Setlist de manière atomique.

### 23. Évolution V40 : Wizard de Relocalisation "Self-Healing" (Source/Action/Dest)
*   **Architecture Transfert 3-Étapes (`index.html`)** : Workflow visuel Source -> Action -> Destination. Suppression des contrôles redondants dans le pied de page pour une interface épurée.
*   **UI Réactive (`app.js`)** : Le champ **Destination** est dynamiquement **grisé / désactivé** lors d'une action "Lier uniquement". 
*   **Gestion Dynamique i18n** : Les messages de succès précisent désormais l'action effectuée (Lier, Copier, Déplacer) en FR et EN.
*   **Résilience du Moteur de Fichiers (`server.py`)** : 
    *   **Sécurisation Atomique** : Implémentation de blocs `try-except` pour capturer les erreurs d'accès disque (fichiers verrouillés, permissions).
    *   **Fix WinError 183** : Normalisation stricte des chemins (`os.path.normpath`) et support de `dirs_exist_ok=True` pour les dossiers multipistes.
    *   **Auto-Fallback Destination** : Le programme bascule automatiquement sur les dossiers Medias internes (mode AUTO) si la destination fournie est invalide pour une copie.

### 24. Évolution V41 : Organisation & Gestion de Bibliothèque (Artist-Routing & Manager)
*   **Classement par Artiste Intégré (`server.py`)** : Le moteur de relocalisation extrait désormais le champ `artist` pour créer dynamiquement une arborescence `Medias/{Type}/{Artiste}/`. Inclut une sanitarisation Regex des caractères Windows interdits (`/`, `:`, `*`...) et un fallback `Divers`.
*   **Déménagement Unitaire en Édition (`app.js` & `index.html`)** :
    - **UI Directe** : Intégration de l'affichage du chemin physique et de boutons d'action rapide (Copier/Déplacer) dans les modales `modal-local` et `modal-multitrack`.
    - **Logic RelocateFromEdit** : Capacité à déménager un média sain vers n'importe quel dossier manuel, avec mise à jour immédiate du lien en base de données.
*   **Gestionnaire de Bibliothèque Global (`lib-manager`)** :
    - **Vue de Masse** : Nouvelle modale `modal-library-manager` permettant de traiter l'intégralité de la bibliothèque locale (recherche, filtre, sélection multiple).
    - **Actions Groupées** : Exécution séquentielle d'opérations physiques (Copy/Move) vers une destination fixe ou via l'Auto-routage par Artiste pour une réorganisation complète instantanée.
*   **Renforcement i18n & UX** : Ajout de clés de traduction pour la gestion avancée et indicateurs de progression spécifiques pour les opérations de masse.

### 25. Évolution V53 : Restauration Pixel-Perfect & Unification des Modales de Médias
*   **Unification du Workflow d'Édition (`index.html` & `app.js`)** :
    - **Fusion YouTube / Local** : Suppression de `modal-local` (orpheline) au profit d'un `media-modal` unique gérant intelligemment les deux types de contenus.
    - **Logic Redirection** : `openEditLocalModal` et `saveLocalItem` redirigent désormais vers les IDs standardisés (`edit-url`, `edit-title`, etc.), simplifiant la maintenance.
    - **Gestion Dynamique UI** : Masquage contextuel de la zone de recherche YouTube lors de l'édition de fichiers locaux.
*   **Restauration Design "Studio" (`style.css` & `index.html`)** :
    - **Alignement Pixel-Perfect** : Retour aux paddings et marges de la version stable pour éliminer les scrollbars parasites dans toutes les modales.
    - **Harmonisation Art** : Utilisation systématique de la classe `wide-art` (16:9) pour une cohérence visuelle entre les types de médias.
*   **Fiabilisation de l'Interface** :
    - **Nettoyage des Duplicatas d'ID** : Élimination des conflits sur `local-path-display` qui empêchaient l'affichage du chemin.
    - **Correction Structurelle HTML** : Résolution des erreurs de balises `<dialog>` orphelines qui bloquaient le rendu du navigateur.
    - **Bandeau de Relocalisation** : Réintégration propre des fonctions Copier/Déplacer dans la modale d'édition unifiée.


### 40. Évolution V22 : Synchronisation Universelle & Persistance des Médias Liés
*   **Moteur de Synchronisation ✨ (Universal Tag) :**
    - **Détection des Liens Locaux** : La recherche universelle identifie désormais si un média (Audio/Vidéo) est déjà lié à l'élément en cours d'édition. Elle propose une suggestion prioritaire "Média Lié" qui extrait les métadonnées directement de la bibliothèque locale.
    - **Persistance des Pochettes Web** : Renforcement du flux de données pour les Web Links. La variable `window.currentWebLinkCover` capture désormais fidèlement les chemins de fichiers locaux (`original_cover_path`) lors d'une synchronisation avec un média existant, garantissant que la pochette est préservée après redémarrage.
*   **Robustesse du Frontend (`app.js`) :**
    - **Protection contre les Crashs** : Isolation de `applyUniversalMetadata` dans un bloc `try/catch` global avec des vérifications d'existence systématiques pour chaque champ (ID-safe).
    - **Restauration de Secours** : Implémentation d'une logique de "Last Resort" dans `saveWebLink` qui, si la variable globale est vide, tente d'extraire la pochette directement depuis l'élément `<img>` de la modale en décodant l'URL du proxy.

### 41. Évolution V57 : Persistance Blindée via UIDs & Nettoyage Métadonnées
*   **Système d'UID Stables (`metadata_service.py` & `server.py`)** :
    - Abandon définitif des index de tableau pour les liaisons (`linked_ids`). Chaque média reçoit un UID unique (`lib_xxxx` ou `web_xxxx`) persisté dans son sidecar `airstep_meta.json`.
    - **Migration à la volée** : Les fonctions `get_local_files` et `get_web_links` convertissent automatiquement les anciens liens `type:index` vers les nouveaux UIDs lors du chargement.
*   **Optimisation du Stockage (Sidecar Hardening)** :
    - La fonction `write_file_metadata` supprime désormais systématiquement les données binaires (Base64) du JSON avant l'écriture, forçant le stockage de la pochette dans un fichier `folder.jpg` physique. Cela évite les fichiers JSON de plusieurs mégaoctets et les corruptions.
*   **Synchronisation Bidirectionnelle Automatique** :
    - Toute modification d'un lien dans un média (Local ou Web) déclenche via `sync_web_link_bidirectional` la mise à jour du média cible, garantissant un maillage parfait et incassable.
*   **Fiabilisation Frontend (`app.js`)** :
    - Initialisation systématique de `currentEditingLinkedIds` à l'ouverture des modales.
    - Correction de `applyUniversalMetadata` pour assurer que `currentCoverData` est correctement mis à jour lors d'un tagging automatique, permettant la persistence immédiate de la pochette choisie.

### 42. Évolution V60 : Vue Groupée & Smart Mesh View
*   **Algorithme de Regroupement** : Implémentation d'un filtrage basé sur l'appartenance à une "famille" (Mesh). Pour chaque groupe de médias interconnectés, l'interface ne conserve qu'un seul représentant (Master) lors du rendu.
*   **Hiérarchie de Représentation** : Choix intelligent de l'élément Master selon le score de priorité : Multitrack (5) > Vidéo (4) > Audio (3) > YouTube (2) > Web (1).
*   **Persistance UI** : L'état du commutateur "Vue Groupée" est sauvegardé dans le `localStorage` et synchronisé entre tous les onglets de la bibliothèque.
*   **Expérience UI (Sticky Headers)** : Implémentation de `position: sticky` avec offsets calculés pour les onglets, titres et filtres de la barre latérale. Utilisation de fonds opaques et de `z-index` hiérarchisés pour garantir une navigation fluide sans chevauchement visuel lors du défilement des listes massives.

### 43. Évolution V64 : Adressage par UID & Hardening Layout
*   **Adressage Absolu (`playMediaByUid`)** : Abandon définitif de la lecture par "index de ligne" (index-based) qui causait des désynchronisations lors du tri ou du filtrage. Chaque clic passe désormais l'UID stable de l'élément.
*   **Isolation du Layout (`.th-content`)** : Introduction d'un wrapper flex interne dans les balises `th`. Cela permet de garder les cellules en `display: table-cell` (garantissant l'alignement horizontal natif) tout en offrant des contrôles flexibles (boutons de tri, resizers) à l'intérieur.
*   **Découplage Tri/Resize** : Les événements de tri sont isolés sur des boutons dédiés (`.btn-sort`), éliminant les déclenchements accidentels lors du redimensionnement manuel des colonnes.

### 44. Évolution V65 : Standardisation du Tri Bidirectionnel
*   **Moteur de Tri Unifié** : Standardisation du comportement de tri pour les 3 bibliothèques (YouTube, Local, Web). 
*   **Toggle Intelligent** : Premier clic = Croissant (A-Z). Re-clic sur la même colonne = Décroissant (Z-A). Le passage à une nouvelle colonne réinitialise automatiquement le sens en mode Croissant pour une expérience prévisible.

### 45. Évolution V66 : Harmonisation de l'Applet Web Links
*   **Parité Fonctionnelle** : Ajout de la colonne **Catégorie** dans la table des liens Web pour correspondre aux bibliothèques locales.
*   **Alignement "Pixel-Perfect"** : Utilisation de `justify-content: space-between` dans les en-têtes pour forcer l'alignement des icônes de tri sur le bord droit de chaque colonne, créant une symétrie visuelle sur tout le Dashboard.
### 46. Évolution V67 : Système de Synchronisation Multi-Cloud & Hardening WebDAV
*   **Moteur de Synchronisation Unifié (`sync_manager.py`)** :
    - **Architecture Multi-Provider** : Support natif du stockage Local, SFTP et WebDAV via une interface fournisseur unique.
    - **Smart Sidecar Matching** : Logique de décision basée sur le flag `shared_with_group` des fichiers sidecars pour éviter la synchronisation accidentelle de la bibliothèque privée.
    - **Listing Récurrent IIS** : Implémentation de `_list_manual` pour WebDAV, simulant un scan récursif profond sur les serveurs IIS qui rejettent l'en-tête `Depth: Infinity`.
*   **Robustesse des Transferts & Casing** :
    - **Comparaison Case-Insensitive** : Analyse de la bibliothèque basée sur des index en minuscules pour prévenir les boucles d'upload/download infinies causées par des différences de casse entre l'OS local et le serveur (ex: `FFMPEG.exe`).
    - **Gestion des Gros Fichiers (HTTP 413)** : Documentation et hardening pour supporter les transferts jusqu'à 4 Go sur IIS WebDAV.
*   **Monitoring de Précision** :
    - Instrumentation complète des flux réseau avec logs explicites (`[SYNC]`, `[WEBDAV]`, `[SFTP]`) permettant un diagnostic instantané des échecs de permission ou de quota.
    - Correction de la signature `is_remote` pour garantir la stabilité du maillage lors des scans de fichiers manquants.
### 47. Évolution V68 : Synchronisation Robuste des Pochettes & Support Sidecar Universel
*   **Moteur d'Extraction Hybride (`metadata_service.py`) ✨** :
    - **Support Sidecar pour Fichiers Simples** : Le moteur de résolution d'images (`get_file_cover`) a été étendu pour supporter les fichiers `.json` sidecars même pour les fichiers média uniques (MP4, MP3). S'il ne trouve pas d'image embarquée, il cherche `nom_fichier.json` et utilise le champ `cover`. Idéal pour les vidéos YouTube téléchargées.
    - **Nettoyage Automatique** : Lors de toute écriture en base, le service purge les données binaires (Base64) du JSON pour forcer le stockage dans un fichier physique `folder.jpg` (pour les dossiers) ou référencé (pour les fichiers), garantissant des performances optimales.
*   **Endpoint de Résolution Directe (`server.py`) ✨** :
    - **`/api/cover`** : Nouvel endpoint permettant de récupérer une pochette directement via un chemin de fichier (portable ou absolu). Inclus une gestion d'erreurs "Safe" (retour 404 propre au lieu de 500) pour une stabilité totale du Dashboard.
*   **Intégrité Physiques des Données** :
    - Implémentation systématique de `f.flush()` et `os.fsync()` lors de la sauvegarde des métadonnées et des images, prévenant les corruptions de fichiers lors de déplacements ou de rafraîchissements rapides.
*   **Expansion WAV** : Support natif de l'extraction et de l'injection d'images dans les fichiers WAV via le moteur Mutagen Wave.

### 48. Évolution V69 : Persistance Absolue & MIDI Smart Matching
*   **Path Persistence (`utils.py`) :**
    - **Dossier Agnostique** : Centralisation via `get_app_dir()` pour garantir que le dossier de données (`config.json`, `profiles/`, `devices/`, `library.json`, etc.) réside **toujours** à côté de l'exécutable PyInstaller (`sys.executable`), même si l'application est lancée depuis un raccourci bureau qui modifie le CWD (Current Working Directory).
    - **Sécurité des Données** : Suppression stricte des accès par chemins relatifs dans tous les managers (`config_manager.py`, `profile_manager.py`, `device_manager.py`, `library_manager.py`, `server.py`).
*   **Smart Matching MIDI Output (`midi_engine.py`) :**
    - **Résolution Dynamique** : Le moteur est désormais capable de se reconnecter automatiquement à un port de sortie renommé par Windows MM. Si "Midi 1" est déconnecté puis redétecté comme "Midi 2", le moteur retire le suffixe numérique, matche la racine "Midi", se connecte, et **met à jour la configuration silencieusement** pour préserver la case cochée dans GUI.
    - **Ghost Config Fix** : La mémoire tampon de l'interface `self.settings` ne subit plus de dérive (drift) lors des appels `save_all`. Les ports d'E/S actifs sont strictement synchronisés dynamiquement avant chaque sauvegarde, évitant l'écrasement intempestif par un `config.json` vide.
*   **Mode "Light" Agnostique (`main.py`) :**
    - Le système de `.flag` (Désactivation Web/Moniteur de Focus) est désormais robuste et fonctionne n'importe où grâce à l'implémentation de `get_app_dir()`. De plus, le `.env` de sécurité YouTube obsolète a été banni de l'UI.

### 49. Évolution V70 (V9.1 - V9.2) : Moteur de Synchronisation Interactive & Sécurité
*   **Analyse de Différentiel Avancée (`sync_manager.py`) :**
    - **Sync State Tracker** : Création de `data/sync_state.json` pour mémoriser l'état de la bibliothèque après chaque succès. Permet de distinguer mathématiquement une suppression d'un nouvel ajout.
    - **Détection des Suppressions** : Le moteur identifie désormais 4 types d'actions : `pull`, `push`, `delete_remote` (suppression cloud) et `delete_local` (suppression physique locale).
*   **Interface de Validation "Safety-First" (`gui.py`) :**
    - **SyncConfirmationDialog** : Nouvelle modale interactive présentant le récapitulatif complet de l'analyse (avec icônes 📥, 📤, 🗑️). L'utilisateur peut cocher/décocher individuellement chaque fichier avant l'exécution.
    - **Console Intégrée** : Déplacement de la barre de progression et de la console de logs du Dashboard principal vers la modale pour une meilleure concentration sur l'opération en cours.
*   **Bridage de Flux (Sync Modes) :**
    - Implémentation de 3 modes opératoires : **Bidirectionnel**, **Réception seule (Pull Only)** et **Envoi seul (Push Only)**. Le système filtre les listes d'actions avant de les présenter à l'utilisateur selon le mode choisi.
*   **Hardening des Providers :**
    - Ajout de la méthode `delete_file` dans `LocalProvider`, `SftpProvider` et `WebdavProvider`. Support du forçage de l'horloge (`utime`) sur SFTP pour garantir une précision < 1s.

### 50. Évolution V9.6.40 : Stabilisation Critique & Intelligence de Synchronisation
*   **Moteur de Synchronisation 2.0 (`sync_manager.py`)** :
    - **Validation Croisée Cloud (Trust-the-Cloud)** : Implémentation d'un mécanisme de sauvegarde où, en cas d'absence du flag local `shared_with_group` dans un sidecar, le système vérifie la présence du fichier sur le serveur distant. S'il existe sur le Cloud, il est considéré comme partagé, éliminant les suppressions accidentelles de médias légitimes lors d'une analyse bidirectionnelle.
    - **Héritage Dynamique des Sidecars** : Les fichiers annexes (`folder.jpg`, `.srt`, `.vtt`, `.json`) ne sont plus rejetés d'office en mode local. Ils "traversent" désormais la logique pour vérifier récursivement le statut de leur fichier maître (JSON du média ou dossier multipiste).
    - **Shield Anti-Récursion** : Ajout d'une protection stricte empêchant les fichiers `.json` ou les sidecars identifiés de chercher leur propre maître, prévenant les erreurs de type "Maximum recursion depth exceeded".
    - **Cache d'Analyse Éphémère** : Stockage temporaire des index de fichiers (`local_files` / `remote_files`) dans l'instance pendant l'analyse pour permettre des validations croisées sans surcharge mémoire ni latence réseau.
*   **Expansion des Formats Supportés** :
    - Support natif étendu pour les formats : **Images** (PNG, JPEG, GIF), **Audio** (AAC, M4A, FLAC) et **Vidéo** (WebM, MKV, MOV).
*   **Fiabilisation des Logs** :
    - Nettoyage des logs de diagnostic `[SYNC-DEBUG]` au profit d'un flux de production clair et précis dans `midikbd_debug.log`.
### 51. Évolution V9.6.41 : Nettoyage Récursif des Répertoires
*   **Hygiène du Cloud (`sync_manager.py`)** :
    - **Auto-Cleanup Parents** : Implémentation d'une logique de nettoyage récursif après suppression de fichier. Si un dossier devient vide suite à une synchronisation (ex: déplacement d'un média multipiste), le moteur tente de supprimer les dossiers parents orphelins jusqu'à la racine du partage.
    - Support natif sur **SFTP**, **WebDAV** et **Local**.
    - **Protected Dirs (V9.6.46)** : Liste de dossiers structurels sanctuarisés (`Medias`, `data`, `profiles`, etc.) qui ne sont jamais supprimés par le moteur, garantissant l'intégrité de l'arborescence.
