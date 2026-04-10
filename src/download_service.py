import os
import logging
import yt_dlp
import threading
import time
import shutil
import sys

try:
    from metadata_service import MetadataService
except ImportError:
    from src.metadata_service import MetadataService

class DownloadService:
    def __init__(self):
        self.metadata_service = MetadataService()
        self.active_downloads = {}
        
        # Dependency Check (Strict Enforcement)
        # Even if yt_dlp library is imported, we require the executable as a token of responsibility
        try:
            from dependency_manager import DependencyManager
            status = DependencyManager.check_availability()
            self.download_available = status["can_download"] # Requires yt-dlp.exe AND ffmpeg.exe
        except:
             self.download_available = False

        self.ffmpeg_path = self._find_ffmpeg()
        self.ffmpeg_available = self.ffmpeg_path is not None
        
        if self.ffmpeg_available:
            logging.info(f"FFmpeg detected at: {self.ffmpeg_path}")
        else:
            logging.warning("FFmpeg not found. Merging and conversions disabled.")

    def _find_ffmpeg(self):
        """
        Looks for ffmpeg in:
        1. System PATH
        2. Current Working Directory
        3. Application Directory (Frozen or Source)
        """
        # 1. Check System PATH
        path = shutil.which("ffmpeg")
        if path: return path

        # Candidates for local check
        candidates = []

        # 2. Current Directory
        candidates.append(os.path.join(os.getcwd(), "ffmpeg.exe"))
        candidates.append(os.path.join(os.getcwd(), "ffmpeg")) # Linux/Mac

        # 3. App Directory
        if getattr(sys, 'frozen', False):
            base_path = sys._MEIPASS
            # Check root of portable dir (executable dir)
            exe_dir = os.path.dirname(sys.executable)
            candidates.append(os.path.join(exe_dir, "ffmpeg.exe"))
            candidates.append(os.path.join(exe_dir, "ffmpeg"))
        else:
            # Source Mode
            base_path = os.path.dirname(os.path.abspath(__file__)) # src/
            root_path = os.path.dirname(base_path) # project root
            candidates.append(os.path.join(root_path, "ffmpeg.exe"))
            candidates.append(os.path.join(root_path, "ffmpeg"))

        for c in candidates:
            if os.path.exists(c) and os.access(c, os.X_OK):
                return c
            # Windows fallback check without X_OK if strictly name match
            if os.path.exists(c) and c.endswith(".exe"):
                return c

        return None

    def _check_ffmpeg(self):
        """Deprecated, use self.ffmpeg_available."""
        return self.ffmpeg_available

    def get_formats(self, url):
        """
        Retrieves simplified format list for a URL.
        """
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }

        if self.ffmpeg_path:
            ydl_opts['ffmpeg_location'] = self.ffmpeg_path

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return {
                    "title": info.get('title'),
                    "thumbnail": info.get('thumbnail'),
                    "duration": info.get('duration')
                }

        except Exception as e:
            logging.error(f"DL Info Error: {e}")
            return {"error": str(e)}

    def get_direct_url(self, url):
        """
        Retrieves the direct stream URL for a video (fallback preview).
        """
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'format': 'best[ext=mp4]/best', # Prefer MP4 for browser compatibility
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }

        if self.ffmpeg_path:
            ydl_opts['ffmpeg_location'] = self.ffmpeg_path

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return {
                    "url": info.get('url'), # The direct stream link
                    "title": info.get('title'),
                    "thumbnail": info.get('thumbnail')
                }
        except Exception as e:
            logging.error(f"Get Direct URL Error: {e}")
            return {"error": str(e)}

    def download(self, options, progress_callback=None, completion_callback=None):
        """
        Blocking download function. Should be run in a thread.
        options: {
            url, format_id, target_folder,
            subs (bool), metadata (dict)
        }
        """
        if not self.download_available:
            if completion_callback:
                completion_callback(False, "Téléchargement désactivé : Outils externes manquants (yt-dlp/ffmpeg).")
            return

        url = options.get('url')
        fmt_id = options.get('format_id')
        target_folder = options.get('target_folder')
        download_subs = options.get('subs', False)
        meta = options.get('metadata', {})

        from utils import resolve_portable_path
        target_folder = resolve_portable_path(target_folder)

        if not os.path.exists(target_folder):
            os.makedirs(target_folder, exist_ok=True)

        # Build YDL Config
        ydl_opts = {
            'outtmpl': os.path.join(target_folder, '%(title)s.%(ext)s'),
            'noplaylist': True,
            'writethumbnail': False, # We handle cover manually via metadata service usually
            'quiet': True,
            'no_warnings': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            'sleep_interval': 1,
            'max_sleep_interval': 5,
            'add_metadata': True, # Embed chapters/info into file
        }

        # Inject Local FFmpeg
        if self.ffmpeg_path:
            ydl_opts['ffmpeg_location'] = self.ffmpeg_path

        # Format Selection Logic

        # --- AUDIO MODES ---
        if fmt_id == 'audio_original':
            # Best audio, no conversion (M4A/Opus)
            ydl_opts.update({
                'format': 'bestaudio/best',
            })

        elif fmt_id.startswith('audio_mp3_'):
            # Conversion required
            quality = fmt_id.split('_')[2] # 320, 192, 128
            ydl_opts.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': quality,
                }],
            })

        # --- VIDEO MODES ---
        elif fmt_id == 'video_auto':
            # Best Single File (No Merge)
            ydl_opts.update({
                'format': 'best[ext=mp4]/best',
            })

        elif fmt_id.startswith('video_'):
            # Explicit Resolution (Merge Strategy)
            res = fmt_id.split('_')[1] # 1080, 720, etc
            ydl_opts.update({
                'format': f'bestvideo[height<={res}][ext=mp4]+bestaudio[ext=m4a]/best[height<={res}][ext=mp4]/best[height<={res}]',
                'merge_output_format': 'mp4'
            })

        # --- LEGACY FALLBACK ---
        elif fmt_id == 'audio_best':
             if self.ffmpeg_available:
                 ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                })
             else:
                 ydl_opts.update({'format': 'bestaudio/best'})

        # Subtitles
        if download_subs:
            ydl_opts.update({
                'writesubtitles': True,
                'writeautomaticsub': True,
                # 'subtitleslangs': ['fr', 'en', 'all'], # REMOVED: Specific request triggers 429
                'skip_download_archive': True,
            })

        # Progress Hook
        def hook(d):
            if d['status'] == 'downloading':
                try:
                    p = d.get('_percent_str', '0%').replace('%','')
                    progress_callback(float(p), "downloading")
                except: pass
            elif d['status'] == 'finished':
                progress_callback(100, "processing")

        ydl_opts['progress_hooks'] = [hook]

        try:
            final_filename = None
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

                if 'requested_downloads' in info:
                    final_filename = info['requested_downloads'][0]['filepath']
                else:
                    filename = ydl.prepare_filename(info)

                    # Correction: prepare_filename returns the original filename before conversion.
                    # If we converted to MP3, the extension changed.
                    if 'postprocessors' in ydl_opts:
                        for pp in ydl_opts['postprocessors']:
                            if pp['key'] == 'FFmpegExtractAudio':
                                base, _ = os.path.splitext(filename)
                                filename = base + "." + pp['preferredcodec']
                                break

                    final_filename = filename

            if final_filename and os.path.exists(final_filename):
                # Tagging
                logging.info(f"Tagging file: {final_filename}")
                self.metadata_service.write_file_metadata(final_filename, meta)

                # Extract Chapters if available
                chapters = info.get('chapters', [])

                if completion_callback:
                    completion_callback(True, {
                        "path": final_filename, 
                        "meta": meta,
                        "chapters": chapters
                    })
            else:
                if completion_callback:
                    completion_callback(False, "File not found after download")

        except Exception as e:
            logging.error(f"Download Failed: {e}")
            if completion_callback:
                completion_callback(False, str(e))
