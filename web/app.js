let currentMode = "WIN";
let websocket;
let currentProfile = null;
let currentActivePlayer = 'youtube';
let wavesurfer = null;

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
    if (!actionValue) return;
    const cmd = actionValue.toLowerCase();

    // Check if HTML5 player is active
    const html5 = document.getElementById("html5-player");

    if (currentActivePlayer === 'local') {
        if (['media_play', 'media_pause', 'media_play_pause', 'space', 'k'].some(c => cmd.includes(c))) {
            html5.paused ? html5.play() : html5.pause();
        } else if (cmd.includes('media_stop')) {
            html5.pause(); html5.currentTime = 0;
        } else if (cmd.includes('media_rewind') || cmd.includes('left')) {
            html5.currentTime = Math.max(0, html5.currentTime - 5);
        } else if (cmd.includes('media_forward') || cmd.includes('right')) {
            html5.currentTime = Math.min(html5.duration, html5.currentTime + 5);
        } else if (cmd.includes('media_speed_up')) {
            html5.playbackRate += 0.25;
        } else if (cmd.includes('media_speed_down')) {
            html5.playbackRate = Math.max(0.25, html5.playbackRate - 0.25);
        }
    } else if (currentActivePlayer === 'waveform' && wavesurfer) {
        // WaveSurfer Controls
        const act = actionValue.toLowerCase();
        if (['media_play', 'media_pause', 'media_play_pause', 'space', 'k'].some(c => act.includes(c))) {
            wavesurfer.playPause();
        } else if (act.includes('media_stop')) {
            wavesurfer.stop();
        } else if (act.includes('media_rewind') || act.includes('left')) {
            wavesurfer.skip(-5);
        } else if (act.includes('media_forward') || act.includes('right')) {
            wavesurfer.skip(5);
        } else if (act.includes('media_speed_up')) {
            wavesurfer.setPlaybackRate(wavesurfer.getPlaybackRate() + 0.1);
        } else if (act.includes('media_speed_down')) {
            wavesurfer.setPlaybackRate(Math.max(0.1, wavesurfer.getPlaybackRate() - 0.1));
        }


    } else if (player && player.getPlayerState) {
        // YouTube API
        if (['media_play', 'media_pause', 'media_play_pause', 'space', 'k'].some(c => cmd.includes(c))) toggleVideo();
        else if (cmd.includes('media_stop')) player.stopVideo();
        else if (cmd.includes('media_rewind') || cmd.includes('left')) seekRelative(-5);
        else if (cmd.includes('media_forward') || cmd.includes('right')) seekRelative(5);
        else if (cmd.includes('media_speed_up')) player.setPlaybackRate(player.getPlaybackRate() + 0.25);
        else if (cmd.includes('media_speed_down')) player.setPlaybackRate(Math.max(0.25, player.getPlaybackRate() - 0.25));
    }
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cc: cc, value: 127 })
        });
    }
}

function setMode(mode, forcedProfileName = null) {
    currentMode = mode;
    // Removed old button update logic
    fetch("/api/set_mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: mode, forced_profile_name: forcedProfileName })
    });
}

// --- VIEW NAVIGATION ---
function switchView(viewName) {
    // Buttons
    document.getElementById("tab-library").classList.toggle("active", viewName === "library");
    document.getElementById("tab-apps").classList.toggle("active", viewName === "apps");
    document.getElementById("tab-local").classList.toggle("active", viewName === "local");

    // Containers
    document.getElementById("view-library").style.display = viewName === "library" ? "block" : "none";
    document.getElementById("view-apps").style.display = viewName === "apps" ? "block" : "none";
    document.getElementById("view-local").style.display = viewName === "local" ? "block" : "none";

    if (viewName === "local") loadLocalFiles();
}

// --- SETLIST ---
let currentTrackList = [];
let editingIndex = null; // null = Add Mode, number = Edit Mode
let sortAsc = true;

async function loadSetlist() {
    try {
        const res = await fetch("/api/setlist");
        if (res.ok) {
            const rawList = await res.json();
            // Assign persistent original index for safe editing/deleting after sort
            currentTrackList = rawList.map((track, idx) => ({ ...track, originalIndex: idx }));
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

function sortTable(key) {
    sortAsc = !sortAsc;
    currentTrackList.sort((a, b) => {
        const valA = (a[key] || "").toString().toLowerCase();
        const valB = (b[key] || "").toString().toLowerCase();
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
    renderSetlist(currentTrackList);
}

function renderSetlist(tracks) {
    const tbody = document.getElementById("setlist-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    // 1. Search Filters
    const fArtist = document.getElementById("filter-artist").value.toLowerCase();
    const fTitle = document.getElementById("filter-title").value.toLowerCase();
    const fCat = document.getElementById("filter-category").value.toLowerCase();

    const filtered = tracks.filter(t => {
        const matchArtist = (t.artist || "").toLowerCase().includes(fArtist);
        const matchTitle = (t.title || t.url).toLowerCase().includes(fTitle);
        const matchCat = (t.category || "").toLowerCase().includes(fCat);
        return matchArtist && matchTitle && matchCat;
    });

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:gray;'>Aucun résultat</td></tr>";
        // Update datalists anyway
        updateDatalists(tracks);
        return;
    }

    filtered.forEach((track) => {
        // Use originalIndex for safe actions
        const realIndex = track.originalIndex;

        const tr = document.createElement("tr");

        const iconUrl = getIcon(track.url);
        const iconImg = iconUrl ? `<img src="${iconUrl}" style="width:16px; height:16px; margin-right:8px; vertical-align:middle;">` : '';

        // Swapped Columns: Artist | Title (with icon) | Category
        tr.innerHTML = `
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${track.artist || ""}</td>
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${iconImg}${track.title || track.url}</td>
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${track.category || ""}</td>
            <td style="text-align:right;">
                <button class="btn-action" onclick="openEditModal(${realIndex})" title="Éditer">✎</button>
                <button class="btn-action" onclick="deleteTrack(${realIndex})" style="color:#cf6679;" title="Supprimer">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDatalists(currentTrackList);
}

function updateDatalists(tracks) {
    // Categories
    const dataList = document.getElementById("categories");
    if (dataList) {
        dataList.innerHTML = "";
        const allCats = new Set(tracks.map(t => t.category || "Général"));
        allCats.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c;
            dataList.appendChild(opt);
        });
    }

    // Genres
    const genreList = document.getElementById("genres");
    if (genreList) {
        genreList.innerHTML = "";
        const allGenres = new Set(tracks.map(t => t.genre || "Divers"));
        allGenres.forEach(g => {
            const opt = document.createElement("option");
            opt.value = g;
            genreList.appendChild(opt);
        });
    }
}

// --- APPS LOGIC ---
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path })
    });

    document.getElementById("new-app-name").value = "";
    document.getElementById("new-app-path").value = "";
    closeAppModal();
    loadApps();
}

async function addApp() {
    // Deprecated inline call, redirected to modal
    openAppModal();
}

async function launchApp(path) {
    // Launching app implies WIN mode usually
    setMode("WIN");
    await fetch("/api/launch_app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path })
    });
}

async function openSettings() {
    await fetch("/api/open_settings", { method: "POST" });
}

// --- MODAL & EDIT LOGIC ---

function openAddModal() {
    editingIndex = null;
    document.getElementById("media-modal").showModal();
    // Clear Form
    document.getElementById("yt-search-input").value = "";
    document.getElementById("search-results").innerHTML = "";

    document.getElementById("edit-title").value = "";
    document.getElementById("edit-artist").value = "";
    document.getElementById("edit-channel").value = "";
    document.getElementById("edit-url").value = "";

    // Empty default for easy datalist access, with placeholders
    const catInput = document.getElementById("edit-category");
    catInput.value = "";
    catInput.placeholder = "Général";

    const genreInput = document.getElementById("edit-genre");
    genreInput.value = "";
    genreInput.placeholder = "Divers";

    document.getElementById("edit-mode").value = "auto";
    document.getElementById("youtube-desc-input").value = "";
    document.getElementById("user-notes-input").value = "";

    document.getElementById("preview-thumbnail").innerHTML = '<span style="font-size:30px;">🎵</span>';

    document.getElementById("yt-search-input").focus();
}

function openEditModal(index) {
    editingIndex = index;
    // Find track by original index in the current (possibly sorted) list
    const track = currentTrackList.find(t => t.originalIndex === index);
    if (!track) return;

    document.getElementById("media-modal").showModal();

    // Fill Form
    document.getElementById("yt-search-input").value = "";
    document.getElementById("search-results").innerHTML = ""; // Clear old search

    document.getElementById("edit-title").value = track.title;
    document.getElementById("edit-artist").value = track.artist || "";
    document.getElementById("edit-channel").value = track.channel || "";
    document.getElementById("edit-url").value = track.url;
    document.getElementById("edit-category").value = track.category || "Général";
    document.getElementById("edit-genre").value = track.genre || "Divers";
    document.getElementById("edit-mode").value = track.open_mode || "auto";

    // Legacy support: if description exists but not youtube_description, assume it was generic description (or user note?)
    // Since we just migrated, we can put old description into user_notes if user_notes empty
    document.getElementById("youtube-desc-input").value = track.youtube_description || "";
    document.getElementById("user-notes-input").value = track.user_notes || track.description || "";

    // Thumbnail
    if (track.thumbnail) {
        document.getElementById("preview-thumbnail").innerHTML = `<img src="${track.thumbnail}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
        document.getElementById("preview-thumbnail").innerHTML = '<span style="font-size:30px;">🎵</span>';
    }
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

        // Pass results data to window to allow accessing full object from onclick string if needed,
        // OR better: use closure in forEach.
        results.forEach(video => {
            const card = document.createElement("div");
            card.className = "result-card";
            // We pass the simplified object
            card.onclick = () => selectResult(video);
            card.innerHTML = `
                <img src="${video.thumbnail_url}">
                <div class="info">
                    <div class="title" title="${video.title}">${video.title}</div>
                    <div style="color:#888; margin-top:2px; font-size:0.7em;">${video.channel}</div>
                    <div style="color:#666; font-size:0.6em; margin-top:2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        ${video.description || ""}
                    </div>
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
    console.log("Selected Data:", video); // Debug

    // 1. Title & URL
    document.getElementById("edit-title").value = video.title;
    const url = video.id ? `https://www.youtube.com/watch?v=${video.id}` : "";
    if (url) document.getElementById("edit-url").value = url;

    // 2. Channel & Description
    document.getElementById("edit-channel").value = video.channel || "";
    document.getElementById("youtube-desc-input").value = video.description || "";

    // 3. Thumbnail Preview
    if (video.thumbnail_url) {
        document.getElementById("preview-thumbnail").innerHTML = `<img src="${video.thumbnail_url}">`;
    } else {
        document.getElementById("preview-thumbnail").innerHTML = '<span style="font-size:40px;">🎵</span>';
    }

    // 4. Try Parse Artist (Format "Artist - Title")
    if (video.title && video.title.includes("-")) {
        const parts = video.title.split("-");
        if (parts.length >= 2) {
            document.getElementById("edit-artist").value = parts[0].trim();
            // Optionally clean title? No, keep original title usually safer or ask user.
        }
    } else {
        // Fallback: Use Channel as Artist? often true for VEVO etc
        // document.getElementById("edit-artist").value = video.channel;
    }

    // 5. Auto-set mode
    document.getElementById("edit-mode").value = "iframe";
}

async function saveItem() {
    const title = document.getElementById("edit-title").value;
    const artist = document.getElementById("edit-artist").value;
    const channel = document.getElementById("edit-channel").value;
    const url = document.getElementById("edit-url").value;

    // Use defaults if empty
    const category = document.getElementById("edit-category").value || "Général";
    const genre = document.getElementById("edit-genre").value || "Divers";

    const mode = document.getElementById("edit-mode").value;
    const youtube_description = document.getElementById("youtube-desc-input").value;
    const user_notes = document.getElementById("user-notes-input").value;

    // Extract thumbnail from preview if it's an image
    let thumbnail = "";
    const previewDiv = document.getElementById("preview-thumbnail");
    const img = previewDiv.querySelector("img");
    if (img) thumbnail = img.src;

    if (!url) {
        alert("L'URL est obligatoire.");
        return;
    }

    const payload = {
        title: title,
        url: url,
        category: category,
        genre: genre,
        manual_mode: mode,
        artist: artist,
        channel: channel,
        youtube_description: youtube_description,
        user_notes: user_notes,
        thumbnail: thumbnail
    };

    if (editingIndex !== null) {
        // UPDATE
        await fetch(`/api/setlist/${editingIndex}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } else {
        // CREATE
        await fetch("/api/setlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
    const track = currentTrackList.find(t => t.originalIndex === index);
    if (track) playTrack(track);
}

function playTrack(track) {
    const ytDiv = document.getElementById("player");
    const genFrame = document.getElementById("generic-player");
    const html5 = document.getElementById("html5-player");

    // Reset Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");
    videoContainer.style.display = "flex";
    audioContainer.style.display = "none";

    // Reset all Players
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
            currentActivePlayer = 'youtube';
        } else {
            genFrame.style.display = "block";
            genFrame.src = track.url;
            setMode("WIN", track.profile_name);
            currentActivePlayer = 'external';
        }
    } else if (track.open_mode === "local") {
        html5.style.display = "block";
        html5.src = "/api/stream?path=" + encodeURIComponent(track.url);
        html5.play();
        currentActivePlayer = 'local';
        setMode("WEB", track.profile_name);
    } else {
        // External
        window.open(track.url, '_blank');
        setMode("WIN", track.profile_name);
    }
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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cc: m.midi_cc, value: 127 })
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
    if (typeof WaveSurfer !== 'undefined') initWaveSurfer();
};

function initWaveSurfer() {
    try {
        wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#4F4A85',
            progressColor: '#383351',
            url: null,
            cursorColor: '#bb86fc',
            height: 256,
            barWidth: undefined,
            responsive: true,
            normalize: true,
            backend: 'WebAudio'
        });

        wavesurfer.on('interaction', () => { wavesurfer.play(); });
        wavesurfer.on('finish', () => { /* Loop or Next */ });
        wavesurfer.on('timeupdate', (currentTime) => {
            const duration = wavesurfer.getDuration();
            const fmt = (s) => new Date(s * 1000).toISOString().substr(14, 5);
            document.getElementById("audio-time").innerText = fmt(currentTime) + " / " + fmt(duration);
        });
    } catch (e) { console.error("WaveSurfer Init Error:", e); }
}


// --- LOCAL FILES LOGIC ---
let localFiles = [];
let editingLocalIndex = null;

async function loadLocalFiles() {
    try {
        const res = await fetch("/api/local/files");
        localFiles = await res.json();
    } catch (e) { localFiles = []; }
    renderLocalFiles();
}

function renderLocalFiles() {
    const tbody = document.getElementById("local-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Filters
    const fArtist = (document.getElementById("filter-local-artist")?.value || "").toLowerCase();
    const fTitle = (document.getElementById("filter-local-title")?.value || "").toLowerCase();
    const fAlbum = (document.getElementById("filter-local-album")?.value || "").toLowerCase();

    const filtered = localFiles.filter(file => {
        const matchArtist = (file.artist || "").toLowerCase().includes(fArtist);
        const matchTitle = (file.title || "").toLowerCase().includes(fTitle);
        const matchAlbum = (file.album || "").toLowerCase().includes(fAlbum);
        return matchArtist && matchTitle && matchAlbum;
    });

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:gray;'>Aucun résultat</td></tr>";
        return;
    }

    filtered.forEach((file, index) => {
        // We use original logic, but index might mismatch if we filter?
        // Wait, playLocal uses index from THE LIST.
        // Issue: if we filter, 'index' passed to playLocal(index) refers to index in FILTERED list?
        // playLocal uses localFiles[index]. This will BREAK current logic if we just pass loop index.
        // Fix: We need to find the REAL index in localFiles, or pass the file object itself to playLocal?
        // Since localFiles is a simple array, let's just find the index in the original array.
        // Best way: add originalIndex to localFiles objects on load, or lookup.
        // Let's lookup for now to be safe, or just pass the ID if we had one.
        // Simple fix: localFiles.indexOf(file)

        const realIndex = localFiles.indexOf(file);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${file.artist || ""}</td>
            <td style="cursor:pointer;" onclick="playLocal(${realIndex})">${file.title}</td>
            <td>${file.album || ""}</td>
            <td style="text-align:right;">
                <button class="btn-action" onclick="openEditLocalModal(${realIndex})">✎</button>
                <button class="btn-action" onclick="deleteLocalFile(${realIndex})" style="color:#cf6679;">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function resetFilters(mode) {
    if (mode === 'web') {
        document.getElementById("filter-artist").value = "";
        document.getElementById("filter-title").value = "";
        document.getElementById("filter-category").value = "";
        renderSetlist(currentTrackList);
    } else if (mode === 'local') {
        document.getElementById("filter-local-artist").value = "";
        document.getElementById("filter-local-title").value = "";
        document.getElementById("filter-local-album").value = "";
        renderLocalFiles();
    }
}

function playLocal(index) {
    const file = localFiles[index];
    if (!file) return;

    // Detect Type
    const ext = file.path.split('.').pop().toLowerCase();
    const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext);

    // Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");

    // Common Resets
    document.getElementById("player").style.display = "none";
    const genFrame = document.getElementById("generic-player");
    if (genFrame) genFrame.style.display = "none";

    const v = document.getElementById("html5-player");

    if (isAudio) {
        // --- AUDIO MODE (Hide Video Container) ---
        videoContainer.style.display = "none";
        audioContainer.style.display = "flex";

        v.pause();
        v.style.display = "none";
        // aContainer.style.display = "flex"; // Already done above

        // Update UI
        document.getElementById("audio-title").innerText = file.title;
        document.getElementById("audio-artist").innerText = file.artist || "Artiste Inconnu";
        document.getElementById("audio-album").innerText = file.album || "";

        const artImg = document.getElementById("audio-art");
        // Reset first
        artImg.style.display = "none";
        artImg.src = "";

        // Try load (The onerror in HTML handles failure to hide it, but we set it block here to try)
        // We set src to API endpoint
        artImg.src = `/api/local/art/${index}?t=${Date.now()}`; // cache bust
        artImg.style.display = "block";

        // Load WaveSurfer
        if (wavesurfer) {
            wavesurfer.load("/api/stream?path=" + encodeURIComponent(file.path));
            wavesurfer.on('ready', () => wavesurfer.play());
        }

        currentActivePlayer = 'waveform';

    } else {
        // --- VIDEO MODE (Show Video Container) ---
        videoContainer.style.display = "flex";
        audioContainer.style.display = "none";

        if (wavesurfer) wavesurfer.pause();
        // aContainer.style.display = "none"; // Done above
        v.style.display = "block";

        v.src = "/api/stream?path=" + encodeURIComponent(file.path);
        v.play();

        currentActivePlayer = 'local';
    }

    setMode("WEB", "Local Media");
}

// --- AUDIO CONTROLS (On Screen) ---
function audioControl(action) {
    if (!wavesurfer) return;
    switch (action) {
        case 'playpause': wavesurfer.playPause(); break;
        case 'prev': wavesurfer.skip(-10); break;
        case 'next': wavesurfer.skip(10); break;
        case 'speed':
            let rate = wavesurfer.getPlaybackRate();
            rate = rate >= 2 ? 0.5 : rate + 0.25;
            wavesurfer.setPlaybackRate(rate);
            break;
    }
}

async function addLocalFile() {
    await fetch("/api/local/add", { method: "POST" });
    loadLocalFiles();
}

function openEditLocalModal(index) {
    editingLocalIndex = index;
    const item = localFiles[index];
    document.getElementById("modal-local").showModal();

    document.getElementById("local-path-display").innerText = item.path;
    document.getElementById("local-title").value = item.title;
    document.getElementById("local-artist").value = item.artist || "";
    document.getElementById("local-album").value = item.album || "";
    document.getElementById("local-genre").value = item.genre || "";
    document.getElementById("local-year").value = item.year || "";
    document.getElementById("local-notes").value = item.user_notes || "";

    // Load Art
    const img = document.getElementById("local-art-img");
    img.src = `/api/local/art/${index}?t=${Date.now()}`;
    img.style.display = "block";
}

function closeLocalModal() {
    document.getElementById("modal-local").close();
    editingLocalIndex = null;
}

async function saveLocalItem() {
    if (editingLocalIndex === null) return;

    const payload = {
        title: document.getElementById("local-title").value,
        artist: document.getElementById("local-artist").value,
        album: document.getElementById("local-album").value,
        genre: document.getElementById("local-genre").value,
        year: document.getElementById("local-year").value,
        user_notes: document.getElementById("local-notes").value
    };

    await fetch(`/api/local/${editingLocalIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    closeLocalModal();
    loadLocalFiles();
}

async function deleteLocalFile(index) {
    if (!confirm("Supprimer de la liste locale ?")) return;
    await fetch(`/api/local/${index}`, { method: "DELETE" });
    loadLocalFiles();
}

function sortLocal(key) {
    // Basic sort
    localFiles.sort((a, b) => {
        const va = (a[key] || "").toLowerCase();
        const vb = (b[key] || "").toLowerCase();
        return va.localeCompare(vb);
    });
    renderLocalFiles();
}


loadYouTubeAPI();
connectWS();
