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
let editingIndex = null; // null = Add Mode, number = Edit Mode

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

function getIcon(url) {
    if (!url) return '';
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return '';
    }
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
        const allCats = new Set(currentTrackList.map(t => t.category || "Général"));
        allCats.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c;
            dataList.appendChild(opt);
        });
    }

    // 4. Render Groups
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

            const iconUrl = getIcon(item.track.url);
            const iconImg = iconUrl ? `<img src="${iconUrl}" style="width:16px; height:16px; margin-right:8px; vertical-align:middle;">` : '';

            div.innerHTML = `
                <div style="flex:1; cursor:pointer; display:flex; align-items:center;" onclick="playTrackAt(${item.index})">
                    ${iconImg}
                    <span class="track-title">${item.track.title || item.track.url}</span>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="btn-icon" onclick="openEditModal(${item.index})" style="font-size:1em; color:#aaa;">✎</button>
                    <button class="btn-icon" onclick="deleteTrack(${item.index})" style="font-size:1em; color:#cf6679;">×</button>
                </div>
            `;
            listDiv.appendChild(div);
        });

        groupDiv.appendChild(listDiv);
        container.appendChild(groupDiv);
    });
}

// --- MODAL & EDIT LOGIC ---

function openAddModal() {
    editingIndex = null;
    document.getElementById("media-modal").showModal();
    // Clear Form
    document.getElementById("yt-search-input").value = "";
    document.getElementById("search-results").innerHTML = "";
    document.getElementById("edit-title").value = "";
    document.getElementById("edit-url").value = "";
    document.getElementById("edit-category").value = "Général";
    document.getElementById("edit-mode").value = "auto";
    document.getElementById("yt-search-input").focus();
}

function openEditModal(index) {
    editingIndex = index;
    const track = currentTrackList[index];
    if (!track) return;

    document.getElementById("media-modal").showModal();

    // Fill Form
    document.getElementById("yt-search-input").value = "";
    document.getElementById("search-results").innerHTML = ""; // Clear old search
    document.getElementById("edit-title").value = track.title;
    document.getElementById("edit-url").value = track.url;
    document.getElementById("edit-category").value = track.category || "Général";

    // Mode Logic: if track has specific open_mode that is NOT auto-derived...
    // The backend stores "open_mode", but the UI dropdown expects "auto", "iframe", "external".
    // If we want to show what is saved, we assume "manual_mode" isn't stored, but inferred.
    // Let's assume standard behavior: if it's set to iframe/external, show it.
    // If it was auto, we might have lost that info unless we store "manual_mode".
    // For now, let's map what we have.
    document.getElementById("edit-mode").value = track.open_mode || "auto";
}

function closeModal() {
    document.getElementById("media-modal").close();
    editingIndex = null;
}

async function searchYouTube() {
    const q = document.getElementById("yt-search-input").value;
    if (!q) return;

    const container = document.getElementById("search-results");
    container.innerHTML = "Chargement...";

    try {
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();

        container.innerHTML = "";
        results.forEach(video => {
            const card = document.createElement("div");
            card.className = "result-card";
            card.onclick = () => selectResult(video);
            card.innerHTML = `
                <img src="${video.thumbnail_url}">
                <div class="info">
                    <div class="title" title="${video.title}">${video.title}</div>
                    <div style="color:#888; margin-top:2px;">${video.channel}</div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        container.innerHTML = "Erreur de recherche.";
        console.error(e);
    }
}

function selectResult(video) {
    document.getElementById("edit-title").value = video.title;
    const url = video.id ? `https://www.youtube.com/watch?v=${video.id}` : "";
    if (url) document.getElementById("edit-url").value = url;

    // Auto-set mode to iframe if YouTube
    document.getElementById("edit-mode").value = "iframe";
}

async function saveItem() {
    const title = document.getElementById("edit-title").value;
    const url = document.getElementById("edit-url").value;
    const category = document.getElementById("edit-category").value;
    const mode = document.getElementById("edit-mode").value;

    if (!url) {
        alert("L'URL est obligatoire.");
        return;
    }

    const payload = {
        title: title,
        url: url,
        category: category,
        manual_mode: mode // Backend expects manual_mode to decide
    };

    if (editingIndex !== null) {
        // UPDATE
        await fetch(`/api/setlist/${editingIndex}`, {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });
    } else {
        // CREATE
        await fetch("/api/setlist", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });
    }

    closeModal();
    loadSetlist();
}

function previewItem() {
    const title = document.getElementById("edit-title").value;
    const url = document.getElementById("edit-url").value;
    const mode = document.getElementById("edit-mode").value;

    // Construct a temporary track object
    // We need backend logic to resolve ID if missing,
    // but for preview we do best effort or rely on JS.

    // If it's YouTube and we have URL, we can extract ID in JS for preview
    let id = null;
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    if (match) id = match[1];

    let open_mode = mode;
    if (mode === "auto") {
        open_mode = (url.includes("youtube.com") || url.includes("youtu.be")) ? "iframe" : "external";
    }

    const track = {
        title: title,
        url: url,
        id: id,
        open_mode: open_mode,
        profile_name: "Preview" // Temporary
    };

    // Play it
    playTrack(track);
}

// --- PLAYER ---

async function deleteTrack(index) {
    if (!confirm("Supprimer ?")) return;
    await fetch(`/api/setlist/${index}`, { method: "DELETE" });
    loadSetlist();
}

function playTrackAt(index) {
    const track = currentTrackList[index];
    if (track) playTrack(track);
}

function playTrack(track) {
    const ytDiv = document.getElementById("player");
    const genFrame = document.getElementById("generic-player");

    if (track.open_mode === "iframe") {
        const isYT = track.url.includes("youtu");
        if (isYT) {
            genFrame.style.display = "none"; ytDiv.style.display = "block";
            if (track.id && player) player.loadVideoById(track.id);
            // If just URL and no ID (e.g. preview), try to load by url?
            // player.loadVideoByUrl? Or extract ID.
            // If track.id is missing but it is YT, we might fail.
            // But extract logic is in backend.
            // For preview, we extracted it in JS.

            setMode("WEB", track.profile_name);
        } else {
            if (player && player.stopVideo) player.stopVideo();
            ytDiv.style.display = "none"; genFrame.style.display = "block";
            genFrame.src = track.url;
            setMode("WIN", track.profile_name);
        }
    } else {
        // External
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
