import os
import json
import sys
import shutil
from utils import get_app_dir, get_resource_path

class I18nManager:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(I18nManager, cls).__new__(cls)
            cls._instance.init_once()
        return cls._instance
        
    def init_once(self):
        self.current_lang = "fr"
        self.translations = {}
        self.supported_langs = ["fr", "en"]
        self.locales_exported = False
        
    def set_language(self, lang_code):
        if lang_code in self.supported_langs:
            self.current_lang = lang_code
            self.load_translations()
            return True
        return False
        
    def get_current_language(self):
        return self.current_lang
        
    def export_locales(self):
        """Copies internalized locales to the external application directory if missing or outdated."""
        if not getattr(sys, 'frozen', False):
            return # No need to export in dev
            
        external_dir = os.path.join(get_app_dir(), "locales")
        internal_dir = get_resource_path("locales")
        
        try:
            if not os.path.exists(external_dir):
                os.makedirs(external_dir, exist_ok=True)
                
            for lang in self.supported_langs:
                src = os.path.join(internal_dir, f"{lang}.json")
                dst = os.path.join(external_dir, f"{lang}.json")
                
                # Copy if missing or out of date. To be perfectly safe, always copy
                # internal version to external dir during startup. User edits should 
                # be done in 'src/locales', not in the runtime 'locales' folder.
                if os.path.exists(src):
                    try:
                        shutil.copy2(src, dst)
                        print(f"[I18N] Exported/Updated: {dst}")
                    except PermissionError:
                        print(f"[I18N] Permission Error: Could not overwrite {dst} (file might be in use).")
                        
            self.locales_exported = True
        except Exception as e:
            print(f"[I18N] Export failed: {e}")

    def load_translations(self):
        # 1. Try external (user modified)
        external_path = os.path.join(get_app_dir(), "locales", f"{self.current_lang}.json")
        # 2. Try internal (bundled)
        internal_path = get_resource_path(os.path.join("locales", f"{self.current_lang}.json"))
        
        target_path = external_path if os.path.exists(external_path) else internal_path
        
        try:
            if os.path.exists(target_path):
                with open(target_path, "r", encoding="utf-8") as f:
                    self.translations = json.load(f)
            else:
                print(f"[I18N] WARNING: Translation file not found: {target_path}")
                self.translations = {}
        except Exception as e:
            print(f"[I18N] Error loading locales at {target_path}: {e}")
            self.translations = {}
            
    def get_text(self, key_path, default=None, **kwargs):
        keys = key_path.split('.')
        val = self.translations
        
        try:
            for k in keys:
                val = val[k]
        except (KeyError, TypeError):
            # Fallback to default or pure key path if missing
            return default if default is not None else key_path
            
        if isinstance(val, str) and kwargs:
            try:
                return val.format(**kwargs)
            except KeyError:
                return val
        elif isinstance(val, str):
            return val
            
        return default if default is not None else key_path

# Helper singleton function
i18n = I18nManager()

def _(key_path, default=None, **kwargs):
    """Shorthand for translation"""
    return i18n.get_text(key_path, default=default, **kwargs)
