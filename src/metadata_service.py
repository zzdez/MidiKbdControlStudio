import logging
import re
import requests
import os
import base64
import time
import mutagen
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TCON, TDRC, TRCK, error as ID3Error
from mutagen.easyid3 import EasyID3
from mutagen.easymp4 import EasyMP4
from mutagen.flac import Picture, FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE
from mutagen.mp4 import MP4, MP4Cover
from utils import resolve_portable_path

class MetadataService:
    def __init__(self):
        logging.info("MetadataService initialized with iTunes API")

    def clean_filename(self, filename):
        """
        Nettoie un nom de fichier pour en faire un terme de recherche.
        Ex: "01_Back_in_Black.mp3" -> "Back in Black"
        """
        if not filename: return ""
        
        # 1. Enlever l'extension
        text = re.sub(r'\.(mp3|wav|flac|ogg|m4a|webm|mkv|aac|wma)$', '', filename, flags=re.IGNORECASE)
        
        # 2. Enlever les chiffres au début (Track numbers)
        # Ex: "01 - Title", "01. Title", "01 Title"
        text = re.sub(r'^\s*\d+[\s.-]+', '', text)
        
        # 3. Remplacer underscores et plusieurs espaces
        text = text.replace("_", " ").replace("-", " ")
        text = re.sub(r'\s+', ' ', text)
        
        # 4. Mots parasites (Optionnel, à enrichir)
        parasites = [
            r'\(?official video\)?', 
            r'\(?official audio\)?', 
            r'\(?lyrics\)?', 
            r'\(?remastered\)?', 
            r'\(?remaster\)?',
            r'\(?hq\)?',
            r'\[.*?\]' # Enlever tout ce qui est entre crochets [kbps], [promo] etc.
        ]
        
        for p in parasites:
            text = re.sub(p, '', text, flags=re.IGNORECASE)

        return text.strip()

    def search(self, query):
        """Recherche sur iTunes API."""
        if not query: return []
        
        # On nettoie la requête
        clean_q = self.clean_filename(query)
        if not clean_q or len(clean_q) < 2: 
            logging.warning(f"Query empty after cleaning: '{query}' -> '{clean_q}'")
            # Fallback: research generic if cleaning stripped too much, or use original if reasonable
            if len(query) > 0: clean_q = query
            else: return []

        logging.info(f"Searching iTunes for: {clean_q}")
        
        url = "https://itunes.apple.com/search"
        params = {
            "term": clean_q,
            "media": "music",
            "entity": "song",
            "limit": 5
        }
        
        results = []
        try:
            resp = requests.get(url, params=params, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("results", []):
                    # Mapping iTunes -> App
                    
                    # Cover HD Hack
                    cover_url = item.get("artworkUrl100", "")
                    if cover_url:
                        cover_url = cover_url.replace("100x100bb", "600x600bb")
                    
                    # Year Parsing (releaseDate: "1980-07-25T07:00:00Z")
                    year = ""
                    if "releaseDate" in item:
                        year = item["releaseDate"][:4]

                    results.append({
                        "title": item.get("trackName", ""),
                        "artist": item.get("artistName", ""),
                        "album": item.get("collectionName", ""),
                        "genre": item.get("primaryGenreName", ""),
                        "year": year,
                        "cover_url": cover_url,
                        "preview_url": item.get("previewUrl", "") # Bonus: preview audio possible
                    })
            else:
                logging.error(f"iTunes API Error: {resp.status_code}")

        except Exception as e:
            logging.error(f"iTunes Search Fatal Error: {e}")
            
        return results

    def scan_file_metadata(self, path):
        if os.path.isdir(path):
            title = os.path.basename(path.rstrip('/\\'))
            stems = []
            max_duration = 0
            
            # --- SIDECAR JSON LOADING ---
            sidecar_path = os.path.join(path, "airstep_meta.json")
            sidecar_data = {}
            has_sidecar = os.path.exists(sidecar_path)
            
            import json
            if has_sidecar:
                try:
                    with open(sidecar_path, "r", encoding="utf-8") as f:
                        sidecar_data = json.load(f)
                except Exception as e:
                    logging.error(f"Error reading sidecar JSON: {e}")

            # V57: Generate stable UID if missing
            if not sidecar_data.get("uid"):
                import uuid
                sidecar_data["uid"] = f"lib_{uuid.uuid4().hex[:8]}"
                try:
                    with open(sidecar_path, "w", encoding="utf-8") as f:
                        json.dump(sidecar_data, f, indent=4)
                except: pass

            # Scan for audio files in the top level of the directory
            for f in os.listdir(path):
                if f.lower().endswith(('.mp3', '.wav', '.flac', '.ogg', '.m4a')):
                    stem_path = os.path.join(path, f)
                    stems.append(stem_path)
                    
            # Try to get duration from the first stem as reference
            if stems:
                try:
                    ref_audio = mutagen.File(stems[0], easy=True)
                    if ref_audio and hasattr(ref_audio, 'info') and hasattr(ref_audio.info, 'length'):
                        max_duration = ref_audio.info.length
                except: pass

            return {
                "uid": sidecar_data.get("uid"),
                "title": sidecar_data.get("title", title),
                "artist": sidecar_data.get("artist", ""),
                "album": sidecar_data.get("album", "Stems"),
                "genre": sidecar_data.get("genre", ""),
                "year": sidecar_data.get("year", ""),
                "bpm": sidecar_data.get("bpm", ""),
                "key": sidecar_data.get("key", ""),
                "media_key": sidecar_data.get("media_key", ""),
                "original_pitch": sidecar_data.get("original_pitch", ""),
                "target_pitch": sidecar_data.get("target_pitch", ""),
                "category": sidecar_data.get("category", "Multipistes"),
                "user_notes": sidecar_data.get("user_notes", ""),
                "loops": sidecar_data.get("loops", []),
                "audio_cues": sidecar_data.get("audio_cues", []),
                "volume": sidecar_data.get("volume", 100),
                "autoplay": sidecar_data.get("autoplay", False),
                "autoreplay": sidecar_data.get("autoreplay", False),
                "subtitle_pos_y": sidecar_data.get("subtitle_pos_y", 80),
                "linked_ids": sidecar_data.get("linked_ids", []),
                "is_primary": sidecar_data.get("is_primary", False),
                "duration": max_duration,
                "is_multitrack": True,
                "stems": stems
            }


        # --- SINGLE FILE SCAN ---
        ext = os.path.splitext(path)[1].lower()
        try:
            audio = None
            if ext in ['.m4a', '.mp4']:
                try: audio = EasyMP4(path)
                except: pass
            elif ext == '.ogg':
                try: audio = OggVorbis(path)
                except: pass

            # Generic Fallback (Handles WebM/MKV if supported by installed mutagen)
            if not audio:
                audio = mutagen.File(path, easy=True)

            if not audio:
                # Fallback specifically for OGG if Easy failed and we didn't try OggVorbis yet
                if ext == '.ogg':
                    try: audio = OggVorbis(path)
                    except: pass

            if not audio: return {"title": os.path.basename(path)}

            # Helper to get first item safely
            def get_val(obj, keys):
                for k in keys:
                    if k in obj and obj[k]:
                        return obj[k][0]
                return ""

            title = os.path.basename(path)
            artist = ""
            album = ""
            genre = ""
            year = ""

            # Strategy: Duck Typing keys based on object type
            # Matroska / OggVorbis use UPPERCASE keys usually (or simple tags)
            # EasyID3/EasyMP4 use 'title', 'artist'

            keys_title = ['title', 'TITLE', 'Title']
            keys_artist = ['artist', 'ARTIST', 'Artist']
            keys_album = ['album', 'ALBUM', 'Album']
            keys_genre = ['genre', 'GENRE', 'Genre']
            keys_date = ['date', 'DATE', 'year', 'YEAR']

            t = get_val(audio, keys_title)
            if t: title = t

            artist = get_val(audio, keys_artist)
            album = get_val(audio, keys_album)
            genre = get_val(audio, keys_genre)
            year = get_val(audio, keys_date)

            length = 0
            if hasattr(audio, 'info') and hasattr(audio.info, 'length'):
                length = audio.info.length

            res = {
                "title": title,
                "artist": artist,
                "album": album,
                "genre": genre,
                "year": year,
                "duration": length
            }

            # Merging with Sidecar JSON if available (priority to sidecar for extended fields)
            sidecar_path = path + ".json"
            sidecar_data = {}
            if os.path.exists(sidecar_path):
                try:
                    import json
                    with open(sidecar_path, "r", encoding="utf-8") as f:
                        sidecar_data = json.load(f)

                        # V57: UID support for single files
                        if not sidecar_data.get("uid"):
                            import uuid
                            sidecar_data["uid"] = f"lib_{uuid.uuid4().hex[:8]}"
                            try:
                                with open(sidecar_path, "w", encoding="utf-8") as f_save:
                                    json.dump(sidecar_data, f_save, indent=4)
                            except: pass

                        # Apply sidecar overrides
                        if sidecar_data.get("title"): res["title"] = sidecar_data["title"]
                        if sidecar_data.get("artist"): res["artist"] = sidecar_data["artist"]
                        if sidecar_data.get("album"): res["album"] = sidecar_data["album"]
                        if sidecar_data.get("genre"): res["genre"] = sidecar_data["genre"]
                        if sidecar_data.get("year"): res["year"] = sidecar_data["year"]

                        # Add Extended metadata that Mutagen doesn't reliably map
                        res["uid"] = sidecar_data.get("uid")
                        res["bpm"] = sidecar_data.get("bpm", "")
                        res["key"] = sidecar_data.get("key", "")
                        res["scale"] = sidecar_data.get("scale", "")
                        res["linked_ids"] = sidecar_data.get("linked_ids", [])
                        res["user_notes"] = sidecar_data.get("user_notes", "")
                        res["category"] = sidecar_data.get("category", "")

                        res["key"] = sidecar_data.get("key", "")
                        res["media_key"] = sidecar_data.get("media_key", "")
                        res["scale"] = sidecar_data.get("scale", "")
                        res["original_pitch"] = sidecar_data.get("original_pitch", "")
                        res["target_pitch"] = sidecar_data.get("target_pitch", "")
                        res["category"] = sidecar_data.get("category", "")
                        res["user_notes"] = sidecar_data.get("user_notes", "")
                        res["loops"] = sidecar_data.get("loops", [])
                        res["audio_cues"] = sidecar_data.get("audio_cues", [])
                        res["volume"] = sidecar_data.get("volume", 100)
                        res["autoplay"] = sidecar_data.get("autoplay", False)
                        res["autoreplay"] = sidecar_data.get("autoreplay", False)
                        res["is_primary"] = sidecar_data.get("is_primary", False)
                        res["subtitle_pos_y"] = sidecar_data.get("subtitle_pos_y", 80)
                except Exception as e:
                    logging.error(f"Error reading single file sidecar JSON: {e}")

            # V57: Add default UID if still missing (might happen if no sidecar exists yet)
            if not res.get("uid"):
                import uuid
                res["uid"] = f"lib_{uuid.uuid4().hex[:8]}"
                # Note: We don't force write it here for non-sidecar files to avoid creating 
                # .json files for EVERYTHING. But if write_file_metadata is called, it will persist.
                
            return res

        except Exception as e:
            print(f"Metadata Read Error: {e}")

            res = {"title": os.path.basename(path)}
            # Try to read sidecar even if Mutagen fails
            sidecar_path = path + ".json"
            if os.path.exists(sidecar_path):
                try:
                    import json
                    with open(sidecar_path, "r", encoding="utf-8") as f:
                        sidecar_data = json.load(f)
                        res.update(sidecar_data)
                except: pass

            return res

    def generate_peaks(self, file_path: str, num_samples: int = 8000) -> list:
        """
        Génère un tableau de 'peaks' (min/max) pour dessiner l'onde audio.
        Mise en cache du résultat (.json) pour éviter de recalculer à chaque chargement.
        """
        import json
        
        cache_file = file_path + ".peaks.json"
        
        # 1. Vérifier si le cache existe
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r") as f:
                    return json.load(f)
            except:
                pass # Si le cache est corrompu, on recalcule
                
        try:
            ext = os.path.splitext(file_path)[1].lower()
            if ext != '.wav':
                # Pour l'instant on ne supporte que les pics pur WAV sans dependances lourdes
                return []
                
            import wave
            import struct
            
            with wave.open(file_path, 'rb') as wav_file:
                nchannels = wav_file.getnchannels()
                sampwidth = wav_file.getsampwidth()
                nframes = wav_file.getnframes()
                
                if nframes == 0 or sampwidth not in (1, 2, 3, 4):
                    return []
                    
                chunk_size = max(1, nframes // num_samples)
                peaks = []
                
                # Format de struct selon sampwidth
                fmt = ''
                if sampwidth == 1:
                    fmt = f"<{chunk_size * nchannels}B" # unverified, unsigned
                elif sampwidth == 2:
                    fmt = f"<{chunk_size * nchannels}h" # signed 16-bit
                elif sampwidth == 4:
                    fmt = f"<{chunk_size * nchannels}i" # signed 32-bit ou f (float) - simplifions pour int standard
                    
                for i in range(0, nframes, chunk_size):
                    # Attention, à la fin du fichier le chunk peut être plus petit
                    frames_to_read = min(chunk_size, nframes - i)
                    data = wav_file.readframes(frames_to_read)
                    
                    if not data:
                        break
                        
                    # Si c'est du 24-bit (sampwidth=3), struct ne gère pas nativement int24.
                    # Méthode manuelle ou on skip. Pour l'audio DAW c'est souvent 16 ou 24, parfois 32 float.
                    # Implémentation universelle simple via int.from_bytes:
                    max_val = 0
                    bytes_per_sample = sampwidth * nchannels
                    
                    # Lecture byte-level (plus souple que struct pour le 24bit)
                    # On ne prend qu'un échantillon sur X pour aller vite si le chunk est très grand (downsampling basique)
                    step = max(1, len(data) // 400) * sampwidth # On check ~400 points dans le chunk pour trouver le max approché
                    # s'assurer qu'on reste aligné sur un echantillon complet (nchannels * sampwidth)
                    step = (step // bytes_per_sample) * bytes_per_sample
                    if step == 0: step = bytes_per_sample
                    
                    for j in range(0, len(data), step):
                        # Lecture du channel 1 (Left ou Mono)
                        sample_bytes = data[j:j+sampwidth]
                        if len(sample_bytes) < sampwidth:
                            continue
                            
                        # Convertir bytes en entier signé (sauf 8-bit qui est souvent non-signé)
                        signed = sampwidth > 1
                        val = int.from_bytes(sample_bytes, byteorder='little', signed=signed)
                        
                        abs_val = abs(val)
                        if abs_val > max_val:
                            max_val = abs_val
                            
                    # Normaliser selon la largeur (16 bits = 32768, 24 bits = 8388608...)
                    max_possible = (1 << (sampwidth * 8 - (1 if sampwidth > 1 else 0))) - 1
                    
                    # Ramener entre 0 et 1.
                    normalized = float(max_val) / float(max_possible) if max_possible > 0 else 0.0
                    peaks.append(round(normalized, 4))
                    
            # 3. Sauvegarder dans le cache
            try:
                import json
                with open(cache_file, "w") as f:
                    json.dump(peaks, f)
            except Exception as e:
                import logging
                logging.error(f"Cannot save peaks cache for {file_path}: {e}")
                    
            return peaks
        except Exception as e:
            import logging
            logging.error(f"Generate Peaks Error for {file_path} (wave module): {e}")
            return []

    def write_file_metadata(self, path, data, local_items=None):
        """Writes metadata to a file's id3 tags or a sidecar .json file."""
        path = resolve_portable_path(path)
        
        logging.info(f"Attempting to write metadata for: {path}")
        
        # --- MULTITRACK (DIRECTORY) CASE ---
        if os.path.isdir(path):
            sidecar_path = os.path.join(path, "airstep_meta.json")
            import json
            
            # --- 1. LOAD EXISTING SIDECAR ---
            sidecar_data = {}
            if os.path.exists(sidecar_path):
                try:
                    with open(sidecar_path, "r", encoding="utf-8") as f:
                        sidecar_data = json.load(f)
                except: pass
            
            # --- 2. MERGE WITH NEW DATA ---
            # V57: Exclude transitories and bloat
            for key, value in data.items():
                if key not in ["cover_data", "cover_url", "stems", "is_multitrack", "duration", "chapters"]:
                    sidecar_data[key] = value
            
            try:
                # 3. Handle Cover if provided
                if "cover_data" in data and data["cover_data"]:
                    cover_data_bin, mime = self._resolve_cover_bin(data["cover_data"], local_items)
                    if cover_data_bin:
                        dest_img = os.path.join(path, "folder.jpg")
                        if cover_data_bin == "DELETE":
                            if os.path.exists(dest_img): os.remove(dest_img)
                            sidecar_data["cover"] = ""
                        else:
                            with open(dest_img, "wb") as img_f:
                                img_f.write(cover_data_bin)
                                img_f.flush()
                                os.fsync(img_f.fileno())
                            from utils import to_portable_path
                            sidecar_data["cover"] = to_portable_path(dest_img)

                # 4. SAVE JSON (Sidecar)
                with open(sidecar_path, "w", encoding="utf-8") as f:
                    json.dump(sidecar_data, f, indent=4)
                    f.flush()
                    os.fsync(f.fileno())
                
                return True
            except Exception as e:
                logging.error(f"Multitrack Sidecar Write Error: {e}")
                return False

        else:
            # --- 2. SINGLE FILE METADATA PERSISTENCE ---
            sidecar_path = path + ".json"
            import json

            # Merge with existing sidecar data if present
            sidecar_data = {}
            if os.path.exists(sidecar_path):
                try:
                    with open(sidecar_path, "r", encoding="utf-8") as f:
                        sidecar_data = json.load(f)
                except Exception as e:
                    logging.error(f"Error reading existing sidecar JSON for update: {e}")

            # Update with new values (keep existing keys we don't know about)
            for key, value in data.items():
                if key not in ["cover_data", "stems", "is_multitrack", "duration", "chapters"]:
                    sidecar_data[key] = value

            try:
                with open(sidecar_path, "w", encoding="utf-8") as f:
                    json.dump(sidecar_data, f, indent=4)
                    f.flush()
                    os.fsync(f.fileno())
            except Exception as e:
                logging.error(f"Error writing sidecar JSON: {e}")

            # --- 3. PREPARE COVER DATA ---
            cover_data_bin, mime_type = self._resolve_cover_bin(data.get("cover_data"), local_items)

            # --- 4. FORMAT SPECIFIC LOGIC (Physical Tags) ---
            ext = os.path.splitext(path)[1].lower()
            if ext in ['.mkv', '.webm']:
                logging.info("WebM/MKV : Mise à jour DB locale uniquement")
                return True

            if ext in ['.avi', '.mov']: return False

        try:
            # --- 2. FORMAT SPECIFIC LOGIC ---

            # === MP3 (ID3 + EasyID3) ===
            if ext == ".mp3":
                try:
                    # A. TEXT TAGS (EasyID3)
                    try:
                        audio = EasyID3(path)
                    except:
                        # Create header if missing
                        try: ID3(path).save()
                        except: pass
                        audio = EasyID3()
                        audio.save(path)

                    if 'title' in data: audio['title'] = data['title']
                    if 'artist' in data: audio['artist'] = data['artist']
                    if 'album' in data: audio['album'] = data['album']
                    if 'genre' in data: audio['genre'] = data['genre']
                    if 'year' in data: audio['date'] = str(data['year'])
                    audio.save()

                    # B. IMAGE (ID3 Classic)
                    if cover_data_bin:
                        tags = ID3(path)
                        if cover_data_bin == "DELETE":
                            tags.delall("APIC")
                        else:
                            tags.delall("APIC")
                            tags.add(APIC(
                                encoding=3,
                                mime=mime_type,
                                type=3,
                                desc='Cover',
                                data=cover_data_bin
                            ))
                        tags.save(v2_version=3)
                    return True
                except Exception as e:
                    logging.error(f"MP3 Write Error: {e}")
                    return False

            # === M4A / MP4 ===
            elif ext in [".m4a", ".mp4", ".m4v"]:
                try:
                    # 1. TEXTE (Via EasyMP4 pour mapping standard)
                    try:
                        audio = EasyMP4(path)
                    except:
                        audio = EasyMP4(path) # Create if validation failed initially

                    if "title" in data: audio["title"] = data["title"]
                    if "artist" in data: audio["artist"] = data["artist"]
                    if "album" in data: audio["album"] = data["album"]
                    if "genre" in data: audio["genre"] = data["genre"]
                    if "year" in data: audio["date"] = str(data["year"])
                    audio.save()

                    # 2. IMAGE (Via MP4 standard car EasyMP4 filtre 'covr')
                    if cover_data_bin:
                        m_audio = MP4(path)

                        if cover_data_bin == "DELETE":
                            if "covr" in m_audio:
                                del m_audio["covr"]
                        else:
                            # On vide l'ancienne cover
                            m_audio["covr"] = []

                            # On crée la nouvelle
                            fmt = MP4Cover.FORMAT_PNG if mime_type == "image/png" else MP4Cover.FORMAT_JPEG
                            cover_obj = MP4Cover(cover_data_bin, imageformat=fmt)
                            m_audio["covr"] = [cover_obj]

                        m_audio.save()

                    return True
                except Exception as e:
                    logging.error(f"M4A/MP4 Write Error: {e}")
                    return True

            # === OGG VORBIS ===
            elif ext == ".ogg":
                try:
                    audio = OggVorbis(path)
                    # Uppercase keys
                    if 'title' in data: audio['TITLE'] = data['title']
                    if 'artist' in data: audio['ARTIST'] = data['artist']
                    if 'album' in data: audio['ALBUM'] = data['album']
                    if 'genre' in data: audio['GENRE'] = data['genre']
                    if 'year' in data: audio['DATE'] = str(data["year"])

                    # Cover (Metadata Block Picture)
                    if cover_data_bin:
                        if cover_data_bin == "DELETE":
                            audio.clear_pictures()
                            if "metadata_block_picture" in audio: del audio["metadata_block_picture"]
                        else:
                            pic = Picture()
                            pic.data = cover_data_bin
                            pic.type = 3
                            pic.mime = mime_type
                            pic.desc = 'Cover'

                            audio.clear_pictures()
                            # Base64 Encode of the Picture Block
                            pic_data = pic.write()
                            encoded_data = base64.b64encode(pic_data).decode("ascii")
                            audio["metadata_block_picture"] = [encoded_data]

                    audio.save()
                    return True
                except Exception as e:
                    logging.error(f"OGG Write Error: {e}")
                    return False

            # === WAV (ID3 in Chunk) ===
            elif ext == ".wav":
                try:
                    try: audio = WAVE(path)
                    except: audio = WAVE(path); audio.add_tags()

                    if audio.tags is None: audio.add_tags()

                    # Text
                    if "title" in data: audio.tags.add(TIT2(encoding=3, text=data["title"]))
                    if "artist" in data: audio.tags.add(TPE1(encoding=3, text=data["artist"]))
                    if "album" in data: audio.tags.add(TALB(encoding=3, text=data["album"]))
                    if "genre" in data: audio.tags.add(TCON(encoding=3, text=data["genre"]))
                    if "year" in data: audio.tags.add(TDRC(encoding=3, text=str(data["year"])))

                    # Cover
                    if cover_data_bin:
                        if cover_data_bin == "DELETE":
                            audio.tags.delall("APIC")
                        else:
                            audio.tags.delall("APIC")
                            audio.tags.add(APIC(encoding=0, mime=mime_type, type=3, desc=u'', data=cover_data_bin))

                    audio.save()
                    return True
                except Exception as e:
                    logging.error(f"WAV Write Error: {e}")
                    return False

            # === GENERIC FALLBACK (FLAC, etc) ===
            else:
                try:
                    # Try generic mutagen File
                    audio = mutagen.File(path)
                    if not audio: return False

                    # Basic Text
                    if "title" in data: audio["title"] = data["title"]
                    if "artist" in data: audio["artist"] = data["artist"]
                    if "album" in data: audio["album"] = data["album"]
                    if "genre" in data: audio["genre"] = data["genre"]
                    if "year" in data: audio["date"] = str(data["year"])

                    # FLAC Picture
                    if isinstance(audio, FLAC) and cover_data_bin:
                        if cover_data_bin == "DELETE":
                            audio.clear_pictures()
                        else:
                            pic = Picture()
                            pic.data = cover_data_bin
                            pic.type = 3
                            pic.mime = mime_type
                            audio.clear_pictures()
                            audio.add_picture(pic)

                    audio.save()
                    return True
                except Exception as e:
                    logging.error(f"Generic Write Error: {e}")
                    return False

        except Exception as e:
            logging.error(f"Metadata Write Fatal Error: {e}")

        return False

    def _resolve_cover_bin(self, cover_source, local_items=None):
        """Helper to resolve different cover sources to binary data."""
        if not cover_source: return None, None
        
        cover_data_bin = None
        mime_type = "image/jpeg"

        # Case A: DELETE
        if cover_source == "DELETE":
            return "DELETE", None

        # Case B: Local API /api/local/art/{index}
        elif "/api/local/art/" in cover_source:
             try:
                 parts = cover_source.split("/")
                 idx_str = parts[-1].split("?")[0]
                 idx = int(idx_str)
                 if local_items and 0 <= idx < len(local_items):
                     from utils import resolve_portable_path
                     path = resolve_portable_path(local_items[idx].get("path", ""))
                     if os.path.exists(path):
                         return self.get_file_cover(path)
             except Exception as e:
                 logging.warning(f"Failed local art resolution: {e}")

        # Case C: Local API /api/cover?path=...
        elif "/api/cover" in cover_source and "path=" in cover_source:
             try:
                 import urllib.parse
                 from utils import resolve_portable_path
                 parsed = urllib.parse.urlparse(cover_source)
                 params = urllib.parse.parse_qs(parsed.query)
                 raw_path = params.get("path", [None])[0]
                 if raw_path:
                     path = resolve_portable_path(raw_path)
                     if os.path.exists(path):
                         return self.get_file_cover(path)
             except Exception as e:
                 logging.warning(f"Failed local path resolution from API URL: {e}")

        # Case D: Raw File Path (Portable or Absolute)
        elif "${APP_DIR}" in cover_source or cover_source.startswith(("/") if os.name != 'nt' else ("/", "C:", "\\")):
             try:
                 from utils import resolve_portable_path
                 path = resolve_portable_path(cover_source)
                 if os.path.exists(path):
                     return self.get_file_cover(path)
             except Exception as e:
                 logging.warning(f"Failed raw path cover resolution: {e}")

        # Case E: External URL
        elif cover_source.startswith("http"):
            try:
                resp = requests.get(cover_source, timeout=10)
                if resp.status_code == 200:
                    cover_data_bin = resp.content
                    if "image/png" in resp.headers.get("Content-Type", ""):
                        mime_type = "image/png"
            except: pass

        # Case E: Base64
        elif cover_source.startswith("data:"):
            try:
                header, encoded = cover_source.split(",", 1)
                cover_data_bin = base64.b64decode(encoded)
                if "image/png" in header: mime_type = "image/png"
            except: pass
            
        return cover_data_bin, mime_type

    def get_file_cover(self, path):
        """
        Extracts embedded cover art from file or directory.
        Returns (data: bytes, mime_type: str) or (None, None).
        """
        if not os.path.exists(path): return None, None
        
        # --- DIR CASE (Multitrack/Folder) ---
        if os.path.isdir(path):
            # Check for airstep_meta.json sidecar (V55)
            sidecar_path = os.path.join(path, "airstep_meta.json")
            if os.path.exists(sidecar_path):
                try:
                    import json
                    with open(sidecar_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        cover_field = meta.get("cover")
                        if cover_field:
                            # If cover is a filename inside the same dir
                            full_cover_path = os.path.join(path, cover_field)
                            if os.path.exists(full_cover_path):
                                # Recursively call to extract if it's an audio or just serve if image
                                return self.get_file_cover(full_cover_path)
                            # Or if it's an absolute/portable path
                            resolved_cover = resolve_portable_path(cover_field)
                            if os.path.exists(resolved_cover):
                                return self.get_file_cover(resolved_cover)
                except Exception as e:
                    logging.error(f"[COVER] Sidecar read error in {path}: {e}")

            # Fallback to folder.jpg
            img_path = os.path.join(path, "folder.jpg")
            if os.path.exists(img_path):
                try:
                    with open(img_path, "rb") as f:
                        return f.read(), "image/jpeg"
                except: pass
            return None, None


        # --- SINGLE FILE SIDECAR CHECK (V57) ---
        sidecar_path = path + ".json"
        if os.path.exists(sidecar_path):
            try:
                import json
                with open(sidecar_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    cover_field = meta.get("cover")
                    if cover_field:
                        # Try to resolve cover (could be absolute, portable or relative to media)
                        resolved_cover = resolve_portable_path(cover_field)
                        if os.path.exists(resolved_cover):
                            return self.get_file_cover(resolved_cover)
                        
                        # Try relative to the media file handle directory
                        rel_cover = os.path.join(os.path.dirname(path), cover_field)
                        if os.path.exists(rel_cover):
                             return self.get_file_cover(rel_cover)
            except Exception as e:
                logging.debug(f"[COVER] Sidecar {sidecar_path} parsing skip: {e}")

        ext = os.path.splitext(path)[1].lower()
        
        try:
            # === MP3 (ID3) ===
            if ext == ".mp3":
                try:
                    audio = ID3(path)
                    for tag in audio.getall("APIC"):
                        if tag.type == 3: # Front Cover
                            return tag.data, tag.mime
                    # Fallback: any picture
                    if audio.getall("APIC"):
                        tag = audio.getall("APIC")[0]
                        return tag.data, tag.mime
                except: pass

            # === FLAC ===
            elif ext == ".flac":
                try:
                    audio = FLAC(path)
                    if audio.pictures:
                        p = audio.pictures[0]
                        return p.data, p.mime
                except: pass

            # === M4A / MP4 ===
            elif ext in [".m4a", ".mp4", ".m4v"]:
                try:
                    audio = MP4(path)
                    if "covr" in audio:
                        covers = audio["covr"]
                        if covers:
                            data = covers[0]
                            # MP4Cover is a bytes subclass, but might need formatting
                            mime = "image/jpeg"
                            if data.imageformat == MP4Cover.FORMAT_PNG: mime = "image/png"
                            return bytes(data), mime
                except: pass

            # === OGG ===
            elif ext == ".ogg":
                 try:
                    audio = OggVorbis(path)
                    if "metadata_block_picture" in audio:
                        # Block is base64 encoded
                        for b64_data in audio["metadata_block_picture"]:
                            try:
                                raw = base64.b64decode(b64_data)
                                pic = Picture(raw)
                                if pic.type == 3: return pic.data, pic.mime
                            except: pass
                        
                        # Fallback
                        raw = base64.b64decode(audio["metadata_block_picture"][0])
                        pic = Picture(raw)
                        return pic.data, pic.mime
                 except: pass

            # === WAV (ID3 Chunk) ===
            elif ext == ".wav":
                try:
                    audio = WAVE(path)
                    if audio.tags:
                         # Same as ID3
                        for tag in audio.tags.getall("APIC"):
                            if tag.type == 3: return tag.data, tag.mime
                        if audio.tags.getall("APIC"):
                            tag = audio.tags.getall("APIC")[0]
                            return tag.data, tag.mime
                except: pass

        except Exception as e:
            logging.error(f"Cover Read Error {path}: {e}")
            
        return None, None
