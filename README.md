# MidiKbd Control Studio (Web & Desktop)

Une application hybride (Python/FastAPI + HTML/JS/CSS) conçue pour les musiciens.
Elle permet de contrôler des médias (YouTube, MP3, Vidéos Locales) et d'autres applications Windows (DAWs, Moises, Spotify) directement depuis un pédalier MIDI (comme l'AIRSTEP) ou le clavier de l'ordinateur, grâce à une interface Web unifiée et un exécutable portable.

![MidiKbd Control Studio Web UI](./assets/screenshot.png) *(Note: Image d'illustration)*

---

## 🚀 Fonctionnalités Principales

*   **Plug & Play Universel :** Compatible avec **n'importe quel contrôleur MIDI** : Airstep, Boss FS-1-WL, Chocolate, Korg Nano, Claviers maîtres...
    *   **Double Driver :** Support natif Bluetooth LE (Bleak) et USB (Mido/WinMM).
    *   **Détection Automatique :** Branchez, scannez, c'est détecté.
*   **Mode Service & Portable :** 
    *   L'application démarre discrètement dans la zone de notification (Tray).
    *   **Persistance Absolue :** Vos données (`config.json`, profils) restent indéfiniment attachées à l'exécutable, même lancé depuis un raccourci distant.
*   **Bibliothèque & Smart Launcher :**
    *   Un tiroir ("Drawer") intégré à la télécommande pour lancer vos morceaux et vos applications favorites.
    *   Détection automatique des applications liées à vos profils (ex: lancez "Reaper" et le profil change automatiquement).
*   **Setlist Catégorisée & Intelligente :**
    *   **Modale de recherche YouTube intégrée :** trouvez, prévisualisez et ajoutez vos backing tracks sans quitter l'appli.
    *   **Support des fichiers locaux (MP3/WAV) via streaming natif.**
    *   **Auto-Tag Intelligent :** Recherche automatique des métadonnées et pochettes HD via iTunes API.
    *   **Éditeur de Métadonnées :** Modifiez physiquement vos fichiers (Titres, Artistes...) et gérez vos pochettes d'album directement depuis l'application.
    *   **UI Premium :** Interface modernisée avec **Phosphor Icons** pour une lisibilité parfaite.
    *   Organisez par Artiste, Genre, et ajoutez vos notes personnelles distinctes de la description YouTube.
    *   **Profils Web Universels :** Ajoutez n'importe quel site (Dailymotion, Vimeo...) et associez-lui un profil dédié. L'application détecte automatiquement le contexte grâce au titre de la fenêtre dynamique.
    *   **Smart Embed :** Copiez/collez vos liens standards (Dailymotion, Vimeo) et le lecteur les convertit automatiquement en liens "Embed" compatibles.
*   **Contrôle Hybride & Robuste :**
    *   **Mode WEB :** Pilotez le lecteur YouTube (Play, Pause, Vitesse, Seek)- **Lecteur Vidéo Local**
    - Support MP4, MKV, AVI, MOV.
    - Contrôle de vitesse (0.5x à 2.0x).
    - Pitch Shifting (Changement de tonalité sans changer la vitesse) de -6 à +6 demi-tons.
    - Support Multi-Sous-titres (SRT/VTT) avec sélection de piste en direct via modale.
    - Ajustement interactif (Drag & Drop) de la hauteur des sous-titres, avec sauvegarde globale persistante pour vos prochains visionnages !
    - Navigation par sauts (+/- 5s).
    - **Support des Chapitres :** Détection et affichage interactif des chapitres YouTube (Timeline Marker).
- **Lecteur Audio Local (Simple & Multipistes)**
    - Support MP3, WAV, FLAC, M4A, OGG.
    - **Support Multipistes (Stems) :** Jouez vos morceaux décomposés (basse, batterie, guitare, etc.) en parfaite synchronisation.
    - **UI Harmonisée & Professionnelle :** Unification visuelle totale (codes couleurs, bordures, alignement pixel-perfect) entre les graphiques et les commandes.
    - **Mini-DAW Intégré :** Contrôles ultra-réactifs de Volume, Panoramique, Mute et Solo par piste avec sauvegarde automatique.
    - **Waveform Interactive :** WaveSurfer.js synchronisé avec menu contextuel de colorisation dynamique des pistes.
    - Option de Pitch Shifting et contrôle de vitesse (pour les pistes simples).
*   **Fretboard Interactif & Gammes (Nouveau !) :**
    - **Manche Virtuel & CAGED System :** Affichez un manche (15, 22 ou 24 cases) superposé et déplaçable au-dessus de vos vidéos YouTube, MP3 ou Multipistes pour improviser instantanément en suivant la tonalité de l'œuvre.
    - **Rigueur Pédagogique (Sillet Virtuel) :** Le métronome et l'affichage comprennent la guitare. Les octaves sont scindées avec une rigueur absolue à la frette 12 (Virtual Nut), et rejettent intelligemment toute position mathématiquement "injouable" qui dépasserait les limites du corps de l'instrument.
    - **Générateur d'Exercices en Zig-Zag :** Apprenez les gammes (Pentatonique, Blues, Majeure, Modes) en balayant le manche de manière fluide ("Ascending", "Descending", "Zig-Zag", "Random"). Le métronome dynamique s'adapte à la vitesse de votre média !
    - **Instruments Étendus & Tuning :** Support parfait des Guitares 7 Cordes, Basses 4 & 5 Cordes, et des accordages alternatifs (Drop D, Eb, D Standard). Les boîtes ne dérivent jamais !
    - **Mode Gaucher & Skins :** Option native pour inverser le manche, et sélection du thème visuel (Texture Bois réaliste ou Flat Design) depuis les réglages.
*   **Audio Master Plan :**
    - **Volume Maître par Profil :** Chaque profil peut définir son propre volume système cible. Quand l'application détecte que vous ouvrez "Reaper", elle ajuste automatiquement le volume général de Windows pour vous !
    - **Volume Persistant par Média :** Les lecteurs (Web et Local) mémorisent le volume exact de chaque piste individuellement. Ajustez la jauge en direct, c'est sauvegardé instantanément !
    - Contrôle UX unifié avec pourcentage en temps réel et fonction *Mute* rapide.
    - **Persistance des Options de Lecture :** Vos préférences de lecture (Autoplay, Autoreplay) sont strictement enregistrées par média et garanties sans désynchronisation d'interface lors de vos éditions en arrière-plan.
*   **Métronome Haute Précision (Nouveau !) :**
    - **Web Audio Context :** Remplacement des tickrate logiciels imprécis par une interface à oscillateurs dédiée, synchrone avec le débit du processeur.
    - **Subdivisions Rythmiques :** Support natif des Croches, Triolets et Doubles Croches avec gestion fine de la polyrythmie visuelle et sonore (Clics secondaires différenciés).
    - **Synergie Métronome :** Le métronome recalcule le BPM à la volée en cas de changement de vitesse (*Rate*) sur les lecteurs Web ou locaux.
    - **Interface Compacte :** Harmonisation des champs de configuration (Speed Trainer) pour un rendu moderne et sans débordement.
*   **Boîte à Rythmes & MIDI Wizard (Nouveau !) :**
    - **Moteur 11 Pistes Haute Fidélité :** Séquenceur complet embarquant des sons de légende (Roland TR-808, 909, 505, etc.).
    - **Mixeur Studio Robuste :** Gestion granulaire du volume, du mute et du solo par piste via une architecture objet stable (V7).
    - **MIDI Import Wizard :** Importez n'importe quel fichier MIDI et mappez intelligemment les notes.
    - **Full Song Mode :** Support des morceaux longs avec synchronisation visuelle.
*   **Repères & Décomptes Audio Cues (Nouveau !) :**
    - **Timeline Marker :** Posez des drapeaux pour programmer des avertisseurs visuels HUD avant les couplets.
    - **Global Override :** Mutez l'intégralité des bips d'un clic sur la Cloche sans perdre vos calibrations.
    - **Repères Visuels Timeline :** Affichage automatique de légers traits jaunes permettant de situer instantanément les zones clés.
*   **Système d'Entraînement Avancé (A-B Looping 3 États) :**
    - **Boucles Multiples :** Définissez, nommez et sauvegardez plusieurs boucles (Points A & B) pour chaque morceau, incluant **désormais un support total et visuel pour les vidéos YouTube en streaming**.
    - **Mode Séquentiel Intelligent :** Activez "Boucle Unique" pour répéter la section, ou "Boucle Séquentielle" pour passer automatiquement à la suite d'accords suivante une fois le solo maîtrisé.
    - **Rendu Visuel :** Les boucles s'affichent sous forme de zones sur la timeline (Audio, HTML5 et YouTube), avec le nom de vos sections (Couplet, Refrain...) agissant comme une carte visuelle persistante.
*   **Contrôle Hybride & Robuste :**
    *   **Contrôle Granulaire Vitesse :** Ajustez par pas de 0.05x (sans altération du Pitch/Tonalité).
        *   **Seek de Précision :** +/- 5 secondes.
        *   **Commandes Clavier Natives :** Support direct des flèches directionnelles et de la barre d'espace pour le mapping.
    *   **Injection native des commandes (Win32)** pour piloter même les applications récalcitrantes (Moises, applis Electron).
    *   **Mode WINDOWS :** Simulez des raccourcis clavier pour contrôler vos logiciels ou sites externes.
*   **Overlay Persistant (Remote Control) :**
    *   **Design Compact :** Optimisé pour prendre le moins de place possible sur l'écran.
    *   **Mode Singleton :** Gestion intelligente des fenêtres (ne s'ouvre qu'une fois).
    *   **Smart Close :** Fermez la remote sans être dérangé par la fenêtre principale (qui reste dans le Tray).
    *   **Feedback Visuel Unifié :** Les boutons clignotent que l'action vienne du MIDI, du Clavier (HID) ou du clic souris.
*   **Persistance Sidecar JSON :**
    *   Toutes vos modifications (BPM, Tonalité Originale, Tonalité Média, Pitch, Notes) sont désormais sauvegardées dans un petit fichier `.json` à côté de vos médias locaux.
    *   Vos métadonnées vous suivent partout, même si vous déplacez vos dossiers.
*   **Éditeur de Médias Harmonisé :**
    *   Interface ultra-compacte et professionnelle, identique pour tous les types de médias (YouTube, Local, Multipiste).
    *   **Ligne Technique Unifiée** : BPM, Tonalité Originale, Tonalité Média, Pitch Original et Pitch Média sont désormais regroupés sur une seule ligne pour une visibilité instantanée sans défilement.
    *   **Modale de notes dédiée** fusionnant la description YouTube et vos propres mémos techniques.
    *   **Optimisation Vision :** Plus de barre de défilement parasite dans les modales, tout est accessible en un coup d'œil.

## 🎹 Configuration MIDI (Universel & Multi-Output)

MidiKbd Control Studio permet de piloter **tous vos équipements en même temps**, quel que soit le contrôleur d'entrée utilisé (Airstep, Boss, Korg...).

### 1. Multi-Sorties Simultanées & Smart Matching
Dans *Réglages > MIDI Output*, vous pouvez cocher plusieurs sorties :
*   **Hardware :** Synthétiseurs externes (ex: *Fender Tone Master*), Pédales...
*   **Software :** DAWs (Reaper, Ableton, Cubase...) ou Plugins via un câble virtuel.
*   **Smart Matching (Auto-reconnexion) :** Si Windows renomme votre port MIDI (ex: "Midi 1" devient "Midi 2"), l'application s'y reconnecte automatiquement et met à jour votre profil de manière transparente.

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
| **Lecture / Pause** | `Espace` ou `K` (ou Clic sur la vidéo) |
| **Reculer (-5s)** | `Flèche Gauche` ou `J` |
| **Avancer (+5s)** | `Flèche Droite` ou `L` |
| **Chapitre Précédent** | `Ctrl` + `Flèche Gauche` (ou Touche Média Précédent) |
| **Chapitre Suivant** | `Ctrl` + `Flèche Droite` (ou Touche Média Suivant) |
| **Vitesse** | `Flèche Haut` / `Flèche Bas` |
| **Pitch Shifting** | `Shift` + `Flèche Haut` / `Flèche Bas` |
| **Boucle Suivante** | `Shift` + `Flèche Droite` |
| **Boucle Précédente** | `Shift` + `Flèche Gauche` |
| **Activer/Désactiver Boucle** | `R` (Toggle 3 États) |
| **Redémarrer** | `0` ou `Début` |
| **Démarrer Entraînement** | `Alt` + `Espace` |
| **Recommencer Position** | `Alt` + `Home` ou `0` |
| **Position Précédente** | `Alt` + `Flèche Gauche` |
| **Position Suivante** | `Alt` + `Flèche Droite` |

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

---
### API Credits
Powered by <a href="https://getsongbpm.com">GetSongBPM</a> and <a href="https://getsongkey.com">GetSongKey</a> database.
