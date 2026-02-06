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

    def get_formats(self, url):
        """
        Retrieves format list AND available audio languages.
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

                # Extract Audio Languages
                # Store as dict {code: name} to handle duplicates and prefer names
                langs_found = {}
                formats = info.get('formats', [])

                # Debug Log
                logging.info(f"[DL-DEBUG] Formats found: {len(formats)}")

                for f in formats:
                    # Filter Audio Only formats (vcodec=none)
                    if f.get('vcodec') == 'none' and f.get('acodec') != 'none':

                        lang = f.get('language')
                        note = f.get('format_note', '')

                        # Logging specific audio track details
                        logging.info(f"[DL-DEBUG] Audio Track - ID: {f.get('format_id')}, Lang: {lang}, Note: {note}")

                        # Heuristic: Clean Note (remove quality info like "low", "medium")
                        clean_note = note.lower().replace("low", "").replace("medium", "").replace("high", "").strip()

                        # Identifier: Lang Code OR Note (if Lang missing)
                        # If both missing, it's usually "und" (Undefined/Default)

                        # Skip pure quality tracks if we already have a better label for this language
                        if not lang and not clean_note:
                            continue

                        # If lang code exists, use it as primary key
                        if lang:
                            key = lang
                            label = note if note else lang
                        else:
                            # Use note as key if valid (e.g. "French")
                            key = clean_note
                            label = clean_note

                        # Store/Update
                        # We want to keep the most descriptive label
                        if key not in langs_found:
                            langs_found[key] = {'code': key, 'name': label}
                        elif note and len(note) > len(langs_found[key]['name']):
                             langs_found[key]['name'] = note

                # Convert to sorted list
                lang_list = sorted(langs_found.values(), key=lambda x: x['code'])
                logging.info(f"[DL-DEBUG] Final Langs: {lang_list}")

                return {
                    "title": info.get('title'),
                    "thumbnail": info.get('thumbnail'),
                    "duration": info.get('duration'),
                    "languages": lang_list
                }

        except Exception as e:
            logging.error(f"DL Info Error: {e}")
            return {"error": str(e)}

    def download(self, options, progress_callback=None, completion_callback=None):
        """
        Blocking download function. Should be run in a thread.
        options: {
            url, format_id, target_folder,
            subs (bool), metadata (dict),
            container (mp4/mkv), audio_langs (list of codes)
        }
        """
        url = options.get('url')
        fmt_id = options.get('format_id')
        target_folder = options.get('target_folder')
        download_subs = options.get('subs', False)
        container = options.get('container', 'mp4') # Default MP4
        audio_langs = options.get('audio_langs', []) # List of selected lang codes
        meta = options.get('metadata', {})

        if not os.path.exists(target_folder):
            os.makedirs(target_folder, exist_ok=True)

        # Build YDL Config
        ydl_opts = {
            'outtmpl': os.path.join(target_folder, '%(title)s.%(ext)s'),
            'noplaylist': True,
            'writethumbnail': False,
            'quiet': True,
            'no_warnings': True,
            # Force Android client to see all audio tracks (dubs)
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            'sleep_interval': 1,
            'max_sleep_interval': 5,
        }

        if self.ffmpeg_path:
            ydl_opts['ffmpeg_location'] = self.ffmpeg_path

        # --- AUDIO SELECTION BUILDER ---
        # If user selected languages, we build a filter.
        # If not (or for Audio Only mode), we use default behavior.

        def build_audio_filter():
            if not audio_langs:
                return "bestaudio"

            # If multiple langs, we want to download ALL of them.
            # yt-dlp syntax for multi audio is: bestaudio[language=fr],bestaudio[language=en]
            # And enable --audio-multistreams
            filters = []
            for lang in audio_langs:
                filters.append(f"bestaudio[language={lang}]")

            # If ffmpeg available and MKV, we can merge.
            # But the 'format' string in yt-dlp expects a logic like: video+audio1+audio2
            # Join with +
            return "+".join(filters)

        # --- FORMAT LOGIC ---

        # 1. AUDIO MODES (Ignoring Multi-Lang selection as per request "Audio: langue par défaut")
        if fmt_id == 'audio_original':
            ydl_opts.update({'format': 'bestaudio/best'})

        elif fmt_id.startswith('audio_mp3_'):
            quality = fmt_id.split('_')[2]
            ydl_opts.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': quality,
                }],
            })

        # 2. VIDEO MODES
        elif fmt_id.startswith('video_'):

            # Multi-Audio Handling
            use_multiaudio = len(audio_langs) > 0 and self.ffmpeg_available

            if use_multiaudio:
                ydl_opts['audio_multistreams'] = True
                audio_str = build_audio_filter()
            else:
                # Default: Best available audio
                audio_str = "bestaudio"

            # Resolution Handling
            if fmt_id == 'video_auto':
                # No merge if possible, just best file.
                # BUT if user wants multi-audio, we MUST merge.
                if use_multiaudio:
                    ydl_opts.update({
                        'format': f"bestvideo+({audio_str})/best",
                        'merge_output_format': container
                    })
                else:
                    # Classic Auto (Fallback)
                    ydl_opts.update({'format': f'best[ext={container}]/best'})

            else:
                # Specific Resolution (Requires Merge usually)
                res = fmt_id.split('_')[1]

                # Strict Format: Video stream <= RES + Selected Audio(s)
                # Fallback to single file <= RES if merge fails or not possible
                video_selector = f"bestvideo[height<={res}]"

                ydl_opts.update({
                    'format': f"{video_selector}+({audio_str})/best[height<={res}]",
                    'merge_output_format': container
                })

        # Subtitles
        if download_subs:
            ydl_opts.update({
                'writesubtitles': True,
                'writeautomaticsub': True,
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

                    if 'postprocessors' in ydl_opts:
                        for pp in ydl_opts['postprocessors']:
                            if pp['key'] == 'FFmpegExtractAudio':
                                base, _ = os.path.splitext(filename)
                                filename = base + "." + pp['preferredcodec']
                                break
                    final_filename = filename

            if final_filename and os.path.exists(final_filename):
                logging.info(f"Tagging file: {final_filename}")
                self.metadata_service.write_file_metadata(final_filename, meta)

                if completion_callback:
                    completion_callback(True, {"path": final_filename, "meta": meta})
            else:
                if completion_callback:
                    completion_callback(False, "File not found after download")

        except Exception as e:
            logging.error(f"Download Failed: {e}")
            if completion_callback:
                completion_callback(False, str(e))
