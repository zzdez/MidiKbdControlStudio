import requests
import base64
import time

class MusicAPI:
    def __init__(self, config_manager=None):
        self.config = config_manager
        self._spotify_token = None
        self._spotify_token_expires = 0

    def get_spotify_token(self):
        client_id = self.config.get("spotify_client_id")
        client_secret = self.config.get("spotify_client_secret")

        if not client_id or not client_secret:
            return None

        # Reuse token if still valid
        if self._spotify_token and time.time() < self._spotify_token_expires:
            return self._spotify_token

        auth_string = f"{client_id}:{client_secret}"
        auth_base64 = base64.b64encode(auth_string.encode("utf-8")).decode("utf-8")

        url = "https://accounts.spotify.com/api/token"
        headers = {
            "Authorization": f"Basic {auth_base64}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {"grant_type": "client_credentials"}

        try:
            response = requests.post(url, headers=headers, data=data)
            if response.status_code == 200:
                res_data = response.json()
                self._spotify_token = res_data.get("access_token")
                # Expire slightly before the actual 3600 seconds
                self._spotify_token_expires = time.time() + res_data.get("expires_in", 3600) - 60
                return self._spotify_token
            else:
                print(f"[Spotify API] Error getting token: {response.text}")
                return None
        except Exception as e:
            print(f"[Spotify API] Request failed: {e}")
            return None

    def _extract_key(self, song):
        """
        Helper to extract key from a GetSongBPM song object.
        Handles key_of (string or list), open_key, and key fields.
        """
        key_of = song.get("key_of")
        open_key = song.get("open_key")
        key_data = song.get("key")
        
        k_str = ""
        
        # 1. Handle key_of as list (legacy or specific versions)
        if isinstance(key_of, list) and len(key_of) >= 2:
            k_note = str(key_of[0])
            k_scale = str(key_of[1])
            k_str = f"{k_note}m" if "minor" in k_scale.lower() else k_note
        
        # 2. Handle key_of as String (User reported)
        elif isinstance(key_of, str) and key_of:
            # Format often: "A Minor", "C Major", "F# Major"
            parts = key_of.split()
            if len(parts) >= 2:
                k_note = parts[0]
                k_scale = parts[1].lower()
                k_str = f"{k_note}m" if "minor" in k_scale else k_note
            else:
                k_str = key_of
        
        # 3. Fallback to open_key or generic key field
        elif open_key and isinstance(open_key, str):
            k_str = open_key
        elif key_data and isinstance(key_data, str):
            k_str = key_data
            
        # Basic normalization for common notations
        if k_str:
            k_str = k_str.replace(" Major", "").replace(" major", "")
            if " Minor" in k_str or " minor" in k_str:
                k_str = k_str.replace(" Minor", "m").replace(" minor", "m")
                
        return k_str.strip()

    def search_spotify_bpm_key(self, artist, title):
        token = self.get_spotify_token()
        if not token:
            return None

        # 1. Search for the track
        query = f"track:{title} artist:{artist}" if artist else f"track:{title}"
        search_url = f"https://api.spotify.com/v1/search?q={requests.utils.quote(query)}&type=track&limit=5"
        headers = {"Authorization": f"Bearer {token}"}

        try:
            res = requests.get(search_url, headers=headers)
            if res.status_code != 200:
                return None
            
            data = res.json()
            items = data.get("tracks", {}).get("items", [])
            if not items:
                return None
            
            results = []
            for item in items[:5]:
                track_id = item["id"]
                track_title = item.get("name", title)
                track_artist = item.get("artists", [{}])[0].get("name", artist)
                
                # 2. Get Audio Features for the track
                features_url = f"https://api.spotify.com/v1/audio-features/{track_id}"
                feat_res = requests.get(features_url, headers=headers)
                if feat_res.status_code != 200:
                    continue

                feat_data = feat_res.json()
                
                # Map Spotify Key to musical notation
                pitch_class = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
                key_idx = feat_data.get("key", -1)
                mode = feat_data.get("mode", 1) # 1 = Major, 0 = Minor
                
                key_str = ""
                if 0 <= key_idx <= 11:
                    base_note = pitch_class[key_idx]
                    key_str = f"{base_note}m" if mode == 0 else base_note

                results.append({
                    "title": track_title,
                    "artist": track_artist,
                    "bpm": round(feat_data.get("tempo", 0)),
                    "key": key_str,
                    "source": "Spotify",
                    "cover": item.get("album", {}).get("images", [{}])[0].get("url", "")
                })

            return results
        except Exception as e:
            print(f"[Spotify API] Error during search: {e}")
            return []

    def search_getsongbpm(self, artist, title):
        raw_key = self.config.get("getsong_api_key") or self.config.get("getsongbpm_api_key")
        if not raw_key:
            print("[GetSongBPM API] ❌ Erreur : Clé API manquante dans les paramètres.")
            return None
        
        api_key = str(raw_key).strip()
        domains = ["api.getsong.co", "api.getsongbpm.com"]
        
        # Variations de recherche de la plus précise à la plus large
        search_variants = []
        if artist and title:
            search_variants.append(f"artist:{artist} song:{title}")
            search_variants.append(f"{artist} {title}")
        search_variants.append(title)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "X-API-KEY": api_key
        }

        for domain in domains:
            for variant in search_variants:
                params = {
                    "api_key": api_key,
                    "type": "song",
                    "lookup": variant,
                    "limit": 10
                }
                url = f"https://{domain}/search/"
                
                try:
                    print(f"[DEBUG MusicAPI] Test recherche sur {domain} avec '{variant}'...")
                    res = requests.get(url, params=params, headers=headers, timeout=10)
                    
                    if res.status_code == 200:
                        data = res.json()
                        songs = data.get("search", [])
                        if isinstance(songs, list) and len(songs) > 0:
                            print(f"[DEBUG MusicAPI] ✅ {len(songs)} résultats trouvés sur {domain}")
                            results = []
                            for song in songs[:5]:
                                tempo = song.get("tempo") or song.get("bpm")
                                key_val = self._extract_key(song)
                                print(f"[DEBUG MusicAPI] Song: {song.get('title')} - Tempo: {tempo}, Key: {key_val}")
                                if tempo:
                                    results.append({
                                        "id": song.get("id", ""),
                                        "title": song.get("title", title),
                                        "artist": song.get("artist", {}).get("name") if isinstance(song.get("artist"), dict) else artist,
                                        "bpm": round(float(tempo)),
                                        "key": key_val,
                                        "year": song.get("album", {}).get("year") if isinstance(song.get("album"), dict) else "",
                                        "genres": song.get("artist", {}).get("genres", []) if isinstance(song.get("artist"), dict) else [],
                                        "source": "GetSongBPM",
                                        "cover": ""
                                    })
                            if results:
                                return results
                    elif res.status_code == 401 or res.status_code == 403:
                        print(f"[DEBUG MusicAPI] ❌ Erreur d'authentification (401/403) sur {domain}. Vérifiez votre clé API.")
                        # On continue quand même sur l'autre domaine au cas où
                    else:
                        print(f"[DEBUG MusicAPI] ⚠️ {domain} a répondu avec le code {res.status_code}")
                except Exception as e:
                    print(f"[DEBUG MusicAPI] ❌ Erreur de connexion à {domain}: {e}")
        
        print("[DEBUG MusicAPI] ℹ️ Aucun résultat trouvé après avoir testé tous les domaines et variantes.")
        return []
            
        return []

    def search_getsongkey(self, artist, title):
        raw_key = self.config.get("getsong_api_key") or self.config.get("getsongkey_api_key") or self.config.get("getsongbpm_api_key")
        if not raw_key:
            return None
        
        api_key = str(raw_key).strip()
        domains = ["api.getsong.co", "api.getsongbpm.com"]
        
        search_variants = []
        if artist and title:
            search_variants.append(f"artist:{artist} song:{title}")
            search_variants.append(f"{artist} {title}")
        search_variants.append(title)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "X-API-KEY": api_key
        }

        for domain in domains:
            for variant in search_variants:
                params = {
                    "api_key": api_key,
                    "type": "song",
                    "lookup": variant,
                    "limit": 10
                }
                url = f"https://{domain}/search/"
                
                try:
                    res = requests.get(url, params=params, headers=headers, timeout=10)
                    if res.status_code == 200:
                        data = res.json()
                        songs = data.get("search", [])
                        if isinstance(songs, list) and len(songs) > 0:
                            results = []
                            for song in songs[:5]:
                                k_str = self._extract_key(song)
                                if k_str:
                                    results.append({
                                        "id": song.get("id", ""),
                                        "title": song.get("title", title),
                                        "artist": song.get("artist", {}).get("name") if isinstance(song.get("artist"), dict) else artist,
                                        "bpm": "",
                                        "key": k_str,
                                        "year": song.get("album", {}).get("year") if isinstance(song.get("album"), dict) else "",
                                        "genres": song.get("artist", {}).get("genres", []) if isinstance(song.get("artist"), dict) else [],
                                        "source": "GetSongKey",
                                        "cover": ""
                                    })
                            if results:
                                return results
                except Exception:
                    pass
        
        return []
            
        return []

    def fetch_metadata(self, artist, title):
        """
        Attempts to fetch BPM and Key from configured APIs, returning a list of possibilities.
        """
        # 1. Try Spotify first
        spotify_res = self.search_spotify_bpm_key(artist, title)
        if spotify_res and len(spotify_res) > 0:
            return spotify_res

        # 2. Fallbacks: GetSongBPM and GetSongKey
        gsb_res = self.search_getsongbpm(artist, title)
        gsk_res = self.search_getsongkey(artist, title)
        
        # Merge results into a unified list, matching by ID or Title+Artist.
        merged_by_id = {}
        
        # Process BPM results first
        if gsb_res:
            for item in gsb_res:
                sid = item.get("id") or f"{item['title'].lower().strip()}|{item['artist'].lower().strip()}"
                merged_by_id[sid] = item
                print(f"[DEBUG MusicAPI] Multi-Search BPM entry: {item['title']} ID={sid} Key={item.get('key')}")

        # Process Key results and merge
        if gsk_res:
            for item in gsk_res:
                sid = item.get("id") or f"{item['title'].lower().strip()}|{item['artist'].lower().strip()}"
                if sid in merged_by_id:
                    print(f"[DEBUG MusicAPI] Merging Key into ID={sid}: {item.get('key')}")
                    # Merge key into existing entry
                    if not merged_by_id[sid].get("key"):
                        merged_by_id[sid]["key"] = item.get("key")
                    # If current item has cover but merged one doesn't, take it
                    if not merged_by_id[sid].get("cover"):
                        merged_by_id[sid]["cover"] = item.get("cover")
                    # Source attribution
                    if item.get("key"):
                        merged_by_id[sid]["key_source"] = "GetSongKey"
                else:
                    item["key_source"] = "GetSongKey"
                    merged_by_id[sid] = item

        # Convert back to list and fill missing source fields
        final_list = []
        for entry in merged_by_id.values():
            entry.setdefault("bpm_source", "GetSongBPM" if entry.get("bpm") else "")
            entry.setdefault("key_source", "GetSongKey" if entry.get("key") else "")
            # Ensure title and artist are what the user searched if missing (fallback)
            if not entry.get("title"): entry["title"] = title
            if not entry.get("artist"): entry["artist"] = artist
            final_list.append(entry)

        # Sort by relevance (those having both BPM and Key first)
        final_list.sort(key=lambda x: (1 if x.get("bpm") and x.get("key") else 0), reverse=True)

        print(f"[DEBUG MusicAPI] Final combined results: {len(final_list)}")
        return final_list[:5]
