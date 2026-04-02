import os
import json
from dotenv import load_dotenv
from utils import get_app_dir

# Load env vars immediately
load_dotenv()

class ConfigManager:
    def __init__(self, config_file="config.json"):
        self.config_file = os.path.join(get_app_dir(), config_file)
        self.config_data = {}
        self._load_config()
        
        # Ensure internal Media directories exist at startup
        from utils import get_internal_media_dirs
        get_internal_media_dirs()

    def _load_config(self):
        """Loads config.json into memory if it exists. Creates it if missing."""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    self.config_data = json.load(f)
            except Exception as e:
                print(f"Error loading {self.config_file}: {e}")
                self.config_data = {"settings": {}}
        else:
            self.config_data = {"settings": {}}
            self._save_config()

    def get(self, key, default=None):
        """
        Retrieves a configuration value with priority:
        1. Environment Variable (Upper Case)
        2. config.json (exact key)
        3. Default value
        """
        # Environment Variable (Highest Priority)
        env_key = key.upper()
        if os.environ.get(env_key) is not None:
            return os.environ.get(env_key)

        # SPECIFIC LOGIC: Internal Media folders (Prioritized & Merged)
        if key == "media_folders":
            from utils import get_internal_media_dirs, to_portable_path
            internal_dirs = get_internal_media_dirs() 
            
            # Get existing from config
            saved_dirs = []
            if "settings" in self.config_data and "media_folders" in self.config_data["settings"]:
                saved_dirs = self.config_data["settings"]["media_folders"]
            elif "media_folders" in self.config_data:
                saved_dirs = self.config_data["media_folders"]
            
            # Merge and prioritize internal (as portable paths)
            final_dirs = [to_portable_path(d) for d in internal_dirs]
            for d in saved_dirs:
                if d not in final_dirs:
                    final_dirs.append(d)
            return final_dirs

        # JSON config backup
        if "settings" in self.config_data and key in self.config_data["settings"]:
            return self.config_data["settings"][key]

        if key in self.config_data:
            return self.config_data[key]
            
        # Specific Default for language
        if key == "language":
            return "fr"

        # 3. Default
        return default

    def set(self, key, value):
        """
        Sets a value in config.json (persisted) or .env (if it's an API Key).
        """
        env_key = key.upper()
        if "API_KEY" in env_key:
            import dotenv
            env_path = os.path.join(get_app_dir(), ".env")
            if not os.path.exists(env_path):
                # Create default .env with template hint
                try:
                    with open(env_path, "w", encoding="utf-8") as f:
                        f.write(f"# Midi-Kbd Control Studio Environment File\n")
                except Exception as e:
                    print(f"Error creating .env: {e}")
            
            # Set via python-dotenv
            try:
                dotenv.set_key(env_path, env_key, str(value))
                # Update OS environ so it's immediately available without restart
                os.environ[env_key] = str(value)
            except Exception as e:
                print(f"Error saving to .env: {e}")
            return
            
        # Normal configuration save
        if "settings" not in self.config_data:
            self.config_data["settings"] = {}

        self.config_data["settings"][key] = value
        self._save_config()

    def _save_config(self):
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(self.config_data, f, indent=4)
        except Exception as e:
            print(f"Error saving config: {e}")
