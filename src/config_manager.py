import os
import json
from dotenv import load_dotenv

# Load env vars immediately
load_dotenv()

class ConfigManager:
    def __init__(self, config_file="config.json"):
        self.config_file = config_file
        self.config_data = {}
        self._load_config()

    def _load_config(self):
        """Loads config.json into memory if it exists."""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    self.config_data = json.load(f)
            except Exception as e:
                print(f"Error loading {self.config_file}: {e}")
                self.config_data = {}

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

        # 3. Default
        return default

    def set(self, key, value):
        """
        Sets a value in config.json (persisted).
        It does NOT change environment variables.
        """
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
