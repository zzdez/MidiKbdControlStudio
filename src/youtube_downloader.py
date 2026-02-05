import os
import shutil
import logging
import yt_dlp

class YouTubeDownloader:
    def __init__(self, download_folder):
        self.download_folder = download_folder
        self.ffmpeg_available = self._check_ffmpeg()
        
        if not os.path.exists(self.download_folder):
            os.makedirs(self.download_folder)

    def _check_ffmpeg(self):
        """Checks if ffmpeg is available in PATH."""
        return shutil.which("ffmpeg") is not None

    def download(self, url, progress_hook=None, logger=None):
        """
        Downloads video from URL.
        Returns dict with result info (title, path, id, etc.)
        """
        
        # Format Selection Strategy
        # If ffmpeg is present: Best Video + Best Audio (Merge) -> MP4
        # If no ffmpeg: Best Single File (often 720p) -> MP4 compatible
        # Note: 'best' in yt-dlp selects best single file with video+audio.
        
        format_str = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        # Phase 1: format selection (same as before)
        format_str = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        if not self.ffmpeg_available:
            logging.warning("FFmpeg not found. Falling back to single file download (lower quality).")
            format_str = "best[ext=mp4]/best"

        # Common Options
        common_opts = {
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
            'ignoreerrors': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://www.google.com/',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            'sleep_interval': 1,
            'max_sleep_interval': 5,
        }
        
        if logger:
            common_opts['logger'] = logger

        try:
            # Step 1: Extract Info only to check Subtitles
            logging.info("Step 1: Inspecting metadata for subtitles...")
            with yt_dlp.YoutubeDL(common_opts) as ydl:
                info_dict = ydl.extract_info(url, download=False)
                
            # Analyze Subtitles
            subs_map = info_dict.get('subtitles', {})
            auto_map = info_dict.get('automatic_captions', {})
            
            # Analyze Subtitles
            subs_map = info_dict.get('subtitles', {})
            auto_map = info_dict.get('automatic_captions', {})
            
            def log_msg(msg):
                if logger: logger.debug(msg) # Use debug for info here to ensure it goes to logger
                else: logging.info(msg)

            log_msg(f"[DEBUG] Available Manual Subs: {list(subs_map.keys())}")
            log_msg(f"[DEBUG] Available Auto Subs: {list(auto_map.keys())}")
            
            target_langs = []
            
            # Check for French (Manual > Auto)
            has_fr_manual = any(k.startswith('fr') for k in subs_map.keys())
            has_fr_auto = any(k.startswith('fr') for k in auto_map.keys())
            
            if has_fr_manual:
                log_msg("Found Manual French Subtitles.")
                target_langs.append('fr.*')
            elif has_fr_auto:
                log_msg("Found Auto-Translated French Subtitles.")
                target_langs.append('fr.*')
            else:
                log_msg("No French Subtitles listed explicitly. Triggering Auto-Translate request.")
                # FORCE REQUEST FOR FRENCH TO TRIGGER AUTO-TRANSLATION
                target_langs.append('fr') 
                
            # Always add English as fallback/complement
            target_langs.append('en.*')
            target_langs.append('en')
            
            # Remove Duplicates
            target_langs = list(set(target_langs))

            
            # Step 2: Download
            log_msg(f"Step 2: Downloading with languages: {target_langs}")
            
            ydl_opts = common_opts.copy()
            ydl_opts.update({
                'format': format_str,
                'outtmpl': os.path.join(self.download_folder, '%(title)s.%(ext)s'),
                'writethumbnail': True,
                'writesubtitles': True,
                'writeautomaticsub': True, # Necessary to get Auto Caps
                'subtitleslangs': target_langs,
                'addmetadata': True,
                'restrictfilenames': True,
            })

            if progress_hook:
                ydl_opts['progress_hooks'] = [progress_hook]

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
                
                # Validation du fichier
                if not os.path.exists(filename):
                     base, _ = os.path.splitext(filename)
                     for ext in ['.mp4', '.mkv', '.webm']:
                         if os.path.exists(base + ext):
                             filename = base + ext
                             break
                
                return {
                    "status": "success",
                    "title": info.get('title', 'Unknown'),
                    "id": info.get('id'),
                    "path": os.path.abspath(filename),
                    "thumbnail": info.get('thumbnail'),
                    "duration": info.get('duration'),
                    "uploader": info.get('uploader'),
                    "description": info.get('description'),
                    "subtitles_found": target_langs
                }

        except Exception as e:
            logging.error(f"Download Error: {e}")
            return {"status": "error", "message": str(e)}
