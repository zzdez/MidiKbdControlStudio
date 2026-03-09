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

    def search_spotify_bpm_key(self, artist, title):
        token = self.get_spotify_token()
        if not token:
            return None

        # 1. Search for the track
        query = f"track:{title} artist:{artist}"
        search_url = f"https://api.spotify.com/v1/search?q={requests.utils.quote(query)}&type=track&limit=1"
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
        api_key = self.config.get("getsongbpm_api_key")
        if not api_key:
            return None

        # GetSongBPM requires searching by title first, then matching artist, or searching both if endpoint supports it.
        # Actually, their search endpoint is /search/?api_key=...&type=song&lookup=query
        query = f"song:{title} artist:{artist}"
        url = f"https://api.getsong.co/search/?api_key={api_key}&type=both&lookup={requests.utils.quote(query)}"
        print(f"[DEBUG GetSongBPM] Requesting URL: {url}")
        
        headers = {"User-Agent": "MidiKbdControlStudio/1.0 (https://github.com/zzdez/MidiKbdControlStudio)"}
        try:
            res = requests.get(url, headers=headers)
            print(f"[DEBUG GetSongBPM] HTTP Status: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                print(f"[DEBUG GetSongBPM] Raw JSON Response: {data}")
                results = []
                if "search" in data and isinstance(data["search"], list) and len(data["search"]) > 0:
                    for song in data["search"][:5]:
                        tempo = song.get("tempo", "")
                        if tempo:
                            results.append({
                                "title": song.get("title", title),
                                "artist": song.get("artist", {}).get("name", artist),
                                "bpm": round(float(tempo)),
                                "key": "",
                                "source": "GetSongBPM",
                                "cover": ""
                            })
                return results
        except Exception as e:
            print(f"[GetSongBPM API] Error: {e}")
            
        return []

    def search_getsongkey(self, artist, title):
        api_key = self.config.get("getsongkey_api_key")
        if not api_key:
            return None

        query = f"song:{title} artist:{artist}"
        url = f"https://api.getsong.co/search/?api_key={api_key}&type=both&lookup={requests.utils.quote(query)}"
        print(f"[DEBUG GetSongKey] Requesting URL: {url}")
        
        headers = {"User-Agent": "MidiKbdControlStudio/1.0 (https://github.com/zzdez/MidiKbdControlStudio)"}
        try:
            res = requests.get(url, headers=headers)
            print(f"[DEBUG GetSongKey] HTTP Status: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                print(f"[DEBUG GetSongKey] Raw JSON Response: {data}")
                results = []
                if "search" in data and isinstance(data["search"], list) and len(data["search"]) > 0:
                    for song in data["search"][:5]:
                        key_of = song.get("key_of", [])
                        key_data = song.get("key", "")
                        
                        k_str = ""
                        if isinstance(key_of, list) and len(key_of) >= 2:
                            k_note = key_of[0]
                            k_scale = key_of[1]
                            k_str = f"{k_note}m" if k_scale.lower() == "minor" else k_note
                        elif key_data:
                            k_str = key_data
                            
                        if k_str:
                            results.append({
                                "title": song.get("title", title),
                                "artist": song.get("artist", {}).get("name", artist),
                                "bpm": "",
                                "key": k_str,
                                "source": "GetSongKey",
                                "cover": ""
                            })
                return results
        except Exception as e:
            print(f"[GetSongKey API] Error: {e}")
            
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
        
        # Merge results into a unified list, matching by title if possible.
        # Since we just want simple options, we will return the GSB items, and augment them with GSK items if they match,
        # otherwise we just append them. We'll simplify and just do a zipped/paired approach up to 5 items.
        
        combined_results = []
        max_len = max(len(gsb_res) if gsb_res else 0, len(gsk_res) if gsk_res else 0)
        
        for i in range(max_len):
            bpm_item = gsb_res[i] if gsb_res and i < len(gsb_res) else None
            key_item = gsk_res[i] if gsk_res and i < len(gsk_res) else None
            
            # Use bpm item as base if exists, else key item
            base_item = bpm_item or key_item
            if not base_item:
                continue
                
            entry = {
                "title": base_item.get("title", title),
                "artist": base_item.get("artist", artist),
                "bpm": bpm_item.get("bpm", "") if bpm_item else "",
                "key": key_item.get("key", "") if key_item else "",
                "bpm_source": "GetSongBPM" if bpm_item else "",
                "key_source": "GetSongKey" if key_item else "",
                "cover": ""
            }
            combined_results.append(entry)

        return combined_results[:5]
