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

    if (currentMode === "WEB") {
        // Direct Control for YouTube/Web
        // Priority to Hardcoded Airstep Mapping for Reliability
        if (cc == 54) toggleVideo(); // C
        else if (cc == 52) seekRelative(-5); // B
        else if (cc == 56) seekRelative(5); // D
        else if (cc == 50 && player) player.setPlaybackRate(Math.max(0.25, player.getPlaybackRate() - 0.25)); // A
        else if (cc == 58 && player) player.setPlaybackRate(player.getPlaybackRate() + 0.25); // E
        else if ((cc == 53 || cc == 55) && player) player.seekTo(0); // Long Press
        else executeWebAction(m.action_value); // Fallback to mapped value
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
    renderSetlist(currentTrackList);
}

function renderSetlist(tracks) {
    const container = document.getElementById("setlist-container");
    if (!container) return;
    container.innerHTML = "";

    // 1. Search Filter
    const query = document.getElementById("search-input").value.toLowerCase();
    const filtered = tracks.filter(t => (t.title || t.url).toLowerCase().includes(query));

    if (!filtered || filtered.length === 0) {
        container.innerHTML = "<div style='color:gray; font-size:12px; padding:10px;'>Aucun résultat</div>";
        return;
    }

    // 2. Group by Category
    const grouped = {};
    const categories = new Set();

    filtered.forEach((track, index) => {
        // We need original index for deletion/playing correctly,
        // so we store the object reference or find index in original list.
        // Let's store original index in a transient property if needed or search it.
        // Better: filtered map contains original indices?
        // Let's find index in currentTrackList
        const realIndex = currentTrackList.indexOf(track);

        const cat = track.category || "Général";
        categories.add(cat);
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({track, index: realIndex});
    });

    // 3. Update Datalist
    const dataList = document.getElementById("categories");
    if (dataList) {
        dataList.innerHTML = "";
        // Add all known categories from full list, not just filtered
        const allCats = new Set(currentTrackList.map(t => t.category || "Général"));
        allCats.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c;
            dataList.appendChild(opt);
        });
    }

    // 4. Render Groups
    // Sort categories (Général first or alphabetical)
    const sortedCats = Object.keys(grouped).sort();

    sortedCats.forEach(cat => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "setlist-group";

        // Header
        const header = document.createElement("div");
        header.className = "category-header";
        header.style.cssText = "background-color: #333; padding: 5px; cursor: pointer; font-weight: bold; margin-top: 5px; border-radius: 4px;";
        header.innerText = `${cat} (${grouped[cat].length})`;
        header.onclick = () => {
            const list = groupDiv.querySelector(".category-list");
            list.style.display = list.style.display === "none" ? "block" : "none";
        };
        groupDiv.appendChild(header);

        // List
        const listDiv = document.createElement("div");
        listDiv.className = "category-list";
        listDiv.style.display = "block"; // Open by default

        grouped[cat].forEach(item => {
            const div = document.createElement("div");
            div.className = "track-item";
            div.style.cssText = "display: flex; justify-content: space-between; padding: 5px 10px; border-bottom: 1px solid #444; align-items: center;";
            div.innerHTML = `<span class="track-title" onclick="playTrackAt(${item.index})" style="cursor: pointer; flex: 1;">${item.track.title || item.track.url}</span> <button class="btn-del" onclick="deleteTrack(${item.index})" style="background: none; border: none; color: #cc3300; cursor: pointer; font-weight: bold;">×</button>`;
            listDiv.appendChild(div);
        });

        groupDiv.appendChild(listDiv);
        container.appendChild(groupDiv);
    });
}

async function addToSetlist() {
    const url = document.getElementById("url-input").value;
    const mode = document.getElementById("mode-select").value;
    const cat = document.getElementById("category-input").value;

    if (!url) return;
    await fetch("/api/setlist", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url: url, manual_mode: mode, category: cat || "Général"})
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
