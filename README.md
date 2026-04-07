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
    *   **UI Premium :** Interface modernisée avec **Phosphor Icons** pour une lisibilité parfaite. Surlignage intelligent et défilement automatique vers le morceau actif.
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
    - **UI Harmonisée & Professionnelle :** Unification visuelle totale (codes couleurs, bordures, alignement pixel-perfect) entre les graphiques et les commandes. Hauteur des barres de transport standardisée à **55px**, Header Cockpit à **80px** avec pochette média pleine hauteur.
    - **Waveform Interactive :** WaveSurfer.js synchronisé avec menu contextuel de colorisation dynamique des pistes.
    - Option de Pitch Shifting et contrôle de vitesse (pour les pistes simples).
*   **Fretboard Interactif & Gammes :**
    - **Manche Virtuel & CAGED System :** Affichez un manche (15, 22 ou 24 cases) superposé et déplaçable au-dessus de vos vidéos YouTube, MP3 ou Multipistes pour improviser instantanément en suivant la tonalité de l'œuvre.
    - **Smart Badge Header :** Visualisation immédiate de la Tonalité et de la Gamme dans le header. Cliquez sur le badge pour ouvrir instantanément le manche !
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
    - **Moteur 11 Pistes Haute Fidélité :** Séquenceur complet embarquant des sons de légende (TR-808, 909, etc.). Gestion dynamique de la basse (invisible en mode 808, active en mode MIDI Import).
    - **Mixeur Studio Intelligent :** Rafraîchissement automatique des pistes selon le morceau chargé (0.05x precision).
    - **Assistant MIDI (Wizard) :** Support bilingue intégral (FR/EN) pour l'importation et le mapping intelligent des morceaux complexes.
*   **Repères & Décomptes Audio Cues (Nouveau !) :**
    - **Timeline Marker :** Posez des drapeaux pour programmer des avertisseurs visuels HUD avant les couplets.
    - **Global Override :** Mutez l'intégralité des bips d'un clic sur la Cloche sans perdre vos calibrations.
    - **Repères Visuels Timeline :** Affichage automatique de légers traits jaunes permettant de situer instantanément les zones clés.
*   **Système d'Entraînement Avancé (A-B Looping & Speed Trainer) :**
    - **Boucles Multiples :** Définissez, nommez et sauvegardez plusieurs boucles (Points A & B) pour chaque morceau, incluant **désormais un support total et visuel pour les vidéos YouTube en streaming**.
    - **Mode Séquentiel Intelligent :** Activez "Boucle Unique" pour répéter la section, ou "Boucle Séquentielle" pour passer automatiquement à la suite d'accords suivante une fois le solo maîtrisé.
    - **Speed Trainer Progressif :** Augmentez automatiquement le BPM de vos boucles après chaque cycle. Le système détecte intelligemment le tempo original de vos morceaux pour proposer un départ à 75% et une cible à 100%.
    - **Moteur Stabilisé :** Protection anti-rebond (Debounce) pour garantir un comptage précis des cycles même sur des boucles très courtes.
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
    *   Toutes vos modifications (BPM, Tonalité Originale, Tonalité Média, Pitch, Notes, **Liens d'interconnexion**) sont désormais sauvegardées dans un petit fichier `.json` à côté de vos médias locaux.
    *   **Moteur de Fusion Intelligente** : Les métadonnées existantes sont préservées lors des mises à jour, garantissant une intégrité totale de votre base de données locale.
    *   Vos métadonnées vous suivent partout, même si vous déplacez vos dossiers.
*   **Éditeur de Médias Unifié :**
    *   **Interface Unique** : Fusion totale des outils d'édition. Les médias YouTube, Audios/Vidéos locaux et Multipistes partagent désormais la même structure technique (`media-modal`), garantissant une expérience fluide et une maintenance simplifiée.
    *   **Design Studio "Pixel-Perfect"** : Interface ultra-compacte et professionnelle. Alignement rigoureux des marges et paddings pour une visibilité totale sans défilement parasite.
    *   **Ligne Technique Unifiée** : BPM, Tonalité Originale, Tonalité Média, Pitch Original et Pitch Média sont regroupés sur une seule ligne pour une visibilité instantanée.
    *   **Support Wide Art (16:9)** : Les pochettes d'albums et miniatures YouTube s'affichent dans leur format d'origine (panoramique) sans déformation.
    *   **Modale de notes dédiée** fusionnant la description YouTube et vos propres mémos techniques.
*   **Navigation & Ergonomie :**
    *   **Auto-Restart** : Tous les lecteurs reviennent automatiquement à 00:00 une fois le morceau terminé.
    *   **Annulation Boucle** : Touche `Echap` pour annuler la sélection d'un point A ou B instantanément.
*   **Résilience & Gestion de Portabilité Avancée (Nouveau !) :**
    *   **Assistant de Réparation** : Si vous déplacez vos fichiers ou changez de disque (ex: de `C:` vers `D:\`), l'application le détecte et vous propose de les retrouver.
    *   **Workflow en 2 Étapes** : Une fois le fichier localisé (via scan intelligent ou sélection manuelle), vous choisissez l'action :
        *   **Lier** : Met à jour le chemin sans toucher au fichier.
        *   **Copier** : Importe une copie dans les dossiers `Medias/` de l'application (Dossier portable).
        *   **Déplacer** : Range physiquement votre fichier original dans la structure propre de l'application.
    *   **Rangement Automatisé** : Le système trie vos fichiers dans les bons dossiers (`Audios`, `Videos`, `Midi` ou `Multipistes`) selon leur format.
    *   **Scan Multi-Lecteurs** : Capacité de scanner la racine de tous les disques physiques pour localiser vos médias perdus en quelques secondes.
    *   **Re-scan des Stems** : Pour les projets multipistes, le système reconstruit instantanément les liens de chaque piste après un déplacement.
    *   **Portabilité Totale** : Utilisation systématique du token `${APP_DIR}`, garantissant que votre bibliothèque vous suit partout, même sur une clé USB.
    *   **Sidecars Intelligents** : Vos sous-titres et métadonnées JSON suivent automatiquement le média lors d'un déplacement physique.
*   **Interconnexion de Médias (Maillage Intelligent) :**
    - **Ponts Automatiques** : Liez n'importe quel morceau à sa version YouTube, son fichier MP3 local, son projet Multipiste ou des sites Web tiers (Songsterr, Moises, Spotify).
    - **Persistence Blindée (V57)** : Migration vers des **UIDs stables** (identifiants uniques). Vos liens ne sont plus brisés si vous déplacez un fichier ou changez l'ordre de votre bibliothèque.
    - **Startup Self-Healing** : Un moteur de nettoyage automatique au démarrage répare les liens orphelins et garantit la symétrie entre vos bases de données.
    - **Démarrage Synchrone** : Architecture optimisée pour éliminer les "Race Conditions". Vos icônes d'interconnexion (Songsterr, etc.) apparaissent instantanément après chaque rafraîchissement (F5).
    - **Header Cockpit Dynamique** : Des icônes interactives (Vidéo, Audio, Multipiste, Web) apparaissent instantanément dans le panneau de contrôle dès qu'une liaison est configurée.
    - **Visualisation de Bibliothèque** : Affichage d'un badge bleu "ID-Link" et d'un compteur filtré (affichage des liens valides uniquement) dans toutes les listes.


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
| **Annuler Boucle (A/B)** | `Echap` |

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
