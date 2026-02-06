let currentMode = "WIN";
let websocket;
let currentProfile = null;
let currentActivePlayer = 'youtube';

// --- CONTEXT AWARE PROFILES ---

let wavesurfer = null;
let player = null; // Fix: Explicit declaration to avoid ID collision
let currentCoverData = null; // Fix: Explicit declaration
let availableProfiles = []; // Cache for profiles

let currentWebMode = "GENERIC"; // Track AUDIO, VIDEO or GENERIC explicitly


// --- PITCH SHIFT VARIABLES ---
let audioCtx = null;
let pitchShifter = null;
let pitchSource = null;
let isPitchEnabled = false;

// Store sources separately to avoid conflict/recreation errors
let sourceAudio = null; // For WaveSurfer
let sourceVideo = null; // For HTML5 Video

function logToBackend(msg) {
    console.log(msg);
    fetch('/api/debug_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
    }).catch(e => console.error("Log Send Error:", e));
}

function initAudioContext() {
    logToBackend("[PITCH] initAudioContext triggered");
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        logToBackend("[PITCH] AudioContext Created: " + audioCtx.state);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => logToBackend("[PITCH] AudioContext Resumed"));
    }
}

function togglePitchEngine(enabled) {
    logToBackend("[PITCH] Toggle: " + enabled);
    isPitchEnabled = enabled;

    // UI Sync (Sync all duplicate controls)
    const els = [
        { s: document.getElementById("pitch-slider"), l: document.getElementById("pitch-value"), c: document.getElementById("pitch-enable-toggle") },
        { s: document.getElementById("pitch-slider-video"), l: document.getElementById("pitch-value-video"), c: document.getElementById("pitch-enable-toggle-video") }
    ];

    els.forEach(group => {
        if (group.c && group.c.checked !== enabled) group.c.checked = enabled;
        if (group.s) group.s.disabled = !enabled;
        if (group.l) group.l.style.color = enabled ? "#fff" : "#ccc";
    });

    if (enabled) {
        initAudioContext();
        connectPitchEngine();
    } else {
        disconnectPitchEngine();
    }
}

function connectPitchEngine() {
    logToBackend("[PITCH] Connecting Engine...");

    let mediaElement = null;
    let targetSource = null;

    // Retry checking mode and elements
    logToBackend("[PITCH] Mode: " + currentWebMode);

    if (currentWebMode === "VIDEO") {
        mediaElement = document.getElementById("html5-player");
        if (mediaElement) logToBackend("[PITCH] Found Video Element: " + mediaElement.tagName);
    } else if (currentWebMode === "AUDIO") {
        if (wavesurfer) {
            mediaElement = wavesurfer.getMediaElement();
            // Fallback for older WaveSurfer versions
            if (!mediaElement && wavesurfer.backend) mediaElement = wavesurfer.backend.media;
            if (!mediaElement && wavesurfer.media) mediaElement = wavesurfer.media;

            if (mediaElement) logToBackend("[PITCH] Found Audio Element (WaveSurfer): " + mediaElement.tagName);
        } else {
            logToBackend("[PITCH] WaveSurfer not initialized");
        }
    }

    if (!mediaElement) {
        logToBackend("[PITCH] No Media Element found in DOM for mode " + currentWebMode);
        return;
    }

    if (!audioCtx) { initAudioContext(); }
    if (!audioCtx) { logToBackend("[PITCH] No AudioContext"); return; }

    try {
        if (!pitchShifter) {
            logToBackend("[PITCH] Creating Jungle PitchShifter instance");
            pitchShifter = new Jungle(audioCtx);
        }

        if (currentWebMode === "VIDEO") {
            if (!sourceVideo) {
                logToBackend("[PITCH] Creating MediaElementSource (Video)");
                sourceVideo = audioCtx.createMediaElementSource(mediaElement);
            }
            targetSource = sourceVideo;
        } else if (currentWebMode === "AUDIO") {
            if (!sourceAudio) {
                logToBackend("[PITCH] Creating MediaElementSource (Audio)");
                sourceAudio = audioCtx.createMediaElementSource(mediaElement);
            }
            targetSource = sourceAudio;
        }

        logToBackend("[PITCH] Routing: Source -> Shifter -> Destination");

        // Disconnect from default destination
        try { targetSource.disconnect(); } catch (e) { }

        // Connect Graph
        if (pitchShifter) {
            targetSource.connect(pitchShifter.input);
            try { pitchShifter.output.disconnect(); } catch (e) { }
            pitchShifter.output.connect(audioCtx.destination);

            // Set Initial Pitch
            const slider = document.getElementById("pitch-slider") || document.getElementById("pitch-slider-video");
            const val = parseFloat(slider?.value || "0");
            logToBackend("[PITCH] Apply Pitch: " + val);
            pitchShifter.setPitch(val);
        }

    } catch (e) {
        logToBackend("[PITCH] Connection Error: " + e);
        console.error("Pitch Engine Error:", e);
    }
}

function disconnectPitchEngine() {
    if (pitchSource) {
        try {
            pitchSource.disconnect();
            pitchSource.connect(audioCtx.destination);
        } catch (e) {
            console.error("Disconnect Error:", e);
        }
    }
}

function updatePitch(val) {
    // UI Sync
    ["pitch-value", "pitch-value-video"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = (val > 0 ? "+" : "") + val;
    });

    ["pitch-slider", "pitch-slider-video"].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value != val) el.value = val;
    });

    if (isPitchEnabled && pitchShifter) {
        // logToBackend("Setting Pitch: " + val); // Optional: reduces spam
        pitchShifter.setPitch(parseFloat(val));
    }
}

function changePitch(delta) {
    if (!isPitchEnabled) {
        console.log("Pitch Internal Disabled");
        return;
    }
    // Get current value from whichever slider is valid
    const slider = document.getElementById("pitch-slider"); // Primary source
    let val = parseInt(slider.value) + delta;
    val = Math.max(-12, Math.min(12, val));

    updatePitch(val);
}

// --- INIT ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '',
        events: { 'onReady': onPlayerReady }
    });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;


let queuedVideoId = null;

function onPlayerReady() {
    console.log("Player Ready");
    if (queuedVideoId) {
        console.log("Playing queued video:", queuedVideoId);
        player.loadVideoById(queuedVideoId);
        queuedVideoId = null;
    }
}

// --- CONTEXT AWARE PROFILES ---
// currentWebMode is declared at the top of the file now.

async function setMode(mode, profileName) {
    if (currentWebMode === mode) return;

    console.log(`Switching Web Mode: ${mode} -> ${profileName}`);
    currentWebMode = mode;

    // Notify Backend
    try {
        await fetch("/api/profile/active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: profileName })
        });
    } catch (e) {
        console.error("Failed to switch profile", e);
    }
}

// --- WEBSOCKET & MIDI HANDLING ---
let socket;

function connectVideoWebSocket() {
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
        } else if (msg.type === "dl_progress") {
            const bar = document.getElementById("dl-progress-bar");
            const status = document.getElementById("dl-status");
            if (bar && status) {
                bar.style.width = msg.percent + "%";
                status.innerText = msg.status === "processing" ? "Finalisation..." : Math.round(msg.percent) + "%";
            }
        } else if (msg.type === "dl_complete") {
            alert("Téléchargement terminé avec succès !");
            document.getElementById("dl-status").innerText = "Terminé ✅";
            document.getElementById("dl-progress-bar").style.width = "100%";
            // Refresh local view if visible
            loadLocalFiles();
        } else if (msg.type === "dl_error") {
            alert("Erreur de téléchargement : " + msg.error);
            document.getElementById("dl-status").innerText = "Erreur ❌";
            document.getElementById("dl-progress-bar").style.background = "#cf6679";
        }
    };

    websocket.onclose = () => {
        document.getElementById("connection-status").classList.remove("connected");
        setTimeout(connectWS, 2000);
    };
}

// --- ACTION EXECUTOR (Context Aware) ---
function executeWebAction(action, value) {
    console.log(`Executing WEB Action: ${action} [Value: ${value}] Mode: ${currentWebMode}`);

    // --- YOUTUBE CONTEXT ---
    if (currentWebMode === "YOUTUBE") {
        if (!player || !player.playVideo) return;

        if (action === "media_play_pause") {
            const state = player.getPlayerState();
            if (state === 1) player.pauseVideo();
            else player.playVideo();
        }
        else if (action === "media_stop") player.stopVideo();
        // else if (action === "media_next") playNext(); // Not implemented yet
        // else if (action === "media_prev") playPrev(); // Not implemented yet
        else if (action === "media_seek_forward") {
            const cur = player.getCurrentTime();
            player.seekTo(cur + 10, true);
        }
        else if (action === "media_seek_backward") {
            const cur = player.getCurrentTime();
            player.seekTo(cur - 10, true);
        }
        else if (action === "media_restart") player.seekTo(0, true);
        else if (action === "media_speed_up") {
            const rates = player.getAvailablePlaybackRates();
            const curr = player.getPlaybackRate();
            // Simple interaction: next available rate or +0.25
            const idx = rates.indexOf(curr);
            if (idx < rates.length - 1) player.setPlaybackRate(rates[idx + 1]);
        }
        else if (action === "media_slow_down") {
            const rates = player.getAvailablePlaybackRates();
            const curr = player.getPlaybackRate();
            const idx = rates.indexOf(curr);
            if (idx > 0) player.setPlaybackRate(rates[idx - 1]);
        }
    }

    // --- AUDIO LOCAL CONTEXT ---
    else if (currentWebMode === "AUDIO") {
        if (action === "media_play_pause") audioControl('playpause');
        else if (action === "media_stop") { audioControl('restart'); wavesurfer.pause(); }
        else if (action === "media_seek_forward") audioControl('next');
        else if (action === "media_seek_backward") audioControl('prev');
        else if (action === "media_restart") audioControl('restart');
        else if (action === "media_speed_up") audioControl('speed_up');
        else if (action === "media_slow_down") audioControl('speed_down');
    }

    // --- VIDEO LOCAL CONTEXT ---
    else if (currentWebMode === "VIDEO") {
        if (action === "media_play_pause") videoControl('playpause');
        else if (action === "media_stop") { videoControl('restart'); videoControl('playpause'); }
        else if (action === "media_seek_forward") videoControl('next');
        else if (action === "media_seek_backward") videoControl('prev');
        else if (action === "media_restart") videoControl('restart');
        else if (action === "media_speed_up") videoControl('speed_up');
        else if (action === "media_slow_down") videoControl('speed_down');
        // PITCH (Shared Logic)
        else if (action === "media_pitch_up") changePitch(0.1);
        else if (action === "media_pitch_down") changePitch(-0.1);
    }

    // --- GENERIC FALLBACK (Same as before) ---
    else {
        // No specific player context, so we can't execute media actions.
        // This block could be used for global actions or simply do nothing.
    }
}

function seekRelative(sec) { player.seekTo(player.getCurrentTime() + sec, true); }
function toggleVideo() {
    if (currentActivePlayer === 'local') {
        const v = document.getElementById("html5-player");
        v.paused ? v.play() : v.pause();
    } else if (currentActivePlayer === 'waveform' && wavesurfer) {
        wavesurfer.playPause();
    } else if (player && typeof player.getPlayerState === 'function') {
        player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
    }
}

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
        else if (cc == 50) executeWebAction("media_slow_down"); // A
        else if (cc == 58) executeWebAction("media_speed_up"); // E
        else if (cc == 60) executeWebAction("media_pitch_down"); // Ext 1
        else if (cc == 61) executeWebAction("media_pitch_up"); // Ext 2
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
    if (currentMode === mode && !forcedProfileName) return; // Optimize

    currentMode = mode;

    // --- CRITICAL: Update Window Title for ContextMonitor Auto-Detect ---
    // Universal Logic: "Airstep Studio - [Profile Name]"
    if (forcedProfileName) {
        document.title = `Airstep Studio - ${forcedProfileName}`;
    } else {
        // Fallback for hardcoded modes if no profile name provided
        if (mode === "YOUTUBE") document.title = "Airstep Studio - YouTube";
        else if (mode === "AUDIO") document.title = "Airstep Studio - Audio";
        else if (mode === "VIDEO") document.title = "Airstep Studio - Video";
        else document.title = "Airstep Studio";
    }

    // Notify Backend
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
    renderSetlist(currentTrackList); // Render Sorted
    updateDatalists(currentTrackList); // Update shared datalists
}

function renderSetlist(list) {
    const tbody = document.getElementById("setlist-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    // 1. Search Filters
    const fArtist = document.getElementById("filter-artist").value.toLowerCase();
    const fTitle = document.getElementById("filter-title").value.toLowerCase();
    const fCat = document.getElementById("filter-category").value.toLowerCase();

    const filtered = list.filter(t => {
        const matchArtist = (t.artist || "").toLowerCase().includes(fArtist);
        const matchTitle = (t.title || t.url).toLowerCase().includes(fTitle);
        const matchCat = (t.category || "").toLowerCase().includes(fCat);
        return matchArtist && matchTitle && matchCat;
    });

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:gray;'>Aucun résultat</td></tr>";
        // Update datalists anyway
        updateDatalists(list);
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


// --- CUSTOM AUTOCOMPLETE ---
let blockedTags = { category: [], genre: [] };

async function loadBlockedTags() {
    try {
        const res = await fetch("/api/metadata/blocked");
        const data = await res.json();
        blockedTags = data;
    } catch (e) {
        console.error("Failed to load blocked tags", e);
    }
}

async function blockTag(field, value) {
    if (!confirm(`Ne plus jamais suggérer "${value}" pour ${field} ?`)) return;

    // Optimistic Update
    if (!blockedTags[field]) blockedTags[field] = [];
    blockedTags[field].push(value);

    try {
        await fetch("/api/metadata/block", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field, value })
        });
    } catch (e) {
        console.error("Block Tag Error", e);
    }
}

function setupCustomAutocomplete(inputId, boxId, field) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(boxId);

    if (!input || !box) return;

    const hideBox = () => setTimeout(() => box.style.display = "none", 200);

    const showSuggestions = () => {
        const currentVal = input.value.toLowerCase();

        // 1. Get all unique values from library
        const allValues = new Set(localFiles.map(t => t[field] || "").filter(v => v));

        // 2. Filter: Match input AND Not Blocked
        const matches = Array.from(allValues).filter(v => {
            if (blockedTags[field] && blockedTags[field].includes(v)) return false;
            return v.toLowerCase().includes(currentVal);
        }).sort();

        if (matches.length === 0) {
            box.style.display = "none";
            return;
        }

        // 3. Render
        box.innerHTML = "";
        matches.forEach(val => {
            const div = document.createElement("div");
            div.className = "suggestion-item";

            const textSpan = document.createElement("span");
            textSpan.innerText = val;

            const delBtn = document.createElement("span");
            delBtn.className = "suggestion-delete";
            delBtn.innerText = "×";
            delBtn.title = "Ne plus suggérer";
            delBtn.onclick = (e) => {
                e.stopPropagation(); // Don't trigger select
                blockTag(field, val);
                input.focus(); // Keep focus
                showSuggestions(); // Refresh list immediately
            };

            div.onclick = () => {
                input.value = val;
                box.style.display = "none";
            };

            div.appendChild(textSpan);
            div.appendChild(delBtn);
            box.appendChild(div);
        });

        box.style.display = "block";
    };

    input.addEventListener("input", showSuggestions);
    input.addEventListener("focus", showSuggestions);
    input.addEventListener("blur", hideBox);
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

// --- SETTINGS LOGIC ---
let currentSettings = null;

async function loadSettings() {
    try {
        const res = await fetch("/api/settings");
        if (res.ok) {
            currentSettings = await res.json();
        }
    } catch (e) {
        console.error("Settings Load Error", e);
    }
}

async function openSettings() {
    // Deprecated Name, redirected to Modal
    openSettingsModal();
}

async function openSettingsModal() {
    if (!currentSettings) await loadSettings();

    if (currentSettings) {
        // Populate Fields
        document.getElementById("setting-youtube-key").value = currentSettings.YOUTUBE_API_KEY || "";
        renderSettingsFolders();

        // Show Modal
        document.getElementById("settings-modal").showModal();
        switchSettingsTab('general'); // Reset to first tab
    }
}

function closeSettingsModal() {
    document.getElementById("settings-modal").close();
}

function switchSettingsTab(tabName) {
    // Hide all
    document.getElementById("tab-settings-general").style.display = "none";
    document.getElementById("tab-settings-library").style.display = "none";
    document.getElementById("tab-settings-controller").style.display = "none";

    // Deactivate Buttons
    const btns = document.querySelectorAll(".settings-nav .nav-btn");
    btns.forEach(b => b.classList.remove("active"));

    // Show Target
    document.getElementById(`tab-settings-${tabName}`).style.display = "block";

    // Activate Button (Simple Index Logic or Search)
    const map = { 'general': 0, 'library': 1, 'controller': 2 };
    if (btns[map[tabName]]) btns[map[tabName]].classList.add("active");
}

function renderSettingsFolders() {
    const list = document.getElementById("settings-folder-list");
    list.innerHTML = "";

    const folders = currentSettings.media_folders || [];
    folders.forEach((path, index) => {
        const div = document.createElement("div");
        div.className = "folder-item";
        div.innerHTML = `
            <div class="folder-path">${path}</div>
            <button class="btn-remove-folder" onclick="removeFolder(${index})">×</button>
        `;
        list.appendChild(div);
    });
}

function removeFolder(index) {
    if (currentSettings.media_folders) {
        currentSettings.media_folders.splice(index, 1);
        renderSettingsFolders();
    }
}

async function addLibraryFolder() {
    try {
        const res = await fetch("/api/library/add_folder", { method: "POST" });
        const data = await res.json();

        if (data.status === "added" && data.path) {
            // Update local state
            if (!currentSettings.media_folders) currentSettings.media_folders = [];

            // Avoid duplicates
            if (!currentSettings.media_folders.includes(data.path)) {
                currentSettings.media_folders.push(data.path);
                renderSettingsFolders();
            }
        }
    } catch (e) {
        console.error("Add Folder Error", e);
    }
}

async function saveSettings() {
    // Harvest Data
    currentSettings.YOUTUBE_API_KEY = document.getElementById("setting-youtube-key").value;

    try {
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentSettings)
        });
        closeSettingsModal();

        // Optional: Reload Library if folders changed?
        // Since we don't have a live reload event yet, maybe just reload local view
        loadLocalFiles();

    } catch (e) {
        alert("Erreur lors de la sauvegarde.");
        console.error(e);
    }
}

async function openNativeEditor() {
    // Calls the server route which triggers Tkinter
    closeSettingsModal(); // Close web modal to avoid confusion
    await fetch("/api/open_native_editor", { method: "POST" });
}

// --- MODAL & EDIT LOGIC ---

function openAddModal() {
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
    document.getElementById("edit-target-profile").value = "Auto"; // Default
    document.getElementById("youtube-desc-input").value = "";
    document.getElementById("user-notes-input").value = "";

    document.getElementById("preview-thumbnail").innerHTML = '<span style="font-size:30px;">🎵</span>';

    // Reset Download UI
    document.getElementById("dl-options-container").style.display = "none";
    document.getElementById("btn-show-dl").style.display = "none";
    document.getElementById("dl-progress-bar").style.width = "0%";
    document.getElementById("dl-status").innerText = "Prêt";

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
    document.getElementById("edit-target-profile").value = track.target_profile || "Auto";

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

    // Reset Download UI
    document.getElementById("dl-options-container").style.display = "none";
    document.getElementById("dl-progress-bar").style.width = "0%";
    document.getElementById("dl-status").innerText = "Prêt";

    // Check if URL is valid for download
    checkDownloadAvailability(track.url);
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

    // Show Download Button if URL
    if (url) checkDownloadAvailability(url);

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

// --- DOWNLOADER LOGIC ---

let ffmpegAvailable = false;

async function checkDLStatus() {
    try {
        const res = await fetch("/api/dl/status");
        const data = await res.json();
        ffmpegAvailable = data.ffmpeg;
        console.log("FFmpeg Status:", ffmpegAvailable);
    } catch (e) { console.error("DL Status Check Failed", e); }
}

function checkDownloadAvailability(url) {
    const btn = document.getElementById("btn-show-dl");
    if (url && (url.includes("youtube.com") || url.includes("youtu.be"))) {
        btn.style.display = "inline-block";
    } else {
        btn.style.display = "none";
    }
}

async function toggleDownloadOptions() {
    const container = document.getElementById("dl-options-container");
    if (container.style.display === "block") {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";

    // 1. Populate Folders
    const folderSelect = document.getElementById("dl-folder");
    folderSelect.innerHTML = "";

    // Ensure settings are loaded
    if (!currentSettings) await loadSettings();

    let folders = [];
    if (currentSettings && currentSettings.media_folders) {
        folders = currentSettings.media_folders;
    }

    if (folders.length === 0) {
        const opt = document.createElement("option");
        opt.innerText = "Aucun dossier configuré (Ajouter dans Paramètres)";
        folderSelect.appendChild(opt);
    } else {
        folders.forEach(f => {
            const opt = document.createElement("option");
            opt.value = f;
            opt.innerText = f;
            folderSelect.appendChild(opt);
        });
    }

    // 2. Populate Formats based on Capabilities
    const formatSelect = document.getElementById("dl-format");
    formatSelect.innerHTML = "";

    const addOpt = (val, text, enabled = true) => {
        const o = document.createElement("option");
        o.value = val;
        o.innerText = text;
        if (!enabled) {
            o.disabled = true;
            o.innerText += " (FFmpeg requis)";
        }
        formatSelect.appendChild(o);
    };

    // Audio Options
    addOpt("audio_original", "🎵 Audio (Original / Meilleure Qualité)");
    addOpt("audio_mp3_320", "🎵 Audio MP3 320kbps", ffmpegAvailable);
    addOpt("audio_mp3_192", "🎵 Audio MP3 192kbps", ffmpegAvailable);

    // Video Options
    addOpt("video_auto", "🎬 Vidéo Auto (Meilleur fichier unique)");
    addOpt("video_2160", "🎬 Vidéo 4K (2160p) (MP4)", ffmpegAvailable);
    addOpt("video_1440", "🎬 Vidéo 2K (1440p) (MP4)", ffmpegAvailable);
    addOpt("video_1080", "🎬 Vidéo 1080p (MP4)", ffmpegAvailable);
    addOpt("video_720", "🎬 Vidéo 720p (MP4)", ffmpegAvailable);
    addOpt("video_480", "🎬 Vidéo 480p (MP4)", ffmpegAvailable);

    // Select default smart option if ffmpeg missing
    if (!ffmpegAvailable) {
        formatSelect.value = "video_auto";
    }

    // Listener for format change to show/hide Container & Languages
    formatSelect.onchange = () => updateDLUI(formatSelect.value);

    // Initial UI State
    updateDLUI(formatSelect.value);

    // Fetch Languages for this URL
    fetchDLLanguages();
}

function updateDLUI(format) {
    const isVideo = format.startsWith("video_");
    document.getElementById("dl-container-opt").style.display = isVideo ? "flex" : "none";
    document.getElementById("dl-audio-langs").style.display = isVideo ? "block" : "none";
}

async function fetchDLLanguages() {
    const url = document.getElementById("edit-url").value;
    const list = document.getElementById("dl-langs-list");
    list.innerHTML = "Chargement...";

    try {
        const res = await fetch("/api/dl/info", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({url})
        });
        const info = await res.json();

        list.innerHTML = "";

        if (info.languages && info.languages.length > 0) {
            info.languages.forEach(lang => {
                const div = document.createElement("div");
                div.style.display = "flex";
                div.style.alignItems = "center";
                div.style.gap = "5px";

                // Checkbox
                const chk = document.createElement("input");
                chk.type = "checkbox";
                chk.value = lang;
                chk.name = "dl_lang";

                // Auto-check logic: "Default" + "French"
                // Assume 1st is default/original usually
                if (lang === info.languages[0] || lang.startsWith("fr")) {
                    chk.checked = true;
                }

                const lbl = document.createElement("label");
                lbl.innerText = lang.toUpperCase();

                div.appendChild(chk);
                div.appendChild(lbl);
                list.appendChild(div);
            });
        } else {
            list.innerHTML = "<span style='color:#888'>Aucune piste audio alternative détectée (Langue par défaut uniquement).</span>";
        }
    } catch (e) {
        list.innerHTML = "Erreur chargement langues.";
    }
}

async function startDownload() {
    const url = document.getElementById("edit-url").value;
    const format = document.getElementById("dl-format").value;
    const folder = document.getElementById("dl-folder").value;
    const subs = document.getElementById("dl-subs").checked;

    const container = document.getElementById("dl-container").value;

    // Collect selected languages
    const audio_langs = [];
    document.querySelectorAll("input[name='dl_lang']:checked").forEach(c => audio_langs.push(c.value));

    if (!url) return alert("URL manquante");
    if (!folder || folder.includes("Aucun dossier")) return alert("Veuillez sélectionner un dossier valide.");

    // Harvest Metadata
    const metadata = {
        title: document.getElementById("edit-title").value,
        artist: document.getElementById("edit-artist").value,
        album: "", // Not in setlist modal
        category: document.getElementById("edit-category").value,
        genre: document.getElementById("edit-genre").value,
        cover_data: document.getElementById("preview-thumbnail").querySelector("img")?.src || ""
    };

    // UI Feedback
    document.getElementById("dl-status").innerText = "Démarrage...";
    document.getElementById("dl-progress-bar").style.width = "0%";
    document.getElementById("dl-progress-bar").style.background = "var(--accent)";

    try {
        const payload = {
            url: url,
            format_id: format,
            target_folder: folder,
            subs: subs,
            container: container,
            audio_langs: audio_langs,
            metadata: metadata
        };

        const res = await fetch("/api/dl/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Erreur serveur");

    } catch (e) {
        alert("Erreur: " + e.message);
        document.getElementById("dl-status").innerText = "Erreur";
    }
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
    const target_profile = document.getElementById("edit-target-profile").value;
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
        target_profile: target_profile,
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

// --- PLAYER CONTROL ---
function stopAllMedia() {
    console.log("Stopping all media players...");

    // 1. YouTube
    if (player && typeof player.stopVideo === "function") {
        try { player.stopVideo(); } catch (e) { }
    }

    // 2. WaveSurfer (Audio Local)
    if (wavesurfer) {
        try { wavesurfer.pause(); } catch (e) { }
    }

    // 3. HTML5 Video (Video Local)
    const v = document.getElementById("html5-player");
    if (v) {
        v.pause();
        // Don't reset src here aggressively to avoid side effects, just pause.
    }

    // 4. Generic Iframe
    const genFrame = document.getElementById("generic-player");
    if (genFrame) {
        // Clearing src stops playback for generic iframes
        // genFrame.src = ""; // Optional: might flash white, usually strictly separate
    }
}

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

    // STOP ALL MEDIA first
    stopAllMedia();

    // Reset Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");
    videoContainer.style.display = "flex";
    audioContainer.style.display = "none";

    // Reset all Players
    ytDiv.style.display = "none";
    genFrame.style.display = "none";
    html5.style.display = "none";
    document.getElementById("video-controls-container").style.display = "none";
    document.getElementById("video-controls-container").style.display = "none";

    if (player && player.stopVideo) player.stopVideo();
    html5.pause(); html5.src = "";
    genFrame.src = "";

    function getProfile(item, def) {
        return (item.target_profile && item.target_profile !== "Auto") ? item.target_profile : def;
    }

    if (track.open_mode === "external") {
        fetch(`/api/open_external?url=${encodeURIComponent(track.url)}`);
        setMode("GENERIC", getProfile(track, track.profile_name)); // External apps don't have a web mode
    } else if (track.open_mode === "iframe" && track.id) {
        // YouTube Iframe
        setMode("YOUTUBE", getProfile(track, "Web YouTube")); // Context Switch

        ytDiv.style.display = "block";
        currentActivePlayer = 'youtube'; // Important for logic tracking

        if (player && typeof player.loadVideoById === "function") {
            player.loadVideoById(track.id);
            // playerState = 1; // Handled by API
        } else {
            console.warn("YouTube Player not ready yet. Video ID queued:", track.id);
            // Optional: queue it? Or just let user click again.
            // But we must at least show the container.
            // If we rely on onYouTubeIframeAPIReady, it creates a NEW player.
            // If player exists but methods missing, that's weird.
        }
    } else {
        // Generic / Direct URL (could be any iframeable content)
        setMode("GENERIC", getProfile(track, "Web Generic")); // Fallback

        // SMART EMBED CONVERSION
        // Automatically convert known platforms to Embed URL
        const smartUrl = getEmbedUrl(track.url);

        genFrame.style.display = "block";
        genFrame.src = smartUrl;
    }
}

// --- HELPERS ---
function getEmbedUrl(url) {
    if (!url) return "";

    // Dailymotion: dailymotion.com/video/x123 -> dailymotion.com/embed/video/x123
    // Supports: /video/ID only mainly.
    if (url.includes("dailymotion.com/video/")) {
        return url.replace("/video/", "/embed/video/");
    }

    // Vimeo: vimeo.com/123 -> player.vimeo.com/video/123
    // Regex for ID
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch && vimeoMatch[1]) {
        return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    }

    // Default
    return url;
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

// --- GLOBAL INPUT ROUTER ---
// Central point for Keyboard and MIDI commands

window.addEventListener('keydown', (e) => {
    // 1. IGNORE INPUT TEXT FIELDS
    // We want the user to be able to type in Search, Notes, Rename, etc.
    const tag = e.target.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
    }

    let command = null;

    // 2. KEY MAPPING (Normalized)
    switch (e.code) {
        case 'Space':
        case 'KeyK': // YouTube standard
            command = 'media_play_pause';
            break;
        case 'ArrowLeft':
        case 'KeyJ': // YouTube standard (-10s usually, we do -5s)
            command = 'media_rewind';
            break;
        case 'ArrowRight':
        case 'KeyL': // YouTube standard (+10s usually)
            command = 'media_forward';
            break;
        case 'ArrowUp':
            command = 'media_speed_up';
            break;
        case 'ArrowDown':
            command = 'media_speed_down';
            break;
        case 'Digit0':
        case 'Numpad0':
        case 'Home':
            command = 'media_restart';
            break;
        // Optional: Pitch access via Keyboard if needed later
        // case 'PageUp': command = 'media_pitch_up'; break;
        // case 'PageDown': command = 'media_pitch_down'; break;
    }

    // 3. INTERCEPT & EXECUTE
    if (command) {
        e.preventDefault(); // STOP Scrolling, STOP Slider movement
        e.stopPropagation(); // Stop bubbling
        executeWebAction(command);
    }
});

function handleMidi(jsonData) {
    if (!jsonData) return;
    const m = JSON.parse(jsonData);

    // logToBackend("[MIDI IN] " + JSON.stringify(m));

    // If it's a specific web action command
    if (m.action_type === 'web_action' || m.action_type === 'hotkey') {
        // Use the value as the command (e.g. "media_play_pause")
        // Some profiles might send "Space" as value for hotkey, we should normalize if needed,
        // but ideally the profile sends abstract commands: "media_play_pause"
        executeWebAction(m.action_value);
    }
}

function executeWebAction(command) {
    logToBackend("[ROUTER] Execute: " + command + " | Mode: " + currentWebMode);

    // ROUTING LOGIC based on currentWebMode
    // Modes: "AUDIO" (Local WaveSurfer), "VIDEO" (Local HTML5), "GENERIC" (YouTube/Iframe)

    // A. GENERIC / YOUTUBE
    if (currentWebMode === "GENERIC" || !currentWebMode) {
        // Try YouTube API
        if (player && typeof player.getPlayerState === 'function') {
            switch (command) {
                case 'media_play_pause':
                    const state = player.getPlayerState();
                    if (state === 1) player.pauseVideo();
                    else player.playVideo();
                    break;
                case 'media_play': player.playVideo(); break;
                case 'media_pause': player.pauseVideo(); break;
                case 'media_rewind':
                    const cur = player.getCurrentTime();
                    player.seekTo(Math.max(0, cur - 5));
                    break;
                case 'media_forward':
                    const curF = player.getCurrentTime();
                    player.seekTo(curF + 5);
                    break;
                case 'media_restart': player.seekTo(0); break;
                // YouTube lacks fine speed/pitch control via simple API, but we could add speed
                case 'media_speed_up':
                    const sU = player.getPlaybackRate();
                    player.setPlaybackRate(Math.min(2.0, sU + 0.25));
                    break;
                case 'media_speed_down':
                    const sD = player.getPlaybackRate();
                    player.setPlaybackRate(Math.max(0.25, sD - 0.25));
                    break;
            }
        }
    }
    // B. LOCAL AUDIO
    else if (currentWebMode === "AUDIO") {
        switch (command) {
            case 'media_play_pause': audioControl('playpause'); break;
            case 'media_play': if (wavesurfer) wavesurfer.play(); break;
            case 'media_pause': if (wavesurfer) wavesurfer.pause(); break;
            case 'media_rewind': audioControl('prev'); break;
            case 'media_forward': audioControl('next'); break;
            case 'media_restart': audioControl('restart'); break;
            case 'media_speed_up': audioControl('speed_up'); break; // Arrow UP
            case 'media_speed_down': audioControl('speed_down'); break; // Arrow DOWN

            // Explicit Pitch Commands (via MIDI usually)
            case 'media_pitch_up': changePitch(0.1); break;
            case 'media_pitch_down': changePitch(-0.1); break;
            case 'media_pitch_reset': updatePitch(0); break;
        }
    }
    // C. LOCAL VIDEO
    else if (currentWebMode === "VIDEO") {
        switch (command) {
            case 'media_play_pause': videoControl('playpause'); break;
            case 'media_play': if (videoTarget) videoTarget.play(); break;
            case 'media_pause': if (videoTarget) videoTarget.pause(); break;
            case 'media_rewind': videoControl('prev'); break;
            case 'media_forward': videoControl('next'); break;
            case 'media_restart': videoControl('restart'); break;
            case 'media_speed_up': videoControl('speed_up'); break; // Arrow UP
            case 'media_speed_down': videoControl('speed_down'); break; // Arrow DOWN

            // Explicit Pitch Commands
            case 'media_pitch_up': changePitch(0.1); break;
            case 'media_pitch_down': changePitch(-0.1); break;
            case 'media_pitch_reset': updatePitch(0); break;
        }
    }
}

window.onload = () => {
    loadSetlist();
    if (typeof WaveSurfer !== 'undefined') initWaveSurfer();
};

function setMode(mode, targetProfile) {
    console.log(`[DEBUG JS] setMode called with Mode=${mode}, Target=${targetProfile}`);
    currentMode = mode;

    // STRICTLY UPDATE WEB MODE STATE
    if (mode === "AUDIO" || mode === "VIDEO") {
        currentWebMode = mode;
    } else {
        currentWebMode = "GENERIC";
    }

    // UPDATE DOCUMENT TITLE for ContextMonitor
    // This ensures the native app detects the context change even if WS fails
    if (targetProfile && targetProfile !== "Auto") {
        document.title = "Airstep Studio - " + targetProfile;
    } else {
        document.title = "Airstep Studio - Web Generic";
    }

    // Also notify backend
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            type: "set_mode",
            mode: mode,
            target_profile: targetProfile
        }));
    }
}
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
            backend: 'MediaElement'
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

// --- DATALISTS ---
function updateDatalists() {
    // 1. Categories (Web + Local)
    const webCats = currentTrackList.map(t => t.category).filter(c => c && c.trim() !== "");
    const localCats = localFiles.map(f => f.category).filter(c => c && c.trim() !== "");
    const uniqueCats = [...new Set([...webCats, ...localCats])].sort();

    const catList = document.getElementById("categories");
    if (catList) {
        catList.innerHTML = uniqueCats.map(c => `<option value="${c}">`).join("");
    }

    // 2. Genres (Web + Local)
    const webGenres = currentTrackList.map(t => t.genre).filter(g => g && g.trim() !== "");
    const localGenres = localFiles.map(f => f.genre).filter(g => g && g.trim() !== "");
    const uniqueGenres = [...new Set([...webGenres, ...localGenres])].sort();

    const genreList = document.getElementById("genres");
    if (genreList) {
        genreList.innerHTML = uniqueGenres.map(g => `<option value="${g}">`).join("");
    }
}

async function loadLocalFiles() {
    try {
        await loadBlockedTags(); // Load blocked list first

        const res = await fetch("/api/local/files");
        localFiles = await res.json();
    } catch (e) { localFiles = []; }

    // Initialize Custom Autocompletes
    setupCustomAutocomplete("edit-category", "suggestions-category", "category");
    setupCustomAutocomplete("edit-genre", "suggestions-genre", "genre");

    renderLocalFiles();
}

function renderLocalFiles() {
    const tbody = document.getElementById("local-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Filters
    const fArtist = (document.getElementById("filter-local-artist")?.value || "").toLowerCase();
    const fTitle = (document.getElementById("filter-local-title")?.value || "").toLowerCase();
    const fCategory = (document.getElementById("filter-local-album")?.value || "").toLowerCase(); // Reusing the 3rd input ID for Category

    const filtered = localFiles.filter(file => {
        const matchArtist = (file.artist || "").toLowerCase().includes(fArtist);
        const matchTitle = (file.title || "").toLowerCase().includes(fTitle);
        // Match against CATEGORY now, not Album (though we could search both?)
        // User requested Category column filter.
        const matchCat = (file.category || "").toLowerCase().includes(fCategory);
        return matchArtist && matchTitle && matchCat;
    });

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:gray;'>Aucun résultat</td></tr>";
        return;
    }

    filtered.forEach((file, index) => {
        const realIndex = localFiles.indexOf(file);

        // Icon Logic
        const ext = file.path.split('.').pop().toLowerCase();
        const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext);

        // Phosphor Icons
        let iconHtml = '';
        if (isAudio) {
            iconHtml = `<i class="ph ph-music-notes" style="color:#bb86fc; font-size:1.2em; vertical-align:middle; margin-right:5px;"></i>`;
        } else {
            // Video / Film Strip
            iconHtml = `<i class="ph ph-film-strip" style="color:#03dac6; font-size:1.2em; vertical-align:middle; margin-right:5px;"></i>`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${file.artist || ""}</td>
            <td style="cursor:pointer;" onclick="playLocal(${realIndex})">
                ${iconHtml}
                ${file.title}
            </td>
            <td>${file.category || "Général"}</td>
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

    // Helper
    const getProfile = (item, def) => (item.target_profile && item.target_profile !== "Auto") ? item.target_profile : def;

    // Detect Type
    const ext = file.path.split('.').pop().toLowerCase();
    const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext);
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm']; // Explicit list from user request for log consistency
    const isVideo = videoExts.includes(ext); // Note: original code checked ['mp4', 'mkv', 'webm', 'avi', 'mov']

    console.log("[DEBUG JS] Extension détectée :", ext);
    console.log("[DEBUG JS] Est-ce une vidéo ?", isVideo);
    console.log("[DEBUG JS] Profil Cible (si Auto) :", isVideo ? "Web Video Local" : "Web Audio Local");
    console.log("[DEBUG JS] Profil Forcé (Item) :", file.target_profile);

    // AUTO-RESET PITCH
    updatePitch(0);

    // Reset Volume Slider
    const volSlider = document.getElementById("audio-volume");
    if (volSlider) volSlider.value = 1;

    // Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");

    // Common Resets
    document.getElementById("player").style.display = "none";
    const genFrame = document.getElementById("generic-player");
    if (genFrame) genFrame.style.display = "none";

    // GLOBAL STOP
    stopAllMedia();

    const v = document.getElementById("html5-player");

    // Clean Reset without triggering errors
    v.onerror = null; // Remove listener before clearing
    v.pause();
    v.removeAttribute('src'); // Clean removal
    v.load();

    if (isAudio) {
        // --- AUDIO MODE (Hide Video Container) ---
        const target = getProfile(file, "Web Audio Local");
        console.log("[DEBUG JS] Envoi demande setMode (AUDIO) avec profil :", target);
        setMode("AUDIO", target); // Context Switch

        videoContainer.style.display = "none";
        audioContainer.style.display = "flex";
        document.getElementById("video-controls-container").style.display = "none";
        const vPitch = document.getElementById("video-pitch-control");
        if (vPitch) vPitch.style.display = "none";

        v.style.display = "none";

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
            wavesurfer.on('ready', () => {
                wavesurfer.play();
                if (isPitchEnabled) connectPitchEngine();
            });
        }

        currentActivePlayer = 'waveform';

    } else if (isVideo) {
        // --- VIDEO MODE (Show Video Container) ---
        const target = getProfile(file, "Web Video Local");
        console.log("[DEBUG JS] Envoi demande setMode (VIDEO) avec profil :", target);
        setMode("VIDEO", target); // Context Switch

        videoContainer.style.display = "flex";
        audioContainer.style.display = "none";
        v.style.display = "block";
        document.getElementById("video-controls-container").style.display = "flex";
        const vPitch = document.getElementById("video-pitch-control");
        if (vPitch) vPitch.style.display = "flex";



        // STOP AUDIO
        if (wavesurfer) {
            wavesurfer.pause();
        }

        // IMPORTANT: Define error handler BEFORE setting src, 
        // but ensure it ignores empty src errors (code 4)
        v.onerror = (e) => {
            if (!v.getAttribute('src')) return; // Ignore errors when src is empty
            console.error("Video Error:", v.error);
            alert("Erreur lecture vidéo: " + (v.error ? v.error.message : "Code " + v.error.code));
        };

        // 1. Set Source
        v.src = `/api/local/stream/${index}`;



        // 3. Play when ready
        v.oncanplay = () => {
            v.play();
            if (isPitchEnabled) connectPitchEngine();
        };

        // 3. Play when ready
        // We use a one-time listener to avoid multiple path triggers
        const startPlay = () => {
            v.play().catch(e => console.warn("Auto-play aborted", e));
            v.removeEventListener('canplay', startPlay);
        };
        v.addEventListener('canplay', startPlay);

        currentActivePlayer = 'local';
    }
}

// --- AUDIO CONTROLS (On Screen) ---
function audioControl(action) {
    if (!wavesurfer) return;
    switch (action) {
        case 'playpause': wavesurfer.playPause(); break;
        case 'prev': wavesurfer.skip(-5); break;
        case 'next': wavesurfer.skip(5); break;
        case 'restart': wavesurfer.seekTo(0); break;
        case 'speed_up':
            {
                let rate = wavesurfer.getPlaybackRate();
                rate = Math.min(rate + 0.05, 2.0);
                rate = Math.round(rate * 100) / 100;
                wavesurfer.setPlaybackRate(rate);
                document.getElementById("btn-audio-speed").innerText = rate + "x";
            }
            break;
        case 'speed_down':
            {
                let rate = wavesurfer.getPlaybackRate();
                rate = Math.max(rate - 0.05, 0.5);
                rate = Math.round(rate * 100) / 100;
                wavesurfer.setPlaybackRate(rate);
                document.getElementById("btn-audio-speed").innerText = rate + "x";
            }
            break;
    }
}

// --- VIDEO CONTROLS (On Screen) ---
function videoControl(action) {
    const vid = document.getElementById("html5-player");
    if (!vid) return;

    switch (action) {
        case 'playpause':
            vid.paused ? vid.play() : vid.pause();
            break;
        case 'prev':
            vid.currentTime -= 5;
            break;
        case 'next':
            vid.currentTime += 5;
            break;
        case 'restart':
            vid.currentTime = 0;
            break;
        case 'speed_up':
            {
                let rate = vid.playbackRate;
                rate = Math.min(rate + 0.05, 2.0);
                rate = Math.round(rate * 100) / 100;
                vid.playbackRate = rate;
                document.getElementById("btn-video-speed").innerText = rate + "x";
            }
            break;
        case 'speed_down':
            {
                let rate = vid.playbackRate;
                rate = Math.max(rate - 0.05, 0.5);
                rate = Math.round(rate * 100) / 100;
                vid.playbackRate = rate;
                document.getElementById("btn-video-speed").innerText = rate + "x";
            }
            break;
    }
}

async function addLocalFile() {
    const res = await fetch("/api/local/add", { method: "POST" });
    const data = await res.json();

    if (data.status === "ok") {
        loadLocalFiles();
    } else if (data.status === "import_needed") {
        openImportModal(data);
    } else if (data.status === "exists") {
        alert("Ce fichier est déjà dans la bibliothèque.");
    }
}

// --- IMPORT LOGIC ---
let pendingImportData = null;

function openImportModal(data) {
    pendingImportData = data;
    document.getElementById("import-modal").showModal();
    document.getElementById("import-source-path").innerText = data.source_path;

    const select = document.getElementById("import-target-folder");
    select.innerHTML = "";
    data.target_folders.forEach(folder => {
        const opt = document.createElement("option");
        opt.value = folder;
        opt.innerText = folder;
        select.appendChild(opt);
    });
}

function closeImportModal() {
    document.getElementById("import-modal").close();
    pendingImportData = null;
}

async function confirmImport(action) {
    if (!pendingImportData) return;

    const targetFolder = document.getElementById("import-target-folder").value;
    const payload = {
        source_path: pendingImportData.source_path,
        action: action,
        target_folder: targetFolder
    };

    closeImportModal(); // Close immediately

    // Show loading or opt
    try {
        const res = await fetch("/api/local/confirm_import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            loadLocalFiles();
        } else {
            alert("Erreur lors de l'importation.");
        }
    } catch (e) {
        console.error("Import Error", e);
        alert("Erreur technique lors de l'import.");
    }
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
    document.getElementById("local-category").value = item.category || "Général";
    document.getElementById("local-year").value = item.year || "";
    document.getElementById("local-target-profile").value = item.target_profile || "Auto";
    document.getElementById("local-notes").value = item.user_notes || "";

    // Load Art
    currentCoverData = null;
    document.getElementById("cover-upload").value = "";

    const img = document.getElementById("local-art-img");
    const placeholder = document.getElementById("local-art-placeholder");

    // Reset visibility logic
    img.style.display = "none";
    placeholder.style.display = "flex";

    img.onload = () => {
        img.style.display = "block";
        placeholder.style.display = "none";
    };
    img.onerror = () => {
        img.style.display = "none";
        placeholder.style.display = "flex";
    };

    img.src = `/api/local/art/${index}?t=${Date.now()}`;
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
        category: document.getElementById("local-category").value || "Général",
        year: document.getElementById("local-year").value,
        target_profile: document.getElementById("local-target-profile").value,
        user_notes: document.getElementById("local-notes").value,
        cover_data: currentCoverData // Send base64 data if changed
    };

    const res = await fetch(`/api/local/${editingLocalIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (res.ok) {
        const data = await res.json();
        if (data.warning) {
            alert(data.warning);
        }
    }

    closeLocalModal();
    loadLocalFiles();
}

async function deleteLocalFile(index) {
    if (!confirm("Supprimer ce fichier de la bibliothèque ?")) return;
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


// loadYouTubeAPI(); // Fix: Removed undefined call. API loaded via HTML script tag.
// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Loaded");

    // Initialize WebSockets
    if (typeof connectVideoWebSocket === 'function') {
        connectVideoWebSocket();
    } else {
        console.error("connectVideoWebSocket function not found!");
    }

    // CHECK YOUTUBE API MANUALLY
    // If API loaded before we attached the callback, we must init manually.
    if (window.YT && window.YT.Player && typeof onYouTubeIframeAPIReady === "function") {
        console.log("YouTube API already loaded. Forcing manual init.");
        try {
            onYouTubeIframeAPIReady();
        } catch (e) { console.error("Manual YT Init Error:", e); }
    }

    // Initial Loads
    setTimeout(() => {
        if (!localFiles || localFiles.length === 0) loadLocalFiles();
    }, 1000);
});

function handleLocalCover(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            currentCoverData = e.target.result; // Base64 string
            const img = document.getElementById("local-art-img");
            const placeholder = document.getElementById("local-art-placeholder");

            if (img && placeholder) {
                img.src = currentCoverData;
                img.style.display = "block";
                placeholder.style.display = "none";
            }
        };
        reader.readAsDataURL(input.files[0]);
    }
}


function removeLocalCover() {
    // Logic to mark cover for deletion
    currentCoverData = "DELETE";

    // Update UI immediately
    const img = document.getElementById("local-art-img");
    const placeholder = document.getElementById("local-art-placeholder");
    const fileInput = document.getElementById("cover-upload");

    if (img && placeholder) {
        img.style.display = "none";
        img.src = ""; // Clear source
        placeholder.style.display = "flex";
    }

    // Reset file input
    if (fileInput) fileInput.value = "";
}
// --- AUTO-TAG LOGIC ---
async function autoTagLocal() {
    let q = document.getElementById("local-title").value;
    if (!q) {
        // Fallback to filename if title is empty
        const pathDisplay = document.getElementById("local-path-display").innerText;
        // Basic extraction: filename without path
        if (pathDisplay) {
            const parts = pathDisplay.split(/[\\/]/);
            q = parts[parts.length - 1];
        }
    }

    if (!q) {
        alert("Veuillez entrer un titre ou sélectionner un fichier.");
        return;
    }

    const container = document.getElementById("auto-tag-results");
    container.style.display = "flex";
    container.innerHTML = "<div style='color:#888;'>Recherche en cours...</div>";

    try {
        const res = await fetch(`/api/metadata/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();

        container.innerHTML = "";

        if (results.length === 0) {
            container.innerHTML = "<div style='color:#aaa;'>Aucun résultat trouvé.</div>";
            return;
        }

        results.forEach(item => {
            const div = document.createElement("div");
            div.style.padding = "5px";
            div.style.background = "#2a2a2a";
            div.style.border = "1px solid #444";
            div.style.borderRadius = "4px";
            div.style.cursor = "pointer";
            div.style.display = "flex";
            div.style.gap = "10px";
            div.style.alignItems = "center";

            // Thumbnail handling (if available)
            let thumb = "<span style='font-size:20px;'>🎵</span>";
            if (item.cover_url) {
                thumb = `<img src="${item.cover_url}" style="width:30px; height:30px; object-fit:cover;">`;
            }

            div.innerHTML = `
                ${thumb}
                <div>
                    <div style="font-weight:bold; font-size:0.9em;">${item.title}</div>
                    <div style="font-size:0.8em; color:#bbb;">${item.artist} - ${item.album} (${item.year})</div>
                </div>
            `;

            // Pass full item to handler
            div.onclick = () => applyAutoTag(item);
            container.appendChild(div);
        });

    } catch (e) {
        container.innerHTML = "<div style='color:red;'>Erreur API.</div>";
        console.error(e);
    }
}

function applyAutoTag(item) {
    // Fill fields
    document.getElementById("local-title").value = item.title || "";
    document.getElementById("local-artist").value = item.artist || "";
    document.getElementById("local-album").value = item.album || "";
    document.getElementById("local-year").value = item.year || "";

    // Hide results
    document.getElementById("auto-tag-results").style.display = "none";

    // Cover Logic
    if (item.cover_url) {
        currentCoverData = item.cover_url; // Store URL directly
        // Update Preview
        const img = document.getElementById("local-art-img");
        const ph = document.getElementById("local-art-placeholder");
        const btnDel = document.getElementById("btn-delete-cover");

        img.src = item.cover_url;
        img.style.display = "block";
        ph.style.display = "none";
        btnDel.style.display = "flex";
    }
}

// Ensure pendingCoverData is global or accessible
// (It is, defined near addLocalFile)

// --- PROFILES LOAD ---
async function loadProfiles() {
    try {
        const res = await fetch("/api/profiles");
        availableProfiles = await res.json();
    } catch (e) { availableProfiles = []; }

    populateProfileSelects();
}

function populateProfileSelects() {
    const ids = ["edit-target-profile", "local-target-profile"];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        // Keep "Auto"
        sel.innerHTML = '<option value="Auto">Auto (Recommandé)</option>';
        availableProfiles.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.name;
            opt.innerText = p.name;
            sel.appendChild(opt);
        });
    });
}
// Add to Init
const originalOnLoad = window.onload;
window.onload = () => {
    if (originalOnLoad) originalOnLoad();
    loadProfiles();
    loadSettings(); // Ensure settings are loaded on startup
    checkDLStatus(); // Check FFmpeg status
};
