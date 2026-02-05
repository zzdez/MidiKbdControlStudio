import os
import json
import logging
import yt_dlp
import asyncio
from concurrent.futures import ThreadPoolExecutor

try:
    # Production / Frozen (sys._MEIPASS) or Flat Build
    # This tries to import 'services' as a top-level package, which exists in _BUILD_TEMP/services
    from services.translator import parse_vtt, generate_vtt, translate_batch
    # And 'config_manager' as a top-level module (since src/*.py are copied to root of _BUILD_TEMP)
    from config_manager import ConfigManager
except ImportError:
    # Development (running from repo root, where src is a package)
    from src.services.translator import parse_vtt, generate_vtt, translate_batch
    from src.config_manager import ConfigManager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

config_manager = ConfigManager()
executor = ThreadPoolExecutor(max_workers=3)

def _download_media(url, folder, options):
    """
    Executes yt-dlp with the given options.
    Returns the info dict of the downloaded item.
    """
    ydl_opts = {
        'outtmpl': os.path.join(folder, '%(title)s [%(id)s].%(ext)s'),
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': options.get('download_subs', False),
        'writeautomaticsub': options.get('download_subs', False),
        'subtitlesformat': 'vtt',
        'skip_download': False,
        'writethumbnail': True,
        # 'postprocessors': [{'key': 'FFmpegEmbedSubtitle'}] if options.get('embed_subs') else [],
    }

    if options.get('mode') == 'audio':
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        # Video
        quality = options.get('quality', '1080p')
        height = quality.replace('p', '')
        ydl_opts['format'] = f'bestvideo[height<={height}]+bestaudio/best[height<={height}]'

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return info

async def process_import(data):
    """
    Main entry point for importing media.
    data: {
        url, title, artist, ... metadata
        target_folder,
        mode: 'audio'|'video',
        quality: '1080p',
        download_subs: bool,
        translate: bool,
        trans_source_lang, trans_target_lang, trans_context, trans_remove_dupes, trans_remove_non_speech
    }
    """
    url = data.get('url')
    target_folder = data.get('target_folder')

    if not url or not target_folder:
        return {"status": "error", "message": "URL and Target Folder required"}

    if not os.path.exists(target_folder):
        return {"status": "error", "message": "Target folder does not exist"}

    logger.info(f"Starting import for {url} into {target_folder}")

    # Prepare Options
    dl_options = {
        'mode': data.get('mode', 'video'),
        'quality': data.get('quality', '1080p'),
        'download_subs': data.get('download_subs', False)
    }

    try:
        # 1. DOWNLOAD (Run in Thread)
        loop = asyncio.get_running_loop()
        info = await loop.run_in_executor(executor, _download_media, url, target_folder, dl_options)

        # Determine Filenames
        # yt-dlp sanitize filename logic is complex, but we can try to find the file
        # Info dict has 'requested_downloads' usually

        final_filename = None
        if 'requested_downloads' in info:
             final_filename = info['requested_downloads'][0]['filepath']
        else:
             # Fallback logic if needed, but 'filepath' usually present
             final_filename = ydl_utils_get_filepath(info, target_folder)

        if not final_filename or not os.path.exists(final_filename):
             logger.warning("Could not determine final filename cleanly.")
             # Try search by ID
             for f in os.listdir(target_folder):
                 if info['id'] in f and not f.endswith('.json') and not f.endswith('.vtt'):
                      final_filename = os.path.join(target_folder, f)
                      break

        if not final_filename:
             return {"status": "error", "message": "Download failed (file not found)"}

        # 2. SUBTITLE TRANSLATION
        translated_vtt_path = None
        if data.get('translate', False) and data.get('download_subs', False):
            # Find the VTT file
            # Usually same basename as video but .vtt extension
            base, _ = os.path.splitext(final_filename)
            # yt-dlp might append .en.vtt or similar

            vtt_path = None
            # Check for language specific vtt
            # Common pattern: filename.en.vtt

            # List files in folder with same base
            for f in os.listdir(target_folder):
                if f.startswith(os.path.basename(base)) and f.endswith('.vtt'):
                    vtt_path = os.path.join(target_folder, f)
                    break

            if vtt_path and os.path.exists(vtt_path):
                logger.info(f"Translating subtitles: {vtt_path}")
                api_key = config_manager.get("GEMINI_API_KEY")
                if api_key:
                    try:
                        translated_vtt_path = await translate_vtt_file(
                            vtt_path,
                            data.get('trans_source_lang', 'English'),
                            data.get('trans_target_lang', 'French'),
                            api_key,
                            data.get('trans_context', ''),
                            data.get('trans_remove_dupes', True),
                            data.get('trans_remove_non_speech', True)
                        )
                    except Exception as e:
                        logger.error(f"Translation failed: {e}")
                else:
                    logger.warning("No GEMINI_API_KEY found, skipping translation.")

        # 3. CREATE METADATA SIDECAR (JSON)
        # Used by Airstep to store rich metadata not supported by file tags
        sidecar_path = final_filename + ".json"

        metadata = {
            "id": info.get('id'),
            "url": url,
            "title": data.get('title', info.get('title')),
            "artist": data.get('artist', info.get('uploader')), # Use user input or uploader
            "album": data.get('album', ''),
            "genre": data.get('genre', ''),
            "category": data.get('category', 'Général'),
            "year": data.get('year', ''),
            "description": data.get('description', info.get('description', '')),
            "user_notes": data.get('user_notes', ''),
            "subtitle_position": data.get('subtitle_position', 'bottom'), # Default
            "translated_subtitles": translated_vtt_path,
            "original_subtitles": vtt_path if 'vtt_path' in locals() and vtt_path else None
        }

        with open(sidecar_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=4)

        return {
            "status": "success",
            "path": final_filename,
            "sidecar": sidecar_path,
            "translated_subs": translated_vtt_path
        }

    except Exception as e:
        logger.error(f"Import process failed: {e}")
        return {"status": "error", "message": str(e)}

async def translate_vtt_file(filepath, source_lang, target_lang, api_key, context, rm_dupes, rm_speech):
    """
    Orchestrates the translation of a single VTT file using the Service.
    """
    if not os.path.exists(filepath):
        return None

    # 1. Read
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 2. Parse
    cues = parse_vtt(content)

    # 3. Batch Translate
    CHUNK_SIZE = 20
    translated_cues = []

    for i in range(0, len(cues), CHUNK_SIZE):
        chunk = cues[i:i + CHUNK_SIZE]
        # Run synchronous translate_batch in executor to avoid blocking
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            executor,
            translate_batch,
            chunk, source_lang, target_lang, api_key, context, rm_dupes, rm_speech
        )
        translated_cues.extend(result)
        # Small delay to respect rate limits if needed
        await asyncio.sleep(0.5)

    # 4. Generate
    new_content = generate_vtt(translated_cues)

    # 5. Save
    # ex: song.vtt -> song_French.vtt
    new_filepath = filepath.replace(".vtt", f"_{target_lang}.vtt")
    with open(new_filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

    return new_filepath

def ydl_utils_get_filepath(info, folder):
    # Heuristic to guess filename if requested_downloads is missing
    # This is fragile but better than nothing
    filename = info.get('_filename')
    if filename: return filename
    # Reconstruct from template
    # This is hard because template uses sanitized title
    return None
