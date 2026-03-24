import re

filepath = "src/server.py"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Remplacer 'prefix = parts[0]' par 'prefix = parts[0].lower()'
updated = re.sub(r'prefix = parts\[0\]', 'prefix = parts[0].lower()', content)

if updated != content:
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(updated)
    print("SUCCESS: Prefixes lowercased.")
else:
    print("WARNING: No replacement made.")
