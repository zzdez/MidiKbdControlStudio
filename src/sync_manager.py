import os
import json
import shutil
import hashlib
from typing import Dict, List, Optional
from datetime import datetime
import paramiko
import logging
from cryptography.fernet import Fernet

def deep_merge(target: dict, source: dict) -> dict:
    """Recursively merge source dictionary into target."""
    for key, value in source.items():
        if isinstance(value, dict) and key in target and isinstance(target[key], dict):
            target[key] = deep_merge(target[key], value)
        else:
            target[key] = value
    return target

class SyncProvider:
    def list_files(self, directory: str) -> Dict[str, dict]:
        """Returns a flat dictionary of {relative_path: {'mtime': float, 'size': int}}"""
        raise NotImplementedError

    def download_file(self, remote_path: str, local_path: str) -> bool:
        raise NotImplementedError

    def upload_file(self, local_path: str, remote_path: str) -> bool:
        raise NotImplementedError


class LocalProvider(SyncProvider):
    def __init__(self, root_dir: str):
        self.root_dir = root_dir

    def list_files(self, relative_dir: str = "") -> Dict[str, dict]:
        result = {}
        target_dir = os.path.join(self.root_dir, relative_dir)
        if not os.path.exists(target_dir):
            return result
        
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, self.root_dir).replace('\\', '/')
                stat = os.stat(full_path)
                result[rel_path] = {'mtime': stat.st_mtime, 'size': stat.st_size}
        return result

    def download_file(self, remote_relative_path: str, local_absolute_path: str) -> bool:
        src = os.path.join(self.root_dir, remote_relative_path)
        os.makedirs(os.path.dirname(local_absolute_path), exist_ok=True)
        shutil.copy2(src, local_absolute_path)
        return True

    def upload_file(self, local_absolute_path: str, remote_relative_path: str) -> bool:
        dst = os.path.join(self.root_dir, remote_relative_path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(local_absolute_path, dst)
        return True


class SftpProvider(SyncProvider):
    def __init__(self, host: str, port: int, username: str, password: str, remote_root: str):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.remote_root = remote_root
        self.ssh = paramiko.SSHClient()
        self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.sftp = None

    def connect(self):
        if self.sftp is None:
            self.ssh.connect(self.host, port=self.port, username=self.username, password=self.password)
            self.sftp = self.ssh.open_sftp()

    def close(self):
        if self.sftp:
            self.sftp.close()
            self.sftp = None
        self.ssh.close()

    def list_files(self, relative_dir: str = "") -> Dict[str, dict]:
        self.connect()
        result = {}
        
        # Ensure remote_root doesn't end with slash
        root = self.remote_root.rstrip('/')
        if not root: root = "."
        
        target_dir = f"{root}/{relative_dir}".replace('//', '/').rstrip('/')
        if not target_dir: target_dir = "."
        
        logging.warning(f"[SFTP] Tentative de listing dans: {target_dir} (Root: {root})")
        
        try:
            self.sftp.stat(target_dir)
        except IOError:
            logging.warning(f"[SFTP] Le dossier racine '{target_dir}' n'existe pas encore.")
            return {}

        def _walk(path):
            try:
                for entry in self.sftp.listdir_attr(path):
                    if entry.filename in ['.', '..']: continue
                    
                    full_p = f"{path}/{entry.filename}".replace('//', '/')
                    import stat
                    if stat.S_ISDIR(entry.st_mode):
                        _walk(full_p)
                    else:
                        # CRITICAL: Normalize rel_path by stripping the root part
                        # We must handle both absolute and relative roots
                        norm_p = full_p
                        if norm_p.startswith('./'): norm_p = norm_p[2:]
                        
                        clean_root = root
                        if clean_root.startswith('./'): clean_root = clean_root[2:]
                        
                        if norm_p.startswith(clean_root):
                            rel_path = norm_p[len(clean_root):].lstrip('/')
                        else:
                            rel_path = norm_p # Fallback
                        
                        result[rel_path] = {'mtime': entry.st_mtime, 'size': entry.st_size}
            except IOError as e:
                logging.warning(f"[SFTP] Erreur lors du listing de {path} : {e}")
        
        _walk(target_dir)
        return result

    def download_file(self, remote_relative_path: str, local_absolute_path: str) -> bool:
        self.connect()
        src = f"{self.remote_root}/{remote_relative_path}".replace('//', '/')
        os.makedirs(os.path.dirname(local_absolute_path), exist_ok=True)
        self.sftp.get(src, local_absolute_path)
        return True

    def _mkdir_p(self, remote_directory):
        """Recursively create directories on the SFTP server."""
        if not remote_directory or remote_directory in ['.', '/']:
            return

        dirs = []
        path = remote_directory
        while path and path not in ['.', '/']:
            try:
                self.sftp.stat(path)
                break
            except IOError:
                dirs.append(path)
                path = os.path.dirname(path).replace('\\', '/')
        
        while dirs:
            target = dirs.pop()
            try:
                logging.warning(f"[SFTP] Creating directory: {target}")
                self.sftp.mkdir(target)
            except IOError as e:
                # Might already exist (race condition)
                pass

    def upload_file(self, local_absolute_path: str, remote_relative_path: str) -> bool:
        self.connect()
        root = self.remote_root.rstrip('/')
        dst = f"{root}/{remote_relative_path}".replace('//', '/')
        dst_dir = os.path.dirname(dst)
        
        logging.warning(f"[SFTP] Uploading to: {dst}")
        try:
            self._mkdir_p(dst_dir)
            self.sftp.put(local_absolute_path, dst)
            return True
        except Exception as e:
            logging.warning(f"[SFTP] Echec de l'upload pour {dst} : {e}")
            raise e

class WebdavProvider(SyncProvider):
    def __init__(self, url: str, username: str, password: str):
        self.url = url.rstrip('/')
        self.username = username
        self.password = password
        import requests
        self.session = requests.Session()
        self.session.auth = (username, password)

    def list_files(self, relative_dir: str = "") -> Dict[str, dict]:
        import xml.etree.ElementTree as ET
        from urllib.parse import unquote
        
        result = {}
        target_url = f"{self.url}/{relative_dir}".rstrip('/') + '/'
        
        headers = {'Depth': 'infinity'}
        try:
            response = self.session.request('PROPFIND', target_url, headers=headers)
            if response.status_code not in [200, 207]:
                # If infinity not supported, fallback to 1 and manual recursion
                return self._list_manual(relative_dir)
            
            # Parse Multistatus XML
            root = ET.fromstring(response.content)
            namespace = {'d': 'DAV:'}
            
            for resp in root.findall('d:response', namespace):
                href = unquote(resp.find('d:href', namespace).text)
                # Normalize href to be relative to our base URL
                base_path = self.url.split('//')[-1].split('/', 1)[-1]
                if base_path and not base_path.startswith('/'): base_path = '/' + base_path
                
                rel_p = href
                if base_path and rel_p.startswith(base_path):
                    rel_p = rel_p[len(base_path):].lstrip('/')
                
                if not rel_p: continue # Root folder
                
                propstat = resp.find('d:propstat', namespace)
                if propstat is None: continue
                prop = propstat.find('d:prop', namespace)
                if prop is None: continue
                
                # Check if it's a collection (folder)
                resourcetype = prop.find('d:resourcetype', namespace)
                if resourcetype is not None and resourcetype.find('d:collection', namespace) is not None:
                    continue
                    
                getlastmod = prop.find('d:getlastmodified', namespace)
                getsize = prop.find('d:getcontentlength', namespace)
                
                mtime = 0
                if getlastmod is not None:
                    try:
                        from email.utils import parsedate_to_datetime
                        mtime = parsedate_to_datetime(getlastmod.text).timestamp()
                    except: pass
                
                size = 0
                if getsize is not None:
                    try: size = int(getsize.text)
                    except: pass
                
                result[rel_p] = {'mtime': mtime, 'size': size}
                
            return result
        except Exception as e:
            logging.warning(f"[WebDAV] Error listing {target_url}: {e}")
            return {}

    def _list_manual(self, relative_dir: str):
        # Fallback manual list if Depth: infinity is disabled (common on IIS)
        import xml.etree.ElementTree as ET
        from urllib.parse import unquote
        namespace = {'d': 'DAV:'}
        result = {}
        folders_to_scan = [relative_dir.strip('/')]
        
        # Determine base path for normalization
        base_path = self.url.split('//')[-1].split('/', 1)[-1]
        if base_path and not base_path.startswith('/'): base_path = '/' + base_path
        if not base_path: base_path = "/"

        while folders_to_scan:
            current_rel = folders_to_scan.pop(0)
            target_url = f"{self.url}/{current_rel}".rstrip('/') + '/'
            try:
                response = self.session.request('PROPFIND', target_url, headers={'Depth': '1'})
                if response.status_code not in [200, 207]: continue
                
                root = ET.fromstring(response.content)
                for resp in root.findall('d:response', namespace):
                    href = unquote(resp.find('d:href', namespace).text)
                    
                    # Normalize href to relative path
                    rel_p = href
                    if base_path != "/" and rel_p.startswith(base_path):
                        rel_p = rel_p[len(base_path):].lstrip('/')
                    elif base_path == "/" and rel_p.startswith('/'):
                        rel_p = rel_p.lstrip('/')
                    
                    rel_p = rel_p.rstrip('/')
                    if not rel_p or rel_p == current_rel: continue
                    
                    propstat = resp.find('d:propstat', namespace)
                    if not propstat: continue
                    prop = propstat.find('d:prop', namespace)
                    if not prop: continue
                    
                    resourcetype = prop.find('d:resourcetype', namespace)
                    if resourcetype is not None and resourcetype.find('d:collection', namespace) is not None:
                        folders_to_scan.append(rel_p)
                    else:
                        getlastmod = prop.find('d:getlastmodified', namespace)
                        getsize = prop.find('d:getcontentlength', namespace)
                        mtime = 0
                        if getlastmod is not None:
                            from email.utils import parsedate_to_datetime
                            try: mtime = parsedate_to_datetime(getlastmod.text).timestamp()
                            except: pass
                        size = 0
                        if getsize is not None:
                            try: size = int(getsize.text)
                            except: pass
                        result[rel_p] = {'mtime': mtime, 'size': size}
            except Exception as e:
                logging.warning(f"[WebDAV] Manual list error at {current_rel}: {e}")
        return result

    def download_file(self, remote_relative_path: str, local_absolute_path: str) -> bool:
        src = f"{self.url}/{remote_relative_path}"
        os.makedirs(os.path.dirname(local_absolute_path), exist_ok=True)
        response = self.session.get(src)
        if response.status_code == 200:
            with open(local_absolute_path, 'wb') as f:
                f.write(response.content)
            return True
        return False

    def upload_file(self, local_absolute_path: str, remote_relative_path: str) -> bool:
        dst = f"{self.url}/{remote_relative_path}"
        dst_dir = os.path.dirname(remote_relative_path).replace('\\', '/')
        
        logging.warning(f"[WebDAV] Uploading to: {dst}")
        try:
            self._mkdir_p_dav(dst_dir)
            with open(local_absolute_path, 'rb') as f:
                response = self.session.put(dst, data=f)
                if response.status_code not in [200, 201, 204]:
                    logging.warning(f"[WebDAV] Upload FAILED ({response.status_code}) for {dst}")
                    return False
                return True
        except Exception as e:
            logging.warning(f"[WebDAV] Upload EXCEPTION for {dst}: {e}")
            return False

    def _mkdir_p_dav(self, remote_directory: str):
        if not remote_directory or remote_directory in ['.', '/']:
            return
            
        parts = remote_directory.split('/')
        current = ""
        for part in parts:
            if not part: continue
            current = f"{current}/{part}".lstrip('/')
            url = f"{self.url}/{current}"
            # Check if exists
            resp = self.session.request('PROPFIND', url, headers={'Depth': '0'})
            if resp.status_code == 404:
                logging.warning(f"[WebDAV] Creating directory: {url}")
                mkcol_resp = self.session.request('MKCOL', url)
                if mkcol_resp.status_code not in [201, 207]:
                    logging.warning(f"[WebDAV] MKCOL error {mkcol_resp.status_code} for {url}")

class SyncManager:
    def __init__(self, local_app_dir: str, provider: SyncProvider, shared_fields: Optional[List[str]] = None):
        self.local_dir = local_app_dir
        self.provider = provider
        self.update_buffer_dir = os.path.join(local_app_dir, '.update_buffer')
        
        # Default shared fields (Global metadata)
        self.shared_fields = shared_fields or [
            'title', 'artist', 'album', 'genre', 'year', 'bpm', 'key', 'media_key', 'scale', 
            'category', 'tuning', 'shared_with_group', 'url', 'path', 'added_at', 
            'duration', 'is_multitrack', 'stems', 'chapters', 'audio_cues', 'linked_ids', 
            'uid', 'original_pitch', 'target_pitch'
        ]
        
        # Absolute private fields (Never shared)
        self.private_fields = [
            'loops', 'user_notes', 'volume', 'target_profile', 
            'subtitle_enabled', 'subtitle_pos_y', 'subtitle_track', 
            'autoplay', 'autoreplay'
        ]

    def analyze(self) -> Dict[str, list]:
        """Compares local and remote to return a list of files to pull and push."""
        remote_files = self.provider.list_files()
        local_files = self._list_local_files()
        
        self._remote_files_cache = remote_files
        
        # Build lowercase maps for case-insensitive matching
        remote_files_lower = {k.lower(): k for k in remote_files.keys()}
        local_files_lower = {k.lower(): k for k in local_files.keys()}
        
        to_pull = []
        to_push = []
        
        TOLERANCE = 2.0 # 2 seconds tolerance for mtimes
        
        for rel_path, remote_stat in remote_files.items():
            rel_path_low = rel_path.lower()
            if self._should_ignore(rel_path):
                logging.warning(f"[SYNC] Skip Pull: {rel_path} (Ignored by policy)")
                continue
            
            if rel_path_low not in local_files_lower:
                if self._is_shared_file(rel_path, is_remote=True):
                    logging.warning(f"[SYNC] Add to Pull: {rel_path} (Missing locally)")
                    to_pull.append(rel_path)
            elif (remote_stat['mtime'] - local_files[local_files_lower[rel_path_low]]['mtime']) > TOLERANCE:
                logging.warning(f"[SYNC] Add to Pull: {rel_path} (Remote is newer)")
                to_pull.append(rel_path)
            elif (local_files[local_files_lower[rel_path_low]]['mtime'] - remote_stat['mtime']) > TOLERANCE and self._is_shared_file(rel_path):
                logging.warning(f"[SYNC] Add to Push: {local_files_lower[rel_path_low]} (Local is newer and shared)")
                to_push.append(local_files_lower[rel_path_low])
        
        # Determine push for shared local files that don't exist remotely (case-insensitive)
        for rel_path, local_stat in local_files.items():
            rel_path_low = rel_path.lower()
            if self._should_ignore(rel_path):
                continue
                
            if self._is_shared_file(rel_path) and rel_path_low not in remote_files_lower:
                logging.warning(f"[SYNC] Add to Push: {rel_path} (Missing on remote)")
                to_push.append(rel_path)
            elif not self._is_shared_file(rel_path) and rel_path_low not in remote_files_lower:
                if rel_path_low.startswith("medias/"):
                    logging.warning(f"[SYNC] Skip Push: {rel_path} (Not marked as shared)")

        return {"pull": to_pull, "push": to_push}
    
    def _list_local_files(self) -> Dict[str, dict]:
        local_provider = LocalProvider(self.local_dir)
        return local_provider.list_files()
        
    def _should_ignore(self, rel_path: str) -> bool:
        """Returns True if the file should NEVER be synchronized (private or temporary)."""
        p = rel_path.replace('\\', '/').lower()
        
        # 1. User Personnel Configuration & Hardware profiles
        if p == "config.json" or p.startswith("data/config.json"):
            return True
        if p.startswith("profiles/"):
            return True
        if p.startswith("devices/"):
            return True
            
        # 2. Temporary & Cache files
        if p.startswith(".update_buffer/"):
            return True
        if "backup/" in p:
            return True
        if "peaks/" in p:
            return True
        if p.endswith(".log") or "debug" in p:
            return True
            
        # 3. Development files
        if p in [".env", ".gitignore", "requirements.txt", "build.bat", "ag_state.json"]:
            return True
        if p.startswith("venv/") or p.startswith(".git/"):
            return True
        if p.endswith(".py"): # Do not sync source code, only binaries
            return True
            
        return False
        
    def _is_shared_file(self, rel_path: str, is_remote: bool = False) -> bool:
        """Returns True if the file should be shared with the group automatically or via flag."""
        p = rel_path.replace('\\', '/').lower()
        
        # 1. Binaries and System Tools (Always shared)
        SHARED_BINARIES = ["midikbdcontrolstudio.exe", "yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe"]
        for b in SHARED_BINARIES:
            if p == b: 
                logging.warning(f"[SYNC] Shared check: {p} => TRUE (System Binary)")
                return True

        # 2. System Folders (Always shared)
        if p.startswith("assets/") or p.startswith("locales/"):
            logging.warning(f"[SYNC] Shared check: {p} => TRUE (Assets/Locales)")
            return True
            
        # 3. Shared Data files (Global library indices)
        SHARED_DATA = ["data/web_links.json", "library.json", "local_lib.json", "apps.json", "setlist.json"]
        for d in SHARED_DATA:
            if p == d: 
                logging.warning(f"[SYNC] Shared check: {p} => TRUE (Shared Data)")
                return True
            
        # 4. Media Files & Sidecars (Conditional)
        if p.startswith("medias/"):
            # A. If it's the sidecar itself
            if p.endswith('.json'):
                full_path = os.path.join(self.local_dir, rel_path)
                if os.path.exists(full_path):
                    try:
                        with open(full_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            res = isinstance(data, dict) and data.get('shared_with_group', False)
                            logging.warning(f"[SYNC] Shared check: {p} => {res} (Sidecar flag)")
                            return res
                    except: return False
                else:
                    if hasattr(self, '_remote_files_cache') and rel_path in self._remote_files_cache:
                        logging.warning(f"[SYNC] Shared check: {p} => TRUE (Remote sidecar present)")
                        return True
                    logging.warning(f"[SYNC] Shared check: {p} => FALSE (Sidecar missing locally & remote)")
                    return False

            # B. Other files in Medias
            json_path = rel_path + '.json'
            if self._is_shared_file(json_path):
                logging.warning(f"[SYNC] Shared check: {p} => TRUE (Sidecar {json_path} is shared)")
                return True
                
            # C. Satellite files
            MEDIA_EXTS = ('.mp4', '.mp3', '.wav', '.mkv', '.webm', '.flv', '.avi')
            base_name = os.path.basename(rel_path)
            dir_name = os.path.dirname(rel_path)
            if '.' in base_name:
                parent_candidate = base_name.rsplit('.', 1)[0]
                if parent_candidate.lower().endswith(MEDIA_EXTS):
                    if self._is_shared_file(os.path.join(dir_name, parent_candidate + '.json').replace('\\', '/')):
                        logging.warning(f"[SYNC] Shared check: {p} => TRUE (Parent media {parent_candidate} is shared)")
                        return True
            
            return False

        return False

    def sync(self, analysis_result: Dict[str, list]):
        pull_list = analysis_result.get('pull', [])
        push_list = analysis_result.get('push', [])
        logging.warning(f"[SYNC] Starting execution: {len(pull_list)} to pull, {len(push_list)} to push.")

        os.makedirs(self.update_buffer_dir, exist_ok=True)
        # Store remote files in a cache for _is_shared_file to use
        self._remote_files_cache = self.provider.list_files()
        remote_files = self._remote_files_cache
        
        # 1. Pull
        for i, rel_path in enumerate(pull_list):
            logging.warning(f"[SYNC] Pulling {i+1}/{len(pull_list)}: {rel_path}")
            # Normal pull to buffer
            buffer_path = os.path.join(self.update_buffer_dir, rel_path)
            self.provider.download_file(rel_path, buffer_path)
            
            # Deep Merge JSON logic directly here
            if rel_path.endswith('.json'):
                local_path = os.path.join(self.local_dir, rel_path)
                if os.path.exists(local_path):
                    self._perform_deep_merge(buffer_path, local_path)
            
            # Instantly apply non-lockable files to the main directory
            if not rel_path.lower().endswith('.exe'):
                local_path = os.path.join(self.local_dir, rel_path)
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                shutil.copy2(buffer_path, local_path)
                    
        # 2. Push
        for i, rel_path in enumerate(push_list):
            logging.warning(f"[SYNC] Pushing {i+1}/{len(push_list)}: {rel_path}")
            local_path = os.path.join(self.local_dir, rel_path)
            
            # Smart Push for JSON: Merge with remote first to avoid overwriting master BPM with stale local BPM
            # AND filter out private data (loops, notes) before upload
            upload_source = local_path
            if rel_path.endswith('.json'):
                try:
                    # 1. Download existing remote version if it exists
                    temp_remote_path = os.path.join(self.update_buffer_dir, rel_path + ".remote")
                    remote_exists = False
                    for rp in remote_files: # Note: remote_files was defined in analyze but we need to ensure it's accessible or re-list
                         if rp == rel_path:
                             remote_exists = True
                             break
                    
                    if remote_exists:
                        self.provider.download_file(rel_path, temp_remote_path)
                        # Prepare a merged AND filtered version for upload
                        filtered_path = os.path.join(self.update_buffer_dir, rel_path + ".upload")
                        self._prepare_filtered_json_for_upload(local_path, temp_remote_path, filtered_path)
                        upload_source = filtered_path
                    else:
                        # New file on master: filter only
                        filtered_path = os.path.join(self.update_buffer_dir, rel_path + ".upload")
                        self._prepare_filtered_json_for_upload(local_path, None, filtered_path)
                        upload_source = filtered_path
                except Exception as e:
                    print(f"Push preparation error for {rel_path}: {e}")

            self.provider.upload_file(upload_source, rel_path)
            
    def _prepare_filtered_json_for_upload(self, local_json_path: str, remote_json_path: Optional[str], output_path: str):
        """Creates a filtered version of the JSON for the Master (removes private fields)."""
        with open(local_json_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
            
        if not isinstance(local_data, dict):
            # For lists, we don't filter (e.g. library.json, apps.json)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(local_data, f, indent=4)
            return

        # 1. Create a copy with only shared fields (Whitelist)
        filtered_data = {k: local_data[k] for k in self.shared_fields if k in local_data}
        
        # 2. Force remove absolute private fields just in case they were in the shared list
        for fld in self.private_fields:
            if fld in filtered_data:
                del filtered_data[fld]
        
        # 3. If there is a remote version, prioritize IT for global shared data (Master Wins)
        if remote_json_path and os.path.exists(remote_json_path):
            with open(remote_json_path, 'r', encoding='utf-8') as f:
                remote_data = json.load(f)
            # Master wins on global metadata to avoid overwriting with stale local data
            # (We only override if the master actually HAS data for these fields)
            MASTER_WINS_FIELDS = ['bpm', 'key', 'media_key', 'scale', 'title', 'artist', 'genre', 'year', 'original_pitch']
            for k in MASTER_WINS_FIELDS:
                if k in remote_data and remote_data[k]:
                    filtered_data[k] = remote_data[k]

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(filtered_data, f, indent=4)

    def _perform_deep_merge(self, downloaded_json_path: str, local_json_path: str):
        with open(local_json_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
        with open(downloaded_json_path, 'r', encoding='utf-8') as f:
            remote_data = json.load(f)
            
        if not isinstance(local_data, dict) or not isinstance(remote_data, dict):
            # For lists, remote version (the one being downloaded) wins
            with open(downloaded_json_path, 'w', encoding='utf-8') as f:
                json.dump(remote_data, f, indent=4)
            return

        # Priority: Remote values act as source for global metadata (BPM, chapters),
        # but LOCAL overrides for volume, target_pitch, saved_loops, notes
        
        merged = deep_merge(local_data.copy(), remote_data)
        
        # Ensure PRIVATE local data is NEVER overwritten by Master
        for field in self.private_fields:
            if field in local_data:
                merged[field] = local_data[field]
            elif field in merged:
                del merged[field]
        
        # Also protect fields NOT in the current whitelist (they are considered local-only by the user)
        # unless they are explicitly shared and we want them.
        # (This handles the case where someone adds a field to their MASTER that we don't want)
        for field in list(merged.keys()):
            if field not in self.shared_fields and field not in self.private_fields:
                 # If it was in local_data, keep it (local preference)
                 if field in local_data:
                     merged[field] = local_data[field]
                 else:
                     # It's extra data from master that we don't share/recognize
                     pass 
            
        with open(downloaded_json_path, 'w', encoding='utf-8') as f:
            json.dump(merged, f, indent=4)

    def generate_bootstrapper_script(self):
        """Creates updater.bat that kills AirstepStudio, moves buffer files to root, and restarts."""
        bat_script = f"""@echo off
timeout /t 2 /nobreak > nul
echo Updating AirstepStudio...

:: Move all files from .update_buffer to root directory
xcopy "{self.update_buffer_dir}\\*" "{self.local_dir}\\" /S /Y /C /I

:: Delete the buffer
rmdir /s /q "{self.update_buffer_dir}"

:: Restart AirstepStudio
cd /d "{self.local_dir}"
start "" MidiKbdControlStudio.exe

:: Self-destruct
del "%~f0"
"""
        bat_path = os.path.join(self.local_dir, 'updater.bat')
        with open(bat_path, 'w', encoding='utf-8') as f:
            f.write(bat_script)
        return bat_path

