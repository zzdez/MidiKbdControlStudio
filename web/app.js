let player;         // Youtube Player
let currentMode = "WIN";
let websocket;
let currentProfile = null;

// --- 1. INITIALISATION ---
document.addEventListener("DOMContentLoaded", () => {
    connectWS();
    // Charger les données initiales
    loadSetlist();
    loadLocalLib();
    loadApps();

    // Activer l'onglet par défaut (Web)
    switchTab('web');
});

// --- 2. GESTION DES ONGLETS ---
function switchTab(tabName) {
    // Masquer toutes les vues
    document.getElementById("view-web").style.display = "none";
    document.getElementById("view-local").style.display = "none";
    document.getElementById("view-apps").style.display = "none";

    // Désactiver tous les boutons
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

    // Activer la cible
    document.getElementById(`view-${tabName}`).style.display = "block"; // "block" fits better with existing CSS than "flex"
    document.getElementById(`btn-tab-${tabName}`).classList.add("active");
}

// --- 3. YOUTUBE API (Automatique) ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%', width: '100%', videoId: '',
        events: { 'onReady': () => console.log("YT Ready") }
    });
}

// --- 4. WEBSOCKET & MIDI ---
function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    websocket = new WebSocket(`${protocol}//${location.host}/ws`);

    websocket.onopen = () => document.getElementById("connection-status").classList.add("connected");

    websocket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "midi") handleMidi(msg.cc, msg.value);
        else if (msg.type === "profile_update") {
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

function handleMidi(cc, value) {
    if (value === 0) return;

    // Highlight visuel
    const card = document.getElementById(`card-${cc}`);
    if (card) {
        card.classList.add("active");
        setTimeout(() => card.classList.remove("active"), 200);
    }

    if (!currentProfile || !currentProfile.mappings) return;
    const m = currentProfile.mappings.find(x => x.midi_cc == cc);

    // Actions Locales (JS) si mode WEB
    if (currentMode === "WEB") {
        // Logique YouTube
        if (player && player.getPlayerState) {
             if (cc == 54) player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
             else if (cc == 52) player.seekTo(player.getCurrentTime() - 5, true);
             else if (cc == 56) player.seekTo(player.getCurrentTime() + 5, true);
             else if (cc == 50) player.setPlaybackRate(Math.max(0.25, player.getPlaybackRate() - 0.25));
             else if (cc == 58) player.setPlaybackRate(player.getPlaybackRate() + 0.25);
             else if (m) executeWebAction(m.action_value);
        }

        // Logique Lecteur HTML5 (Local)
        const localPlayer = document.getElementById("html5-player");
        const isHtml5 = localPlayer && localPlayer.style.display !== "none";

        if (isHtml5 && !localPlayer.ended) {
             if (cc == 54) localPlayer.paused ? localPlayer.play() : localPlayer.pause();
             else if (cc == 52) localPlayer.currentTime = Math.max(0, localPlayer.currentTime - 5);
             else if (cc == 56) localPlayer.currentTime = Math.min(localPlayer.duration, localPlayer.currentTime + 5);
             else if (cc == 50) localPlayer.playbackRate = Math.max(0.25, localPlayer.playbackRate - 0.25);
             else if (cc == 58) localPlayer.playbackRate += 0.25;
        }
    } else {
        // Mode WIN : Trigger Server
        fetch("/api/trigger", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({cc: cc, value: 127})
        });
    }
}

function executeWebAction(action) {
    if (!action) return;
    const cmd = action.toLowerCase();

    // 1. Détecter quel lecteur est actif (visible)
    const localPlayer = document.getElementById("html5-player");

    // Est-ce qu'on est en mode Local ? (Vérifie si le lecteur HTML5 est affiché)
    const isLocal = localPlayer && localPlayer.style.display !== "none";

    console.log("Action:", cmd, "| Mode Local:", isLocal);

    if (isLocal) {
        // --- PILOTAGE HTML5 ---
        // Mapping approximatif des commandes basées sur des mots clés si l'action n'est pas exacte
        if (['media_play', 'media_pause', 'space', 'k'].some(s => cmd.includes(s))) {
            localPlayer.paused ? localPlayer.play() : localPlayer.pause();
        } else if (cmd.includes('media_stop')) {
            localPlayer.pause();
            localPlayer.currentTime = 0;
        } else if (cmd.includes('media_speed_up') || cmd.includes('shift+;')) {
            localPlayer.playbackRate += 0.1;
        } else if (cmd.includes('media_speed_down') || cmd.includes('shift+,')) {
            localPlayer.playbackRate = Math.max(0.1, localPlayer.playbackRate - 0.1);
        } else if (cmd.includes('left') || cmd.includes('media_rewind')) {
            localPlayer.currentTime -= 5;
        } else if (cmd.includes('right') || cmd.includes('media_forward')) {
            localPlayer.currentTime += 5;
        } else if (cmd === '0') {
            localPlayer.currentTime = 0;
        }
    } else {
        // --- PILOTAGE YOUTUBE ---
        if (!player || !player.getPlayerState) return;

        if (['media_play', 'media_pause', 'space', 'k'].some(s => cmd.includes(s))) {
            player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
        } else if (cmd.includes('media_stop')) {
            player.stopVideo();
        } else if (cmd.includes('media_speed_up')) {
            player.setPlaybackRate(player.getPlaybackRate() + 0.25);
        } else if (cmd.includes('media_speed_down')) {
            player.setPlaybackRate(Math.max(0.25, player.getPlaybackRate() - 0.25));
        } else if (cmd.includes('left') || cmd.includes('media_rewind')) {
            player.seekTo(player.getCurrentTime() - 5, true);
        } else if (cmd.includes('right') || cmd.includes('media_forward')) {
            player.seekTo(player.getCurrentTime() + 5, true);
        } else if (cmd === '0') {
            player.seekTo(0);
        }
    }
}

// --- 5. LOGIQUE SETLIST (WEB) ---
let currentTrackList = [];
let editingIndex = null;
let sortAsc = true;
let editContext = 'setlist'; // 'setlist' or 'local'

async function loadSetlist() {
    try {
        const res = await fetch("/api/setlist");
        if (res.ok) {
            const rawList = await res.json();
            currentTrackList = rawList.map((track, idx) => ({ ...track, originalIndex: idx }));
        } else {
            currentTrackList = [];
        }
    } catch (e) {
        currentTrackList = [];
    }
    renderSetlist(currentTrackList);
}

function renderSetlist(tracks) {
    const tbody = document.getElementById("setlist-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const query = document.getElementById("search-input").value.toLowerCase();
    const filtered = tracks.filter(t => (t.title || t.url).toLowerCase().includes(query));

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color:gray;'>Aucun résultat</td></tr>";
        updateDatalists(tracks);
        return;
    }

    filtered.forEach((track) => {
        const realIndex = track.originalIndex;
        const tr = document.createElement("tr");
        const iconUrl = getIcon(track.url);
        const iconImg = iconUrl ? `<img src="${iconUrl}" style="width:16px; height:16px; margin-right:8px; vertical-align:middle;">` : '';

        tr.innerHTML = `
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${iconImg}${track.title || track.url}</td>
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${track.artist || ""}</td>
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${track.category || ""}</td>
            <td style="text-align:right;">
                <button class="btn-action" onclick="openEditModal(${realIndex})" title="Éditer">✎</button>
                <button class="btn-action" onclick="deleteTrack(${realIndex})" style="color:#cf6679;" title="Supprimer">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    updateDatalists(tracks);
}

function playTrackAt(index) {
    const track = currentTrackList.find(t => t.originalIndex === index);
    if (track) playTrack(track);
}

function playTrack(track) {
    const ytDiv = document.getElementById("player");
    const genFrame = document.getElementById("generic-player");
    const html5 = document.getElementById("html5-player");

    // Reset all
    ytDiv.style.display = "none";
    genFrame.style.display = "none";
    html5.style.display = "none";

    if (player && player.stopVideo) player.stopVideo();
    html5.pause(); html5.src = "";
    genFrame.src = "";

    if (track.open_mode === "iframe") {
        const isYT = track.url.includes("youtu");
        if (isYT) {
            ytDiv.style.display = "block";
            if (track.id && player) player.loadVideoById(track.id);
            setMode("WEB", track.profile_name);
        } else {
            genFrame.style.display = "block";
            genFrame.src = track.url;
            setMode("WIN", track.profile_name);
        }
    } else if (track.open_mode === "local") {
        html5.style.display = "block";
        html5.src = "/api/stream?path=" + encodeURIComponent(track.url);
        html5.play();
        setMode("WEB", track.profile_name);
    } else {
        window.open(track.url, '_blank');
        setMode("WIN", track.profile_name);
    }
}

async function deleteTrack(index) {
    if (!confirm("Supprimer ?")) return;
    await fetch(`/api/setlist/${index}`, { method: "DELETE" });
    loadSetlist();
}

// --- 6. LOGIQUE LOCALE (NOUVEAU) ---
async function addLocalFile() {
    console.log("Clic sur Ajouter Fichier Local...");
    try {
        const response = await fetch("/api/local/add", { method: "POST" });
        const result = await response.json();
        console.log("Réponse serveur:", result);
        if (result.status === "ok") {
            loadLocalLib(); // Rafraîchir la liste
        }
    } catch (e) {
        console.error("Erreur addLocalFile:", e);
    }
}

async function loadLocalLib() {
    const res = await fetch("/api/local/files"); // Using correct endpoint created in server.py
    const files = await res.json();
    const container = document.getElementById("local-list-body");
    if(!container) return;

    container.innerHTML = "";
    if (files.length === 0) {
        container.innerHTML = "<tr><td colspan='3' style='text-align:center; color:gray;'>Aucun fichier.</td></tr>";
        return;
    }

    files.forEach((f, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${f.artist || "-"}</td>
            <td title="${f.title || f.path}">${f.title || f.path}</td>
            <td style="text-align:right;">
                <button class="btn-action" onclick="playLocal('${f.path.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')">▶</button>
                <button class="btn-action" onclick="openEditModalLocal(${index})" title="Éditer">✎</button>
                <button class="btn-action" onclick="deleteLocalTrack(${index})" style="color:#cf6679;">×</button>
            </td>
        `;
        container.appendChild(tr);
    });
}

async function deleteLocalTrack(index) {
    if(!confirm("Retirer ce fichier ?")) return;
    await fetch(`/api/local/files/${index}`, { method: "DELETE" });
    loadLocalLib();
}

function playLocal(path) {
    // Masquer YouTube, Afficher HTML5
    document.getElementById("player").style.display = "none";
    document.getElementById("generic-player").style.display = "none";
    const v = document.getElementById("html5-player");
    v.style.display = "block";

    // Streamer
    v.src = "/api/stream?path=" + encodeURIComponent(path);
    v.play();

    // Basculer mode
    setMode("WEB", "Local Media");
}

// --- 7. LOGIQUE APPS ---
async function loadApps() {
    try {
        const res = await fetch("/api/apps");
        const apps = await res.json();
        renderApps(apps);
    } catch (e) {
        console.error("Apps load error:", e);
    }
}

function renderApps(apps) {
    const container = document.getElementById("apps-container");
    if (!container) return;
    container.innerHTML = "";

    apps.forEach((app, index) => {
        const card = document.createElement("div");
        card.className = "app-card-large";
        card.onclick = () => launchApp(app.path);

        card.innerHTML = `
            <div class="app-icon-large">🚀</div>
            <div class="app-name-large">${app.name}</div>
        `;
        container.appendChild(card);
    });
}

function openAppModal() { document.getElementById("app-modal").showModal(); }
function closeAppModal() { document.getElementById("app-modal").close(); }

async function saveApp() {
    const name = document.getElementById("new-app-name").value;
    const path = document.getElementById("new-app-path").value;
    if (!name || !path) return;

    await fetch("/api/apps", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({name, path})
    });

    document.getElementById("new-app-name").value = "";
    document.getElementById("new-app-path").value = "";
    closeAppModal();
    loadApps();
}

async function launchApp(path) {
    setMode("WIN");
    await fetch("/api/launch_app", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path})
    });
}

// --- 8. RENDU PEDALBOARD ---
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
            if (currentMode === "WEB") handleMidi(m.midi_cc, 127);
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

// --- UTILITAIRES & MODALS ---
function setMode(mode, forcedProfileName = null) {
    currentMode = mode;
    fetch("/api/set_mode", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ mode: mode, forced_profile_name: forcedProfileName })
    });
}

function getIcon(url) {
    if (!url) return '';
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch { return ''; }
}

function updateDatalists(tracks) {
    const dataList = document.getElementById("categories");
    if (dataList) {
        dataList.innerHTML = "";
        new Set(tracks.map(t => t.category || "Général")).forEach(c => {
            const opt = document.createElement("option"); opt.value = c; dataList.appendChild(opt);
        });
    }
    const genreList = document.getElementById("genres");
    if (genreList) {
        genreList.innerHTML = "";
        new Set(tracks.map(t => t.genre || "Divers")).forEach(g => {
            const opt = document.createElement("option"); opt.value = g; genreList.appendChild(opt);
        });
    }
}

function sortTable(key) {
    sortAsc = !sortAsc;
    currentTrackList.sort((a, b) => {
        const valA = (a[key] || "").toString().toLowerCase();
        const valB = (b[key] || "").toString().toLowerCase();
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
    renderSetlist(currentTrackList);
}

// Modal Helpers
function openAddModal() {
    editContext = 'setlist';
    editingIndex = null;
    document.getElementById("media-modal").showModal();

    document.getElementById("edit-title").value = "";
    document.getElementById("edit-artist").value = "";
    document.getElementById("edit-url").value = "";
    document.getElementById("edit-mode").value = "auto";
    document.getElementById("edit-category").value = "";
    document.getElementById("edit-genre").value = "";
    document.getElementById("youtube-desc-input").value = "";
    document.getElementById("user-notes-input").value = "";

    // Show URL fields
    document.getElementById("edit-url").parentElement.style.display = "block";
    document.getElementById("edit-mode").parentElement.style.display = "block";
    document.getElementById("edit-channel").parentElement.style.display = "block";
    document.querySelector(".search-zone").style.display = "block";
    document.getElementById("youtube-desc-input").style.display = "block";
    document.querySelector("label[for='youtube-desc-input']").innerText = "Description YouTube";
}

function openEditModal(index) {
    editContext = 'setlist';
    editingIndex = index;
    const track = currentTrackList.find(t => t.originalIndex === index);
    if (!track) return;
    document.getElementById("media-modal").showModal();

    document.getElementById("edit-title").value = track.title;
    document.getElementById("edit-artist").value = track.artist || "";
    document.getElementById("edit-url").value = track.url;
    document.getElementById("edit-mode").value = track.open_mode;
    document.getElementById("edit-category").value = track.category || "";
    document.getElementById("edit-genre").value = track.genre || "";
    document.getElementById("edit-channel").value = track.channel || "";
    document.getElementById("youtube-desc-input").value = track.youtube_description || "";
    document.getElementById("user-notes-input").value = track.user_notes || "";

    // Show fields
    document.getElementById("edit-url").parentElement.style.display = "block";
    document.getElementById("edit-mode").parentElement.style.display = "block";
    document.getElementById("edit-channel").parentElement.style.display = "block";
    document.querySelector(".search-zone").style.display = "block";
    document.getElementById("youtube-desc-input").style.display = "block";
    document.querySelector("label[for='youtube-desc-input']").innerText = "Description YouTube";
}

async function openEditModalLocal(index) {
    editContext = 'local';
    editingIndex = index;

    try {
        const res = await fetch("/api/local/files");
        const files = await res.json();
        const track = files[index];
        if (!track) return;

        document.getElementById("media-modal").showModal();

        document.getElementById("edit-title").value = track.title || "";
        document.getElementById("edit-artist").value = track.artist || "";
        document.getElementById("edit-category").value = track.category || "";
        document.getElementById("edit-genre").value = track.genre || "";
        document.getElementById("user-notes-input").value = track.user_notes || "";

        // Hide irrelevant fields for local
        document.getElementById("edit-url").parentElement.style.display = "none";
        document.getElementById("edit-mode").parentElement.style.display = "none";
        document.getElementById("edit-channel").parentElement.style.display = "none";
        document.querySelector(".search-zone").style.display = "none";

        // Hide textarea desc and change label
        document.getElementById("youtube-desc-input").style.display = "none";
        const descLabel = document.querySelector("label[for='youtube-desc-input']");
        descLabel.innerText = "Fichier Source : " + track.path;

    } catch (e) { console.error(e); }
}

function closeModal() { document.getElementById("media-modal").close(); }

async function saveItem() {
    const title = document.getElementById("edit-title").value;
    const artist = document.getElementById("edit-artist").value;
    const category = document.getElementById("edit-category").value;
    const genre = document.getElementById("edit-genre").value;
    const user_notes = document.getElementById("user-notes-input").value;

    const payload = {
        title, artist, category, genre, user_notes
    };

    if (editContext === 'local') {
        if (editingIndex !== null) {
            await fetch(`/api/local/files/${editingIndex}`, {
                method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
            });
        }
        loadLocalLib();
    } else {
        // SETLIST MODE
        payload.url = document.getElementById("edit-url").value;
        payload.manual_mode = document.getElementById("edit-mode").value;
        payload.channel = document.getElementById("edit-channel").value;
        payload.youtube_description = document.getElementById("youtube-desc-input").value;

        if (editingIndex !== null) {
            await fetch(`/api/setlist/${editingIndex}`, {
                method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
            });
        } else {
            await fetch("/api/setlist", {
                method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
            });
        }
        loadSetlist();
    }
    closeModal();
}

async function openSettings() {
    await fetch("/api/open_settings", { method: "POST" });
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
    if (currentMode === "WEB" && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); handleMidi(54, 127); }
    }
});
