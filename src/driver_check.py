import os
import sys
import platform

def is_korg_driver_installed():
    """
    Vérifie la présence du driver KORG BLE-MIDI sur Windows.
    Retourne (bool, message).
    """
    if platform.system() != "Windows":
        # Pour le développement sur Linux/Mac, on retourne False ou on simule
        return False, "Système non-Windows"

    # 1. Vérification des dossiers par défaut
    paths = [
        r"C:\Program Files (x86)\KORG\KORG BLE-MIDI Driver",
        r"C:\Program Files\KORG\KORG BLE-MIDI Driver"
    ]

    for p in paths:
        if os.path.exists(p):
            return True, "Installé (Dossier trouvé)"

    # 2. Vérification Registre
    try:
        import winreg
        keys = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\KORG\KORG BLE-MIDI Driver"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\KORG\KORG BLE-MIDI Driver")
        ]

        for root, subkey in keys:
            try:
                with winreg.OpenKey(root, subkey) as key:
                    return True, "Installé (Registre)"
            except OSError:
                continue
    except ImportError:
        pass
    except Exception:
        pass

    return False, "Non détecté"
