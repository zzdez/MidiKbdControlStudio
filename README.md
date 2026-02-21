# MidiKbd Control Studio (Universal V4 Edition)

**MidiKbd Control Studio** (anciennement AirstepStudio) est la station de contrôle ultime pour musiciens, désormais compatible avec **TOUS les contrôleurs MIDI** (USB et Bluetooth).

Elle combine le meilleur de deux mondes :
1.  **Dashboard Web ("Le Cockpit") :** Une interface riche pour gérer vos médias (YouTube, Setlist) et vos configurations.
2.  **Overlay Natif ("La Remote") :** Une télécommande flottante ultra-compacte pour garder le contrôle sur vos logiciels (DAW) sans quitter l'écran des yeux.

## 🚀 Fonctionnalités Clés

*   **Support MIDI Universel (Nouveau) :**
    *   Compatible avec **n'importe quel contrôleur MIDI** : Airstep, Boss FS-1-WL, Chocolate, Korg Nano, Claviers maîtres...
    *   **Double Driver :** Support natif Bluetooth LE (Bleak) et USB (Mido/WinMM).
    *   **Détection Automatique :** Branchez, scannez, c'est détecté.
*   **Mode Service :** L'application démarre discrètement dans la zone de notification (Tray).
*   **Bibliothèque & Smart Launcher :**
    *   Un tiroir ("Drawer") intégré à la télécommande pour lancer vos morceaux et vos applications favorites.
    *   Détection automatique des applications liées à vos profils (ex: lancez "Reaper" et le profil change automatiquement).
*   **Setlist Catégorisée & Intelligente :**
    *   **Nouveau !** Modale de recherche YouTube intégrée : trouvez, prévisualisez et ajoutez vos backing tracks sans quitter l'appli.
    *   **Nouveau !** Support des fichiers locaux (MP3/WAV) via streaming natif.
    *   **Auto-Tag Intelligent :** Recherche automatique des métadonnées et pochettes HD via iTunes API.
    *   **Éditeur de Métadonnées :** Modifiez physiquement vos fichiers (Titres, Artistes...) et gérez vos pochettes d'album directement depuis l'application.
    *   **UI Premium :** Interface modernisée avec **Phosphor Icons** pour une lisibilité parfaite.
    *   Organisez par Artiste, Genre, et ajoutez vos notes personnelles distinctes de la description YouTube.
    *   **NOUVEAU ! Profils Web Universels :** Ajoutez n'importe quel site (Dailymotion, Vimeo...) et associez-lui un profil dédié. L'application détecte automatiquement le contexte grâce au titre de la fenêtre dynamique.
    *   **Smart Embed :** Copiez/collez vos liens standards (Dailymotion, Vimeo) et le lecteur les convertit automatiquement en liens "Embed" compatibles.
*   **Contrôle Hybride & Robuste :**
    *   **Mode WEB :** Pilotez le lecteur YouTube (Play, Pause, Vitesse, Seek)- **Lecteur Vidéo Local**
    - Support MP4, MKV, AVI, MOV.
    - Contrôle de vitesse (0.5x à 2.0x).
    - **Nouveau** : Pitch Shifting (Changement de tonalité sans changer la vitesse) de -6 à +6 demi-tons.
    - **Nouveau** : Support Multi-Sous-titres (SRT/VTT) avec sélection de piste en direct via une modale unifiée.
    - **Nouveau** : Ajustement interactif et "Live Preview" de la position verticale des sous-titres depuis l'éditeur.
    - Navigation par sauts (+/- 5s).
    - **NOUVEAU ! Support des Chapitres :** Détection et affichage interactif des chapitres YouTube (Timeline Marker) pour une navigation ultra-rapide.
- **Lecteur Audio Local**
    - Waveform interactive (WaveSurfer.js).
    - Support MP3, WAV, FLAC, M4A, OGG.
    - Pitch Shifting et contrôle de vitesse indépendants.
    - Volume manuel et Normalisation automatique. **Contrôle Granulaire Vitesse :** Ajustez par pas de 0.05x (sans altération du Pitch/Tonalité).
        *   **Seek de Précision :** +/- 5 secondes.
        *   **Commandes Clavier Natives :** Support direct des flèches directionnelles et de la barre d'espace pour le mapping.
    *   **Nouveau !** Injection native des commandes (Win32) pour piloter même les applications récalcitrantes (Moises, applis Electron).
    *   **Mode WINDOWS :** Simulez des raccourcis clavier pour contrôler vos logiciels ou sites externes.
*   **Overlay Persistant (Remote Control) :**
    *   **Nouveau Design Compact :** Optimisé pour prendre le moins de place possible sur l'écran.
    *   **Mode Singleton :** Gestion intelligente des fenêtres (ne s'ouvre qu'une fois).
    *   **Smart Close :** Fermez la remote sans être dérangé par la fenêtre principale (qui reste dans le Tray).
    *   **Feedback Visuel Unifié :** Les boutons clignotent que l'action vienne du MIDI, du Clavier (HID) ou du clic souris.

## 🎹 Configuration MIDI (Universel & Multi-Output)

MidiKbd Control Studio permet de piloter **tous vos équipements en même temps**, quel que soit le contrôleur d'entrée utilisé (Airstep, Boss, Korg...).

### 1. Multi-Sorties Simultanées
Dans *Réglages > MIDI Output*, vous pouvez cocher plusieurs sorties :
*   **Hardware :** Synthétiseurs externes (ex: *Fender Tone Master*), Pédales...
*   **Software :** DAWs (Reaper, Ableton, Cubase...) ou Plugins via un câble virtuel.

### 2. Contrôler un Logiciel (Reaper, Ableton...)
**IMPORTANT :** Windows ne permet pas à deux logiciels d'utiliser le même port MIDI en même temps.
Pour contrôler votre DAW depuis AirstepStudio, vous **DEVEZ** utiliser un câble virtuel :
1.  Installez **loopMIDI** (gratuit, Tobias Erichsen).
2.  Créez un port nommé "loopMIDI Port".
3.  Dans **AirstepStudio** : Cochez "loopMIDI Port" dans les sorties.
4.  Dans **Reaper/DAW** : Activez "loopMIDI Port" en **Entrée (Input)** uniquement (Jamais en sortie, sinon boucle infinie !).

### 3. Performance & Réactivité
*   **Input Priming :** L'application "réveille" Windows à chaque changement de profil pour garantir que votre premier appui de pédale soit instantané.
*   **Anti-Flicker :** Le retour au profil "Bureau" est stabilisé (0.5s) pour éviter les changements intempestifs.

## ⌨️ Raccourcis Clavier & Navigation

| Action | Raccourci |
| :--- | :--- |
| **Lecture / Pause** | `Espace` ou `K` |
| **Reculer (-5s)** | `Flèche Gauche` ou `J` |
| **Avancer (+5s)** | `Flèche Droite` ou `L` |
| **Chapitre Précédent** | `Ctrl` + `Flèche Gauche` (ou Touche Média Précédent) |
| **Chapitre Suivant** | `Ctrl` + `Flèche Droite` (ou Touche Média Suivant) |
| **Vitesse** | `Flèche Haut` / `Flèche Bas` |
| **Redémarrer** | `0` ou `Début` |

## 🛠️ Installation (Développeurs)

1.  **Pré-requis :** Python 3.10+
2.  **Installation des dépendances :**
    `pip install -r requirements.txt`
    *(Inclut désormais `customtkinter`, `fastapi`, `uvicorn`, `requests`, `bleak`, `pystray`...)*
3.  **Lancement :**
    `python src/main.py`
    *Note : L'application se lance dans le System Tray. Cherchez l'icône Airstep.*

## 🏗️ Architecture Hybride

*   **Backend (Python) :**
    *   **FastAPI :** Sert le Dashboard et l'API REST/WebSocket.
    *   **Moteur MIDI :** Gère la connexion Bluetooth/USB avec l'AIRSTEP.
    *   **Orchestrateur (`main.py`) :** Synchronise le serveur Web (Background) et l'interface Native (Main Thread).
*   **Frontend (Web) :**
    *   HTML5/CSS3/JS Vanilla.
    *   Communication temps réel via WebSocket.
*   **GUI Native (CustomTkinter) :**
    *   Interface légère pour le retour visuel immédiat et le lanceur d'applications.

## 📦 Compilation

Lancez `build.bat` pour générer l'exécutable portable unique qui contient tout le système.
