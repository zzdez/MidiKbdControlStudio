
import os
import sys
import shutil

class DependencyManager:
    """
    Vérifie la présence des outils externes requis pour les fonctionnalités
    sensibles (Téléchargement YT, Conversion).
    """
    REQUIRED_TOOLS = ["yt-dlp.exe", "ffmpeg.exe"]

    @staticmethod
    def check_availability():
        """
        Vérifie si les outils sont présents dans le dossier de l'exécutable
        ou le dossier de travail actuel (Mode Dev).
        """
        # Determine search paths
        search_paths = []
        
        # 1. Executable Directory (Portable Mode)
        if getattr(sys, 'frozen', False):
            search_paths.append(os.path.dirname(sys.executable))
        
        # 2. Working Directory (Dev & User Tests)
        search_paths.append(os.getcwd())

        status = {
            "can_download": True,
            "missing": [],
            "found_paths": {}
        }

        for tool in DependencyManager.REQUIRED_TOOLS:
            found = False
            for path in search_paths:
                full_path = os.path.join(path, tool)
                if os.path.exists(full_path):
                    status["found_paths"][tool] = full_path
                    found = True
                    break
            
            if not found:
                status["missing"].append(tool)
                status["can_download"] = False

        return status
