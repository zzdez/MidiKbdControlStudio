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
            // STORE PROFILE
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

// --- 3. LOGIQUE METIER (WEB ACTIONS) ---
function executeWebAction(actionValue) {
    if (!player || !player.getPlayerState) return;
    if (!actionValue) return;

    const cmd = actionValue.toLowerCase();

    // Play/Pause
    if (['media_play', 'media_pause', 'media_play_pause', 'space', 'k'].some(c => cmd.includes(c))) {
        toggleVideo();
        return;
    }

    // Stop
    if (cmd.includes('media_stop')) {
        player.stopVideo();
        return;
    }

    // Seek Relative
    if (cmd.includes('media_rewind') || cmd.includes('left')) {
        seekRelative(-5);
        return;
    }
    if (cmd.includes('media_forward') || cmd.includes('right')) {
        seekRelative(5);
        return;
    }

    // Seek Absolute
    if (cmd.includes('media_seek_start') || cmd === '0') {
        player.seekTo(0);
        return;
    }

    // Speed
    if (cmd.includes('media_speed_up')) {
        player.setPlaybackRate(player.getPlaybackRate() + 0.25);
        return;
    }
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

    // Lookup Mapping
    if (!currentProfile || !currentProfile.mappings) return;
    const mapping = currentProfile.mappings.find(m => m.midi_cc == cc);
    if (!mapping) return;

    // Routing Logic
    if (currentMode === "WEB") {
        executeWebAction(mapping.action_value);
    } else {
        // WIN Mode -> Call Backend API
        fetch("/api/trigger", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({cc: cc, value: 127})
        });
    }
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById("mode-win").className = mode === "WIN" ? "active" : "";
    document.getElementById("mode-web").className = mode === "WEB" ? "active" : "";
}

// --- 5. GESTIONNAIRE SOURIS & CLAVIER ---
window.addEventListener('keydown', (e) => {
    // Global Space -> Pause Video (si pas dans un input)
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        toggleVideo();
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
                <button class="btn-play" onclick="playTrack('${track.url}')">▶</button>
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

function playTrack(url) {
    let videoId = null;
    try {
        let urlObj;
        try { urlObj = new URL(url); } catch {}

        // Simple extraction
        if (urlObj) {
            if (urlObj.hostname.includes("youtube.com")) videoId = urlObj.searchParams.get("v");
            else if (urlObj.hostname.includes("youtu.be")) videoId = urlObj.pathname.slice(1);
        }

        if (!videoId) {
             const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
             if (match && match[1]) videoId = match[1];
        }

    } catch(e) {}

    if (videoId && player) {
        player.loadVideoById(videoId);
        setMode("WEB"); // Auto-switch mode
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
            // Click Handler:
            // 1. WIN Mode -> API Trigger
            fetch("/api/trigger", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cc: m.midi_cc, value: 127})
            });

            // 2. WEB Mode -> Immediate Local Feedback/Action if in Web Mode
            if (currentMode === "WEB") {
                executeWebAction(m.action_value);

                // Visual Feedback
                div.classList.add("active");
                setTimeout(() => div.classList.remove("active"), 200);
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
