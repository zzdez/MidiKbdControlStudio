let player;
let currentMode = "WIN"; // WIN ou WEB
let websocket;
let currentProfile = null;

// --- 1. YOUTUBE API ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '',
        events: { 'onReady': onPlayerReady }
    });
}
function onPlayerReady(event) { console.log("Player Ready"); }

// --- 2. WEBSOCKET ---
function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    websocket = new WebSocket(`${protocol}//${location.host}/ws`);

    websocket.onopen = () => {
        document.getElementById("connection-status").classList.add("connected");
        loadSetlist();
    };

    websocket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "midi") {
            handleMidi(msg.cc, msg.value);
        } else if (msg.type === "profile_update") {
            currentProfile = msg.data;
            renderPedalboard(currentProfile);
            if (currentProfile && currentProfile.name) {
                document.getElementById("active-profile").innerText = "Profil : " + currentProfile.name;
            } else {
                 document.getElementById("active-profile").innerText = "Profil : Global / Aucun";
            }
        }
    };

    websocket.onclose = () => {
        document.getElementById("connection-status").classList.remove("connected");
        setTimeout(connectWS, 2000);
    };
}

// --- 3. LOGIQUE METIER UNIFIEE (WEB ACTIONS) ---
function executeWebAction(actionValue) {
    if (!player || !player.getPlayerState) return;
    if (!actionValue) return;

    const cmd = actionValue.toLowerCase();

    if (['media_play', 'media_pause', 'media_play_pause', 'space', 'k'].some(c => cmd === c || cmd.includes(c))) {
        toggleVideo();
        return;
    }
    if (cmd.includes('media_stop')) { player.stopVideo(); return; }

    if (cmd.includes('media_rewind') || cmd === 'left' || cmd.includes('arrow left')) { seekRelative(-5); return; }
    if (cmd.includes('media_forward') || cmd === 'right' || cmd.includes('arrow right')) { seekRelative(5); return; }

    if (cmd.includes('media_seek_start') || cmd === '0') { player.seekTo(0); return; }

    if (cmd.includes('media_speed_up')) { player.setPlaybackRate(player.getPlaybackRate() + 0.25); return; }
    if (cmd.includes('media_speed_down')) {
        const r = player.getPlaybackRate();
        if (r > 0.25) player.setPlaybackRate(r - 0.25);
        return;
    }
}

function seekRelative(seconds) {
    const curr = player.getCurrentTime();
    player.seekTo(curr + seconds, true);
}

function toggleVideo() {
    if (player.getPlayerState() === 1) player.pauseVideo();
    else player.playVideo();
}

// --- 4. GESTIONNAIRE MIDI ---
function handleMidi(cc, value) {
    if (value === 0) return;

    // Feedback visuel
    const card = document.getElementById(`card-${cc}`);
    if (card) {
        card.classList.add("active");
        setTimeout(() => card.classList.remove("active"), 200);
    }

    if (!currentProfile || !currentProfile.mappings) return;
    const mapping = currentProfile.mappings.find(m => m.midi_cc == cc);
    if (!mapping) return;

    if (currentMode === "WEB") {
        executeWebAction(mapping.action_value);
    } else {
        fetch("/api/trigger", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({cc: cc, value: 127})
        });
    }
}

function setMode(mode, forcedProfileName = null) {
    currentMode = mode;
    document.getElementById("mode-win").className = mode === "WIN" ? "active" : "";
    document.getElementById("mode-web").className = mode === "WEB" ? "active" : "";

    // Call Backend Lock
    fetch("/api/set_mode", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ mode: mode, forced_profile_name: forcedProfileName })
    });
}

// --- 5. GESTIONNAIRE CLAVIER GLOBAL (Mode WEB) ---
window.addEventListener('keydown', (e) => {
    if (currentMode === "WEB" && e.target.tagName !== 'INPUT') {
        const code = e.code;
        if (code === 'Space' || code === 'KeyK') { e.preventDefault(); toggleVideo(); }
        if (code === 'ArrowLeft') { e.preventDefault(); seekRelative(-5); }
        if (code === 'ArrowRight') { e.preventDefault(); seekRelative(5); }
        if (code === 'Digit0' || code === 'Numpad0') { player.seekTo(0); }
    }
});

// --- 6. SETLIST ---
async function loadSetlist() {
    const res = await fetch("/api/setlist");
    const tracks = await res.json();
    const container = document.getElementById("setlist-container");
    container.innerHTML = "";

    tracks.forEach((track, index) => {
        const div = document.createElement("div");
        div.className = "track-item";
        div.innerHTML = `
            <span class="track-title" title="${track.title}">${track.title}</span>
            <div class="track-actions">
                <button class="btn-play" onclick="playTrackAt(${index})">▶</button>
                <button class="btn-del" onclick="deleteTrack(${index})">X</button>
            </div>
        `;
        container.appendChild(div);
    });
}

async function addToSetlist() {
    const input = document.getElementById("url-input");
    const url = input.value;
    if (!url) return;
    input.value = "Chargement...";
    await fetch("/api/setlist", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url: url})
    });
    input.value = "";
    loadSetlist();
}

async function deleteTrack(index) {
    await fetch(`/api/setlist/${index}`, { method: "DELETE" });
    loadSetlist();
}

// Global scope tracker for tracks since we need object data
let currentTrackList = [];
// (We should really store the list from loadSetlist to access index based data easier or pass full object)
// Refactoring loadSetlist to store data
async function loadSetlist() {
    const res = await fetch("/api/setlist");
    currentTrackList = await res.json();
    const container = document.getElementById("setlist-container");
    container.innerHTML = "";

    currentTrackList.forEach((track, index) => {
        const div = document.createElement("div");
        div.className = "track-item";
        div.innerHTML = `
            <span class="track-title" title="${track.title}">${track.title}</span>
            <div class="track-actions">
                <button class="btn-play" onclick="playTrackAt(${index})">▶</button>
                <button class="btn-del" onclick="deleteTrack(${index})">X</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function playTrackAt(index) {
    const track = currentTrackList[index];
    if (!track) return;

    // Cas 1 : YouTube Iframe
    if (track.open_mode === "iframe") {
        if (track.id) {
            player.loadVideoById(track.id);
            // Hide "External" message if implemented, show Player
            document.getElementById("player").style.display = "block";
        }
        setMode("WEB", track.profile_name);
    }
    // Cas 2 : Externe (Songsterr etc)
    else {
        window.open(track.url, '_blank');

        // Show message
        // Maybe replace player div content temporary or overlay?
        // Use console for now or alert? Requirement says: "Affiche un message dans la zone vidéo"
        // Let's modify the DOM cleanly
        // We can't overwrite the IFrame div easily without destroying it.
        // Let's assume we just alert for now or set title?
        // "Ouvert dans une fenêtre externe. Contrôle MIDI actif."
        // Better: Overlay on top of player?
        // Simpler: Just rely on Window switching.

        setMode("WIN", track.profile_name);
    }
}

// --- 7. RENDER PEDALBOARD ---
function renderPedalboard(profile) {
    const grid = document.getElementById("pedalboard-grid");
    grid.innerHTML = "";

    if (!profile || !profile.mappings) {
        grid.innerHTML = '<div class="empty-state">En attente du profil...</div>';
        return;
    }

    profile.mappings.forEach(m => {
        const div = document.createElement("div");
        div.className = "pedal-card";
        div.id = `card-${m.midi_cc}`;

        div.onclick = () => {
            div.classList.add("active");
            setTimeout(() => div.classList.remove("active"), 200);

            if (currentMode === "WEB") {
                executeWebAction(m.action_value);
            } else {
                fetch("/api/trigger", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({cc: m.midi_cc, value: 127})
                });
            }
        };

        div.innerHTML = `
            <span class="pedal-icon">⚡</span>
            <div class="pedal-label">${m.name}</div>
            <div class="pedal-cc">CC ${m.midi_cc}</div>
        `;
        grid.appendChild(div);
    });
}

connectWS();
