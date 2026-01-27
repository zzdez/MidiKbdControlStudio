import logging
import re
import requests

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
