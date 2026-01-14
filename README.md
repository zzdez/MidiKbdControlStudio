# AirstepStudio (Web Edition)

**AirstepStudio** est la nouvelle génération de la station de contrôle pour musiciens.
C'est une **Application Web Locale** (Local Web App) qui combine la puissance de Python pour le matériel (MIDI, Bluetooth) avec la flexibilité du Web pour l'interface (YouTube, Audio, Design).

## 🚀 Pourquoi cette architecture ?
*   **YouTube Natif :** Utilisation du vrai lecteur YouTube (IFrame API) pour une compatibilité parfaite (Sous-titres, Traduction Auto).
*   **Interface Moderne :** Un tableau de bord fluide (HTML/CSS).
*   **Contrôle Total :** Le backend Python continue de gérer le Bluetooth (Airstep) et le pilotage des fenêtres Windows (Focus Switch).

## 🛠️ Installation (Développeurs)
1.  **Pré-requis :** Python 3.10+
2.  **Installation :**
    `pip install -r requirements.txt`
3.  **Lancement :**
    `python src/main.py`

## 📦 Compilation
Lancez `build.bat` pour générer l'exécutable portable.
