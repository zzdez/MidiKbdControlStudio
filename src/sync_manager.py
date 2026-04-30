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
import json
import utils
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
            # V9.6.47: Ignore technical folders
            if ".update_buffer" in root or ".git" in root:
                continue
                
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

    def delete_file(self, relative_path: str, protected_dirs: Optional[List[str]] = None) -> bool:
        path = os.path.join(self.root_dir, relative_path)
        try:
            if os.path.exists(path):
                os.remove(path)
                logging.warning(f"[LOCAL] File deleted successfully: {path}")
                # V9.6.41: Cleanup empty parents
                parent = os.path.dirname(path)
                while parent and parent != self.root_dir:
                    # V9.6.46: Protection check
                    rel_parent = os.path.relpath(parent, self.root_dir).lower().replace('\\', '/')
                    if protected_dirs and rel_parent in protected_dirs:
                        logging.debug(f"[LOCAL] Cleanup stopped: parent '{rel_parent}' is protected.")
                        break
                        
                    try:
                        if not os.listdir(parent):
                            os.rmdir(parent)
                            logging.warning(f"[LOCAL] Empty directory cleaned: {parent}")
                            parent = os.path.dirname(parent)
                        else: break
                    except: break
            return True
        except Exception as e:
            logging.error(f"[LOCAL] Delete FAILED for {path}: {e}")
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
            
            # V9.6.15: Disable forced utime on SFTP. It creates inconsistent drifts when clocks are not synced.
            # The SyncManager's clock_skew logic will handle the natural difference between PC and Server.
            # try:
            #     self.sftp.utime(dst, (local_mtime, local_mtime))
            #     logging.debug(f"[SFTP] Remote mtime synced for {dst}")
            # except Exception as ut_e:
            #     logging.debug(f"[SFTP] Failed to sync utime for {dst}: {ut_e}")
            
            return True
        except Exception as e:
            logging.warning(f"[SFTP] Echec de l'upload pour {dst} : {e}")
    def delete_file(self, relative_path: str, protected_dirs: Optional[List[str]] = None) -> bool:
        self.connect()
        # V9.6.44: Strict normalization
        root = self.remote_root.rstrip('/')
        path = f"{root}/{relative_path}".replace('\\', '/').replace('//', '/')
        try:
            self.sftp.remove(path)
            logging.warning(f"[SFTP] File deleted successfully: {path}")
            
            # V9.6.41: Cleanup empty parents
            parent = os.path.dirname(path).replace('\\', '/')
            while parent and parent != root and parent != '.':
                # V9.6.46: Protection check
                rel_parent = parent
                if rel_parent.startswith(root):
                    rel_parent = rel_parent[len(root):].lstrip('/')
                
                if protected_dirs and rel_parent.lower() in protected_dirs:
                    logging.debug(f"[SFTP] Cleanup stopped: parent '{rel_parent}' is protected.")
                    break
                    
                try:
                    self.sftp.rmdir(parent)
                    logging.warning(f"[SFTP] Empty directory cleaned: {parent}")
                    parent = os.path.dirname(parent).replace('\\', '/')
                except:
                    break
            return True
        except Exception as e:
            logging.error(f"[SFTP] Delete FAILED for {path}: {e}")
            return False

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
            response = self.session.request('PROPFIND', target_url, headers=headers, timeout=10)
            if response.status_code == 401:
                raise ConnectionError(f"WebDAV Non Autorisé (401). Vérifiez l'utilisateur et le mot de passe.")
            elif response.status_code == 403:
                raise ConnectionError(f"WebDAV Accès Interdit (403). Le serveur refuse l'accès au dossier (Droits/Permissions).")
            elif response.status_code == 404:
                raise ConnectionError(f"WebDAV Introuvable (404). Vérifiez l'URL et le dossier distant.")
            elif response.status_code not in [200, 207]:
                logging.warning(f"[WebDAV] PROPFIND (Depth: infinity) failed with status {response.status_code}. Content: {response.text[:200]}")
                return self._list_manual(relative_dir)
            
            root = ET.fromstring(response.content)
            namespace = {'d': 'DAV:'}
            
            # V9.6.2: Namespace agnostic fallback
            responses = root.findall('d:response', namespace)
            if not responses:
                # Some servers might use different namespaces or no namespace
                responses = root.findall('.//{DAV:}response')
                if not responses:
                    responses = root.findall('.//response')
            
            for resp in responses:
                href_node = resp.find('d:href', namespace) or resp.find('.//{DAV:}href') or resp.find('.//href')
                if href_node is None or not href_node.text: continue
                href_raw = href_node.text
                href_path = urlparse(href_raw).path
                href_path = unquote(href_path) # Important for spaces and special chars
                
                # Normalize href to be relative to our base URL (Case Insensitive Prefix Stripping)
                rel_p = href_path
                # V9.6.3: WebDAV paths can be returned in lower/different case than our base_path URL
                if base_path != "/":
                    if rel_p.lower().startswith(base_path.lower()):
                        rel_p = rel_p[len(base_path):].lstrip('/')
                elif base_path == "/" and rel_p.startswith('/'):
                    rel_p = rel_p.lstrip('/')
                
                if not rel_p: continue # Root folder
                
                propstat = resp.find('d:propstat', namespace) or resp.find('.//{DAV:}propstat') or resp.find('.//propstat')
                if propstat is None: continue
                prop = propstat.find('d:prop', namespace) or propstat.find('.//{DAV:}prop') or propstat.find('.//prop')
                if prop is None: continue
                
                # Check if it's a collection (folder)
                resourcetype = prop.find('d:resourcetype', namespace) or prop.find('.//{DAV:}resourcetype') or prop.find('.//resourcetype')
                if resourcetype is not None and (resourcetype.find('d:collection', namespace) is not None or resourcetype.find('.//{DAV:}collection') is not None or resourcetype.find('.//collection') is not None):
                    continue
                    
                getlastmod = prop.find('d:getlastmodified', namespace) or prop.find('.//{DAV:}getlastmodified') or prop.find('.//getlastmodified')
                getsize = prop.find('d:getcontentlength', namespace) or prop.find('.//{DAV:}getcontentlength') or prop.find('.//getcontentlength')
                
                mtime = 0
                if getlastmod is not None and getlastmod.text:
                    try:
                        from email.utils import parsedate_to_datetime
                        mtime = parsedate_to_datetime(getlastmod.text).timestamp()
                    except:
                        try:
                            import datetime
                            clean_str = getlastmod.text.replace('Z', '+00:00')
                            mtime = datetime.datetime.fromisoformat(clean_str).timestamp()
                        except Exception as e:
                            logging.error(f"[WebDAV] Unparseable date: {getlastmod.text}")
                            pass
                
                size = 0
                if getsize is not None:
                    try: size = int(getsize.text)
                    except: pass
                
                result[rel_p] = {'mtime': mtime, 'size': size}
                
            return result
        except ConnectionError:
            raise
        except Exception as e:
            logging.error(f"[WebDAV] Error listing {target_url}: {e}")
            raise ConnectionError(f"Erreur de connexion WebDAV : {str(e)}")

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
                response = self.session.request('PROPFIND', target_url, headers={'Depth': '1'}, timeout=10)
                if response.status_code == 401:
                    raise ConnectionError("WebDAV Non Autorisé (401)")
                if response.status_code == 403:
                    raise ConnectionError("WebDAV Accès Interdit (403)")
                if response.status_code == 404:
                    raise ConnectionError("WebDAV Introuvable (404)")
                if response.status_code not in [200, 207]: 
                    logging.warning(f"[WebDAV Manual] PROPFIND (Depth: 1) failed on {target_url} with status {response.status_code}.")
                    continue
                
                root = ET.fromstring(response.content)
                
                # V9.6.2: Namespace agnostic fallback
                responses = root.findall('d:response', namespace)
                if not responses:
                    responses = root.findall('.//{DAV:}response')
                    if not responses:
                        responses = root.findall('.//response')
                        
                for resp in responses:
                    href_node = resp.find('d:href', namespace) or resp.find('.//{DAV:}href') or resp.find('.//href')
                    if href_node is None: continue
                    href_raw = href_node.text
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
                    
                    propstat = resp.find('d:propstat', namespace) or resp.find('.//{DAV:}propstat') or resp.find('.//propstat')
                    if propstat is None: continue
                    prop = propstat.find('d:prop', namespace) or propstat.find('.//{DAV:}prop') or propstat.find('.//prop')
                    if prop is None: continue
                    
                    resourcetype = prop.find('d:resourcetype', namespace) or prop.find('.//{DAV:}resourcetype') or prop.find('.//resourcetype')
                    if resourcetype is not None and (resourcetype.find('d:collection', namespace) is not None or resourcetype.find('.//{DAV:}collection') is not None or resourcetype.find('.//collection') is not None):
                        folders_to_scan.append(rel_p)
                    else:
                        getlastmod = prop.find('d:getlastmodified', namespace) or prop.find('.//{DAV:}getlastmodified') or prop.find('.//getlastmodified')
                        getsize = prop.find('d:getcontentlength', namespace) or prop.find('.//{DAV:}getcontentlength') or prop.find('.//getcontentlength')
                        mtime = 0
                        if getlastmod is not None and getlastmod.text:
                            try:
                                from email.utils import parsedate_to_datetime
                                mtime = parsedate_to_datetime(getlastmod.text).timestamp()
                            except:
                                try:
                                    import datetime
                                    clean_str = getlastmod.text.replace('Z', '+00:00')
                                    mtime = datetime.datetime.fromisoformat(clean_str).timestamp()
                                except Exception as e:
                                    logging.error(f"[WebDAV] Manual unparseable date: {getlastmod.text}")
                                    pass
                        size = 0
                        if getsize is not None:
                            try: size = int(getsize.text)
                            except: pass
                        result[rel_p] = {'mtime': mtime, 'size': size}
            except ConnectionError:
                raise
            except Exception as e:
                logging.error(f"[WebDAV] Manual list error at {current_rel}: {e}")
                raise ConnectionError(f"Erreur de réseau : {str(e)}")
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

    def delete_file(self, relative_path: str, protected_dirs: Optional[List[str]] = None) -> bool:
        dst = f"{self.url}/{relative_path}"
        try:
            resp = self.session.delete(dst)
            if resp.status_code in [200, 204]:
                logging.warning(f"[WebDAV] File deleted successfully: {dst}")
                # V9.6.41: Try cleanup empty parents
                parts = relative_path.rstrip('/').split('/')
                while len(parts) > 1:
                    parts.pop()
                    parent_path = "/".join(parts)
                    if not parent_path: break
                    
                    # V9.6.46: Protection check
                    if protected_dirs and parent_path.lower() in protected_dirs:
                        break
                        
                    parent_url = f"{self.url}/{parent_path}"
                    # Check if empty (Depth 1 should only return the folder itself if empty)
                    check = self.session.request('PROPFIND', parent_url, headers={'Depth': '1'})
                    if check.status_code == 207:
                        # Simple heuristic: if only one <d:response> (itself), it's empty
                        if check.text.count('<d:response') <= 1 and check.text.count('<response') <= 1:
                            self.session.delete(parent_url)
                            logging.warning(f"[WebDAV] Empty directory cleaned: {parent_url}")
                        else: break
                    else: break
                return True
            return False
        except Exception as e:
            logging.error(f"[WebDAV] Delete FAILED for {dst}: {e}")
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

        # V9.6.48: Partitioned Sync State by Provider Type
        provider_type = "unknown"
        if isinstance(provider, SftpProvider): provider_type = "sftp"
        elif isinstance(provider, WebdavProvider): provider_type = "webdav"
        elif isinstance(provider, LocalProvider): provider_type = "local"
        
        self.state_file = os.path.join(local_app_dir, "data", f"sync_state_{provider_type}.json")
        self.state = self._load_state()
        logging.warning(f"[SYNC] Using partitioned state: {os.path.basename(self.state_file)}")

        self.protected_dirs = [
            "medias", "medias/audios", "medias/videos", "medias/multipistes", "medias/midi",
            "data", "profiles", "devices", "locales", "assets", "peaks"
        ]
        
        # V9.6.53: Sharing Propagation Map
        self._sharing_map = {} 

    def _is_protected_path(self, rel_path: str) -> bool:
        """Checks if a relative path (portable) is in the protected list."""
        p = rel_path.lower().replace('\\', '/').strip('/')
        return p in self.protected_dirs

    def _load_state(self) -> dict:
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    state = json.load(f)
                    if "shared_uids" not in state: state["shared_uids"] = {}
                    return state
            except: pass
        return {"files": {}, "last_sync": 0, "shared_uids": {}}

    def _build_sharing_map(self, local_files: Dict[str, dict]) -> Dict[str, bool]:
        """
        V9.6.53: Builds a map of UIDs to sharing status, propagating through links.
        Ensures that if a master is shared, all linked media are also pushed to cloud.
        """
        uid_to_shared = {} # UID -> bool
        uid_to_links = {}  # UID -> List[UID]
        
        logging.warning("[SYNC] Building sharing propagation map...")
        
        # 1. Collect initial status from all library and sidecar JSONs
        for rel_path in local_files:
            if not rel_path.lower().endswith('.json'): continue
            
            # V9.6.53: Only scan Medias sidecars and Data library files
            p_low = rel_path.lower()
            if not (p_low.startswith('medias/') or p_low.startswith('data/')): continue
            
            full_path = os.path.join(self.local_dir, rel_path)
            try:
                # Use standard json load for safety
                with open(full_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                items = []
                if isinstance(data, list): items = data
                elif isinstance(data, dict): items = [data]
                
                for item in items:
                    if not isinstance(item, dict): continue
                    uid = item.get('uid')
                    if not uid: continue
                    
                    shared = item.get('shared_with_group', False)
                    # Support both boolean and string "true"
                    is_shared = shared is True or shared == "true"
                    
                    if uid not in uid_to_shared or is_shared:
                        uid_to_shared[uid] = is_shared
                        
                    links = item.get('linked_ids', [])
                    if isinstance(links, list):
                        if uid not in uid_to_links: uid_to_links[uid] = set()
                        for l_uid in links:
                            if l_uid: uid_to_links[uid].add(l_uid)
            except:
                continue

        # 2. Iterative propagation (Transitive closure of sharing)
        # If A is shared and A links to B, then B is shared.
        # If B links to A and A is shared, then B is shared.
        changed = True
        iterations = 0
        while changed and iterations < 10: # Limit iterations for safety
            changed = False
            iterations += 1
            for uid, links in uid_to_links.items():
                current_shared = uid_to_shared.get(uid, False)
                
                # Check if I am shared or any of my links is shared
                new_shared = current_shared
                if not new_shared:
                    for l_uid in links:
                        if uid_to_shared.get(l_uid, False):
                            new_shared = True
                            break
                
                if new_shared and not current_shared:
                    uid_to_shared[uid] = True
                    changed = True
                    
                # Propagate my sharing status to my links
                if new_shared:
                    for l_uid in links:
                        if not uid_to_shared.get(l_uid, False):
                            uid_to_shared[l_uid] = True
                            changed = True
                            
        shared_count = sum(1 for s in uid_to_shared.values() if s)
        logging.warning(f"[SYNC] Sharing map ready: {len(uid_to_shared)} items tracked, {shared_count} shared (including propagation).")
        return uid_to_shared


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

    def _is_filterable_json(self, rel_path: str) -> bool:
        """Returns True if the file is a metadata sidecar OR a main library file."""
        p = rel_path.replace('\\', '/').lower()
        # 1. Media sidecars
        if p.startswith('medias/') and p.endswith('.json'): return True
        # 2. Main libraries (V9.6.56)
        filterable_libs = ['data/local_lib.json', 'data/setlist.json', 'data/web_links.json']
        if p in filterable_libs: return True
        return False

    def set_progress_callback(self, callback):
        self.progress_callback = callback

    def _notify_progress(self, current, total, filename, stage, reason=None):
        if self.progress_callback:
            try:
                self.progress_callback(current, total, filename, stage, reason)
            except:
                pass

    def analyze(self, selected_categories: Optional[List[str]] = None, mode: str = "Bidirectionnel (Auto)", exceptions: Optional[List[str]] = None, manual_skew: float = 0.0) -> Dict[str, list]:
        """
        V9.1: Comprehensive analysis including additions, updates, and deletions.
        """
        if exceptions is None: exceptions = []
        # Normaliser les exceptions pour des comparaisons robustes
        exceptions_lower = [e.lower() for e in exceptions]
        
        self._notify_progress(0, 100, "", "analyzing")
        
        local_files = self._list_local_files()
        
        # V9.6.53: Build sharing propagation map BEFORE analysis
        self._sharing_map = self._build_sharing_map(local_files)
        
        remote_files = self.provider.list_files()
        
        # V9.6.33: Aggressive normalization of all paths (slashes and casing)
        local_files_lower = {p.replace('\\', '/').lower(): p for p in local_files.keys()}
        remote_files_lower = {p.replace('\\', '/').lower(): p for p in remote_files.keys()}
        state_files_lower = {p.replace('\\', '/').lower(): p for p in self.state.get("files", {}).keys()}
        
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
            if self._is_absolute_ignore(rel_path): continue
            if rel_path_low in exceptions_lower: continue # Skip skew check for exceptions
            
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
                if rel_path.lower() in exceptions_lower: continue
                if rel_path.lower() in local_files_lower:
                    try:
                        remote_raw = self.provider.get_file_content(rel_path)
                        if remote_raw:
                            remote_data = json.loads(remote_raw)
                            local_p = local_files_lower[rel_path.lower()]
                            if self._are_jsons_functionally_identical(local_p, remote_data):
                                skews.append(local_files[local_p]['mtime'] - remote_files[rel_path]['mtime'])
                    except: pass
        
        if manual_skew != 0:
            clock_skew = manual_skew
            logging.warning(f"[SYNC] Manual skew OVERRIDE: {manual_skew:.2f}s (ignoring auto-detection)")
        elif skews:
            skews.sort()
            clock_skew = skews[len(skews) // 2]
            logging.warning(f"[SYNC] Clock skew stabilized: {clock_skew:.2f}s (based on {len(skews)} anchors)")
        else:
            logging.warning(f"[SYNC] WARNING: No identical files found and no manual skew. Using 0.0s baseline.")
            
        TOLERANCE = 5.0

        # PASS 2: COMPREHENSIVE SCAN
        # V9.6.35: Cache file lists for cross-validation in _is_shared_file
        self._current_remote_files = remote_files_lower
        self._current_local_files = local_files_lower
        
        # 2.1 Scan Remote for Pull or Remote-Delete
        for rel_path, remote_stat in remote_files.items():
            rel_path_low = rel_path.lower()
            if self._is_absolute_ignore(rel_path): continue
            if rel_path_low in exceptions_lower: continue # V9.6.7: Ignorer complètement
            if not self._is_in_selected_categories(rel_path, selected_categories): continue

            if rel_path_low not in local_files_lower:
                # AUTHORITY LOGIC: If we are in "Push Only (Master)" mode, anything on remote NOT on local
                # should be proposed for deletion to match the local state.
                if "Envoi" in mode:
                    to_delete_remote.append({"path": rel_path, "reason": "mirror_master"})
                elif rel_path_low in state_files_lower:
                    to_delete_remote.append({"path": rel_path, "reason": "deleted_locally"})
                else:
                    if self._is_shared_file(rel_path, is_remote=True, categories=selected_categories):
                        to_pull.append({"path": rel_path, "reason": "remote_only"})
                    else:
                        to_delete_remote.append({"path": rel_path, "reason": "unshared_locally"})

            else:
                local_p_real = local_files_lower[rel_path_low]
                local_stat = local_files[local_p_real]
                
                # V9.5: Check if the file is still shared before proposing update
                if not self._is_shared_file(rel_path, categories=selected_categories):
                    # V9.5.1: If we are in "Push Only (Master)" mode and local file is NOT shared,
                    # but it exists on remote, we should propose deleting it from remote.
                    if "Envoi" in mode:
                        to_delete_remote.append({"path": rel_path, "reason": "unshared_locally"})
                    continue

                if rel_path.lower().endswith('.json') and hasattr(self.provider, 'get_file_content'):
                    try:
                        remote_raw = self.provider.get_file_content(rel_path)
                        if remote_raw and self._are_jsons_functionally_identical(local_p_real, json.loads(remote_raw)):
                            continue
                    except: pass

                # V9.6.47: Explicit skewed comparison
                skewed_local = local_stat['mtime'] + clock_skew
                drift = skewed_local - remote_stat['mtime']
                
                local_dt = datetime.fromtimestamp(local_stat['mtime']).strftime('%d/%m %H:%M')
                remote_real_dt = datetime.fromtimestamp(remote_stat['mtime']).strftime('%d/%m %H:%M')
                
                if rel_path_low.endswith('.exe'):
                    logging.warning(f"[SYNC] [DEBUG EXE] Local: {local_dt}, Remote: {remote_real_dt}, Skew: {clock_skew}s, Drift: {drift}s")

                if 'hash' in remote_stat and 'hash' in local_stat:
                    if remote_stat['hash'] != local_stat['hash']:
                        if drift > 2: to_push.append({"path": local_p_real, "reason": f"content_change ({local_dt} > Cloud: {remote_real_dt})"})
                        elif drift < -2: to_pull.append({"path": rel_path, "reason": f"content_change ({local_dt} < Cloud: {remote_real_dt})"})
                elif abs(drift) > TOLERANCE:
                    if remote_stat['size'] == local_stat['size'] and remote_stat['size'] > 0:
                        continue
                    if drift > TOLERANCE: to_push.append({"path": local_p_real, "reason": f"newer_locally ({local_dt} > Cloud: {remote_real_dt})"})
                    else: to_pull.append({"path": rel_path, "reason": f"newer_remotely ({local_dt} < Cloud: {remote_real_dt})"})

        # 2.2 Scan Local for Push or Local-Delete
        for rel_path, local_stat in local_files.items():
            rel_path_low = rel_path.lower()
            if self._is_absolute_ignore(rel_path): continue
            if rel_path_low in exceptions_lower: continue # V9.6.7: Ignorer complètement
            if not self._is_in_selected_categories(rel_path, selected_categories): continue

            if rel_path_low not in remote_files_lower:
                # AUTHORITY LOGIC: If we are in "Pull Only (Slave)" mode, anything on local NOT on remote
                # should be proposed for deletion to match the remote state.
                if "Réception" in mode:
                    if self._is_shared_file(rel_path, categories=selected_categories):
                        to_delete_local.append({"path": rel_path, "reason": "mirror_slave"})
                elif rel_path_low in state_files_lower:
                    to_delete_local.append({"path": rel_path, "reason": "deleted_remotely"})
                else:
                    if self._is_shared_file(rel_path, categories=selected_categories):
                        to_push.append({"path": rel_path, "reason": "local_only"})
        
        # V9.6.1: Debug Dump for User Verification
        try:
            debug_path = os.path.join(self.local_dir, "data", "sync_debug.json")
            with open(debug_path, "w", encoding="utf-8") as f:
                json.dump({
                    "remote_files": remote_files,
                    "local_files": local_files,
                    "proposed_sync": {
                        "pull": to_pull, 
                        "push": to_push,
                        "delete_remote": to_delete_remote,
                        "delete_local": to_delete_local
                    }
                }, f, indent=4)
        except Exception as e:
            logging.error(f"Failed to write sync_debug.json: {e}")

        self._notify_progress(100, 100, "", "analyzed")
        self._current_remote_files = None
        self._current_local_files = None
        
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
        if ".update_buffer" in p: return True
        if ".gemini" in p: return True
        if ".git" in p: return True
        if "backup/" in p: return True
        if "peaks/" in p: return True
        if p.endswith(".log") or "debug" in p or p == "midikbd_debug.log": return True
        
        # V9.6.49: Ignore partitioned sync states (machine-specific)
        if p.startswith("data/sync_state_") and p.endswith(".json"): return True
        if p == "data/sync_state.json": return True
        
        # Development files
        if p in [".env", ".gitignore", "requirements.txt", "build.bat", "ag_state.json"]: return True
        if p.startswith("venv/") or p.startswith(".git/"): return True
        if p.endswith(".py"): return True
        
        # User hardware config (should remain unique to the machine generally)
        if p == "config.json" or p.startswith("data/config.json"): return True
            
        return False

    def _is_in_selected_categories(self, rel_path: str, categories: Optional[List[str]]) -> bool:
        """Returns True if the file belongs to one of the selected categories."""
        if categories is None: return True
        
        p = rel_path.replace('\\', '/').lower()
        
        # V9.6.23: Normalize categories to be case/accent insensitive (handles Médias vs medias)
        norm_cats = []
        for c in categories:
            c_norm = c.lower().replace('é', 'e').replace('è', 'e')
            norm_cats.append(c_norm)

        if 'medias' in norm_cats:
            if p.startswith('medias/'): return True
            
        if 'data' in norm_cats:
            if p.startswith('data/'): return True
            if p == 'config.json': return True
            
        if 'profiles' in norm_cats:
            if p.startswith('profiles/'): return True
            if p.startswith('profiles - copie/'): return True
            
        if 'devices' in norm_cats:
            if p.startswith('devices/'): return True
            
        if 'system' in norm_cats:
            if p.startswith('assets/'): return True
            if p.startswith('locales/'): return True
            if p.endswith('.exe'): return True
            
        # Diagnostic check removed in V9.6.39

            
        return False

    def _is_shared_file(self, rel_path: str, is_remote: bool = False, categories: Optional[List[str]] = None) -> bool:
        """Returns True if the file should be shared with the group."""
        p = rel_path.replace('\\', '/').lower()
        base_name = os.path.basename(rel_path)
        
        # 1. Validate against categories first
        if not self._is_in_selected_categories(rel_path, categories):
            return False

        # 2. Specific logic for Medias (requires sidecar flag check if local)
        # V9.6.32: Use more robust check for media root (case insensitive)
        if p.startswith("medias/"):
            if any(p.endswith(ext) for ext in ['.json', '.jpg', '.jpeg', '.png', '.gif', '.vtt', '.srt']):
                # JSON/Sidecars in Medias: Check if they contain 'shared_with_group': true
                if is_remote: 
                    return True # Remote sidecars are always shared if they exist on SFTP
                
                # V9.6.33: Use more robust absolute path for local check
                full_path = os.path.normpath(os.path.join(self.local_dir, rel_path))
                if os.path.exists(full_path):
                    try:
                        if p.endswith('.json'):
                            data = utils.load_json(full_path)
                            if not isinstance(data, dict): return False
                            uid = data.get('uid')
                            
                            # V9.6.53: Use propagation map
                            shared = self._sharing_map.get(uid, False)
                            
                            # V9.6.37: If local flag is missing but file is ALREADY on Cloud, trust the Cloud
                            if not shared and not is_remote:
                                if p in getattr(self, '_current_remote_files', {}):
                                    shared = True
                            return shared
                        
                        # V9.6.34: Sidecars (Images/Subs) should check their master JSON
                        # instead of returning False immediately.
                        # We let them fall through to the Multipiste/Standard logic below.
                        pass 
                    except Exception:
                        pass
                # If file doesn't exist locally or error, it's not shared locally unless remote check
                if not is_remote:
                    # Fall through to master check below
                    pass
                else:
                    return False


            # 2. Multipistes logic (check parent folder meta)
            dir_path = os.path.dirname(rel_path)
            meta_rel = os.path.join(dir_path, "airstep_meta.json").replace('\\', '/')
            
            if base_name != "airstep_meta.json":
                is_master_shared = self._is_shared_file(meta_rel, is_remote=is_remote, categories=categories)
                
                # V9.6.36: Cross-validate with Remote cache
                if not is_master_shared and not is_remote:
                    if meta_rel.lower() in getattr(self, '_current_remote_files', {}):
                        is_master_shared = True
                
                if is_master_shared:
                    return True


            # 3. Standard Media logic (Smart Master Search)
            # V9.6.38: Only seek master if NOT already a JSON or sidecar to prevent recursion
            if not any(p.endswith(ext) for ext in ['.json', '.jpg', '.jpeg', '.png', '.gif', '.vtt', '.srt']):
                if self._is_shared_file(rel_path + ".json", is_remote=is_remote, categories=categories):
                    return True
                    
                temp_path = rel_path
                for _ in range(2):
                    if '.' not in os.path.basename(temp_path): break
                    temp_path, _ = os.path.splitext(temp_path)
                    for m_ext in ['', '.mp4', '.mp3', '.wav', '.mkv', '.mov', '.webm', '.aac', '.m4a', '.flac']:
                        master_json = temp_path + m_ext + ".json"
                        if master_json != rel_path + ".json":
                            is_m_shared = self._is_shared_file(master_json, is_remote=is_remote, categories=categories)
                            
                            # V9.6.36: Cross-validate with Remote cache
                            if not is_m_shared and not is_remote:
                                if master_json.lower() in getattr(self, '_current_remote_files', {}):
                                    is_m_shared = True
                                    
                            if is_m_shared:
                                return True


            # Reject media file (no master found)

            return False
            
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
            
            if self._is_filterable_json(rel_path):
                local_path = os.path.join(self.local_dir, rel_path)
                if os.path.exists(local_path):
                    self._perform_deep_merge(buffer_path, local_path)
            
            local_path = os.path.join(self.local_dir, rel_path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            if rel_path.lower().endswith('.exe'):
                # V9.6.54: "Windows Rename" Trick for in-use executables
                # We can rename a running EXE to unlock its path, then put the new one in place.
                try:
                    if os.path.exists(local_path):
                        old_path = local_path + ".old"
                        if os.path.exists(old_path): 
                            try: os.remove(old_path)
                            except: pass
                        os.rename(local_path, old_path)
                        logging.warning(f"[SYNC] EXE in use: renamed to {os.path.basename(old_path)} to allow replacement.")
                    
                    shutil.copy2(buffer_path, local_path)
                except Exception as e:
                    logging.error(f"[SYNC] Failed to update EXE: {e}")
            else:
                shutil.copy2(buffer_path, local_path)
                    
        # 2. Push
        for item in push_list:
            rel_path = item["path"] if isinstance(item, dict) else item
            reason = item["reason"] if isinstance(item, dict) else None
            current_action += 1
            self._notify_progress(current_action, total_actions, rel_path, "push", reason)
            
            local_path = os.path.join(self.local_dir, rel_path)
            upload_source = local_path
            
            if self._is_filterable_json(rel_path):
                try:
                    temp_remote_path = os.path.join(self.update_buffer_dir, rel_path + ".remote")
                    filtered_path = os.path.join(self.update_buffer_dir, rel_path + ".upload")
                    
                    # V9.6.45: Ensure buffer subdirectories exist
                    os.makedirs(os.path.dirname(temp_remote_path), exist_ok=True)
                    
                    if rel_path in remote_files:
                        self.provider.download_file(rel_path, temp_remote_path)
                        self._prepare_filtered_json_for_upload(local_path, temp_remote_path, filtered_path)
                        upload_source = filtered_path
                    else:
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
            self.provider.delete_file(rel_path, protected_dirs=self.protected_dirs)

        # 4. Delete Local
        for item in del_local:
            rel_path = item["path"] if isinstance(item, dict) else item
            current_action += 1
            self._notify_progress(current_action, total_actions, rel_path, "delete_local")
            local_path = os.path.join(self.local_dir, rel_path)
            if os.path.exists(local_path):
                logging.warning(f"[SYNC] Deleting local file: {rel_path}")
                self.provider.delete_file(rel_path, protected_dirs=self.protected_dirs)
        
        # FINAL: Save current state to memory
        # V9.2.1: We only save what is CURRENTLY on the remote and that is SHARED.
        # This prevents new local files (not yet pushed) from being seen as "deleted remotely".
        final_remote_files = self.provider.list_files()
        shared_state = {}
        shared_uids = {} # V9.6.57: Track shared UIDs per filterable JSON
        
        for p, s in final_remote_files.items():
            if self._is_filterable_json(p) or self._is_shared_file(p, is_remote=True, categories=selected_categories):
                shared_state[p] = {"mtime": s.get("mtime", 0), "size": s.get("size", 0)}
                
                # V9.6.57: If it's a filterable JSON, we also track its shared UIDs from the remote content
                if self._is_filterable_json(p):
                    try:
                        content = self.provider.get_file_content(p)
                        if content:
                            data = json.loads(content)
                            if isinstance(data, list):
                                uids = [it['uid'] for it in data if isinstance(it, dict) and 'uid' in it]
                                shared_uids[p] = uids
                            elif isinstance(data, dict) and 'uid' in data:
                                shared_uids[p] = [data['uid']]
                    except Exception as e:
                        logging.debug(f"[STATE] Could not track UIDs for {p}: {e}")
        
        # Save to sync_state.json
        try:
            os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
            self.state = {
                "files": shared_state,
                "shared_uids": shared_uids,
                "last_sync": time.time()
            }
            with open(self.state_file, "w", encoding="utf-8") as f:
                json.dump(self.state, f, indent=2)
        except Exception as e:
            logging.error(f"[STATE] Failed to save sync state: {e}")
        
        self._notify_progress(total_actions, total_actions, "", "finished")

            
    def _prepare_filtered_json_for_upload(self, local_json_path: str, remote_json_path: Optional[str], output_path: str):
        """Creates a filtered version of the JSON for the Cloud (removes private items and private fields)."""
        with open(local_json_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
            
        if isinstance(local_data, list):
            # V9.6.55: Selective List Filter (Only upload SHARED items)
            filtered_list = []
            for item in local_data:
                if not isinstance(item, dict): continue
                shared = item.get('shared_with_group', False)
                if shared is True or shared == "true":
                    # Remove absolute private fields from the shared item
                    clean_item = {k: v for k, v in item.items() if k not in self.private_fields}
                    filtered_list.append(clean_item)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(filtered_list, f, sort_keys=True, separators=(',', ':'))
            return

        if not isinstance(local_data, dict):
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(local_data, f, sort_keys=True, separators=(',', ':'))
            return

        # 1. Create a copy with only shared fields (Whitelist)
        filtered_data = {k: local_data[k] for k in self.shared_fields if k in local_data}
        
        # 2. Force remove absolute private fields
        for fld in self.private_fields:
            if fld in filtered_data:
                del filtered_data[fld]
        
        # 3. Master Wins on specific fields if remote exists
        if remote_json_path and os.path.exists(remote_json_path):
            try:
                with open(remote_json_path, 'r', encoding='utf-8') as f:
                    remote_data = json.load(f)
                MASTER_WINS_FIELDS = ['bpm', 'key', 'media_key', 'scale', 'title', 'artist', 'genre', 'year', 'original_pitch']
                for k in MASTER_WINS_FIELDS:
                    if k in remote_data and remote_data[k]:
                        filtered_data[k] = remote_data[k]
            except: pass

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(filtered_data, f, sort_keys=True, separators=(',', ':'))

    def _perform_deep_merge(self, downloaded_json_path: str, local_json_path: str):
        """Merges remote shared data into local library without destroying private items."""
        with open(local_json_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
        with open(downloaded_json_path, 'r', encoding='utf-8') as f:
            remote_data = json.load(f)
            
        if isinstance(local_data, list) and isinstance(remote_data, list):
            # V9.6.57: Smart List Merge with Deletion Tracking
            local_by_uid = {it['uid']: it for it in local_data if isinstance(it, dict) and 'uid' in it}
            remote_by_uid = {it['uid']: it for it in remote_data if isinstance(it, dict) and 'uid' in it}
            
            # Identify deletions: UIDs that WERE on Cloud (in state) but are NO LONGER on Cloud
            prev_shared_uids = set(self.state.get("shared_uids", {}).get(rel_path, []))
            deleted_on_cloud = prev_shared_uids - set(remote_by_uid.keys())
            
            new_list = []
            
            # Phase 1: Keep local items, merging metadata or deleting
            for item in local_data:
                if not isinstance(item, dict) or 'uid' not in item:
                    new_list.append(item)
                    continue
                
                uid = item['uid']
                shared = item.get('shared_with_group', False)
                is_shared = shared is True or shared == "true"
                
                if not is_shared:
                    # Private item: Always keep as is
                    new_list.append(item)
                else:
                    # Shared item: 
                    if uid in remote_by_uid:
                        # Item exists on Cloud: Merge Cloud metadata into Local
                        remote_item = remote_by_uid[uid]
                        merged_item = item.copy()
                        for k, v in remote_item.items():
                            if k not in self.private_fields:
                                merged_item[k] = v
                        new_list.append(merged_item)
                    elif uid in deleted_on_cloud:
                        # V9.6.57: PROPAGATE DELETION
                        # This item was shared and on Cloud before, but is gone from Cloud now.
                        logging.warning(f"[SYNC] Propagating deletion of shared item: {item.get('title', uid)}")
                        continue
                    else:
                        # Shared locally but NOT in state and NOT on cloud -> New local item
                        new_list.append(item)
            
            # Phase 2: Add new shared items from Cloud
            for uid, remote_item in remote_by_uid.items():
                if uid not in local_by_uid:
                    new_list.append(remote_item)
            
            with open(downloaded_json_path, 'w', encoding='utf-8') as f:
                json.dump(new_list, f, sort_keys=True, separators=(',', ':'))
            return

        if not isinstance(local_data, dict) or not isinstance(remote_data, dict):
            with open(downloaded_json_path, 'w', encoding='utf-8') as f:
                json.dump(remote_data, f, sort_keys=True, separators=(',', ':'))
            return

        # Dict deep merge logic
        merged = deep_merge(local_data.copy(), remote_data)
        for field in self.private_fields:
            if field in local_data: merged[field] = local_data[field]
            elif field in merged: del merged[field]
            
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

