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
        # 1. Environment Variable
        env_key = key.upper()
        if os.environ.get(env_key) is not None:
            return os.environ.get(env_key)

        # 2. config.json
        # Handle nested keys if needed, but for now assuming flat or known structure
        # If the key is inside "settings" (based on previous config.json structure)
        if "settings" in self.config_data and key in self.config_data["settings"]:
            return self.config_data["settings"][key]

        if key in self.config_data:
            return self.config_data[key]
            
        # Specific Default for media_folders
        # Specific Default for media_folders
        if key == "media_folders":
            default_path = os.path.join(os.path.expanduser("~"), "Music")
            if os.path.exists(default_path):
                return [default_path]
            return []

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
