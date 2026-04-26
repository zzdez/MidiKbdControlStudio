import os
import json
import shutil
import hashlib
import time
import base64
from typing import Dict, List, Optional, Any
from datetime import datetime
import paramiko
import logging
from cryptography.fernet import Fernet
from urllib.parse import unquote, urlparse

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

    def delete_file(self, relative_path: str) -> bool:
        raise NotImplementedError


class LocalProvider(SyncProvider):
    def __init__(self, root_dir: str):
        self.root_dir = os.path.abspath(root_dir)
        logging.warning(f"[SYNC] LocalProvider initialized on: {self.root_dir}")

    def _calculate_md5(self, path: str) -> str:
        hash_md5 = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()

    def list_files(self, relative_dir: str = "") -> Dict[str, dict]:
        result = {}
        target_dir = os.path.join(self.root_dir, relative_dir)
        if not os.path.exists(target_dir):
            return result
        
        # V7.1: Global Hash limit extended to 200MB for video/media stabilization
        HASH_SIZE_LIMIT = 200 * 1024 * 1024 
        
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, self.root_dir).replace('\\', '/')
                stat = os.stat(full_path)
                
                info = {'mtime': stat.st_mtime, 'size': stat.st_size}
                if stat.st_size < HASH_SIZE_LIMIT:
                    try: 
                        info['hash'] = self._calculate_md5(full_path)
                    except Exception as e:
                        logging.error(f"[HASH] Error calculating hash for {full_path}: {e}")
                
                result[rel_path] = info
        return result

    def download_file(self, remote_relative_path: str, local_absolute_path: str) -> bool:
        src = os.path.join(self.root_dir, remote_relative_path)
        os.makedirs(os.path.dirname(local_absolute_path), exist_ok=True)
        shutil.copy2(src, local_absolute_path)
        return True

    def upload_file(self, local_absolute_path: str, remote_relative_path: str) -> bool:
        dst = os.path.join(self.root_dir, remote_relative_path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        
        # V7.0: Write Verification Logic
        local_stat = os.stat(local_absolute_path)
        # V7.4: Force remove existing file to unlock it on Windows
        if os.path.exists(dst):
            try:
                os.remove(dst)
            except: pass
            
        shutil.copy2(local_absolute_path, dst)
        
        # V6.5: Force explicit utime
        try:
            os.utime(dst, (local_stat.st_atime, local_stat.st_mtime))
        except: pass
        
        # V7.0: Post-Write verification
        try:
            remote_stat = os.stat(dst)
            if remote_stat.st_size != local_stat.st_size:
                logging.error(f"[SYNC] [ERROR] Write verification FAILED for {remote_relative_path}: Size mismatch (Local: {local_stat.st_size} vs Remote: {remote_stat.st_size})")
            else:
                logging.warning(f"[SYNC] [OK] File written and verified: {remote_relative_path} ({remote_stat.st_size} bytes)")
        except Exception as e:
            logging.error(f"[SYNC] [ERROR] Could not verify write for {remote_relative_path}: {e}")
            
        return True

    def delete_file(self, relative_path: str) -> bool:
        path = os.path.join(self.root_dir, relative_path)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False

    def get_file_content(self, relative_path: str) -> Optional[str]:
        """V7.6: Helper for diagnostic diffs."""
        path = os.path.join(self.root_dir, relative_path)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        return None


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

    def get_file_content(self, relative_path: str) -> Optional[str]:
        """V8.1: Direct read from SFTP for functional comparison."""
        self.connect()
        src = f"{self.remote_root}/{relative_path}".replace('//', '/')
        try:
            with self.sftp.open(src, 'r') as f:
                content = f.read()
                if isinstance(content, bytes):
                    return content.decode('utf-8')
                return content
        except Exception as e:
            logging.debug(f"[SFTP] get_file_content failed for {relative_path}: {e}")
            return None

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
        
        # V8.9: Get local mtime for later sync
        local_mtime = os.path.getmtime(local_absolute_path)
        
        logging.warning(f"[SFTP] Uploading to: {dst}")
        try:
            self._mkdir_p(dst_dir)
            self.sftp.put(local_absolute_path, dst)
            
            # V8.9: Force remote mtime to match local mtime
            try:
                self.sftp.utime(dst, (local_mtime, local_mtime))
                logging.debug(f"[SFTP] Remote mtime synced for {dst}")
            except Exception as ut_e:
                logging.debug(f"[SFTP] Failed to sync utime for {dst}: {ut_e}")
                
            return True
        except Exception as e:
            logging.warning(f"[SFTP] Echec de l'upload pour {dst} : {e}")
    def delete_file(self, relative_path: str) -> bool:
        self.connect()
        path = f"{self.remote_root}/{relative_path}".replace('//', '/')
        try:
            self.sftp.remove(path)
            return True
        except: return False

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
        
        result = {}
        target_url = f"{self.url}/{relative_dir}".rstrip('/') + '/'
        
        # 1. Determine base path for normalization (e.g. /dav/master)
        parsed_base = urlparse(self.url)
        base_path = parsed_base.path.rstrip('/')
        if not base_path.startswith('/'): base_path = '/' + base_path
        
        headers = {'Depth': 'infinity'}
        try:
            response = self.session.request('PROPFIND', target_url, headers=headers)
            if response.status_code not in [200, 207]:
                return self._list_manual(relative_dir)
            
            root = ET.fromstring(response.content)
            namespace = {'d': 'DAV:'}
            
            for resp in root.findall('d:response', namespace):
                href_raw = resp.find('d:href', namespace).text
                href_path = urlparse(href_raw).path
                href_path = unquote(href_path) # Important for spaces and special chars
                
                # Normalize href to be relative to our base URL
                rel_p = href_path
                if base_path != "/" and rel_p.startswith(base_path):
                    rel_p = rel_p[len(base_path):].lstrip('/')
                elif base_path == "/" and rel_p.startswith('/'):
                    rel_p = rel_p.lstrip('/')
                
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
        namespace = {'d': 'DAV:'}
        result = {}
        folders_to_scan = [relative_dir.strip('/')]
        
        # 1. Determine base path for normalization
        parsed_base = urlparse(self.url)
        base_path = parsed_base.path.rstrip('/')
        if not base_path.startswith('/'): base_path = '/' + base_path
        if not base_path: base_path = "/"
 
        while folders_to_scan:
            current_rel = folders_to_scan.pop(0)
            target_url = f"{self.url}/{current_rel}".rstrip('/') + '/'
            try:
                response = self.session.request('PROPFIND', target_url, headers={'Depth': '1'})
                if response.status_code not in [200, 207]: continue
                
                root = ET.fromstring(response.content)
                for resp in root.findall('d:response', namespace):
                    href_raw = resp.find('d:href', namespace).text
                    href_path = urlparse(href_raw).path
                    href_path = unquote(href_path)
                    
                    # Normalize href to relative path
                    rel_p = href_path
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

    def get_file_content(self, relative_path: str) -> Optional[str]:
        """V8.1: Direct read from WebDAV for functional comparison."""
        src = f"{self.url}/{relative_path}"
        try:
            response = self.session.get(src)
            if response.status_code == 200:
                return response.content.decode('utf-8')
        except Exception as e:
            logging.debug(f"[WebDAV] get_file_content failed for {relative_path}: {e}")
        return None

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

    def delete_file(self, relative_path: str) -> bool:
        dst = f"{self.url}/{relative_path}"
        try:
            resp = self.session.delete(dst)
            return resp.status_code in [200, 204]
        except: return False

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
        
        # Callback for progress reporting: (current, total, filename, stage)
        self.progress_callback = None

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

        # V9.1: Sync State (Memory)
        self.state_file = os.path.join(local_app_dir, "data", "sync_state.json")
        self.state = self._load_state()

    def _load_state(self) -> dict:
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except: pass
        return {"files": {}, "last_sync": 0}

    def _save_state(self, current_files: dict):
        """V9.1: Save a snapshot of the synchronized files."""
        try:
            os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
            self.state = {
                "files": {p: {"mtime": s["mtime"], "size": s["size"]} for p, s in current_files.items()},
                "last_sync": time.time()
            }
            with open(self.state_file, "w", encoding="utf-8") as f:
                json.dump(self.state, f, indent=2)
        except Exception as e:
            logging.error(f"[STATE] Failed to save sync state: {e}")

    def _get_canonical_hash_from_dict(self, data: dict) -> str:
        """Returns a stable MD5 from a dict by using minified, sorted JSON."""
        stable_string = json.dumps(data, sort_keys=True, separators=(',', ':'))
        return hashlib.md5(stable_string.encode("utf-8")).hexdigest()

    def _get_filtered_hash_for_comparison(self, local_path: str) -> str:
        """
        V7.6: Calculates the canonical MD5 of the FILTERED version of the JSON.
        """
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            if isinstance(data, dict):
                 filtered = {k: data[k] for k in self.shared_fields if k in data}
            else:
                 filtered = data
            
            return self._get_canonical_hash_from_dict(filtered)
        except Exception as e:
            logging.error(f"[HASH] Failed to calculate filtered hash for {local_path}: {e}")
            return "error_hash"

    def _log_json_diff(self, local_path: str, remote_data: dict, rel_path: str):
        """V7.6: Logs exactly which keys differ between local (filtered) and remote."""
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                local_raw = json.load(f)
            
            local_filtered = local_raw
            if isinstance(local_raw, dict):
                local_filtered = {k: local_raw[k] for k in self.shared_fields if k in local_raw}

            if not isinstance(remote_data, dict) or not isinstance(local_filtered, dict):
                logging.warning(f"[DIFF] {rel_path} : One side is not a dictionary.")
                return

            all_keys = set(local_filtered.keys()) | set(remote_data.keys())
            diffs = []
            for k in all_keys:
                if k not in local_filtered: diffs.append(f"Missing locally: {k}")
                elif k not in remote_data: diffs.append(f"Missing remotely: {k}")
                elif local_filtered[k] != remote_data[k]:
                    diffs.append(f"Value mismatch for '{k}': L({local_filtered[k]}) vs R({remote_data[k]})")
            
            if diffs:
                logging.warning(f"[DIFF] {rel_path} Differences found:\n  - " + "\n  - ".join(diffs[:5]))
            else:
                logging.warning(f"[DIFF] {rel_path} : No functional differences found (likely spacing/formatting).")
        except Exception as e:
            logging.error(f"[DIFF] Failed to log diff for {rel_path}: {e}")

    def _are_jsons_functionally_identical(self, local_path: str, remote_data: dict) -> bool:
        """V7.8 & V8.7: Symmetric deep comparison of filtered local JSON vs filtered remote JSON."""
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                local_raw = json.load(f)
            
            if not isinstance(local_raw, dict) or not isinstance(remote_data, dict):
                # For non-dict (lists like setlist), compare as is
                return local_raw == remote_data

            # V8.7: Symmetric filtering
            # We filter BOTH sides to ensure we only compare the fields that AirstepStudio manages.
            # This ignores extra metadata that some WebDAV servers might inject or preserve.
            local_filtered = {k: local_raw[k] for k in self.shared_fields if k in local_raw}
            remote_filtered = {k: remote_data[k] for k in self.shared_fields if k in remote_data}

            # Also force remove private fields just in case
            for fld in self.private_fields:
                if fld in local_filtered: del local_filtered[fld]
                if fld in remote_filtered: del remote_filtered[fld]

            return local_filtered == remote_filtered
        except:
            return False

    def _is_media_sidecar(self, rel_path: str) -> bool:
        """Returns True if the file is a metadata sidecar for a media file."""
        p = rel_path.replace('\\', '/').lower()
        # Media sidecars are .json files located inside Medias/
        return p.startswith('medias/') and p.endswith('.json')

    def set_progress_callback(self, callback):
        self.progress_callback = callback

    def _notify_progress(self, current, total, filename, stage, reason=None):
        if self.progress_callback:
            try:
                self.progress_callback(current, total, filename, stage, reason)
            except:
                pass

    def analyze(self, selected_categories: Optional[List[str]] = None) -> Dict[str, list]:
        """
        V9.1: Comprehensive analysis including additions, updates, and deletions.
        Returns: {'pull': [], 'push': [], 'delete_remote': [], 'delete_local': []}
        """
        self._notify_progress(0, 100, "", "analyzing")
        
        local_files = self._list_local_files()
        remote_files = self.provider.list_files()
        
        # Maps for case-insensitive matching
        local_files_lower = {p.lower(): p for p in local_files.keys()}
        remote_files_lower = {p.lower(): p for p in remote_files.keys()}
        state_files_lower = {p.lower(): p for p in self.state.get("files", {}).keys()}
        
        to_pull = []
        to_push = []
        to_delete_remote = [] # Deleted locally -> should be removed from remote
        to_delete_local = []  # Deleted remotely -> should be removed from local
        
        TOLERANCE = 5.0 # V6.6: Increased to 5s for non-hashed binary files (Windows jitter resilience)
        
        # V6.5: Clock Skew Detection (Improved in V6.6-V6.8 using fallback anchors)
        skews = []
        hash_counts = {"local": sum(1 for f in local_files.values() if 'hash' in f),
                       "remote": sum(1 for f in remote_files.values() if 'hash' in f)}
        
        logging.warning(f"[SYNC] Analyze: Local files: {len(local_files)}, Remote files: {len(remote_files)}, State: {len(self.state.get('files', {}))}")

        # V8.4: WebDAV Ghost Cleanup
        ghosts = ['library.json', 'local_lib.json', 'setlist.json', 'web_links.json']
        for g in ghosts:
            if g in remote_files and f"data/{g}" in remote_files:
                logging.warning(f"[SYNC] [CLEANUP] Ignoring ghost file at remote root: {g}")
                if g in remote_files: del remote_files[g]
                if g.lower() in remote_files_lower: del remote_files_lower[g.lower()]

        # PASS 1: CLOCK SKEW CALIBRATION
        skews = []
        for rel_path, remote_stat in remote_files.items():
            rel_path_low = rel_path.lower()
            if rel_path_low in local_files_lower:
                local_p = local_files_lower[rel_path_low]
                local_stat = local_files[local_p]
                if 'hash' in remote_stat and 'hash' in local_stat:
                    if remote_stat['hash'] == local_stat['hash']:
                        skews.append(local_stat['mtime'] - remote_stat['mtime'])

        if not skews and hasattr(self.provider, 'get_file_content'):
            json_files = [p for p in remote_files.keys() if p.lower().endswith('.json')]
            data_jsons = [p for p in json_files if p.lower().startswith('data/')]
            priority_jsons = (data_jsons + json_files[:10])[:20]
            for rel_path in priority_jsons:
                if rel_path.lower() in local_files_lower:
                    try:
                        remote_raw = self.provider.get_file_content(rel_path)
                        if remote_raw:
                            remote_data = json.loads(remote_raw)
                            local_p = local_files_lower[rel_path.lower()]
                            if self._are_jsons_functionally_identical(local_p, remote_data):
                                skews.append(local_files[local_p]['mtime'] - remote_files[rel_path]['mtime'])
                    except: pass
        
        clock_skew = 0
        if skews:
            skews.sort()
            clock_skew = skews[len(skews) // 2]
            logging.warning(f"[SYNC] Clock skew stabilized: {clock_skew:.2f}s")
            
        TOLERANCE = 5.0

        # PASS 2: COMPREHENSIVE SCAN
        # 2.1 Scan Remote for Pull or Remote-Delete
        for rel_path, remote_stat in remote_files.items():
            rel_path_low = rel_path.lower()
            if self._is_absolute_ignore(rel_path): continue
            if not self._is_in_selected_categories(rel_path, selected_categories): continue

            if rel_path_low not in local_files_lower:
                if rel_path_low in state_files_lower:
                    to_delete_remote.append({"path": rel_path, "reason": "deleted_locally"})
                else:
                    if self._is_shared_file(rel_path, is_remote=True, categories=selected_categories):
                        to_pull.append({"path": rel_path, "reason": "remote_only"})
            else:
                local_p_real = local_files_lower[rel_path_low]
                local_stat = local_files[local_p_real]
                
                if rel_path.lower().endswith('.json') and hasattr(self.provider, 'get_file_content'):
                    try:
                        remote_raw = self.provider.get_file_content(rel_path)
                        if remote_raw and self._are_jsons_functionally_identical(local_p_real, json.loads(remote_raw)):
                            continue
                    except: pass

                drift = (local_stat['mtime'] - remote_stat['mtime']) - clock_skew
                if 'hash' in remote_stat and 'hash' in local_stat:
                    if remote_stat['hash'] != local_stat['hash']:
                        if drift > 0: to_push.append({"path": local_p_real, "reason": "content_change"})
                        else: to_pull.append({"path": rel_path, "reason": "content_change"})
                elif abs(drift) > TOLERANCE:
                    if remote_stat['size'] == local_stat['size'] and remote_stat['size'] > 0:
                        continue
                    if drift > 0: to_push.append({"path": local_p_real, "reason": "newer_locally"})
                    else: to_pull.append({"path": rel_path, "reason": "newer_remotely"})

        # 2.2 Scan Local for Push or Local-Delete
        for rel_path, local_stat in local_files.items():
            rel_path_low = rel_path.lower()
            if self._is_absolute_ignore(rel_path): continue
            if not self._is_in_selected_categories(rel_path, selected_categories): continue

            if rel_path_low not in remote_files_lower:
                if rel_path_low in state_files_lower:
                    to_delete_local.append({"path": rel_path, "reason": "deleted_remotely"})
                else:
                    if self._is_shared_file(rel_path, categories=selected_categories):
                        to_push.append({"path": rel_path, "reason": "local_only"})
        
        self._notify_progress(100, 100, "", "analyzed")
        return {
            "pull": to_pull, 
            "push": to_push,
            "delete_remote": to_delete_remote,
            "delete_local": to_delete_local
        }
    
    def _list_local_files(self) -> Dict[str, dict]:
        """Scans the local application directory for files."""
        from sync_manager import LocalProvider
        local_provider = LocalProvider(self.local_dir)
        return local_provider.list_files()
    
    def _is_absolute_ignore(self, rel_path: str) -> bool:
        """Returns True if the file should NEVER be synchronized (logs, dev, git, etc)."""
        p = rel_path.replace('\\', '/').lower()
        
        # Temporary & Cache files
        if p.startswith(".update_buffer/"): return True
        if "backup/" in p: return True
        if "peaks/" in p: return True
        if p.endswith(".log") or "debug" in p or p == "midikbd_debug.log": return True
            
        # Development files
        if p in [".env", ".gitignore", "requirements.txt", "build.bat", "ag_state.json"]: return True
        if p.startswith("venv/") or p.startswith(".git/"): return True
        if p.endswith(".py"): return True
        
        # User hardware config (should remain unique to the machine generally)
        if p == "config.json" or p.startswith("data/config.json"): return True
            
        return False

    def _is_in_selected_categories(self, rel_path: str, categories: Optional[List[str]]) -> bool:
        """Returns True if the file belongs to one of the selected categories."""
        if categories is None: return True # All categories by default
        
        p = rel_path.replace('\\', '/').lower()
        
        if 'exe' in categories:
            if p.endswith('.exe'): return True
            
        if 'medias' in categories:
            if p.startswith('medias/'): return True
            
        if 'data' in categories:
            # Main JSON files and data folder (V6.1: prefer prefixed paths for consistency)
            DATA_FILES = [
                "data/library.json", "data/local_lib.json", "data/apps.json", 
                "data/setlist.json", "data/web_links.json",
                "library.json", "local_lib.json", "apps.json", "setlist.json", "web_links.json"
            ]
            if any(p == d for d in DATA_FILES): return True
            if p.startswith('data/'): return True
            
        if 'profiles' in categories:
            if p.startswith('profiles/'): return True
            
        if 'devices' in categories:
            if p.startswith('devices/'): return True
            
        if 'system' in categories:
            if p.startswith('assets/') or p.startswith('locales/'): return True
            
        return False

    def _is_shared_file(self, rel_path: str, is_remote: bool = False, categories: Optional[List[str]] = None) -> bool:
        """Returns True if the file should be shared with the group."""
        p = rel_path.replace('\\', '/').lower()
        
        # 1. Validate against categories first
        if not self._is_in_selected_categories(rel_path, categories):
            return False

        # 2. Specific logic for Medias (requires sidecar flag check if local)
        if p.startswith("medias/"):
            if p.endswith('.json'):
                full_path = os.path.join(self.local_dir, rel_path)
                if os.path.exists(full_path):
                    try:
                        with open(full_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            return isinstance(data, dict) and data.get('shared_with_group', False)
                    except: return False
                else:
                    return is_remote # If remote, we assume we want it
            
            # For media content files, check if their sidecar is shared
            json_path = rel_path + '.json'
            if self._is_shared_file(json_path, is_remote=is_remote, categories=categories):
                return True
                
            # Satellite files (chapters, loops etc)
            MEDIA_EXTS = ('.mp4', '.mp3', '.wav', '.mkv', '.webm', '.flv', '.avi')
            base_name = os.path.basename(rel_path)
            dir_name = os.path.dirname(rel_path)
            
            # V6.2: Special case for Multipistes folders (one meta file for all tracks)
            if "multipistes/" in p and base_name != "airstep_meta.json":
                # Check root of the specific multipiste folder
                # p is medias/multipistes/folder_name/track.mp3
                parts = p.split('/')
                try:
                    idx = parts.index("multipistes")
                    if len(parts) > idx + 1:
                        folder_name = parts[idx+1]
                        # V6.6: Search for the TRUE case-sensitive path in local_files_lower
                        meta_key = f"medias/multipistes/{folder_name}/airstep_meta.json".lower()
                        # Use self._remote_files_cache if listing remote, otherwise wait...
                        # Actually _is_shared_file handles existence check internally.
                        # We just need to give it a path that it can find in its categories.
                        meta_rel = f"Medias/Multipistes/{folder_name}/airstep_meta.json"
                        
                        # Find actual case if exists in local_files
                        potential_real = None
                        # We can access the parent SyncManager internal maps if needed
                        # But simpler: if it's medias, it's shared if the meta says so.
                        if self._is_shared_file(meta_rel, is_remote=is_remote, categories=categories):
                            return True
                except: pass

            if '.' in base_name:
                parent_candidate = base_name.rsplit('.', 1)[0]
                if parent_candidate.lower().endswith(MEDIA_EXTS):
                    if self._is_shared_file(os.path.join(dir_name, parent_candidate + '.json').replace('\\', '/'), is_remote=is_remote, categories=categories):
                        return True
            
            return False

        # 3. Everything else that passed category check is shared
        return True

    def sync(self, analysis_result: Dict[str, list], selected_categories: Optional[List[str]] = None):
        pull_list = analysis_result.get('pull', [])
        push_list = analysis_result.get('push', [])
        del_remote = analysis_result.get('delete_remote', [])
        del_local = analysis_result.get('delete_local', [])
        
        total_actions = len(pull_list) + len(push_list) + len(del_remote) + len(del_local)
        current_action = 0
        
        logging.warning(f"[SYNC] Starting execution: {len(pull_list)} pull, {len(push_list)} push, {len(del_remote)} del_rem, {len(del_local)} del_loc")

        os.makedirs(self.update_buffer_dir, exist_ok=True)
        remote_files = self.provider.list_files()
        
        # 1. Pull
        for item in pull_list:
            rel_path = item["path"] if isinstance(item, dict) else item
            reason = item["reason"] if isinstance(item, dict) else None
            current_action += 1
            self._notify_progress(current_action, total_actions, rel_path, "pull", reason)
            
            buffer_path = os.path.join(self.update_buffer_dir, rel_path)
            self.provider.download_file(rel_path, buffer_path)
            
            if self._is_media_sidecar(rel_path):
                local_path = os.path.join(self.local_dir, rel_path)
                if os.path.exists(local_path):
                    self._perform_deep_merge(buffer_path, local_path)
            
            if not rel_path.lower().endswith('.exe'):
                local_path = os.path.join(self.local_dir, rel_path)
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                shutil.copy2(buffer_path, local_path)
                    
        # 2. Push
        for item in push_list:
            rel_path = item["path"] if isinstance(item, dict) else item
            reason = item["reason"] if isinstance(item, dict) else None
            current_action += 1
            self._notify_progress(current_action, total_actions, rel_path, "push", reason)
            
            local_path = os.path.join(self.local_dir, rel_path)
            upload_source = local_path
            
            if self._is_media_sidecar(rel_path):
                try:
                    temp_remote_path = os.path.join(self.update_buffer_dir, rel_path + ".remote")
                    if rel_path in remote_files:
                        self.provider.download_file(rel_path, temp_remote_path)
                        filtered_path = os.path.join(self.update_buffer_dir, rel_path + ".upload")
                        self._prepare_filtered_json_for_upload(local_path, temp_remote_path, filtered_path)
                        upload_source = filtered_path
                    else:
                        filtered_path = os.path.join(self.update_buffer_dir, rel_path + ".upload")
                        self._prepare_filtered_json_for_upload(local_path, None, filtered_path)
                        upload_source = filtered_path
                except Exception as e:
                    logging.error(f"Push preparation error for {rel_path}: {e}")

            self.provider.upload_file(upload_source, rel_path)

        # 3. Delete Remote
        for item in del_remote:
            rel_path = item["path"] if isinstance(item, dict) else item
            current_action += 1
            self._notify_progress(current_action, total_actions, rel_path, "delete_remote")
            logging.warning(f"[SYNC] Deleting remote file: {rel_path}")
            self.provider.delete_file(rel_path)

        # 4. Delete Local
        for item in del_local:
            rel_path = item["path"] if isinstance(item, dict) else item
            current_action += 1
            self._notify_progress(current_action, total_actions, rel_path, "delete_local")
            local_path = os.path.join(self.local_dir, rel_path)
            if os.path.exists(local_path):
                logging.warning(f"[SYNC] Deleting local file: {rel_path}")
                os.remove(local_path)
        
        # FINAL: Save current state to memory
        final_local_files = self._list_local_files()
        self._save_state(final_local_files)
        
        self._notify_progress(total_actions, total_actions, "", "finished")

            
    def _prepare_filtered_json_for_upload(self, local_json_path: str, remote_json_path: Optional[str], output_path: str):
        """Creates a filtered version of the JSON for the Master (removes private fields)."""
        with open(local_json_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
            
        if not isinstance(local_data, dict):
            with open(output_path, 'w', encoding='utf-8') as f:
                # V7.7: Canonical minification
                json.dump(local_data, f, sort_keys=True, separators=(',', ':'))
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
            # V7.7: Atomic Unification (Ensures Local Hash == Remote Hash)
            json.dump(filtered_data, f, sort_keys=True, separators=(',', ':'))

    def _perform_deep_merge(self, downloaded_json_path: str, local_json_path: str):
        with open(local_json_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
        with open(downloaded_json_path, 'r', encoding='utf-8') as f:
            remote_data = json.load(f)
            
        if not isinstance(local_data, dict) or not isinstance(remote_data, dict):
            # For lists, remote version (the one being downloaded) wins
            with open(downloaded_json_path, 'w', encoding='utf-8') as f:
                json.dump(remote_data, f, sort_keys=True, separators=(',', ':'))
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
            json.dump(merged, f, sort_keys=True, separators=(',', ':'))

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

