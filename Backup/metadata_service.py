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

            return {
                "title": title,
                "artist": artist,
                "album": album,
                "genre": genre,
                "year": year,
                "duration": length
            }
        except Exception as e:
            print(f"Metadata Read Error: {e}")
            return {"title": os.path.basename(path)}

    def write_file_metadata(self, path, data):
        logging.info(f"Attempting to write metadata for: {path}")
        ext = os.path.splitext(path)[1].lower()

        # --- 0. PREPARE COVER DATA ---
        cover_data_bin = None
        mime_type = "image/jpeg" # Default

        if "cover_data" in data and data["cover_data"]:
            # Case A: DELETE
            if data["cover_data"] == "DELETE":
                cover_data_bin = "DELETE"

            # Case B: URL (from Auto-Tag)
            elif data["cover_data"].startswith("http"):
                try:
                    logging.info(f"Downloading cover from: {data['cover_data']}")
                    resp = requests.get(data["cover_data"], timeout=10)
                    if resp.status_code == 200:
                        cover_data_bin = resp.content
                        if "image/png" in resp.headers.get("Content-Type", ""):
                            mime_type = "image/png"
                        logging.info(f"Image downloaded: {len(cover_data_bin)} bytes")
                    else:
                        logging.warning(f"Download failed: {resp.status_code}")
                except Exception as e:
                    logging.error(f"Download Error: {e}")

            # Case C: Base64 (starts with "data:")
            elif data["cover_data"].startswith("data:"):
                try:
                    header, encoded = data["cover_data"].split(",", 1)
                    cover_data_bin = base64.b64decode(encoded)
                    if "image/png" in header: mime_type = "image/png"
                except Exception as e:
                    logging.error(f"Base64 Decode Error: {e}")

        # --- 1. FILTER READ-ONLY FORMATS ---
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

    def get_file_cover(self, path):
        """
        Extracts embedded cover art from file.
        Returns (data: bytes, mime_type: str) or (None, None).
        """
        if not os.path.exists(path): return None, None
        
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
