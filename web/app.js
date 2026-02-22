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

// --- A-B LOOPING SYSTEM ---
let loopA = null;
let loopB = null;
let isLoopActive = false;
let currentLoops = []; // Array of saved loops for the active track

// --- GLOBAL DEVICE STATUS ---
let currentDeviceName = "Aucun";
let currentConnectionMode = "MIDO";
let currentIsConnected = false;

function startDeviceStatusPolling() {
    setInterval(async () => {
        try {
            const res = await fetch("/api/status");
            if (res.ok) {
                const data = await res.json();
                currentDeviceName = data.device_name || "Aucun";
                currentConnectionMode = data.connection_mode || "MIDO";
                currentIsConnected = data.is_connected || false;

                const activeProfileName = data.active_profile_name || "Global / Aucun";
                const profileLabel = document.getElementById("active-profile");
                if (profileLabel) {
                    profileLabel.innerText = "Profil : " + activeProfileName;
                }

                // Update Header Device Status
                const headerStatus = document.getElementById("header-device-status");
                if (headerStatus) {
                    let displayMode = currentConnectionMode === "BLE" ? "Bluetooth" : "USB";
                    if (currentDeviceName === "Aucun" || !currentDeviceName) {
                        headerStatus.innerHTML = `○ En attente...`;
                        headerStatus.style.color = "#888";
                    } else if (!currentIsConnected) {
                        headerStatus.innerHTML = `🔴 ${currentDeviceName} (${displayMode}) - Déconnecté`;
                        headerStatus.style.color = "#cf6679";
                    } else {
                        headerStatus.innerHTML = `🟢 ${currentDeviceName} (${displayMode})`;
                        headerStatus.style.color = "#03dac6";
                    }
                }

                // If on empty state, force refresh to show new name immediately
                if (!currentProfile || !currentProfile.mappings) {
                    renderPedalboard(currentProfile);
                }
            }
        } catch (e) {
            // Silently ignore connection errors here to not spam console when server restarts
            currentIsConnected = false;
        }
    }, 2000);
}
startDeviceStatusPolling();

// --- PITCH SHIFT VARIABLES ---
let audioCtx = null;
let pitchShifter = null;
let pitchSource = null;
let isPitchEnabled = false;

// Store sources separately to avoid conflict/recreation errors
let sourceAudio = null; // For WaveSurfer
let sourceVideo = null; // For HTML5 Video

// --- CAPABILITIES ---
let systemCapabilities = { can_download: false }; // Default safe value

async function checkSystemCapabilities() {
    try {
        const res = await fetch("/api/system/capabilities");
        if (res.ok) {
            systemCapabilities = await res.json();
            console.log("System Capabilities:", systemCapabilities);
            applyCapabilities();
        }
    } catch (e) {
        console.error("Failed to check capabilities:", e);
    }
}

function applyCapabilities() {
    const btnDl = document.getElementById('btn-show-dl');
    const btnHelp = document.getElementById('btn-offline-help');

    // Also check smart import button if it exists
    const smartImportBtn = document.getElementById('btn-smart-import');

    if (!systemCapabilities.can_download) {
        // Hide Download features
        if (btnDl) btnDl.style.display = 'none';
        if (smartImportBtn) smartImportBtn.style.display = 'none';

        // Show Alternative (only if logic requires it, usually controlled by specific context)
        // For the modal, it's controlled by checkDownloadAvailability, but global checks help.
    } else {
        // Restore defaults if needed, though usually handled by visibility toggles
    }

    // Show Disclaimer in Settings if limited
    const settingsContainer = document.querySelector('#settings-modal .modal-content');
    if (settingsContainer && !systemCapabilities.can_download) {
        if (!document.getElementById('dep-alert')) {
            const alert = document.createElement('div');
            alert.id = 'dep-alert';
            alert.style.cssText = "background:#332200; color:#ffaa00; padding:10px; margin-bottom:15px; border-left:4px solid #ffaa00; font-size:0.9em;";
            alert.innerHTML = `
                <strong>⚠️ Mode Restreint</strong><br>
                Les fonctions de téléchargement sont désactivées car <code>yt-dlp.exe</code> ou <code>ffmpeg.exe</code> sont absents.<br>
                Pour les activer, placez ces outils dans le dossier de l'application conformément à la documentation.
            `;
            // Insert at top of settings
            if (settingsContainer.firstChild) settingsContainer.insertBefore(alert, settingsContainer.firstChild);
            else settingsContainer.appendChild(alert);
        }
    }
}

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
            // Check auto-close preference
            const autoClose = document.getElementById("dl-autoclose") && document.getElementById("dl-autoclose").checked;

            if (autoClose) {
                closeModal();
                alert("Téléchargement terminé et ajouté aux Fichiers Locaux !");
                // Refresh local view if visible
                loadLocalFiles();
            } else {
                document.getElementById("dl-status").innerText = "Terminé ✅";
                document.getElementById("dl-progress-bar").style.width = "100%";
                // Refresh local view if visible
                loadLocalFiles();
                // Change Cancel button to "Fermer" to indicate it's safe to leave
                // Note: we might need a specific ID for that button or simpler:
                // The user can just click "Annuler" or cross.
            }
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
    document.getElementById("edit-volume").value = 100;
    const evp1 = document.getElementById("edit-volume-percent"); if (evp1) evp1.innerText = "100%";
    document.getElementById("youtube-desc-input").value = "";
    document.getElementById("user-notes-input").value = "";

    document.getElementById("preview-thumbnail").innerHTML = '<span style="font-size:30px;">🎵</span>';

    // Reset Download UI
    document.getElementById("dl-options-container").style.display = "none";

    // Explicitly hide both (will be re-evaluated by checkDownloadAvailability if URL entered)
    const btnDl = document.getElementById("btn-show-dl");
    const btnHelp = document.getElementById("btn-offline-help");
    if (btnDl) btnDl.style.display = "none";
    if (btnHelp) btnHelp.style.display = "none";

    document.getElementById("dl-progress-bar").style.width = "0%";
    document.getElementById("dl-status").innerText = "Prêt";

    // Reset View: Show Search
    resetSearchMode();

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
    let volValEdit = (track.volume !== undefined) ? track.volume : 100;
    document.getElementById("edit-volume").value = volValEdit;
    const evp2 = document.getElementById("edit-volume-percent"); if (evp2) evp2.innerText = volValEdit + "%";

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

    // Hide Search Zone in Edit Mode (Save Space)
    document.getElementById("search-zone-container").classList.add("hidden");
    document.getElementById("btn-back-search").style.display = "block"; // Start with "Back" button visible to allow new search

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

// --- SEARCH MODE LOGIC ---

function selectResult(video) {
    console.log("Selected Data:", video); // Debug

    // 1. Hide Search, Show Form
    document.getElementById("search-zone-container").classList.add("hidden");
    document.getElementById("btn-back-search").style.display = "block";

    // 2. Title & URL
    document.getElementById("edit-title").value = video.title;
    const url = video.id ? `https://www.youtube.com/watch?v=${video.id}` : "";
    if (url) document.getElementById("edit-url").value = url;

    // Show Download Button if URL
    if (url) checkDownloadAvailability(url);

    // 3. Channel & Description
    document.getElementById("edit-channel").value = video.channel || "";
    document.getElementById("youtube-desc-input").value = video.description || "";

    // 4. Thumbnail Preview
    if (video.thumbnail_url) {
        document.getElementById("preview-thumbnail").innerHTML = `<img src="${video.thumbnail_url}">`;
    } else {
        document.getElementById("preview-thumbnail").innerHTML = '<span style="font-size:40px;">🎵</span>';
    }

    // 5. Try Parse Artist (Format "Artist - Title")
    if (video.title && video.title.includes("-")) {
        const parts = video.title.split("-");
        if (parts.length >= 2) {
            document.getElementById("edit-artist").value = parts[0].trim();
        }
    }

    // 6. Auto-set mode
    document.getElementById("edit-mode").value = "iframe";
}

function resetSearchMode() {
    // Show Search, Hide Back Button
    document.getElementById("search-zone-container").classList.remove("hidden");
    document.getElementById("btn-back-search").style.display = "none";

    // Optional: Clear form if desired? For now we keep it so user doesn't lose data if they misclicked.
}

function connectVideoWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    console.log("Connecting WebSocket:", wsUrl);
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
        console.log("WebSocket OPEN");
        // Re-send current mode to sync backend state
        if (currentMode) {
            websocket.send(JSON.stringify({
                type: "set_mode",
                mode: currentMode,
                target_profile: document.title.replace("Airstep Studio - ", "")
            }));
        }
    };

    websocket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);

            if (msg.type === "dl_progress") {
                const percent = msg.percent;
                const status = msg.status;
                const bar = document.getElementById("dl-progress-bar");
                const text = document.getElementById("dl-status");

                if (bar) bar.style.width = percent + "%";
                if (text) text.innerText = `${status} (${Math.round(percent)}%)`;

            } else if (msg.type === "dl_complete") {
                const text = document.getElementById("dl-status");
                const bar = document.getElementById("dl-progress-bar");

                if (text) text.innerText = "Téléchargement terminé !";
                if (bar) {
                    bar.style.width = "100%";
                    bar.style.background = "#4caf50"; // Green
                }

                // Check Auto Close
                const autoCloseCheckbox = document.getElementById("dl-autoclose");
                const autoClose = autoCloseCheckbox ? autoCloseCheckbox.checked : false;
                console.log("[DL] Complete. AutoClose Checked:", autoClose);

                if (autoClose) {
                    console.log("[DL] Auto-closing modal in 1s...");
                    setTimeout(() => {
                        console.log("[DL] Closing modal now.");
                        closeModal(); // FULL CLOSE
                    }, 1000);
                }

                // Refresh Lists
                loadLocalFiles();
                loadSetlist();

            } else if (msg.type === "dl_error") {
                alert("Erreur Téléchargement: " + msg.error);
                const text = document.getElementById("dl-status");
                const bar = document.getElementById("dl-progress-bar");
                if (text) text.innerText = "Erreur";
                if (bar) bar.style.background = "#cf6679"; // Red

            } else if (msg.type === "log") {
                console.log("[SERVER LOG]", msg.message);
            }

        } catch (e) {
            console.error("WS Message Error", e);
        }
    };

    websocket.onclose = () => {
        console.warn("WebSocket Closed. Reconnecting in 3s...");
        setTimeout(connectVideoWebSocket, 3000);
    };

    websocket.onerror = (e) => {
        console.error("WebSocket Error", e);
    };
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
    const btnDl = document.getElementById("btn-show-dl");
    const btnHelp = document.getElementById("btn-offline-help");

    const isYoutube = url && (url.includes("youtube.com") || url.includes("youtu.be"));

    if (isYoutube) {
        if (systemCapabilities && systemCapabilities.can_download) {
            // Capability Present: Show Button, Hide Help
            if (btnDl) btnDl.style.display = "inline-block";
            if (btnHelp) btnHelp.style.display = "none";
        } else {
            // Capability Missing: Hide Button, Show Help
            if (btnDl) btnDl.style.display = "none";
            if (btnHelp) btnHelp.style.display = "inline-block";
        }
    } else {
        // Not YouTube: Hide Both
        if (btnDl) btnDl.style.display = "none";
        if (btnHelp) btnHelp.style.display = "none";
    }
}

async function toggleDownloadOptions() {
    const container = document.getElementById("dl-options-container");
    if (container.style.display === "block") {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";

    // Auto-scroll to bottom of modal to show options
    // Auto-scroll to bottom of modal to show options
    // Use requestAnimationFrame to ensure DOM verify
    requestAnimationFrame(() => {
        container.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

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
}

async function startDownload() {
    const url = document.getElementById("edit-url").value;
    const format = document.getElementById("dl-format").value;
    const folder = document.getElementById("dl-folder").value;
    const subs = document.getElementById("dl-subs").checked;

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
    const volume = parseInt(document.getElementById("edit-volume").value) || 100;

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
        thumbnail: thumbnail,
        volume: volume
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

    // Play it in Preview Modal
    openPreviewModal(track);
}

let currentPreviewUrl = "";

function openPreviewModal(track) {
    const dialog = document.getElementById("preview-modal");
    const container = document.getElementById("preview-container");
    const url = track.url || "";
    currentPreviewUrl = url;

    // Reset UI Elements
    const fallbackBtn = document.getElementById("btn-preview-fallback");
    if (fallbackBtn) {
        fallbackBtn.style.display = "flex";
        fallbackBtn.innerHTML = "<span>🔓</span> Forcer la Lecture (Débloquer)";
        fallbackBtn.disabled = false;
    }
    const infoSpan = document.getElementById("preview-info");
    if (infoSpan) infoSpan.innerText = "Mode Standard (YouTube Embed)";

    // Clean previous
    container.innerHTML = "";

    console.log("Opening Preview for:", url);

    // Determine type
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
        // Extract ID or use existing if parsed
        let id = track.id;
        if (!id) {
            const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
            if (match) id = match[1];
        }

        if (id) {
            // Use Embed Iframe for simplicity in preview
            container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${id}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        } else {
            container.innerHTML = "<div style='color:white;'>ID YouTube invalide ou URL non reconnue.</div>";
        }
    } else {
        // Generic Iframe or Video?
        if (url.match(/\.(mp4|webm|ogv)$/i)) {
            container.innerHTML = `<video src="${url}" controls autoplay style="width:100%; height:100%"></video>`;
        } else {
            // Generic Embed
            // Helper might be missing in context, check if getEmbedUrl exists or use simple iframe
            // Assuming getEmbedUrl exists as per original code context, otherwise fallback
            let src = url;
            try { if (typeof getEmbedUrl === 'function') src = getEmbedUrl(url); } catch (e) { }

            container.innerHTML = `<iframe width="100%" height="100%" src="${src}" frameborder="0" allowfullscreen></iframe>`;
        }
    }

    dialog.style.display = "flex"; // FORCE VISIBILITY
    dialog.showModal();
}

async function unlockPreview() {
    if (!currentPreviewUrl) return alert("Aucune vidéo détectée.");

    const container = document.getElementById("preview-container");
    const btn = document.getElementById("btn-preview-fallback");
    const info = document.getElementById("preview-info");

    btn.disabled = true;
    btn.innerHTML = "<span>⌛</span> Chargement...";

    try {
        const payload = { url: currentPreviewUrl };
        const res = await fetch("/api/dl/stream_url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Erreur serveur");
        if (data.error) throw new Error(data.error);

        if (data.url) {
            // Success: Switch to Video Tag
            container.innerHTML = `
                <video src="${data.url}" controls autoplay
                       style="width:100%; height:100%; outline:none; background:black;"
                       onerror="alert('Impossible de lire le flux direct (Expiré ou format non supporté).')">
                </video>
            `;
            if (info) info.innerText = "Mode Débloqué (Flux Direct)";
            btn.style.display = "none"; // Hide button on success
        } else {
            throw new Error("Aucun lien trouvé");
        }

    } catch (e) {
        alert("Impossible de débloquer la vidéo : " + e.message);
        btn.innerHTML = "<span>🔓</span> Forcer la Lecture (Débloquer)";
    } finally {
        btn.disabled = false;
    }
}

function closePreviewModal() {
    const dialog = document.getElementById("preview-modal");
    const container = document.getElementById("preview-container");

    // Stop video
    container.innerHTML = "";

    dialog.close();
    dialog.style.display = "none"; // FORCE HIDE
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
    loadLoopsForTrack(track);
    const html5 = document.getElementById("html5-player");

    // STOP ALL MEDIA first
    stopAllMedia();

    // Reset Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");
    videoContainer.style.display = "flex";
    audioContainer.style.display = "none";

    // Volume Default logic
    const trackVolume = (track.volume !== undefined) ? parseInt(track.volume, 10) : 100;
    const normalizedVolume = trackVolume / 100;

    // Reset Volume Slider
    const audioVolSlider = document.getElementById("audio-volume");
    if (audioVolSlider) { audioVolSlider.value = normalizedVolume; const avp = document.getElementById("audio-volume-percent"); if (avp) avp.innerText = trackVolume + "%"; }
    const videoVolSlider = document.getElementById("video-volume");
    if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vvp = document.getElementById("video-volume-percent"); if (vvp) vvp.innerText = trackVolume + "%"; }

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
            // Apply volume AFTER load, sometimes YT API needs a tick but usually loadVideoById is sync enough for state prep
            player.setVolume(trackVolume);
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
let isPedalboardVisible = true;

async function toggleNativeRemote() {
    try {
        const res = await fetch("/api/toggle_remote", { method: "POST" });
        if (!res.ok) console.error("Failed to toggle remote", await res.text());
    } catch (e) {
        console.error("Error toggling remote", e);
    }
}

let isTheaterMode = false;

function toggleTheaterMode() {
    isTheaterMode = !isTheaterMode;

    // Elements to toggle
    const sidebar = document.querySelector(".sidebar-zone");
    const pedalboard = document.getElementById("pedalboard-container");
    const mediaZone = document.querySelector(".media-zone");

    if (isTheaterMode) {
        if (sidebar) sidebar.style.display = "none";
        if (pedalboard) pedalboard.style.display = "none";
        if (mediaZone) mediaZone.style.borderRight = "none";
    } else {
        if (sidebar) sidebar.style.display = "flex"; // style.css uses flex for sidebar-zone
        if (pedalboard) pedalboard.style.display = "block";
        if (mediaZone) mediaZone.style.borderRight = "1px solid #333";
    }
}

function renderPedalboard(profile) {
    const grid = document.getElementById("pedalboard-grid");
    grid.innerHTML = "";
    if (!profile || !profile.mappings) {
        grid.innerHTML = `<div class="empty-state" style="padding: 5px; opacity: 0;"></div>`;
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
            if (e.ctrlKey) command = 'media_chapter_prev';
            else command = 'media_rewind';
            break;
        case 'ArrowRight':
        case 'KeyL': // YouTube standard (+10s usually)
            if (e.ctrlKey) command = 'media_chapter_next';
            else command = 'media_forward';
            break;
        case 'MediaTrackPrevious':
            command = 'media_chapter_prev';
            break;
        case 'MediaTrackNext':
            command = 'media_chapter_next';
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

            // Chapter Commands
            case 'media_chapter_prev': videoControl('chapter_prev'); break;
            case 'media_chapter_next': videoControl('chapter_next'); break;
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
            checkLoop(currentTime);
            const duration = wavesurfer.getDuration();
            const fmt = (s) => new Date(s * 1000).toISOString().substr(14, 5);
            document.getElementById("audio-time").innerText = fmt(currentTime) + " / " + fmt(duration);
            updateActiveChapter(currentTime);
        });

        // --- NEW: Icon Toggle ---
        wavesurfer.on('play', () => updatePlayPauseIcon('audio', true));
        wavesurfer.on('pause', () => updatePlayPauseIcon('audio', false));

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

    // RENDER CHAPTERS
    renderChapters(file.chapters);

    // AUTO-RESET PITCH
    updatePitch(0);

    // Volume Default logic
    const trackVolume = (file.volume !== undefined) ? parseInt(file.volume, 10) : 100;
    const normalizedVolume = trackVolume / 100;

    // Reset Volume Slider
    const audioVolSlider = document.getElementById("audio-volume");
    if (audioVolSlider) audioVolSlider.value = normalizedVolume;
    const videoVolSlider = document.getElementById("video-volume");
    if (videoVolSlider) videoVolSlider.value = normalizedVolume;

    // Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");

    // Load saved loops for this file
    loadLoopsForTrack(file);

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
    v.volume = normalizedVolume; // SET HTML5 VOLUME

    if (isAudio) {
        // --- AUDIO MODE (Hide Video Container) ---
        const target = getProfile(file, "Web Audio Local");
        console.log("[DEBUG JS] Envoi demande setMode (AUDIO) avec profil :", target);
        setMode("AUDIO", target); // Context Switch

        videoContainer.style.display = "none";
        audioContainer.style.display = "flex";
        document.getElementById("video-controls-container").style.display = "none";
        // Hide Custom Timeline
        const valT = document.getElementById("video-timeline-container");
        if (valT) valT.style.display = "none";

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
            wavesurfer.setVolume(normalizedVolume); // SET WAVESURFER VOLUME
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

        // Show Custom Timeline
        const timeline = document.getElementById("video-timeline-container");
        if (timeline) {
            timeline.style.display = "flex";
            setupVideoTimeline();
        }

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
        window.currentPlayingIndex = index; // Store for subtitle drag saving

        v.ontimeupdate = () => {
            checkLoop(v.currentTime);
            updateTimelineUI(v.currentTime);
            updateActiveChapter(v.currentTime);
            updateSubtitle(v.currentTime); // Custom SRT Engine
        };

        // 2. Load Subtitles
        loadSubtitles(index, file);



        const startPlay = () => {
            v.play().catch(e => console.warn("Auto-play aborted", e));
            v.removeEventListener('canplay', startPlay);
            if (isPitchEnabled) connectPitchEngine();
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
        case 'prev':
            vid.currentTime -= 5;
            updateTimelineUI(vid.currentTime);
            break;

        case 'next':
            vid.currentTime += 5;
            updateTimelineUI(vid.currentTime);
            break;

        case 'chapter_prev':
            if (currentChapters.length > 0) {
                let currentIdx = -1;
                for (let i = 0; i < currentChapters.length; i++) {
                    if (vid.currentTime >= currentChapters[i].start_time) currentIdx = i;
                    else break;
                }

                if (currentIdx >= 0) {
                    const chapStart = currentChapters[currentIdx].start_time;
                    if (vid.currentTime - chapStart > 3) {
                        vid.currentTime = chapStart;
                    } else if (currentIdx > 0) {
                        vid.currentTime = currentChapters[currentIdx - 1].start_time;
                    } else {
                        vid.currentTime = 0;
                    }
                    updateTimelineUI(vid.currentTime);
                    return;
                }
            }
            // Fallback
            vid.currentTime = 0;
            updateTimelineUI(0);
            break;

        case 'chapter_next':
            if (currentChapters.length > 0) {
                let currentIdx = -1;
                for (let i = 0; i < currentChapters.length; i++) {
                    if (vid.currentTime >= currentChapters[i].start_time) currentIdx = i;
                    else break;
                }

                let nextChap = currentChapters.find(c => c.start_time > vid.currentTime + 0.5);
                if (nextChap) {
                    vid.currentTime = nextChap.start_time;
                    updateTimelineUI(vid.currentTime);
                    return;
                }
            }
            break;

        case 'playpause': vid.paused ? vid.play() : vid.pause(); break;
        case 'restart':
            vid.currentTime = 0;
            updateTimelineUI(0);
            break;
        case 'speed_up':
            let rateU = vid.playbackRate;
            rateU = Math.min(rateU + 0.05, 2.0);
            vid.playbackRate = rateU;
            document.getElementById("btn-video-speed").innerText = rateU.toFixed(2) + "x";
            break;
        case 'speed_down':
            let rateD = vid.playbackRate;
            rateD = Math.max(rateD - 0.05, 0.5);
            vid.playbackRate = rateD;
            document.getElementById("btn-video-speed").innerText = rateD.toFixed(2) + "x";
            break;
    }
}

// --- VOLUME LOGIC (Live Persistence) ---
function updateVideoVolume(val) {
    const numVal = parseFloat(val);
    const percentVol = Math.round(numVal * 100);

    // Apply physically
    if (currentActivePlayer === 'local') {
        const vid = document.getElementById("html5-player");
        if (vid) vid.volume = numVal;
    } else if (currentActivePlayer === 'youtube') {
        if (player && typeof player.setVolume === "function") {
            player.setVolume(percentVol);
        }
    }

    // Save Persistently (Debounced physically if needed, but direct save is fine for discrete slider drops)
    if (currentActivePlayer === 'local' && window.currentPlayingIndex !== undefined) {
        const file = localFiles[window.currentPlayingIndex];
        if (file) {
            file.volume = percentVol;
            fetch(`/api/local/${window.currentPlayingIndex}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(file)
            }).catch(e => console.error("Volume Save Error (Local)", e));
        }
    } else if (currentActivePlayer === 'youtube' && document.getElementById("player").style.display !== "none") {
        if (player && typeof player.getVideoData === "function") {
            const vidData = player.getVideoData();
            if (vidData && vidData.video_id) {
                const track = currentTrackList.find(t => t.id === vidData.video_id);
                if (track && track.originalIndex !== undefined) {
                    track.volume = percentVol;
                    fetch(`/api/setlist/${track.originalIndex}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(track)
                    }).catch(e => console.error("Volume Save Error (YouTube)", e));
                }
            }
        }
    }
}

function liveUpdateModalVolume(type, val) {
    const numVal = parseFloat(val);
    const percentVol = Math.round(numVal);
    const normalizedVolume = percentVol / 100;

    if (type === 'local' && editingLocalIndex !== null && editingLocalIndex === currentPlayingIndex && (currentActivePlayer === 'local' || currentActivePlayer === 'waveform')) {
        const vid = document.getElementById("html5-player");
        if (vid) vid.volume = normalizedVolume;
        if (wavesurfer && currentActivePlayer === 'waveform') wavesurfer.setVolume(normalizedVolume);

        // Sync the main player UI slider too
        const audioVolSlider = document.getElementById("audio-volume");
        if (audioVolSlider) { audioVolSlider.value = normalizedVolume; const ap = document.getElementById("audio-volume-percent"); if (ap) ap.innerText = percentVol + "%"; }
        const videoVolSlider = document.getElementById("video-volume");
        if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vp = document.getElementById("video-volume-percent"); if (vp) vp.innerText = percentVol + "%"; }

    } else if (type === 'edit' && editingIndex !== null && currentActivePlayer === 'youtube') {
        const track = currentTrackList.find(t => t.originalIndex === editingIndex);
        if (track && player && typeof player.getVideoData === "function") {
            const vidData = player.getVideoData();
            if (vidData && vidData.video_id === track.id) {
                player.setVolume(percentVol);

                // Sync the main player UI slider too
                const videoVolSlider = document.getElementById("video-volume");
                if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vp2 = document.getElementById("video-volume-percent"); if (vp2) vp2.innerText = percentVol + "%"; }
            }
        }
    }
}

let isMuted = false;
let preMuteVolume = 1.0;

function toggleMute(type) {
    isMuted = !isMuted;
    const icons = [document.getElementById("audio-mute-icon"), document.getElementById("video-mute-icon")];

    if (isMuted) {
        icons.forEach(i => { if (i) { i.classList.remove("ph-speaker-high"); i.classList.add("ph-speaker-slash"); i.style.color = "#cf6679"; } });

        if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
            const vid = document.getElementById("html5-player");
            if (vid) { preMuteVolume = vid.volume; vid.volume = 0; }
            if (wavesurfer) wavesurfer.setVolume(0);
        } else if (currentActivePlayer === 'youtube') {
            if (player && typeof player.getVolume === "function") {
                preMuteVolume = player.getVolume() / 100;
                player.setVolume(0);
            }
        }

        const v1 = document.getElementById("audio-volume"); if (v1) { v1.value = 0; const a1 = document.getElementById("audio-volume-percent"); if (a1) a1.innerText = "0%"; }
        const v2 = document.getElementById("video-volume"); if (v2) { v2.value = 0; const v_2 = document.getElementById("video-volume-percent"); if (v_2) v_2.innerText = "0%"; }

    } else {
        icons.forEach(i => { if (i) { i.classList.remove("ph-speaker-slash"); i.classList.add("ph-speaker-high"); i.style.color = "#888"; } });

        if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
            const vid = document.getElementById("html5-player");
            if (vid) vid.volume = preMuteVolume;
            if (wavesurfer) wavesurfer.setVolume(preMuteVolume);
        } else if (currentActivePlayer === 'youtube') {
            if (player && typeof player.setVolume === "function") {
                player.setVolume(preMuteVolume * 100);
            }
        }

        const v1 = document.getElementById("audio-volume"); if (v1) { v1.value = preMuteVolume; const a1 = document.getElementById("audio-volume-percent"); if (a1) a1.innerText = Math.round(preMuteVolume * 100) + "%"; }
        const v2 = document.getElementById("video-volume"); if (v2) { v2.value = preMuteVolume; const v_2 = document.getElementById("video-volume-percent"); if (v_2) v_2.innerText = Math.round(preMuteVolume * 100) + "%"; }
    }
}

// --- SUBTITLE ENGINE ---
let currentSubtitles = [];
let subtitleEnabled = false;

function parseSubs(data) {
    const lines = data.replace(/\r/g, '').split('\n');
    let _subtitles = [];
    let idx = 0;

    const pattern = /(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

    const toSec = (h, m, s, ms) => {
        return (parseInt(h || "0") * 3600) + (parseInt(m) * 60) + parseInt(s) + (parseInt(ms) / 1000);
    };

    while (idx < lines.length) {
        let line = lines[idx].trim();
        if (line === '' || line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) {
            idx++;
            continue;
        }

        let match = pattern.exec(line);
        if (!match) {
            if (idx + 1 < lines.length) {
                match = pattern.exec(lines[idx + 1]);
                if (match) idx++;
            }
        }

        if (match) {
            let start = toSec(match[1], match[2], match[3], match[4]);
            let end = toSec(match[5], match[6], match[7], match[8]);
            let text = [];
            idx++;
            while (idx < lines.length && lines[idx].trim() !== '') {
                let t = lines[idx].trim();
                t = t.replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '');
                t = t.replace(/<v [^>]+>/g, '').replace(/<\/v>/g, '');
                t = t.replace(/<c[^>]*>/g, '').replace(/<\/c>/g, '');
                text.push(t);
                idx++;
            }
            _subtitles.push({ start, end, text: text.join('<br>') });
        } else {
            idx++;
        }
    }
    return _subtitles;
}

function updateSubtitle(time) {
    const textSpan = document.getElementById("subtitle-text");
    const overlay = document.getElementById("subtitle-overlay");
    if (!subtitleEnabled || currentSubtitles.length === 0) {
        overlay.style.display = "none";
        return;
    }

    const sub = currentSubtitles.find(s => time >= s.start && time <= s.end);
    if (sub) {
        textSpan.innerHTML = sub.text;
        overlay.style.display = "block";
    } else {
        overlay.style.display = "none";
    }
}

function toggleSubtitles() {
    subtitleEnabled = !subtitleEnabled;
    updateCCIconState(subtitleEnabled, 'both');

    // Save to DB
    if (currentActivePlayer === 'local' && window.currentPlayingIndex !== undefined) {
        const file = localFiles[window.currentPlayingIndex];
        if (file) {
            file.subtitle_enabled = subtitleEnabled;
            fetch(`/api/local/${window.currentPlayingIndex}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(file)
            }).catch(e => console.error("SRT Save State Error", e));
        }
    }

    // Force update overlay
    const vid = document.getElementById("html5-player");
    if (vid) updateSubtitle(vid.currentTime);
}

function updateLiveSubtitlePos(sliderVal) {
    const overlay = document.getElementById("subtitle-overlay");
    if (overlay) {
        overlay.style.top = (100 - parseInt(sliderVal, 10)) + "%";
    }
}

function toggleLiveSubtitles(checked) {
    subtitleEnabled = checked;
    updateCCIconState(checked, 'both');
    const vid = document.getElementById("html5-player");
    if (vid) updateSubtitle(vid.currentTime);

    // Keep memory sync for local active player
    if (currentActivePlayer === 'local' && window.currentPlayingIndex !== undefined) {
        const file = localFiles[window.currentPlayingIndex];
        if (file) {
            file.subtitle_enabled = checked;
            // Also save to DB so it persists
            fetch(`/api/local/${window.currentPlayingIndex}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(file)
            }).catch(e => console.error("SRT Save State Error", e));
        }
    }
}

async function loadSubtitles(index, file) {
    currentSubtitles = [];
    subtitleEnabled = file.subtitle_enabled === true;

    const overlay = document.getElementById("subtitle-overlay");
    overlay.style.display = "none";

    const subBtn = document.getElementById("btn-toggle-subs");
    if (subBtn) subBtn.style.display = "none";

    // Apply saved pos
    const posY = file.subtitle_pos_y || 80;
    overlay.style.top = posY + "%";

    try {
        // Fetch available lists first
        const listRes = await fetch(`/api/local/subs_list/${index}`);
        const listData = await listRes.json();

        window.currentAvailableSubs = [];
        if (listData && listData.status === "ok" && listData.subs.length > 0) {
            window.currentAvailableSubs = listData.subs;
        }

        // Update CC button behavior based on available tracks
        if (subBtn) {
            // Remove previous onclick to prevent stale bindings
            subBtn.onclick = null;
            if (window.currentAvailableSubs.length >= 1) {
                // Always open selector (gives access to "Aucun")
                subBtn.onclick = () => openSubtitleTrackSelection('player');
            }
        }

        let targetTrackUrl = `/api/local/subs/${index}`;
        if (file.subtitle_track && window.currentAvailableSubs.includes(file.subtitle_track)) {
            targetTrackUrl += `?track=${encodeURIComponent(file.subtitle_track)}`;
        } else if (window.currentAvailableSubs.length > 0) {
            targetTrackUrl += `?track=${encodeURIComponent(window.currentAvailableSubs[0])}`;
        }

        const res = await fetch(targetTrackUrl);
        const text = await res.text();
        if (text && text.trim().length > 0) {
            currentSubtitles = parseSubs(text);
            console.log("[DEBUG] Sous-titres chargés :", currentSubtitles.length, "blocs.");

            if (currentSubtitles.length > 0 && subBtn) {
                subBtn.style.display = "flex";
                updateCCIconState(subtitleEnabled, 'player');
            }
        }
    } catch (e) {
        console.error("Erreur chargement SRT/VTT:", e);
    }
}

function updateCCIconState(isEnabled, source = 'player') {
    if (source === 'player' || source === 'both') {
        const btnIcon = document.getElementById("icon-toggle-subs");
        if (btnIcon) {
            if (isEnabled) {
                btnIcon.classList.add("ph-fill");
                btnIcon.style.color = "var(--accent)";
            } else {
                btnIcon.classList.remove("ph-fill");
                btnIcon.style.color = "#eee";
            }
        }
    }
    if (source === 'local' || source === 'both') {
        const localIcon = document.getElementById("modal-cc-icon");
        if (localIcon) {
            if (isEnabled) {
                localIcon.classList.add("ph-fill");
                localIcon.style.color = "var(--accent)";
            } else {
                localIcon.classList.remove("ph-fill");
                localIcon.style.color = "#888";
            }
        }
    }
}

// Subtitle UI Dialog Logic
function openSubtitleTrackSelection(source) {
    if (!window.currentAvailableSubs || window.currentAvailableSubs.length === 0) return;

    const listDiv = document.getElementById("subtitle-tracks-list");
    listDiv.innerHTML = "";

    const currentSelected = (source === 'local') ? window.tempModalSelectedTrack : (localFiles[window.currentPlayingIndex]?.subtitle_track || "");

    const isNoneActive = (source === 'local')
        ? (!window.tempModalSubEnabled)
        : (!subtitleEnabled);

    // Add "Aucun" option
    const btnNone = document.createElement("button");
    btnNone.className = "btn-secondary";
    btnNone.style.width = "100%";
    btnNone.style.textAlign = "left";
    btnNone.style.padding = "8px";
    btnNone.innerText = "Aucun / Désactiver";

    if (isNoneActive) {
        btnNone.style.background = "var(--accent)";
        btnNone.style.color = "var(--bg-color)";
        btnNone.innerText = "✓ " + btnNone.innerText;
    }

    btnNone.onclick = () => {
        if (source === 'local') {
            window.tempModalSubEnabled = false;
            updateCCIconState(false, 'local');
            toggleLiveSubtitles(false);
        } else {
            toggleLiveSubtitles(false);
        }
        document.getElementById('modal-subtitle-tracks').close();
    };
    listDiv.appendChild(btnNone);

    window.currentAvailableSubs.forEach(sub => {
        const btn = document.createElement("button");
        btn.className = "btn-secondary";
        btn.style.width = "100%";
        btn.style.textAlign = "left";
        btn.style.padding = "8px";
        btn.innerText = sub.replace('.srt', '').replace('.vtt', '');

        if (!isNoneActive && (sub === currentSelected || (currentSelected === "" && sub === window.currentAvailableSubs[0]))) {
            btn.style.background = "var(--accent)";
            btn.style.color = "var(--bg-color)";
            btn.innerText = "✓ " + btn.innerText;
        }

        btn.onclick = () => {
            if (source === 'local') {
                window.tempModalSelectedTrack = sub;
                window.tempModalSubEnabled = true;
                updateCCIconState(true, 'local');
            } else {
                changeSubtitleTrack(sub);
            }
            document.getElementById('modal-subtitle-tracks').close();
        };
        listDiv.appendChild(btn);
    });

    document.getElementById("modal-subtitle-tracks").showModal();
}

async function changeSubtitleTrack(trackName) {
    if (currentActivePlayer !== 'local' || window.currentPlayingIndex === undefined) return;

    try {
        const res = await fetch(`/api/local/subs/${window.currentPlayingIndex}?track=${encodeURIComponent(trackName)}`);
        const text = await res.text();
        if (text && text.trim().length > 0) {
            currentSubtitles = parseSubs(text);
            console.log("[DEBUG] Piste de sous-titres changée :", currentSubtitles.length, "blocs.");

            // Ensure subtitles are enabled when a track is explicitly chosen
            if (!subtitleEnabled) {
                toggleLiveSubtitles(true);
            }

            // Force redraw immediately
            const vid = document.getElementById("html5-player");
            if (vid) updateSubtitle(vid.currentTime);

            // Save as preference dynamically
            const file = localFiles[window.currentPlayingIndex];
            if (file) {
                file.subtitle_track = trackName;
                file.subtitle_enabled = true; // Ensure it updates in memory too
                fetch(`/api/local/${window.currentPlayingIndex}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(file)
                }).catch(e => console.error("Update Track Error", e));
            }
        }
    } catch (e) {
        console.error("Erreur changement piste SRT:", e);
    }
}

// Drag logic
function setupSubtitleDrag() {
    const overlay = document.getElementById("subtitle-overlay");
    const container = document.getElementById("video-container");
    let isDragging = false;
    let startY, startTop;

    overlay.onmousedown = (e) => {
        isDragging = true;
        startY = e.clientY;
        startTop = overlay.offsetTop;
        document.body.style.cursor = "grabbing";
        e.preventDefault();
    };

    document.onmousemove = (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        let newTop = startTop + deltaY;

        const containerHeight = container.clientHeight;
        const overlayHeight = overlay.clientHeight;
        if (newTop < 0) newTop = 0;
        // Allow slightly more bottom room, but keep it constrained
        if (newTop > containerHeight - (overlayHeight || 30)) newTop = containerHeight - (overlayHeight || 30);

        const percent = (newTop / containerHeight) * 100;
        overlay.style.top = percent + "%";
    };

    document.onmouseup = async () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = "default";

            // Auto Save to current file if playing local
            if (currentActivePlayer === 'local' && window.currentPlayingIndex !== undefined) {
                const percent = Math.round((overlay.offsetTop / container.clientHeight) * 100);
                const file = localFiles[window.currentPlayingIndex];
                if (file) {
                    file.subtitle_pos_y = percent;
                    fetch(`/api/local/${window.currentPlayingIndex}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(file)
                    }).catch(e => console.error("SRT Save Pos Error", e));
                }
            }
        }
    };
}
// Init drag once
setTimeout(setupSubtitleDrag, 1000);


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

    // ASPECT RATIO & SUBTITLES LOGIC
    const artContainer = document.getElementById("local-art-container");
    const subSettings = document.getElementById("local-subtitle-settings");

    // Simple check for video extensions
    if (item.path.match(/\.(mp4|mkv|mov|avi|webm|m4v)$/i)) {
        artContainer.classList.add("video-mode");
        subSettings.style.display = "flex";
        subSettings.style.flexDirection = "column";
        window.tempModalSubEnabled = item.subtitle_enabled || false;
        updateCCIconState(window.tempModalSubEnabled, 'local');

        let posVal = item.subtitle_pos_y;
        if (posVal === undefined) posVal = 80;
        document.getElementById("local-sub-pos").value = 100 - posVal;
        // Update live preview if the edited video is currently playing
        if (currentActivePlayer === 'local' && window.currentPlayingIndex === index) {
            updateLiveSubtitlePos(100 - posVal);
        }

        // Fetch list to enable context-menu support
        fetch(`/api/local/subs_list/${index}`)
            .then(r => r.json())
            .then(data => {
                if (data.status === "ok" && data.subs.length > 0) {
                    window.currentAvailableSubs = data.subs;
                    // Pre-fill the temporary track choice for the settings modal
                    window.tempModalSelectedTrack = item.subtitle_track || "";
                } else {
                    window.currentAvailableSubs = [];
                    window.tempModalSelectedTrack = "";
                }
            })
            .catch(e => { console.error("Error fetching sub list", e); window.currentAvailableSubs = []; });

    } else {
        artContainer.classList.remove("video-mode");
        subSettings.style.display = "none";
        window.currentAvailableSubs = [];
        window.tempModalSelectedTrack = "";
    }

    document.getElementById("local-path-display").innerText = item.path;
    document.getElementById("local-title").value = item.title;
    document.getElementById("local-artist").value = item.artist || "";
    document.getElementById("local-album").value = item.album || "";
    document.getElementById("local-genre").value = item.genre || "";
    document.getElementById("local-category").value = item.category || "Général";
    document.getElementById("local-year").value = item.year || "";
    document.getElementById("local-target-profile").value = item.target_profile || "Auto";
    let volValLoc = (item.volume !== undefined) ? item.volume : 100;
    document.getElementById("local-volume").value = volValLoc;
    const lvp = document.getElementById("local-volume-percent"); if (lvp) lvp.innerText = volValLoc + "%";
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
        subtitle_enabled: window.tempModalSubEnabled,
        subtitle_pos_y: 100 - parseInt(document.getElementById("local-sub-pos").value, 10),
        subtitle_track: window.tempModalSelectedTrack || "",
        cover_data: currentCoverData, // Send base64 data if changed
        volume: parseInt(document.getElementById("local-volume").value, 10) || 100
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

    // CHECK CAPABILITIES
    checkSystemCapabilities();

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
let currentChapters = [];

function renderChapters(chapters) {
    currentChapters = chapters || [];

    // 1. RENDER LIST (Hidden by default as per user request)
    const listContainer = document.getElementById("chapter-container");
    const list = document.getElementById("chapter-list");

    if (currentChapters.length > 0) {
        listContainer.style.display = "none";
        list.innerHTML = "";
        currentChapters.forEach((chap, idx) => {
            const div = document.createElement("div");
            div.className = "chapter-item";
            div.id = `chapter-list-item-${idx}`;
            div.onclick = () => seekToChapter(chap.start_time);
            const fmt = (s) => new Date(s * 1000).toISOString().substr(14, 5);
            div.innerHTML = `<span>${chap.title}</span><span class="chapter-time">${fmt(chap.start_time)}</span>`;
            list.appendChild(div);
        });
    } else {
        listContainer.style.display = "none";
    }

    // 2. RENDER MARKERS ON VIDEO TIMELINE
    const markersContainer = document.getElementById("video-chapter-markers");
    if (markersContainer) {
        markersContainer.innerHTML = "";

        const v = document.getElementById("html5-player");
        if (v && currentChapters.length > 0) {
            const drawMarkers = () => {
                if (!v.duration || isNaN(v.duration)) return;
                markersContainer.innerHTML = "";
                currentChapters.forEach((chap) => {
                    if (chap.start_time <= 0) return;
                    const pct = (chap.start_time / v.duration) * 100;

                    const marker = document.createElement("div");
                    marker.className = "timeline-marker";
                    marker.style.left = pct + "%";
                    marker.setAttribute("data-title", chap.title);
                    marker.onclick = (e) => {
                        // Marker click logic if needed
                    };
                    markersContainer.appendChild(marker);
                });
            };

            if (isNaN(v.duration)) {
                // Wait for metadata
            } else {
                drawMarkers();
            }
        }
    }
}

function formatTimeCustom(s) {
    if (isNaN(s) || s === Infinity || s === null) return "00:00";
    const minutes = Math.floor(s / 60);
    const seconds = Math.floor(s % 60);
    return (minutes < 10 ? "0" + minutes : minutes) + ":" + (seconds < 10 ? "0" + seconds : seconds);
}

function updateTimelineUI(currentTime) {
    const v = document.getElementById("html5-player");
    const slider = document.getElementById("video-seek-slider");
    const fill = document.getElementById("video-progress-fill");

    // Time Labels
    const lblCur = document.getElementById("video-time-current");
    const lblTot = document.getElementById("video-time-total");

    // Only update Local Video/Audio Timeline if those are active
    if (currentActivePlayer !== 'local' && currentActivePlayer !== 'waveform') return;

    if (v && !isNaN(v.duration) && slider && fill) {
        let dur = v.duration;
        if (dur === 0 || isNaN(dur)) dur = 1;

        // Base value for slider (always absolute to video length)
        slider.value = (currentTime / dur) * 100;

        let pctLeft = 0;
        let pctWidth = 0;
        let displayCur = currentTime;
        let displayDur = dur;

        // Si boucle en cours de création ou active
        if (loopA !== null) {
            pctLeft = (loopA / dur) * 100;
            const curVisual = Math.max(loopA, currentTime);
            let endVisual = curVisual;

            if (loopB !== null) {
                // Boucle complète
                if (curVisual > loopB) endVisual = loopB;
                displayDur = loopB - loopA;
                displayCur = Math.max(0, currentTime - loopA);
            }
            pctWidth = ((endVisual - loopA) / dur) * 100;
        } else {
            // Lecture normale
            pctLeft = 0;
            pctWidth = (currentTime / dur) * 100;
        }

        // Clamp PCT
        pctLeft = Math.max(0, Math.min(100, pctLeft));
        pctWidth = Math.max(0, Math.min(100 - pctLeft, pctWidth));

        fill.style.left = pctLeft + "%";
        fill.style.width = pctWidth + "%";

        // Update Time Labels
        if (lblCur) lblCur.innerText = formatTimeCustom(displayCur);
        if (lblTot) lblTot.innerText = formatTimeCustom(displayDur);

        // Also update active chapter in background (list)
        updateActiveChapter(currentTime);
    }
}

function setupVideoTimeline() {
    const v = document.getElementById("html5-player");
    const slider = document.getElementById("video-seek-slider");
    const fill = document.getElementById("video-progress-fill");

    if (!v || !slider || !fill) return;

    // Time Update logic is now handled in playLocal and playTrack 
    // to avoid overwriting the ontimeupdate handler.
    // Slider movement is still handled here.

    // Input: Seek
    slider.oninput = () => {
        if (!v.duration) return;

        // The slider's value is ALWAYS 0-100% of the entire video duration natively!
        const time = (slider.value / 100) * v.duration;
        v.currentTime = time;

        // Let the updateTimelineUI handle visual representation reliably
        updateTimelineUI(time);
    };

    // Duration Change: Re-render markers if needed
    v.onloadedmetadata = () => {
        if (currentChapters.length > 0) renderChapters(currentChapters);
    };

    // --- NEW: Play/Pause Icon Toggle ---
    v.onplay = () => updatePlayPauseIcon('video', true);
    v.onpause = () => updatePlayPauseIcon('video', false);
}

function updatePlayPauseIcon(type, isPlaying) {
    const btnId = `btn-${type}-play-toggle`;
    const icon = document.getElementById(btnId);
    if (!icon) return;

    // Use replace to swap the specific icon class, preserving 'ph' and 'ph-fill'
    if (isPlaying) {
        icon.classList.replace('ph-play-circle', 'ph-pause-circle');
    } else {
        icon.classList.replace('ph-pause-circle', 'ph-play-circle');
    }
}

// Video Control Overrides for Chapters


function seekToChapter(time) {
    if (currentWebMode === "AUDIO" && wavesurfer) {
        const duration = wavesurfer.getDuration();
        if (duration > 0) {
            wavesurfer.seekTo(time / duration);
            wavesurfer.play();
        }
    } else if (currentWebMode === "VIDEO") {
        const v = document.getElementById("html5-player");
        if (v) {
            v.currentTime = time;
            v.play();
            updateTimelineUI(time);
        }
    }
}

function updateActiveChapter(currentTime) {
    if (!currentChapters || currentChapters.length === 0) return;

    let activeIdx = -1;
    for (let i = 0; i < currentChapters.length; i++) {
        if (currentTime >= currentChapters[i].start_time) {
            activeIdx = i;
        } else {
            break;
        }
    }

    // Update List UI
    const list = document.getElementById("chapter-list");
    if (list) {
        Array.from(list.children).forEach((child, idx) => {
            if (idx === activeIdx) {
                if (!child.classList.contains("active")) {
                    child.classList.add("active");
                    child.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            } else {
                child.classList.remove("active");
            }
        });
    }
}

// ==========================================
// A-B LOOP ENGINE
// ==========================================

function getCurrentPlayerTime() {
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && vid.style.display !== "none") return vid.currentTime;
        if (wavesurfer && document.getElementById("audio-player-container").style.display !== "none") return wavesurfer.getCurrentTime();
    } else if (currentActivePlayer === 'youtube' && player && typeof player.getCurrentTime === "function") {
        return player.getCurrentTime();
    }
    return 0;
}

function seekPlayerTo(time) {
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && vid.style.display !== "none") vid.currentTime = time;
        if (wavesurfer && document.getElementById("audio-player-container").style.display !== "none") wavesurfer.seekTo(time / wavesurfer.getDuration());
    } else if (currentActivePlayer === 'youtube' && player && typeof player.seekTo === "function") {
        player.seekTo(time, true);
    }
}

function setLoopA() {
    loopA = getCurrentPlayerTime();
    if (loopB !== null && loopA >= loopB) loopB = null; // Reset B if A is after B
    isLoopActive = (loopA !== null && loopB !== null);
    updateLoopUI();
}

function setLoopB() {
    const t = getCurrentPlayerTime();
    if (loopA !== null && t > loopA) {
        loopB = t;
        isLoopActive = true;
    } else {
        alert("Le point B doit être après le point A.");
    }
    updateLoopUI();
}

function clearLoop() {
    loopA = null;
    loopB = null;
    isLoopActive = false;
    updateLoopUI();

    // Resume play if it was paused (bug fix)
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && vid.style.display !== "none" && vid.paused) {
            vid.play().catch(e => console.log(e));
        }
        if (wavesurfer && document.getElementById("audio-player-container").style.display !== "none" && !wavesurfer.isPlaying()) {
            wavesurfer.play();
        }
    } else if (currentActivePlayer === 'youtube' && player && typeof player.playVideo === "function" && player.getPlayerState() !== 1) {
        player.playVideo();
    }
}

function updateLoopUI() {
    // Audio UI
    const btnA_a = document.getElementById("btn-loop-a-audio");
    const btnB_a = document.getElementById("btn-loop-b-audio");
    const btnClear_a = document.getElementById("btn-loop-clear-audio");
    const btnSave_a = document.getElementById("btn-loop-save-audio");

    // Video UI
    const btnA_v = document.getElementById("btn-loop-a-video");
    const btnB_v = document.getElementById("btn-loop-b-video");
    const btnClear_v = document.getElementById("btn-loop-clear-video");
    const btnSave_v = document.getElementById("btn-loop-save-video");

    const activeMode = isLoopActive;

    if (btnA_a) btnA_a.style.color = loopA !== null ? "var(--accent)" : "#fff";
    if (btnB_a) btnB_a.style.color = loopB !== null ? "var(--accent)" : "#555";
    if (btnClear_a) btnClear_a.style.display = (loopA !== null || loopB !== null) ? "inline-block" : "none";
    if (btnSave_a) btnSave_a.style.display = activeMode ? "inline-block" : "none";

    if (btnA_v) btnA_v.style.color = loopA !== null ? "var(--accent)" : "#fff";
    if (btnB_v) btnB_v.style.color = loopB !== null ? "var(--accent)" : "#555";
    if (btnClear_v) btnClear_v.style.display = (loopA !== null || loopB !== null) ? "inline-block" : "none";
    if (btnSave_v) btnSave_v.style.display = activeMode ? "inline-block" : "none";

    // Visual Timeline Markers for Local Video / Audio
    const markerA = document.getElementById("video-loop-marker-a");
    const markerB = document.getElementById("video-loop-marker-b");
    const area = document.getElementById("video-loop-area");

    let duration = 0;
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && vid.style.display !== "none") duration = vid.duration || 0;
    }

    if (duration > 0) {
        if (loopA !== null) {
            const pctA = (loopA / duration) * 100;
            if (markerA) { markerA.style.display = "block"; markerA.style.left = pctA + "%"; }
        } else {
            if (markerA) markerA.style.display = "none";
        }

        if (loopB !== null && loopA !== null) {
            const pctB = (loopB / duration) * 100;
            const pctA = (loopA / duration) * 100;
            if (markerB) { markerB.style.display = "block"; markerB.style.left = pctB + "%"; }
            if (area) {
                area.style.display = "block";
                area.style.left = pctA + "%";
                area.style.width = (pctB - pctA) + "%";
            }
        } else {
            if (markerB) markerB.style.display = "none";
            if (area) area.style.display = "none";
        }
    } else {
        // Fallback or Youtube without timeline tracking
        if (markerA) markerA.style.display = "none";
        if (markerB) markerB.style.display = "none";
        if (area) area.style.display = "none";
    }
}

function checkLoop(currentTime) {
    if (!isLoopActive || loopA === null || loopB === null) return;
    if (currentTime >= loopB) {
        seekPlayerTo(loopA);
    }
}

// Ensure high frequency check for Youtube loops
setInterval(() => {
    if (currentActivePlayer === 'youtube' && isLoopActive) {
        checkLoop(getCurrentPlayerTime());
    }
}, 50);

async function promptSaveLoop() {
    if (!isLoopActive || loopA === null || loopB === null) return;

    const name = prompt("Nom de la boucle :", "Ma Boucle");
    if (!name) return;

    const newLoop = {
        id: Date.now(),
        name: name,
        start: loopA,
        end: loopB
    };

    currentLoops.push(newLoop);
    renderLoopsUI();

    // Save to backend
    if (currentActivePlayer === 'youtube') {
        const track = currentTrackList.find(t => t.originalIndex === currentPlayingIndex);
        if (track) {
            track.loops = currentLoops;
            await fetch(`/api/setlist/${currentPlayingIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(track)
            });
        }
    } else {
        const item = currentLocalLibrary.find(i => i.originalIndex === currentPlayingIndex);
        if (item) {
            item.loops = currentLoops;
            await fetch(`/api/local/${currentPlayingIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
        }
    }
}

function renderLoopsUI() {
    const list = document.getElementById("loop-list");
    const container = document.getElementById("loop-container");
    if (!list || !container) return;

    list.innerHTML = "";
    if (!currentLoops || currentLoops.length === 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "flex";
    currentLoops.forEach(l => {
        const btn = document.createElement("button");
        btn.className = "control-btn";
        btn.style.cssText = "font-size: 0.85em; padding: 4px 10px; border-radius: 12px; background: #333; border: 1px solid #555; color: #fff; display:flex; align-items:center; gap:5px; cursor:pointer;";
        btn.innerHTML = `<i class="ph ph-repeat" style="color:var(--accent);"></i> ${l.name} <span style="color:#888; font-size:0.8em;">[${l.start.toFixed(1)}s - ${l.end.toFixed(1)}s]</span> <i class="ph ph-trash" style="color:#cf6679; margin-left:5px; padding:2px; border-radius:4px;" onmouseover="this.style.background='#555'" onmouseout="this.style.background='transparent'" onclick="event.stopPropagation(); deleteLoop(${l.id})"></i>`;

        btn.onclick = () => {
            loopA = l.start;
            loopB = l.end;
            isLoopActive = true;
            updateLoopUI();
            seekPlayerTo(loopA);

            // Auto Play when triggering a loop
            if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
                const vid = document.getElementById("html5-player");
                if (vid && vid.style.display !== "none") vid.play();
                if (wavesurfer && document.getElementById("audio-player-container").style.display !== "none") wavesurfer.play();
            } else if (currentActivePlayer === 'youtube' && player && typeof player.playVideo === "function") {
                player.playVideo();
            }
        };
        list.appendChild(btn);
    });
}

function deleteLoop(id) {
    if (!confirm("Supprimer cette boucle ?")) return;
    currentLoops = currentLoops.filter(l => l.id !== id);
    renderLoopsUI();

    // Save to backend
    if (currentActivePlayer === 'youtube') {
        const track = currentTrackList.find(t => t.originalIndex === currentPlayingIndex);
        if (track) {
            track.loops = currentLoops;
            fetch(`/api/setlist/${currentPlayingIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(track)
            });
        }
    } else {
        const item = currentLocalLibrary.find(i => i.originalIndex === currentPlayingIndex);
        if (item) {
            item.loops = currentLoops;
            fetch(`/api/local/${currentPlayingIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
        }
    }
}

function loadLoopsForTrack(trackOrItem) {
    clearLoop(); // Reset active loops when loading a new track
    currentLoops = trackOrItem.loops || [];
    renderLoopsUI();
}
