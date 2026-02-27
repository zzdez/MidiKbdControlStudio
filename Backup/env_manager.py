import os

class EnvManager:
    def __init__(self, filepath=".env"):
        self.filepath = filepath
        self.env_vars = {}
        self.load()

    def load(self):
        self.env_vars = {}

        # Ensure .env exists from template if missing
        if not os.path.exists(self.filepath):
            template_path = self.filepath + ".template"
            if os.path.exists(template_path):
                try:
                    with open(template_path, "r", encoding="utf-8") as src:
                        content = src.read()
                    with open(self.filepath, "w", encoding="utf-8") as dst:
                        dst.write(content)
                except Exception as e:
                    print(f"Error creating .env from template: {e}")

        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"): continue
                        if "=" in line:
                            key, val = line.split("=", 1)
                            self.env_vars[key.strip()] = val.strip()
            except Exception as e:
                print(f"Error loading .env: {e}")

    def get(self, key, default=None):
        return self.env_vars.get(key, default)

    def set(self, key, value):
        self.env_vars[key] = value
        self.save()

    def save(self):
        try:
            # Read existing to preserve comments?
            # For now simple overwrite to ensure correctness of managed keys.
            # Ideally we would update in place, but that's complex.
            # We'll just write what we have.
            with open(self.filepath, "w", encoding="utf-8") as f:
                for k, v in self.env_vars.items():
                    f.write(f"{k}={v}\n")
        except Exception as e:
            print(f"Error saving .env: {e}")
