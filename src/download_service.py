import os
import logging
import yt_dlp
import threading
import time
import shutil

try:
    from metadata_service import MetadataService
except ImportError:
    from src.metadata_service import MetadataService

class DownloadService:
    def __init__(self):
        self.metadata_service = MetadataService()
        self.active_downloads = {}
        self.ffmpeg_available = self._check_ffmpeg()

    def _check_ffmpeg(self):
        """Checks if ffmpeg is available in PATH."""
        return shutil.which("ffmpeg") is not None

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

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

                formats = []

                # 1. Audio Option
                formats.append({
                    "id": "audio_best",
                    "label": "Audio (MP3 - Meilleure Qualité)",
                    "type": "audio",
                    "ext": "mp3"
                })

                # 2. Video Options
                # We want to offer standard resolutions: 1080p, 720p, 480p
                # yt-dlp format sorting usually gives best first.
                # We can construct specific selectors.

                available_formats = info.get('formats', [])
                resolutions = set()

                for f in available_formats:
                    if f.get('vcodec') != 'none' and f.get('height'):
                        resolutions.add(f.get('height'))

                sorted_res = sorted(list(resolutions), reverse=True)

                for res in sorted_res:
                    if res < 360: continue # Skip very low quality
                    formats.append({
                        "id": f"video_{res}",
                        "label": f"Vidéo {res}p (MP4)",
                        "type": "video",
                        "resolution": res,
                        "ext": "mp4"
                    })

                return {
                    "title": info.get('title'),
                    "thumbnail": info.get('thumbnail'),
                    "formats": formats
                }

        except Exception as e:
            logging.error(f"DL Info Error: {e}")
            return {"error": str(e)}

    def download(self, options, progress_callback=None, completion_callback=None):
        """
        Blocking download function. Should be run in a thread.
        options: {
            url, format_id, target_folder,
            subs (bool), metadata (dict)
        }
        """
        url = options.get('url')
        fmt_id = options.get('format_id')
        target_folder = options.get('target_folder')
        download_subs = options.get('subs', False)
        meta = options.get('metadata', {})

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
        }

        # Format Selection
        if fmt_id == 'audio_best':
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
                # Fallback: Best Audio (usually m4a/opus) without conversion
                ydl_opts.update({
                    'format': 'bestaudio/best',
                })

        elif fmt_id.startswith('video_'):
            res = fmt_id.split('_')[1]

            if self.ffmpeg_available:
                # Merge Strategy (Best Quality)
                ydl_opts.update({
                    'format': f'bestvideo[height<={res}][ext=mp4]+bestaudio[ext=m4a]/best[height<={res}][ext=mp4]/best[height<={res}]',
                    'merge_output_format': 'mp4'
                })
            else:
                # Single File Strategy (Fallback)
                # Tries to find best pre-merged file
                ydl_opts.update({
                    'format': f'best[height<={res}][ext=mp4]/best[height<={res}]/best',
                })

        # Subtitles
        if download_subs:
            ydl_opts.update({
                'writesubtitles': True,
                'writeautomaticsub': True,
                # 'subtitleslangs': ['fr', 'en', 'all'], # REMOVED: Specific request triggers 429 (Translation API)
                # We assume user wants them side-by-side (srt/vtt files)
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
                # Determine final filename
                # If converted (mp3), filename extension changes.

                if 'requested_downloads' in info:
                    final_filename = info['requested_downloads'][0]['filepath']
                else:
                    # Fallback
                    filename = ydl.prepare_filename(info)
                    if fmt_id == 'audio_best':
                        filename = os.path.splitext(filename)[0] + ".mp3"
                    final_filename = filename

            if final_filename and os.path.exists(final_filename):
                # Tagging
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
