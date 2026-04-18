import os
import json
import hashlib
import logging
from utils import get_app_dir, get_data_dir

# Configuration des chemins via utils pour garantir la portabilité
def get_data_filepaths():
    data_dir = get_data_dir()
    return {
        'lib': os.path.join(data_dir, "local_lib.json"),
        'set': os.path.join(data_dir, "setlist.json"),
        'web': os.path.join(data_dir, "web_links.json"),
        'main': os.path.join(data_dir, "library.json"),
        'apps': os.path.join(data_dir, "apps.json")
    }

def consolidate_data_folders():
    """
    Migration V6.1 : Déplace les fichiers JSON orphelins de la racine vers 'data/'.
    Supprime les fichiers vides ou redondants.
    """
    app_dir = get_app_dir()
    data_dir = get_data_dir()
    
    # Liste des fichiers à surveiller à la racine
    targets = ["library.json", "setlist.json", "web_links.json", "apps.json", "local_lib.json"]
    
    for filename in targets:
        root_path = os.path.join(app_dir, filename)
        target_path = os.path.join(data_dir, filename)
        
        if os.path.exists(root_path):
            # 1. Vérifier si le fichier est vide
            if os.path.getsize(root_path) < 10: # Presque vide (ex: [] ou {})
                try:
                    os.remove(root_path)
                    logging.warning(f"[MAINTENANCE] Suppression du fichier résiduel vide: {filename}")
                except: pass
                continue
            
            # 2. Si le fichier contient des données
            if not os.path.exists(target_path):
                # On le déplace simplement
                try:
                    import shutil
                    shutil.move(root_path, target_path)
                    logging.warning(f"[MAINTENANCE] Migration réussie de {filename} vers data/")
                except Exception as e:
                    logging.error(f"[MAINTENANCE] Erreur migration {filename}: {e}")
            else:
                # Conflit : Les deux existent. Sécurité : on renomme l'ancien en .bak
                try:
                    bak_path = root_path + ".bak"
                    os.rename(root_path, bak_path)
                    logging.warning(f"[MAINTENANCE] Conflit détecté pour {filename}. Racine renommé en .bak")
                except: pass

def generate_uid(prefix, item):
    """Génère un UID stable basé sur le contenu."""
    seed = item.get("path") or item.get("url") or (item.get("title", "") + item.get("artist", ""))
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}_{h}"

def heal_all_meshes():
    """
    V59: Point d'entrée de la maintenance au démarrage.
    Garantit que 100% des liens sont synchronisés et utilisent des UIDs stables.
    """
    # Migration structurelle d'abord
    try:
        consolidate_data_folders()
    except Exception as e:
        logging.error(f"[MAINTENANCE] Erreur lors de la consolidation: {e}")

    logging.warning("[MAINTENANCE] Démarrage de la consolidation globale du maillage...")
    
    file_map = get_data_filepaths()
    databases = {}
    uid_to_item = {}
    legacy_to_uid = {}

    # 1. Chargement et Réparation des UIDs
    for prefix, path in file_map.items():
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    db = json.load(f)
                    databases[prefix] = db
                    for i, it in enumerate(db):
                        # Garantir un UID stable
                        if not it.get("uid"):
                            it["uid"] = generate_uid(prefix, it)
                        
                        uid = it["uid"]
                        uid_to_item[uid] = (prefix, it)
                        # Pour migrer les anciens liens type 'lib:5'
                        legacy_to_uid[f"{prefix}:{i}"] = uid
            except Exception as e:
                logging.error(f"[MAINTENANCE] Erreur chargement {path}: {e}")

    if not uid_to_item:
        logging.info("[MAINTENANCE] Aucune donnée à traiter.")
        return

    # 2. Migration des liens Legacy vers UIDs stables
    migration_count = 0
    for prefix, db in databases.items():
        for item in db:
            links = item.get("linked_ids", [])
            if not isinstance(links, list): 
                item["linked_ids"] = []
                continue
                
            new_links = []
            changed = False
            for l in links:
                if not l or not isinstance(l, str): continue
                # Si c'est un format Legacy 'type:idx' (ex: 'lib:5')
                if ":" in l and "_" not in l:
                    if l in legacy_to_uid:
                        new_links.append(legacy_to_uid[l])
                        changed = True
                        migration_count += 1
                    else:
                        new_links.append(l)
                else:
                    new_links.append(l)
            if changed:
                item["linked_ids"] = list(set(new_links))

    # 3. Calcul des Meshes Transitifs (Découverte multidirectionnelle)
    all_uids = list(uid_to_item.keys())
    visited = set()
    groups = []

    for start_uid in all_uids:
        if start_uid in visited: continue
        
        family = {start_uid}
        last_size = 0
        while len(family) > last_size:
            last_size = len(family)
            for uid, (prefix, it) in uid_to_item.items():
                item_links = set(it.get("linked_ids", []))
                # Si l'item pointe vers la famille ou si la famille contient déjà l'item
                if uid not in family:
                    if any(link in family for link in item_links):
                        family.add(uid)
                else:
                    # Ajouter tout ce vers quoi cet item de la famille pointe
                    for l in item_links:
                        if l: family.add(l)
        
        visited.update(family)
        if len(family) > 1:
            groups.append(family)

    # 4. Harmonisation Physique (Full Mesh Expansion)
    dirty_prefixes = set()
    for group in groups:
        for uid in group:
            prefix, item = uid_to_item[uid]
            # Le maillage complet = tout le groupe sauf soi-même
            new_links = list(group - {uid})
            new_links.sort()
            
            old_links = item.get("linked_ids", [])
            old_links.sort()
            
            if new_links != old_links:
                item["linked_ids"] = new_links
                dirty_prefixes.add(prefix)

    # 5. Sauvegarde des changements
    if dirty_prefixes or migration_count > 0:
        actual_change = False
        for prefix, db in databases.items():
            if prefix in dirty_prefixes:
                path = file_map[prefix]
                try:
                    # Idempotency check: Load existing and compare
                    if os.path.exists(path):
                        with open(path, "r", encoding="utf-8") as f_check:
                            old_raw = f_check.read()
                        new_raw = json.dumps(db, indent=4)
                        if old_raw.strip() == new_raw.strip():
                            continue
                            
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(db, f, indent=4)
                    logging.warning(f"[MAINTENANCE] {prefix.upper()} synchronisé et réparé.")
                    actual_change = True
                except Exception as e:
                    logging.error(f"[MAINTENANCE] Erreur sauvegarde {prefix}: {e}")
        
        if actual_change:
            logging.warning(f"[MAINTENANCE] Consolidation terminée. {len(groups)} groupes harmonisés, {migration_count} liens migrés.")
        else:
            logging.info("[MAINTENANCE] Les données étaient déjà harmonisées sur disque.")
    else:
        logging.info("[MAINTENANCE] Les données sont déjà saines et synchronisées.")
