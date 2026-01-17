let player;
let currentMode = "WIN";
let websocket;
let currentProfile = null;

// --- INIT ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '',
        events: { 'onReady': onPlayerReady }
    });
}
function onPlayerReady() { console.log("Player Ready"); }

// --- WEBSOCKET ---
function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    websocket = new WebSocket(`${protocol}//${location.host}/ws`);

    websocket.onopen = () => {
        document.getElementById("connection-status").classList.add("connected");
        loadSetlist();
        loadApps();
    };

    websocket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "midi") {
            handleMidi(msg.cc, msg.value);
        } else if (msg.type === "profile_update") {
            currentProfile = msg.data;
            renderPedalboard(currentProfile);
            const name = currentProfile ? currentProfile.name : "Global / Aucun";
            document.getElementById("active-profile").innerText = "Profil : " + name;
        }
    };

    websocket.onclose = () => {
        document.getElementById("connection-status").classList.remove("connected");
        setTimeout(connectWS, 2000);
    };
}

// --- LOGIC ---
function executeWebAction(actionValue) {
    if (!player || !player.getPlayerState) return;
    if (!actionValue) return;
    const cmd = actionValue.toLowerCase();

    if (['media_play', 'media_pause', 'media_play_pause', 'space', 'k'].some(c => cmd.includes(c))) toggleVideo();
    else if (cmd.includes('media_stop')) player.stopVideo();
    else if (cmd.includes('media_rewind') || cmd.includes('left')) seekRelative(-5);
    else if (cmd.includes('media_forward') || cmd.includes('right')) seekRelative(5);
    else if (cmd.includes('media_speed_up')) player.setPlaybackRate(player.getPlaybackRate() + 0.25);
    else if (cmd.includes('media_speed_down')) player.setPlaybackRate(Math.max(0.25, player.getPlaybackRate() - 0.25));
}

function seekRelative(sec) { player.seekTo(player.getCurrentTime() + sec, true); }
function toggleVideo() { player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo(); }

function handleMidi(cc, value) {
    if (value === 0) return;
    const card = document.getElementById(`card-${cc}`);
    if (card) {
        card.classList.add("active");
        setTimeout(() => card.classList.remove("active"), 200);
    }

    if (!currentProfile || !currentProfile.mappings) return;
    const m = currentProfile.mappings.find(x => x.midi_cc == cc);
    if (!m) return;

    if (currentMode === "WEB") executeWebAction(m.action_value);
    else fetch("/api/trigger", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({cc: cc, value: 127})
    });
}

function setMode(mode, forcedProfileName = null) {
    currentMode = mode;
    document.getElementById("mode-win").className = mode === "WIN" ? "active" : "";
    document.getElementById("mode-web").className = mode === "WEB" ? "active" : "";

    fetch("/api/set_mode", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ mode: mode, forced_profile_name: forcedProfileName })
    });
}

// --- SETLIST ---
let currentTrackList = [];
async function loadSetlist() {
    try {
        const res = await fetch("/api/setlist");
        if (res.ok) {
            currentTrackList = await res.json();
        } else {
            currentTrackList = [];
        }
    } catch (e) {
        console.error("Setlist load error:", e);
        currentTrackList = [];
    }

    const container = document.getElementById("setlist-container");
    if (!container) return;

    container.innerHTML = "";
    if (!currentTrackList || currentTrackList.length === 0) {
        container.innerHTML = "<div style='color:gray; font-size:12px; padding:10px;'>Setlist vide</div>";
        return;
    }

    currentTrackList.forEach((track, index) => {
        const div = document.createElement("div");
        div.className = "track-item";
        div.innerHTML = `<span class="track-title" onclick="playTrackAt(${index})">${track.title || track.url}</span> <button class="btn-del" onclick="deleteTrack(${index})">×</button>`;
        container.appendChild(div);
    });
}

async function addToSetlist() {
    const url = document.getElementById("url-input").value;
    const mode = document.getElementById("mode-select").value;
    if (!url) return;
    await fetch("/api/setlist", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url: url, manual_mode: mode})
    });
    document.getElementById("url-input").value = "";
    loadSetlist();
}

async function deleteTrack(index) {
    await fetch(`/api/setlist/${index}`, { method: "DELETE" });
    loadSetlist();
}

function playTrackAt(index) {
    const track = currentTrackList[index];
    if (!track) return;

    const ytDiv = document.getElementById("player");
    const genFrame = document.getElementById("generic-player");

    if (track.open_mode === "iframe") {
        const isYT = track.url.includes("youtu");
        if (isYT) {
            genFrame.style.display = "none"; ytDiv.style.display = "block";
            if (track.id && player) player.loadVideoById(track.id);
            setMode("WEB", track.profile_name);
        } else {
            if (player && player.stopVideo) player.stopVideo();
            ytDiv.style.display = "none"; genFrame.style.display = "block";
            genFrame.src = track.url;
            setMode("WIN", track.profile_name);
        }
    } else {
        if (player && player.stopVideo) player.stopVideo();
        genFrame.src = "";
        window.open(track.url, '_blank');
        setMode("WIN", track.profile_name);
    }
}

// --- APPS ---
async function loadApps() {
    const res = await fetch("/api/apps");
    const apps = await res.json();
    const container = document.getElementById("apps-container");
    container.innerHTML = "";
    apps.forEach(app => {
        const div = document.createElement("div");
        div.className = "app-card";
        div.innerText = app.name;
        div.onclick = () => launchApp(app.path);
        container.appendChild(div);
    });
}

async function addApp() {
    const name = document.getElementById("app-name").value;
    const path = document.getElementById("app-path").value;
    if (!name || !path) return;
    await fetch("/api/apps", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({name, path})
    });
    loadApps();
}

async function launchApp(path) {
    await fetch("/api/launch_app", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path})
    });
}

async function openSettings() {
    await fetch("/api/open_settings", { method: "POST" });
}

// --- RENDER ---
function renderPedalboard(profile) {
    const grid = document.getElementById("pedalboard-grid");
    grid.innerHTML = "";
    if (!profile || !profile.mappings) {
        grid.innerHTML = '<div class="empty-state">Aucun profil</div>';
        return;
    }
    profile.mappings.forEach(m => {
        const div = document.createElement("div");
        div.className = "pedal-card";
        div.id = `card-${m.midi_cc}`;
        div.onclick = () => {
            div.classList.add("active");
            setTimeout(() => div.classList.remove("active"), 200);
            if (currentMode === "WEB") executeWebAction(m.action_value);
            else fetch("/api/trigger", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cc: m.midi_cc, value: 127})
            });
        };
        div.innerHTML = `<span class="pedal-icon">⚡</span><div class="pedal-label">${m.name}</div>`;
        grid.appendChild(div);
    });
}

window.addEventListener('keydown', (e) => {
    if (currentMode === "WEB" && e.target.tagName !== 'INPUT') {
        if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); toggleVideo(); }
    }
});

window.onload = () => {
    loadSetlist();
};

loadYouTubeAPI();
connectWS();
