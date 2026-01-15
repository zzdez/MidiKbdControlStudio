let player;
let currentMode = "WIN"; // WIN ou WEB
let websocket;

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
    // Determine protocol dynamically to handle potential future https deployments if needed, though mostly local
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
            renderPedalboard(msg.data);
            if (msg.data && msg.data.name) {
                document.getElementById("active-profile").innerText = "Profil : " + msg.data.name;
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

// --- 3. LOGIQUE METIER ---
function handleMidi(cc, value) {
    if (value === 0) return;

    // Feedback visuel
    const card = document.getElementById(`card-${cc}`);
    if (card) {
        card.classList.add("active");
        setTimeout(() => card.classList.remove("active"), 200);
    }

    // Mode WEB (Contrôle direct YouTube)
    // IMPORTANT: Mapping Hardcodé pour le moment tel que demandé par l'utilisateur
    // A: 50, B: 52, C: 54, D: 56, E: 58
    if (currentMode === "WEB" && player && player.getPlayerState) {
        if (cc === 54) toggleVideo(); // C
        if (cc === 52) player.seekTo(player.getCurrentTime() - 5); // B
        if (cc === 56) player.seekTo(player.getCurrentTime() + 5); // D
        if (cc === 50) player.setPlaybackRate(player.getPlaybackRate() - 0.25); // A
        if (cc === 58) player.setPlaybackRate(player.getPlaybackRate() + 0.25); // E
    } else {
        // En mode WIN, on pourrait aussi vouloir trigger via API si le main.py ne le fait pas tout seul.
        // Mais main.py a été "decoupled". Donc il faut envoyer l'info au backend.
        // MAIS le code JS fourni par l'user ne le fait pas explicitement dans handleMidi.
        // Il dit "N'appelle PAS l'API Python" en mode WEB.
        // Et "SI Mode == WIN ... Appelle l'API Python".
        // Le code fourni par l'user ne contient PAS l'appel API dans handleMidi pour le mode WIN.
        // Je vais AJOUTER l'appel API pour le mode WIN pour être cohérent avec la demande précédente "decoupling".

        if (currentMode === "WIN") {
             fetch("/api/trigger", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cc: cc, value: 127})
            });
        }
    }
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById("mode-win").className = mode === "WIN" ? "active" : "";
    document.getElementById("mode-web").className = mode === "WEB" ? "active" : "";
}

// --- 4. SETLIST ---
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
        // Basic extraction if backend ID is missing or fallback
        // The backend saves ID, but here we receive URL (or ID inside URL object if track.url passed)
        // Actually track.url is what we saved.
        // Let's try to extract ID from URL using regex similar to backend or use URL constructor
        let urlObj;
        try {
             urlObj = new URL(url);
        } catch {
             // Maybe it is just an ID?
             if (url.length === 11) videoId = url;
        }

        if (urlObj) {
            if (urlObj.hostname.includes("youtube.com")) videoId = urlObj.searchParams.get("v");
            else if (urlObj.hostname.includes("youtu.be")) videoId = urlObj.pathname.slice(1);
        }

        // Regex Fallback
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

function toggleVideo() {
    if (player.getPlayerState() === 1) player.pauseVideo();
    else player.playVideo();
}

// --- 5. RENDER PEDALBOARD ---
function renderPedalboard(profile) {
    const grid = document.getElementById("pedalboard-grid");
    grid.innerHTML = "";

    if (!profile || !profile.mappings) {
        grid.innerHTML = '<div class="empty-state">Aucun profil actif</div>';
        return;
    }

    profile.mappings.forEach(m => {
        const div = document.createElement("div");
        div.className = "pedal-card";
        div.id = `card-${m.midi_cc}`;
        div.onclick = () => {
            // Manual trigger always sends to backend for action execution?
            // Or respects mode? Usually manual click implies "Testing" or "Forcing" action.
            // Let's force trigger backend.
            fetch("/api/trigger", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cc: m.midi_cc, value: 127})
            });
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
