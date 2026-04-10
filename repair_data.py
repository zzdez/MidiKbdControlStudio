import os
import json
import hashlib

DATA_DIR = "Data"
FILES = {
    "library": "local_lib.json",
    "setlist": "setlist.json",
    "web_links": "web_links.json"
}

def generate_uid(prefix, item):
    # Base UID on path or url to be semi-stable
    seed = item.get("path") or item.get("url") or (item.get("title", "") + item.get("artist", ""))
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}_{h}"

def repair_file(type_name, filename):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        print(f"Fichier non trouvé : {path}")
        return

    print(f"Réparation de {filename}...")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Erreur de lecture {filename}: {e}")
        return

    prefix = "lib" if type_name == "library" else ("set" if type_name == "setlist" else "web")
    
    for item in data:
        # 1. Vérification/Génération d'UID (Stable V57)
        if not item.get("uid"):
            item["uid"] = generate_uid(prefix, item)
            print(f"  [UID] Généré : {item['uid']} pour '{item.get('title')}'")
            
        # 2. Nettoyage des linked_ids (Suppression des nulls qui font planter le JS)
        if "linked_ids" not in item:
            item["linked_ids"] = []
        elif not isinstance(item["linked_ids"], list):
            item["linked_ids"] = []
            
        # Filtrage des nulls, des types incorrects et des chaînes vides
        old_links = item["linked_ids"]
        new_links = [l for l in old_links if l and isinstance(l, str) and l.strip() != ""]
        
        # Purge des anciens liens d'indexation instables (ex: "lib:5") s'ils sont corrompus
        final_links = []
        for l in new_links:
            if ":" in l and not "_" in l:
                # C'est un vieux lien type lib:0. On le garde pour l'instant mais on logue
                print(f"  [LEGACY] Lien index trouvé ({l}) dans {item['uid']}")
            final_links.append(l)

        if len(final_links) != len(old_links):
            item["linked_ids"] = final_links
            print(f"  [CLEAN] Nettoyage liens pour {item['uid']} ({len(old_links) - len(final_links)} entrées invalides supprimées)")

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        print(f"Succès : {filename} réparé.")
    except Exception as e:
        print(f"Erreur d'écriture {filename}: {e}")

if __name__ == "__main__":
    print("--- DÉMARRAGE DE LA RÉPARATION DES DONNÉES ---")
    for t, f in FILES.items():
        repair_file(t, f)
    print("--- RÉPARATION TERMINÉE ---")
