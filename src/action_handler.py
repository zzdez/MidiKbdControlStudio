import keyboard
import pygetwindow as gw
import time
import datetime
import threading
import ctypes
import os

# Ctypes Constants for Key Events
VK_LEFT = 0x25
VK_UP = 0x26
VK_RIGHT = 0x27
VK_DOWN = 0x28

# Win32 Constants for ScanCodes
KEYEVENTF_SCANCODE = 0x0008
KEYEVENTF_KEYUP = 0x0002

class ActionHandler:
    def __init__(self):
        self.debounce_timer = None
        self.pending_execution = None
        self.debounce_delay = 0.15 
        self.has_primed = False
        self.current_profile = None
        self.command_callback = None

    def set_command_callback(self, callback):
        """Définit le callback pour les commandes internes (ex: media_pause) -> WebSocket"""
        self.command_callback = callback

    def set_current_profile(self, profile):
        """Définit le profil actif manuellement (ex: via ContextMonitor)"""
        self.current_profile = profile
        if profile:
            self.log(f"Profil Actif défini sur : {profile.get('name')}")

    def set_debounce_delay(self, seconds):
        self.debounce_delay = seconds

    def log(self, message):
        """Log thread-safe"""
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        try:
            with open("debug.log", "a", encoding="utf-8") as f:
                f.write(f"[ACTION] [{timestamp}] {message}\n")
        except: pass

    def get_active_window_title(self):
        """Récupère le titre de la fenêtre active via Win32 API (Plus robuste que pygetwindow)"""
        try:
            if not hasattr(ctypes, 'windll'): return ""
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            if not hwnd: return ""

            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            if length == 0: return ""

            buff = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buff, length + 1)
            return buff.value
        except Exception as e:
            self.log(f"Erreur GetWindowText: {e}")
            return ""

    def get_active_process_name(self):
        """Récupère le nom du .exe actif (Méthode Robuste Windows API)"""
        try:
            if not hasattr(ctypes, 'windll'): return ""
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            if not hwnd: return ""
            pid = ctypes.c_ulong()
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            h_process = ctypes.windll.kernel32.OpenProcess(0x1010, False, pid)
            if not h_process: return ""
            buf = ctypes.create_unicode_buffer(1024)
            size = ctypes.c_ulong(1024)
            if ctypes.windll.kernel32.QueryFullProcessImageNameW(h_process, 0, buf, ctypes.byref(size)):
                path = buf.value
                ctypes.windll.kernel32.CloseHandle(h_process)
                return os.path.basename(path)
            ctypes.windll.kernel32.CloseHandle(h_process)
            return ""
        except Exception as e:
            return ""

    def bring_window_to_front(self, app_context, title_filter):
        """
        Force la fenêtre cible au premier plan (Focus Switch).
        Utilise ctypes pour scanner les fenêtres (EnumWindows).
        """
        if not hasattr(ctypes, 'windll'):
            return

        target_app = app_context.lower() if app_context else ""
        target_title = title_filter.lower() if title_filter else ""

        found_hwnd = None

        # Définition du callback pour EnumWindows
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def enum_window_callback(hwnd, lParam):
            nonlocal found_hwnd

            # 1. Check Visibilité
            if not ctypes.windll.user32.IsWindowVisible(hwnd):
                return True # Continue

            # 2. Check Titre
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            if length == 0: return True

            buff = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buff, length + 1)
            win_title = buff.value.lower()

            # Filtre Titre (si spécifié)
            if target_title and target_title not in win_title:
                return True

            # 3. Check Process Name (si spécifié)
            if target_app:
                pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

                # Open Process (0x1000 = PROCESS_QUERY_LIMITED_INFORMATION)
                h_process = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
                proc_name = ""
                if h_process:
                    buf = ctypes.create_unicode_buffer(1024)
                    size = ctypes.c_ulong(1024)
                    if ctypes.windll.kernel32.QueryFullProcessImageNameW(h_process, 0, buf, ctypes.byref(size)):
                        proc_name = os.path.basename(buf.value).lower()
                    ctypes.windll.kernel32.CloseHandle(h_process)

                if target_app not in proc_name:
                    return True

            # Match Trouvé !
            found_hwnd = hwnd
            return False # Stop enumeration

        # Lancer le scan
        cb_func = WNDENUMPROC(enum_window_callback)
        ctypes.windll.user32.EnumWindows(cb_func, 0)

        if found_hwnd:
            # self.log(f"FOCUS SWITCH: Window Found (HWND {found_hwnd}). Restore & Front.")
            # SW_RESTORE = 9
            if ctypes.windll.user32.IsIconic(found_hwnd):
                ctypes.windll.user32.ShowWindow(found_hwnd, 9)
            ctypes.windll.user32.SetForegroundWindow(found_hwnd)
            time.sleep(0.2) # Increased wait time for Electron/Moises apps
        else:
            self.log(f"FOCUS SWITCH: Cible introuvable (App='{target_app}', Title='{target_title}')")

    def execute(self, cc, value, channel, profiles, force_target_profile=None):
        # On ignore le relâchement (Value 0)
        if value == 0: return

        # Gestion Anti-Rebond (Debounce)
        if self.debounce_timer:
            self.debounce_timer.cancel()

        self.pending_execution = (cc, channel, profiles, force_target_profile)
        self.debounce_timer = threading.Timer(self.debounce_delay, self._process_execution)
        self.debounce_timer.start()

    def _process_execution(self):
        if not self.pending_execution: return

        # Unpack safe
        args = self.pending_execution
        self.pending_execution = None

        if len(args) == 4:
            cc, channel, profiles, force_profile = args
        else:
            cc, channel, profiles = args[:3]
            force_profile = None

        try:
            self._do_execute(cc, channel, profiles, force_profile)
        except Exception as e:
            self.log(f"Erreur Execution : {e}")

    def find_matching_profile(self, profiles, ignore_titles=None):
        """Trouve le profil correspondant à la fenêtre active"""
        raw_title = self.get_active_window_title()
        if not raw_title: return None

        if ignore_titles:
            for ignored in ignore_titles:
                if ignored in raw_title:
                    return None

        active_title = raw_title.lower()
        active_process = self.get_active_process_name().lower()
        
        # self.log(f"MATCHING: App='{active_process}' Title='{raw_title}'")

        best_profile = None
        best_score = -1

        for p in profiles:
            app_filter = p.get('app_context', '').lower()
            title_filter = p.get('window_title_filter', '').lower()

            if not app_filter and not title_filter:
                continue

            match_app = True
            if app_filter:
                match_app = (app_filter in active_process)

            match_title = True
            if title_filter:
                match_title = title_filter in active_title

            if match_app and match_title:
                score = 0
                if app_filter: score += 1
                if title_filter: score += 2
                if score > best_score:
                    best_score = score
                    best_profile = p

        return best_profile

    def _do_execute(self, cc, channel, profiles, force_profile=None):
        # --- CAS FORCE (GUI / Dashboard) ---
        if force_profile:
            self.log(f"ACTION MANUELLE (GUI): Force Profil '{force_profile.get('name')}'")

            # 1. Switch Focus
            app_context = force_profile.get('app_context', '')
            title_filter = force_profile.get('window_title_filter', '')
            self.bring_window_to_front(app_context, title_filter)

            # 2. Trigger Action
            for m in force_profile.get('mappings', []):
                 try:
                    if int(m['midi_cc']) == cc:
                        self.log(f"ACTION : Déclenchement '{m.get('name')}' (Profil: {force_profile['name']})")
                        self.trigger_keystroke(m)
                        return
                 except: continue
            return

        # --- CAS NORMAL (MIDI Auto-Detect ou Profil Actif) ---
        # Si un profil courant est défini (par ContextMonitor), on l'utilise en priorité
        # pour éviter de scanner la fenêtre à chaque CC (performance + stabilité)
        best_profile = self.current_profile

        # Fallback : Si pas de profil défini, on scanne (Legacy behavior)
        if not best_profile:
            best_profile = self.find_matching_profile(profiles)

        if not best_profile:
            # self.log(f"IGNORÉ : Aucun profil trouvé (CC={cc})")
            return

        # 3. Trouver le Mapping dans le profil
        for m in best_profile.get('mappings', []):
            try:
                if int(m['midi_cc']) == cc:
                    self.log(f"ACTION : Déclenchement '{m.get('name')}' (Profil: {best_profile['name']})")
                    self.trigger_keystroke(m)
                    return
            except: continue

    def _send_native_key(self, vk_code):
        """Simulate key press using native Windows API (keybd_event) with Virtual Key Code"""
        if not hasattr(ctypes, 'windll'): return
        try:
            # Press
            ctypes.windll.user32.keybd_event(vk_code, 0, 0, 0)
            time.sleep(0.05)
            # Release (0x0002 = KEYEVENTF_KEYUP)
            ctypes.windll.user32.keybd_event(vk_code, 0, 2, 0)
        except Exception as e:
            self.log(f"Native Key Error: {e}")

    def _send_native_scancode(self, scancode):
        """Simulate key press using native Windows API (keybd_event) with Hardware Scan Code"""
        if not hasattr(ctypes, 'windll'): return
        try:
            # Envoi Pression (Flag 0x0008 = KEYEVENTF_SCANCODE)
            # Param 1 (bVk) est ignoré quand KEYEVENTF_SCANCODE est défini, mais on met 0
            ctypes.windll.user32.keybd_event(0, scancode, KEYEVENTF_SCANCODE, 0)

            time.sleep(0.1) # Maintien physique augmenté pour Electron

            # Envoi Relâchement
            ctypes.windll.user32.keybd_event(0, scancode, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP, 0)
        except Exception as e:
            self.log(f"Native Scancode Error: {e}")

    def trigger_keystroke(self, mapping):
        """
        Exécute la frappe clavier.
        Mode PERROQUET : Utilise les Scan Codes enregistrés si disponibles.
        """
        
        # Données enregistrées par le GUI (REC)
        main_scan_code = mapping.get('action_scan_code')
        modifier_scan_codes = mapping.get('action_modifier_scan_codes', [])
        
        # Données manuelles (Texte)
        text_value = mapping.get('action_value', '')

        # --- CAS SPECIAL : COMMANDES INTERNES (MEDIA) ---
        if text_value and text_value.startswith("media_"):
            self.log(f" -> COMMANDE INTERNE : {text_value}")
            if self.command_callback:
                self.command_callback(text_value)
            return

        # --- Shift Priming (Wake up Chrome/Windows Input Hook) ---
        # if not self.has_primed:
        #    self.log("PRIMING: Injection Shift pour réveiller l'input...")
        #    try:
        #        keyboard.press('shift')
        #        time.sleep(0.05)
        #        keyboard.release('shift')
        #        self.has_primed = True
        #        time.sleep(0.05)
        #    except: pass

        # --- CAS 0 : Native Arrows (Chrome/Songsterr Fix) ---
        # Detection stricte des flèches pour utiliser keybd_event
        if text_value:
            t = text_value.lower().strip()
            vk_target = None
            if t in ['left', 'gauche', 'arrow left']: vk_target = VK_LEFT
            elif t in ['right', 'droite', 'arrow right']: vk_target = VK_RIGHT
            elif t in ['up', 'haut', 'arrow up']: vk_target = VK_UP
            elif t in ['down', 'bas', 'arrow down']: vk_target = VK_DOWN

            if vk_target:
                self.log(f" -> NATIVE ARROW: {t} (VK={vk_target})")
                self._send_native_key(vk_target)
                return

        # --- CAS 1 : MODE PHYSIQUE (Scan Codes) ---
        # C'est la méthode Prioritaire et Robuste pour AZERTY/QWERTY/VLC
        if main_scan_code:
            try:
                # A. Appuyer sur les modifieurs (ex: Shift, Alt) via leurs codes physiques
                if modifier_scan_codes:
                    for mod_sc in modifier_scan_codes:
                        keyboard.press(mod_sc)
                    time.sleep(0.05) 

                # B. Appuyer sur la touche principale
                # Exception pour Espace (57) ou Flèches (75, 77, 72, 80) qui nécessitent souvent du natif (Win32)
                FORCE_NATIVE_CODES = [57, 75, 77, 72, 80]

                if main_scan_code in FORCE_NATIVE_CODES:
                    self.log(f" -> Envoi NATIF (Win32) pour SC {main_scan_code}")
                    self._send_native_scancode(main_scan_code)
                else:
                    # Méthode standard via keyboard library
                    keyboard.press(main_scan_code)
                    time.sleep(0.1) # Increased press duration for reliability
                    keyboard.release(main_scan_code)

                # C. Relâcher les modifieurs
                if modifier_scan_codes:
                    time.sleep(0.05)
                    for mod_sc in reversed(modifier_scan_codes):
                        keyboard.release(mod_sc)
                
                self.log(f" -> Physique OK : SC {main_scan_code} + Mods {modifier_scan_codes}")
                return # Succès, on quitte

            except Exception as e:
                self.log(f"ERREUR PHYSIQUE : {e}. Tentative fallback texte...")

        # --- CAS 2 : MODE TEXTE (Fallback) ---
        # Si pas de scan code (vieux mapping ou entrée manuelle)
        if text_value:
            try:
                # On nettoie un peu
                keys = text_value.lower().replace(" ", "")
                
                # Cas spécial pour les combos simples écrits à la main
                if "+" in keys:
                    keyboard.send(keys)
                else:
                    keyboard.send(keys)
                    
                self.log(f" -> Texte OK : {keys}")
            except Exception as e:
                self.log(f"ERREUR TEXTE : {e}")
