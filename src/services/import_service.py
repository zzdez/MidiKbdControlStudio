import os
import json
import logging
import asyncio
from typing import Dict, Optional, List
import yt_dlp
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, APIC, TIT2, TPE1
from mutagen.mp4 import MP4, MP4Cover

# Logger configuration would ideally come from a shared config or passed in
logger = logging.getLogger(__name__)

class ImportService:
    def __init__(self, download_dir: str):
        self.download_dir = download_dir

    def analyze_video(self, url: str) -> Dict:
        """
        Analyzes a YouTube video to retrieve metadata, available languages, and subtitles.
        Does NOT download the video.
        """
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extract_flat': False, # We need full details for subs/langs
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                # Extract relevant info
                analysis = {
                    "id": info.get("id"),
                    "title": info.get("title"),
                    "uploader": info.get("uploader"), # Channel/Artist
                    "duration": info.get("duration"),
                    "thumbnail": info.get("thumbnail"),
                    "webpage_url": info.get("webpage_url"),
                    
                    # Language Detection (yt-dlp isn't always perfect here, checks automatic captions mostly)
                    "language": info.get("language"), 
                    
                    # Subtitles
                    "subtitles": list(info.get("subtitles", {}).keys()),
                    "automatic_captions": list(info.get("automatic_captions", {}).keys()),
                    
                    # Formats (Simplified for UI decision)
                    "is_live": info.get("is_live", False)
                }
                
                return {"status": "success", "data": analysis}

        except Exception as e:
            logger.error(f"Analysis Failed: {e}")
            return {"status": "error", "detail": str(e)}

    # ... Future: orchest_download ...
    
    async def orchestrate_import(self, data: Dict, translator_callback=None):
        """
        Orchestrates the full import process: Folder creation, Download, Tagging, Translation.
        Warning: This is a blocking operation, should be run in a separate thread/process if possible,
        or carefully async. yt-dlp is blocking.
        """
        try:
            # 1. Prepare Paths
            base_folder = data['folder_path']
            if data['organize_artist']:
                base_folder = os.path.join(base_folder, self._sanitize(data['artist']))
            if data['organize_title']:
                base_folder = os.path.join(base_folder, self._sanitize(data['title']))
            
            if not os.path.exists(base_folder):
                os.makedirs(base_folder)

            # File Base Name
            filename = self._sanitize(f"{data['artist']} - {data['title']}")
            output_template = os.path.join(base_folder, f"{filename}.%(ext)s")
            
            # 2. Configure yt-dlp
            ydl_opts = {
                'outtmpl': output_template,
                'quiet': False,
                'nocheckcertificate': True,
                'ignoreerrors': True,
                'writethumbnail': True,
                'postprocessors': [], # Will add if audio conversion needed
                'format': 'bestvideo+bestaudio/best' if data['format'] == 'video' else 'bestaudio/best',
            }

            if data['format'] == 'audio':
                ydl_opts['postprocessors'].append({
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                })

            # Subtitles Setup
            if data['dl_subs']:
                ydl_opts['writesubtitles'] = True
                ydl_opts['subtitleslangs'] = [data['sub_lang']]
                # Try to create vtt
                ydl_opts['postprocessors'].append({'key': 'FFmpegEmbedSubtitle'}) # Only works for video/mkv usually?
                # Actually, user wants SEPARATE VTT.
                # yt-dlp writes separate by default if not embedding.
                ydl_opts['skip_download'] = False 
                # Ensure we convert subs to VTT if possible
                # There is a postprocessor 'FFmpegSubtitlesConvertor' but default output is often vtt/srt
            
            # 3. EXECUTE DOWNLOAD
            downloaded_files = []
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(data['url'], download=True)
                # Should return dict.
                if 'requested_downloads' in info:
                    for d in info['requested_downloads']:
                        downloaded_files.append(d['filepath'])
                else:
                    # Single file fallback logic
                    pass # Hard to predict exact filename without prepare_filename
                    # Re-calculate expected filename
                    ext = 'mp3' if data['format'] == 'audio' else info['ext'] # Approximation
                    final_path = os.path.join(base_folder, f"{filename}.{ext}")
                    downloaded_files.append(final_path)

            # Identify valid main media file
            media_path = next((f for f in downloaded_files if f.endswith(('.mp4', '.mp3', '.mkv'))), None)
            
            # 4. TRANSLATION (If requested)
            if data['do_trans'] and translator_callback:
                # Find subtitle file
                # It usually has same basename + lang code
                # We iterate folder to find matching vtt
                for f in os.listdir(base_folder):
                    if f.endswith('.vtt') or f.endswith('.srt'):
                         # Use translator
                         full_sub_path = os.path.join(base_folder, f)
                         # Call translation service
                         # Note: We need to inject the API Key or pass it down. 
                         # Ideally the callback handles the "How" (using keys from config)
                         await translator_callback(full_sub_path, data['trans_lang'])

            # 5. TAGGING (Mutagen)
            if data['tag_file'] and media_path and os.path.exists(media_path):
                self._apply_tags(media_path, data, base_folder)

            # 6. SIDECAR JSON
            sidecar = {
                "source_url": data['url'],
                "subtitle_position": data['sub_position'],
                "artist": data['artist'],
                "title": data['title'],
                "album": data.get('album', ''),
                "genre": data.get('genre', ''),
                "year": data.get('year', ''),
                "category": data.get('category', ''),
                "description": data.get('description', '')
            }
            sidecar_path = os.path.join(base_folder, f"{filename}.json")
            with open(sidecar_path, 'w', encoding='utf-8') as f:
                json.dump(sidecar, f, indent=2)

            return {"status": "success", "path": media_path}

        except Exception as e:
            logger.error(f"Import Error: {e}")
            return {"status": "error", "detail": str(e)}

    def _apply_tags(self, filepath, data, folder):
        try:
            # Find cover image (jpg/webp written by yt-dlp)
            cover_path = None
            for f in os.listdir(folder):
                if f.endswith(('.jpg', '.webp', '.png')) and data['title'] in f: # Loose match
                     cover_path = os.path.join(folder, f)
                     break
            
            # Simple Tagging Logic
            if filepath.endswith('.mp3'):
                audio = MP3(filepath, ID3=ID3)
                try: audio.add_tags()
                except: pass
                audio.tags.add(TIT2(encoding=3, text=data['title']))
                audio.tags.add(TPE1(encoding=3, text=data['artist']))
                # Cover not implemented for brevity, complex with MP3 ID3 APIC vs WebP
                audio.save()
            elif filepath.endswith('.mp4'):
                video = MP4(filepath)
                video["\xa9nam"] = data['title']
                video["\xa9ART"] = data['artist']
                video.save()
                
        except Exception as e:
            logger.warning(f"Tagging non-fatal error: {e}")

    def _sanitize(self, name):
        return "".join([c for c in name if c.isalpha() or c.isdigit() or c in " .-_"]).strip()
