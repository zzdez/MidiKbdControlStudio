let currentMode = "WIN";
let websocket;
let currentProfile = null;
let currentActivePlayer = 'youtube';

// --- i18n (Internationalization) ---
let currentLang = "fr";
let translations = {};

async function loadTranslations(lang) {
    try {
        const res = await fetch(`/api/locales/${lang}`);
        if (res.ok) {
            translations = await res.json();
            currentLang = lang;
            applyTranslations();
        }
    } catch (e) { console.error("I18N Error", e); }
}

function t(keyPath, defaultText = null) {
    const keys = keyPath.split('.');
    let val = translations;
    for (const k of keys) {
        if (val && val[k]) val = val[k];
        else return defaultText || keyPath;
    }
    return val;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder]').forEach(el => {
        // Text Content
        const key = el.getAttribute('data-i18n');
        if (key) {
            const text = t(key);
            if (text !== key) {
                // If the element expects HTML translation (e.g. bold tags inside)
                if (el.hasAttribute('data-i18n-html')) {
                    el.innerHTML = text;
                } else if (!el.firstElementChild) {
                    el.innerText = text;
                } else {
                    // If it contains children, but we STILL want to translate, 
                    // we must only update the text nodes, leaving elements like <i> intact.
                    // This is a common pattern for <button><i class="..."></i> Text</button>
                    for (let node of el.childNodes) {
                        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== '') {
                            node.nodeValue = " " + text + " ";
                            break; // Translate the first text node found
                        }
                    }
                }
            }
        }

        // Tooltips (Title)
        const titleKey = el.getAttribute('data-i18n-title');
        if (titleKey) {
            const titleText = t(titleKey);
            if (titleText !== titleKey) el.title = titleText;
        }

        // Placeholders
        const placeholderKey = el.getAttribute('data-i18n-placeholder');
        if (placeholderKey) {
            const phText = t(placeholderKey);
            if (phText !== placeholderKey) el.placeholder = phText;
        }
    });
}

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
let isSequentialLoop = false; // Toggle between loop 1 or loop sequential
let currentLoops = []; // Array of saved loops for the active track
let activeSavedLoopId = null; // Track which loop is being edited/resized

// --- GLOBAL DEVICE STATUS ---
let currentDeviceName = "Aucun";
let currentConnectionMode = "MIDO";
let currentIsConnected = false;

// --- HELPERS ---
function formatTimeCustom(seconds) {
    if (isNaN(seconds) || seconds === null) return "00:00";
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function startDeviceStatusPolling() {
    setInterval(async () => {
        try {
            const res = await fetch("/api/status");
            if (res.ok) {
                const data = await res.json();
                currentDeviceName = data.device_name || t("web.none");
                currentConnectionMode = data.connection_mode || "MIDO";
                currentIsConnected = data.is_connected || false;

                const activeProfileName = data.active_profile_name || t("web.none");
                const profileLabel = document.getElementById("active-profile");
                if (profileLabel) {
                    profileLabel.innerText = t("web.profile_prefix") + activeProfileName;
                }

                // Update Header Device Status
                const headerStatus = document.getElementById("header-device-status");
                if (headerStatus) {
                    let displayMode = currentConnectionMode === "BLE" ? t("web.bt") : t("web.usb");
                    if (currentDeviceName === t("web.none") || !currentDeviceName) {
                        headerStatus.innerHTML = `○ ` + t("web.status_waiting");
                        headerStatus.style.color = "#888";
                    } else if (!currentIsConnected) {
                        headerStatus.innerHTML = `🔴 ${currentDeviceName} (${displayMode}) - ` + t("web.status_disconnected");
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
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;


let queuedVideoId = null;

function onPlayerReady() {
    console.log("Player Ready");
    if (queuedVideoId) {
        console.log("Playing queued video:", queuedVideoId);
        // Find track for current ID to check its per-track settings
        const track = currentTrackList.find(t => t.id === queuedVideoId);
        const isAutoplay = (track && track.autoplay !== undefined) ? track.autoplay : (currentSettings.autoplay || false);

        if (isAutoplay) {
            player.loadVideoById(queuedVideoId);
        } else {
            player.cueVideoById(queuedVideoId);
        }
        queuedVideoId = null;
    }
}

function onPlayerStateChange(event) {
    if (currentWebMode === 'GENERIC' || currentActivePlayer === 'youtube') {
        if (event.data === YT.PlayerState.ENDED) {
            if (window.currentAutoreplay === true) {
                player.playVideo();
            }
        } else if (event.data === YT.PlayerState.PLAYING) {
            updatePlayPauseIcon('video', true);
        } else if (event.data === YT.PlayerState.PAUSED) {
            updatePlayPauseIcon('video', false);
        }
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
            const name = currentProfile ? currentProfile.name : t("web.none");
            const profileLabel = document.getElementById("active-profile");
            if (profileLabel) {
                profileLabel.innerText = t("web.profile_prefix") + name;
            }
        } else if (msg.type === "dl_progress") {
            const bar = document.getElementById("dl-progress-bar");
            const status = document.getElementById("dl-status");
            if (bar && status) {
                bar.style.width = msg.percent + "%";
                status.innerText = msg.status === "processing" ? t("web.msg_dl_processing") : Math.round(msg.percent) + "%";
            }
        } else if (msg.type === "dl_complete") {
            // Check auto-close preference
            const autoClose = document.getElementById("dl-autoclose") && document.getElementById("dl-autoclose").checked;

            if (autoClose) {
                closeModal();
                alert(t("web.msg_dl_done"));
                // Refresh local view if visible
                loadLocalFiles();
            } else {
                document.getElementById("dl-status").innerText = t("web.msg_dl_success");
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
        setTimeout(connectVideoWebSocket, 2000);
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
    } else if (currentActivePlayer === 'multitrack' && window.multitrack) {
        window.multitrack.isPlaying() ? window.multitrack.pause() : window.multitrack.play();
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
    // Universal Logic: "Midi-Kbd Control Studio - [Profile Name]"
    if (forcedProfileName) {
        document.title = `Midi-Kbd Control Studio - ${forcedProfileName}`;
    } else {
        // Fallback for hardcoded modes if no profile name provided
        if (mode === "YOUTUBE") document.title = "Midi-Kbd Control Studio - YouTube";
        else if (mode === "AUDIO") document.title = "Midi-Kbd Control Studio - Audio";
        else if (mode === "VIDEO") document.title = "Midi-Kbd Control Studio - Video";
        else document.title = "Midi-Kbd Control Studio";
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
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:20px; color:gray;'>" + t("web.msg_no_result") + "</td></tr>";
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
                <button class="btn-action" onclick="openEditModal(${realIndex})" title="${t("web.btn_edit")}">✎</button>
                <button class="btn-action" onclick="deleteTrack(${realIndex})" style="color:#cf6679;" title="${t("web.btn_delete")}">×</button>
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
    if (!confirm(t("web.msg_confirm_block").replace("{value}", value).replace("{field}", field))) return;

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
            if (currentSettings.language && currentSettings.language !== currentLang) {
                await loadTranslations(currentSettings.language);
            } else if (Object.keys(translations).length === 0) {
                await loadTranslations(currentLang);
            }
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
        const langDropdown = document.getElementById("setting-language");
        if (langDropdown) langDropdown.value = currentSettings.language || "fr";

        document.getElementById("setting-youtube-key").value = currentSettings.YOUTUBE_API_KEY || "";

        // Music APIs
        const sClient = document.getElementById("setting-spotify-client-id");
        if (sClient) sClient.value = currentSettings.spotify_client_id || "";

        const sSecret = document.getElementById("setting-spotify-client-secret");
        if (sSecret) sSecret.value = currentSettings.spotify_client_secret || "";

        const getsongKey = document.getElementById("setting-getsong-api-key");
        if (getsongKey) getsongKey.value = currentSettings.getsong_api_key || "";

        const apCb = document.getElementById("setting-autoplay");
        if (apCb) apCb.checked = currentSettings.autoplay !== false; // Default to true

        const arCb = document.getElementById("setting-autoreplay");
        if (arCb) arCb.checked = currentSettings.autoreplay === true; // Default to false
        renderSettingsFolders();

        // Show Modal
        document.getElementById("settings-modal").showModal();
        switchSettingsTab('general'); // Reset to first tab
    }
}

async function changeLanguage() {
    const selector = document.getElementById("setting-language");
    if (!selector) return;
    const newLang = selector.value;

    // Save to settings
    if (currentSettings) currentSettings.language = newLang;
    await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: newLang })
    });

    // Dynamically apply
    await loadTranslations(newLang);
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
            renderSettingsFolders();
        }
    } catch (error) {
        console.error("Add Folder Error", error);
    }
}

/**
 * Move stems with drag and drop
 */
function moveStem(fromIndex, toIndex) {
    if (window.currentPlayingIndex === undefined || !localFiles[window.currentPlayingIndex]) return;
    const currentFile = localFiles[window.currentPlayingIndex];
    if (!currentFile || !currentFile.is_multitrack || !currentFile.stems) return;

    if (fromIndex === toIndex) return;

    // move element
    const stem = currentFile.stems.splice(fromIndex, 1)[0];
    currentFile.stems.splice(toIndex, 0, stem);

    if (window.multitrack) {
        window.multitrack.destroy();
        window.multitrack = null;
    }

    // Update the saved settings order instantly so the UI redraws correctly
    try {
        const key = getMultitrackStorageKey(currentFile);
        const saved = localStorage.getItem(key);
        if (saved) {
            const settings = JSON.parse(saved);
            if (settings.tracks && settings.tracks.length > Math.max(fromIndex, toIndex)) {
                const t = settings.tracks.splice(fromIndex, 1)[0];
                settings.tracks.splice(toIndex, 0, t);
                localStorage.setItem(key, JSON.stringify(settings));
            }
        }
    } catch (e) { }

    // UI reload
    playLocal(window.currentPlayingIndex);
}



async function saveSettings() {
    // Harvest Data
    currentSettings.YOUTUBE_API_KEY = document.getElementById("setting-youtube-key").value;

    // Music APIs
    const sClient = document.getElementById("setting-spotify-client-id");
    if (sClient) currentSettings.spotify_client_id = sClient.value;

    const sSecret = document.getElementById("setting-spotify-client-secret");
    if (sSecret) currentSettings.spotify_client_secret = sSecret.value;

    const getsongKey = document.getElementById("setting-getsong-api-key");
    if (getsongKey) currentSettings.getsong_api_key = getsongKey.value;

    const apCb = document.getElementById("setting-autoplay");
    if (apCb) currentSettings.autoplay = apCb.checked;

    const arCb = document.getElementById("setting-autoreplay");
    if (arCb) currentSettings.autoreplay = arCb.checked;

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
    document.getElementById("dl-status").innerText = t("web.status_ready");

    // Reset View: Show Search
    resetSearchMode();

    // Check API Key
    const searchInput = document.getElementById("yt-search-input");
    const searchBtn = document.getElementById("yt-search-btn");
    const noKeyMsg = document.getElementById("no-api-key-msg");

    if (!currentSettings || !currentSettings.YOUTUBE_API_KEY) {
        if (searchInput) searchInput.style.display = "none";
        if (searchBtn) searchBtn.style.display = "none";
        if (noKeyMsg) noKeyMsg.style.display = "block";
    } else {
        if (searchInput) searchInput.style.display = "inline-block";
        if (searchBtn) searchBtn.style.display = "inline-block";
        if (noKeyMsg) noKeyMsg.style.display = "none";
        if (searchInput) searchInput.focus();
    }
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
    document.getElementById("edit-bpm").value = track.bpm || "";
    document.getElementById("edit-key").value = track.key || "";
    document.getElementById("edit-media-key").value = track.media_key || "";
    document.getElementById("edit-original-pitch").value = track.original_pitch || "";
    document.getElementById("edit-target-pitch").value = track.target_pitch || "";

    syncPlaybackSettingsToModals(track);

    // Legacy support: if description exists but not youtube_description, assume it was generic description (or user note?)
    // Since we just migrated, we can put old description into user_notes if user_notes empty
    document.getElementById("youtube-desc-input").value = track.youtube_description || "";
    document.getElementById("user-notes-input").value = track.user_notes || track.description || "";

    // Thumbnail & Aspect Ratio
    const thumbContainer = document.getElementById("preview-thumbnail");
    thumbContainer.classList.remove("wide-art", "square-art");

    const btnDel = document.getElementById("btn-edit-delete-cover");
    if (btnDel) btnDel.style.display = "none";

    if (track.thumbnail) {
        thumbContainer.classList.add("wide-art");
        // Update only the image/content part, preserving the button if possible, or just re-inject
        thumbContainer.innerHTML = `<img src="${track.thumbnail}" style="width:100%; height:100%; object-fit:contain;">
                                    <div id="btn-edit-delete-cover" class="btn-delete-cover" style="display:flex;"
                                         onclick="event.stopPropagation(); removeEditCover();">×</div>`;
    } else {
        thumbContainer.classList.add("square-art");
        thumbContainer.innerHTML = `<span style="font-size:30px;">🎵</span>
                                    <div id="btn-edit-delete-cover" class="btn-delete-cover" style="display:none;"
                                         onclick="event.stopPropagation(); removeEditCover();">×</div>`;
    }

    // Reset Download UI
    document.getElementById("dl-options-container").style.display = "none";
    document.getElementById("dl-progress-bar").style.width = "0%";
    document.getElementById("dl-status").innerText = t("web.status_ready");

    // Hide Search Zone in Edit Mode (Save Space)
    document.getElementById("search-zone-container").classList.add("hidden");
    document.getElementById("btn-back-search").style.display = "block"; // Start with "Back" button visible to allow new search

    // Check if URL is valid for download
    checkDownloadAvailability(track.url);

    // SUBTITLES LOGIC for YouTube
    const subSettings = document.getElementById("edit-subtitle-settings");
    if (track.profile_name === "YouTube") {
        subSettings.style.display = "flex";
        subSettings.style.flexDirection = "column";
        window.tempModalSubEnabled = track.subtitle_enabled || false;
        updateCCIconState(window.tempModalSubEnabled, 'edit');

        let posVal = track.subtitle_pos_y;
        if (posVal === undefined) posVal = 80;
        const sVal = 100 - posVal;
        document.getElementById("edit-sub-pos").value = sVal;
        const esp = document.getElementById("edit-sub-pos-percent"); if (esp) esp.innerText = sVal + "%";
    } else {
        subSettings.style.display = "none";
    }
}

function closeModal() {
    document.getElementById("media-modal").close();
    editingIndex = null;
}

function openNotesDescModal() {
    const mainDesc = document.getElementById("youtube-desc-input");
    const mainNotes = document.getElementById("user-notes-input");
    const popCombined = document.getElementById("pop-combined-notes");

    let combined = "";
    const ytDesc = (mainDesc ? mainDesc.value : "").trim();
    const userNotes = (mainNotes ? mainNotes.value : "").trim();

    if (ytDesc) {
        combined += ytDesc + "\n\n--- DESCRIPTION YOUTUBE ---\n\n";
    }
    combined += userNotes;

    popCombined.value = combined;
    document.getElementById("modal-notes-desc").showModal();
}

function closeNotesDescModal() {
    const mainNotes = document.getElementById("user-notes-input");
    const popCombined = document.getElementById("pop-combined-notes");

    if (mainNotes && popCombined) {
        mainNotes.value = popCombined.value;
    }
    document.getElementById("modal-notes-desc").close();
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
                target_profile: document.title.replace("Midi-Kbd Control Studio - ", "")
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
        opt.innerText = t("web.msg_no_folder_config");
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
            o.innerText += " " + t("web.lbl_ffmpeg_required");
        }
        formatSelect.appendChild(o);
    };

    // Audio Options
    addOpt("audio_original", t("web.opt_audio_original"));
    addOpt("audio_mp3_320", "🎵 Audio MP3 320kbps", ffmpegAvailable);
    addOpt("audio_mp3_192", "🎵 Audio MP3 192kbps", ffmpegAvailable);

    // Video Options
    addOpt("video_auto", t("web.opt_video_auto"));
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

    if (!url) return alert(t("web.msg_url_required"));
    if (!folder || folder.innerText === t("web.msg_no_folder_config")) return alert(t("web.msg_no_folder_config"));

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
    document.getElementById("dl-status").innerText = t("web.status_starting");
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
    const category = document.getElementById("edit-category").value || t("web.default_category");
    const genre = document.getElementById("edit-genre").value || t("web.default_genre");

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
        alert(t("web.msg_url_required"));
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
        volume: volume,
        bpm: document.getElementById("edit-bpm").value,
        key: document.getElementById("edit-key").value,
        media_key: document.getElementById("edit-media-key").value,
        original_pitch: document.getElementById("edit-original-pitch").value,
        target_pitch: document.getElementById("edit-target-pitch").value,
        subtitle_enabled: window.tempModalSubEnabled || false,
        subtitle_pos_y: 100 - parseInt(document.getElementById("edit-sub-pos").value || 20, 10),
        autoplay: document.getElementById("edit-autoplay").checked,
        autoreplay: document.getElementById("edit-autoreplay").checked
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

    // 5. Multitrack
    if (window.multitrack) {
        try {
            window.multitrack.destroy();
            window.multitrack = null;
        } catch (e) { console.error(e); }
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
    window.currentPlayingIndex = track.originalIndex;
    const ytDiv = document.getElementById("player");
    const genFrame = document.getElementById("generic-player");
    loadLoopsForTrack(track);
    const html5 = document.getElementById("html5-player");

    // STOP ALL MEDIA first
    stopAllMedia();

    // Determine Autoplay/Autoreplay
    const isAutoplay = (track.autoplay !== undefined) ? track.autoplay : (currentSettings.autoplay || false);
    const isAutoreplay = (track.autoreplay !== undefined) ? track.autoreplay : (currentSettings.autoreplay || false);
    window.currentAutoreplay = isAutoreplay; // Global state for end-of-track logic
    updatePlaybackOptionsUI(isAutoreplay, isAutoplay);

    // Reset Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");
    videoContainer.style.display = "flex";
    audioContainer.style.display = "none";

    // Volume Default logic
    const trackVolume = (track.volume !== undefined) ? parseInt(track.volume, 10) : 100;
    const normalizedVolume = trackVolume / 100;

    // Apply Physical initialization (essential for video)
    if (html5) html5.volume = normalizedVolume;

    // Reset Volume Slider
    const audioVolSlider = document.getElementById("audio-volume");
    if (audioVolSlider) { audioVolSlider.value = normalizedVolume; const avp = document.getElementById("audio-volume-percent"); if (avp) avp.innerText = trackVolume + "%"; }
    const videoVolSlider = document.getElementById("video-volume");
    if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vvp = document.getElementById("video-volume-percent"); if (vvp) vvp.innerText = trackVolume + "%"; }

    // Explicitly sync all other modals at startup
    if (typeof syncVolumeToModals === 'function') syncVolumeToModals(trackVolume);

    // Reset all Players
    ytDiv.style.display = "none";
    genFrame.style.display = "none";
    html5.style.display = "none";
    const controlsContainer = document.getElementById("video-controls-container");
    if (controlsContainer) controlsContainer.style.display = "none";

    if (player && player.stopVideo) player.stopVideo();
    html5.pause(); html5.src = "";
    genFrame.src = "";

    // Clear and hide subtitles (streaming handles own CC natively)
    subtitleEnabled = false;
    currentSubtitles = [];
    if (typeof updateCCIconState === "function") updateCCIconState(false, 'both');
    const overlay = document.getElementById("subtitle-overlay");
    if (overlay) overlay.style.display = "none";
    const subBtn = document.getElementById("btn-toggle-subs");
    if (subBtn) subBtn.style.display = "none";

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

        // Display Custom Timeline for YouTube
        const timeline = document.getElementById("video-timeline-container");
        if (timeline) {
            timeline.style.display = "flex";
            // We attach a dynamic slider logic for youtube later relying on player.seekTo
            const slider = document.getElementById("video-seek-slider");
            if (slider) {
                slider.oninput = () => {
                    if (player && typeof player.getDuration === "function") {
                        const dur = player.getDuration();
                        if (dur > 0) {
                            const time = (slider.value / 100) * dur;
                            player.seekTo(time, true);
                            updateTimelineUI(time);
                        }
                    }
                };
            }
        }

        // Display video controls
        if (controlsContainer) controlsContainer.style.display = "flex";

        // Hide Pitch for YouTube (Not Supported)
        const vPitch = document.getElementById("video-pitch-control-inline");
        if (vPitch) vPitch.style.display = "none";

        if (player && (typeof player.loadVideoById === "function" || typeof player.cueVideoById === "function")) {
            if (!currentSettings || currentSettings.autoplay !== false) {
                player.loadVideoById(track.id);
            } else {
                player.cueVideoById(track.id);
            }
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

    // Force wavesurfer redraw for multitrack expansion
    console.log("[DEBUG MT] Theater Mode Toggled:", isTheaterMode);

    setTimeout(() => {
        // Dispatch window resize for any generic listeners
        window.dispatchEvent(new Event('resize'));

        if (window.multitrack && window.multitrack.rendering && window.multitrack.rendering.containers) {
            // wavesurfer-multitrack caches its initial clientWidth and never recalculates it.
            // We must manually grab the actual new width and force the inner DOM to scale.
            const mtContainer = document.getElementById('multitrack-waveforms');
            if (mtContainer) {
                const newWidth = mtContainer.clientWidth;
                const maxDuration = window.multitrack.maxDuration;

                if (newWidth > 0 && maxDuration > 0) {
                    const pxPerSec = newWidth / maxDuration;

                    // 1. Update the parent wrapper div width
                    const scrollDiv = mtContainer.firstElementChild;
                    if (scrollDiv) {
                        const wrapperDiv = scrollDiv.firstElementChild;
                        if (wrapperDiv) {
                            wrapperDiv.style.width = newWidth + 'px';
                        }
                    }

                    // 2. Scale each individual track container and its internal wavesurfer
                    window.multitrack.rendering.containers.forEach((container, idx) => {
                        const duration = window.multitrack.durations[idx];
                        const startPos = window.multitrack.tracks[idx].startPosition || 0;

                        if (container && duration) {
                            container.style.width = (duration * pxPerSec) + 'px';
                            container.style.transform = `translateX(${startPos * pxPerSec}px)`;
                        }

                        // Tell the underlying wavesurfer to draw at the new scale
                        if (window.multitrack.wavesurfers && window.multitrack.wavesurfers[idx]) {
                            window.multitrack.wavesurfers[idx].zoom(pxPerSec);
                        }
                    });

                    console.log("[DEBUG MT] Dynamically rescaled multitrack to width:", newWidth);
                }
            }
        }
    }, 150); // slight delay to let CSS flex layout settle
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
            if (e.shiftKey) command = 'media_loop_prev';
            else if (e.ctrlKey) command = 'media_chapter_prev';
            else command = 'media_rewind';
            break;
        case 'ArrowRight':
        case 'KeyL': // YouTube standard (+10s usually)
            if (e.shiftKey) command = 'media_loop_next';
            else if (e.ctrlKey) command = 'media_chapter_next';
            else command = 'media_forward';
            break;
        case 'MediaTrackPrevious':
            command = 'media_chapter_prev';
            break;
        case 'MediaTrackNext':
            command = 'media_chapter_next';
            break;
        case 'ArrowUp':
            if (e.shiftKey) command = 'media_pitch_up';
            else command = 'media_speed_up';
            break;
        case 'ArrowDown':
            if (e.shiftKey) command = 'media_pitch_down';
            else command = 'media_speed_down';
            break;
        case 'KeyR':
            command = 'media_loop_toggle';
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
                case 'media_loop_toggle': toggleLoopState(); break;
                case 'media_loop_prev': navigateLoop(-1); break;
                case 'media_loop_next': navigateLoop(1); break;
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

            case 'media_loop_toggle': toggleLoopState(); break;
            case 'media_loop_prev': navigateLoop(-1); break;
            case 'media_loop_next': navigateLoop(1); break;
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

            case 'media_loop_toggle': toggleLoopState(); break;
            case 'media_loop_prev': navigateLoop(-1); break;
            case 'media_loop_next': navigateLoop(1); break;
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
    if (targetProfile) {
        document.title = "Midi-Kbd Control Studio - " + targetProfile;
    } else {
        document.title = "Midi-Kbd Control Studio - Web Generic"; // Fallback
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
        wavesurfer.on('finish', () => {
            wavesurfer.pause();
            wavesurfer.seekTo(0);
        });
        wavesurfer.on('timeupdate', (currentTime) => {
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
                <button class="btn-action" onclick="${file.is_multitrack ? 'openMultitrackModal' : 'openEditLocalModal'}(${realIndex})">✎</button>
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

// --- MULTITRACK STATE PERSISTENCE ---
let currentCtxMenuTrackIndex = null;

function generateDarkerColor(hex) {
    if (!hex) return "#bb86fc";
    let c = hex.startsWith("#") ? hex.substring(1) : hex;
    if (c.length !== 6) return "#bb86fc";
    let rgb = parseInt(c, 16);
    let r = Math.max(0, Math.floor(((rgb >> 16) & 0xff) * 0.5));
    let g = Math.max(0, Math.floor(((rgb >> 8) & 0xff) * 0.5));
    let b = Math.max(0, Math.floor((rgb & 0xff) * 0.5));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

function initStemContextMenu() {
    let menu = document.getElementById("stem-context-menu");
    if (!menu) {
        menu = document.createElement("div");
        menu.id = "stem-context-menu";
        menu.innerHTML = `
            <div class="ctx-menu-item" id="ctx-mute"><i class="ph ph-speaker-slash"></i> <span>Mute</span></div>
            <div class="ctx-menu-item" id="ctx-solo"><i class="ph ph-headphones"></i> <span>Solo</span></div>
            <div class="ctx-menu-divider"></div>
            <div class="ctx-menu-item" id="ctx-hide"><i class="ph ph-eye"></i> <span>Masquer</span></div>
            <div class="ctx-menu-item" id="ctx-hide-mute"><i class="ph ph-eye-slash"></i> <span>Masquer & Mute</span></div>
            <div class="ctx-menu-divider"></div>
            <div class="ctx-color-picker-container">
                <span><i class="ph ph-palette"></i> <span id="ctx-lbl-color">Couleur</span></span>
                <input type="color" id="ctx-color" class="stem-color-input" value="#bb86fc">
            </div>
        `;
        document.body.appendChild(menu);

        // Update generic text labels safely
        setTimeout(() => {
            const lblMute = document.querySelector("#ctx-mute span");
            const lblHide = document.querySelector("#ctx-hide span");
            const lblHideMute = document.querySelector("#ctx-hide-mute span");
            const lblColor = document.getElementById("ctx-lbl-color");
            if(lblMute && t('web.hint_mute')) lblMute.innerText = t('web.hint_mute');
            if(lblHide && t('web.btn_hide')) lblHide.innerText = t('web.btn_hide');
            if(lblHideMute && t('web.btn_hide_mute')) lblHideMute.innerText = t('web.btn_hide_mute');
            if(lblColor && t('web.color')) lblColor.innerText = t('web.color');
        }, 100);

        document.addEventListener("click", (e) => {
            if (e.button !== 2 && !menu.contains(e.target)) {
                menu.classList.remove("active");
            }
        });

        menu.addEventListener("contextmenu", e => e.preventDefault());

        document.getElementById("ctx-mute").onclick = () => {
            document.getElementById(`mt-mute-${currentCtxMenuTrackIndex}`)?.click();
            menu.classList.remove("active");
        };
        document.getElementById("ctx-solo").onclick = () => {
            document.getElementById(`mt-solo-${currentCtxMenuTrackIndex}`)?.click();
            menu.classList.remove("active");
        };
        document.getElementById("ctx-hide").onclick = () => {
            document.getElementById(`mt-hide-${currentCtxMenuTrackIndex}`)?.click();
            menu.classList.remove("active");
        };
        document.getElementById("ctx-hide-mute").onclick = () => {
            document.getElementById(`mt-hide-mute-${currentCtxMenuTrackIndex}`)?.click();
            menu.classList.remove("active");
        };
        document.getElementById("ctx-color").onchange = (e) => {
            const index = currentCtxMenuTrackIndex;
            if (index === null || !window.multitrack) return;
            const ws = window.multitrack.wavesurfers[index];
            if (ws) {
                const bg = e.target.value;
                const fg = generateDarkerColor(bg);
                ws.setOptions({ waveColor: bg, progressColor: fg });
                const header = document.getElementById(`mt-header-${index}`);
                if (header) header.style.borderLeft = `4px solid ${bg}`;
                const file = localFiles[currentPlayingIndex];
                if (file) saveMultitrackSettings(file);
            }
        };
    }
}

function showStemContextMenu(e, i) {
    currentCtxMenuTrackIndex = i;
    const menu = document.getElementById("stem-context-menu");
    if (menu) {
        menu.style.left = e.pageX + "px";
        menu.style.top = e.pageY + "px";
        menu.classList.add("active");
        
        const mBtn = document.getElementById(`mt-mute-${i}`);
        const sBtn = document.getElementById(`mt-solo-${i}`);
        const hBtn = document.getElementById(`mt-hide-${i}`);
        const hmBtn = document.getElementById(`mt-hide-mute-${i}`);
        
        document.getElementById("ctx-mute").classList.toggle("active-state", mBtn ? mBtn.classList.contains("active") : false);
        document.getElementById("ctx-solo").classList.toggle("active-state", sBtn ? sBtn.classList.contains("active") : false);
        document.getElementById("ctx-hide").classList.toggle("active-state", hBtn ? hBtn.classList.contains("active") : false);
        document.getElementById("ctx-hide-mute").classList.toggle("active-state", hmBtn ? hmBtn.classList.contains("active") : false);
        
        const ws = window.multitrack && window.multitrack.wavesurfers ? window.multitrack.wavesurfers[i] : null;
        if (ws && ws.options.waveColor && ws.options.waveColor.startsWith("#")) {
            document.getElementById("ctx-color").value = ws.options.waveColor;
        } else {
            document.getElementById("ctx-color").value = "#bb86fc";
        }
    }
}

let mtSaveTimeout = null;
function getMultitrackStorageKey(file) {
    if (!file) return 'mt_settings_unknown';
    return 'mt_settings_' + (file.path || file.title);
}

function saveMultitrackSettings(file) {
    if (!window.multitrack || !file) return;

    const index = currentPlayingIndex;
    if (index === null) return;

    // Debounce to avoid flooding localStorage when sliding quickly or playing
    clearTimeout(mtSaveTimeout);
    mtSaveTimeout = setTimeout(() => {
        const settings = {
            masterVolume: document.getElementById("multitrack-master-volume") ? parseFloat(document.getElementById("multitrack-master-volume").value) : 1.0,
            autoplay: file.autoplay,
            autoreplay: file.autoreplay,
            tracks: []
        };

        file.stems.forEach((stem, i) => {
            const muteBtn = document.getElementById(`mt-mute-${i}`);
            const soloBtn = document.getElementById(`mt-solo-${i}`);
            const hideBtn = document.getElementById(`mt-hide-${i}`);
            const hideMuteBtn = document.getElementById(`mt-hide-mute-${i}`);
            const volSlider = document.getElementById(`mt-vol-${i}`);
            const panSlider = document.getElementById(`mt-pan-${i}`);

            const ws = window.multitrack ? window.multitrack.wavesurfers[i] : null;
            const currentColor = ws ? ws.options.waveColor : null;

            settings.tracks.push({
                path: stem.path,
                name: stem.name,
                mute: muteBtn ? muteBtn.classList.contains('active') : false,
                solo: soloBtn ? soloBtn.classList.contains('active') : false,
                hidden: hideBtn ? hideBtn.classList.contains('active') : false,
                hidden_mute: hideMuteBtn ? hideMuteBtn.classList.contains('active') : false,
                volume: volSlider ? parseFloat(volSlider.value) : 1.0,
                pan: panSlider ? parseFloat(panSlider.value) : 0.0,
                color: currentColor
            });
        });

        // Send to backend for persistent storage (Sidecar)
        fetch(`/api/local/multitrack_settings/${index}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings)
        }).catch(e => console.error("Save Settings API Error:", e));

        // Fallback/Legacy: Still save to localStorage for instant local responsiveness
        localStorage.setItem(getMultitrackStorageKey(file), JSON.stringify(settings));
    }, 500); // 500ms debounce
}

async function loadMultitrackSettings(file) {
    const index = currentPlayingIndex;
    if (index === null) return;

    try {
        // 1. Try Backend first
        const resp = await fetch(`/api/local/multitrack_settings/${index}`);
        let settings = null;
        if (resp.ok) {
            settings = await resp.json();
        }

        // 2. Fallback to LocalStorage if backend empty or API failed
        if (!settings || !settings.tracks) {
            settings = JSON.parse(localStorage.getItem(getMultitrackStorageKey(file)) || "{}");
        }

        if (settings && settings.tracks) {
            // Apply master volume, autoplay, autoreplay
            if (settings.masterVolume !== undefined) {
                const mst = document.getElementById("multitrack-master-volume");
                if (mst) {
                    mst.value = settings.masterVolume;
                    const mstPerc = document.getElementById("multitrack-master-volume-percent");
                    if (mstPerc) mstPerc.innerText = Math.round(settings.masterVolume * 100) + '%';
                }
            }

            if (settings.autoplay !== undefined) file.autoplay = settings.autoplay;
            if (settings.autoreplay !== undefined) file.autoreplay = settings.autoreplay;

            settings.tracks.forEach((trackData, i) => {
                const muteBtn = document.getElementById(`mt-mute-${i}`);
                const soloBtn = document.getElementById(`mt-solo-${i}`);
                const hideBtn = document.getElementById(`mt-hide-${i}`);
                const hideMuteBtn = document.getElementById(`mt-hide-mute-${i}`);
                const volSlider = document.getElementById(`mt-vol-${i}`);
                const panSlider = document.getElementById(`mt-pan-${i}`);
                const ws = window.multitrack.wavesurfers[i];

                if (muteBtn && trackData.mute) muteBtn.classList.add('active');
                if (soloBtn && trackData.solo) soloBtn.classList.add('active');
                if (hideBtn && trackData.hidden) hideBtn.classList.add('active');
                if (hideMuteBtn && trackData.hidden_mute) hideMuteBtn.classList.add('active');

                // Audio Logic handled by calculation loop below
                
                const isHidden = (trackData.hidden || trackData.hidden_mute);
                if (isHidden) {
                    const hdiv = document.getElementById(`mt-header-${i}`);
                    if (hdiv) hdiv.style.display = 'none';
                    if (ws) {
                        const wsContainer = ws.getWrapper().parentElement;
                        wsContainer.style.height = '0px';
                        wsContainer.style.overflow = 'hidden';
                        wsContainer.style.border = 'none';
                        wsContainer.style.margin = '0px';
                        wsContainer.style.padding = '0px';
                    }
                }

                if (volSlider && trackData.volume !== undefined) {
                    volSlider.value = trackData.volume;
                    const valSpan = document.getElementById(`mt-vol-val-${i}`);
                    if (valSpan) valSpan.innerText = Math.round(trackData.volume * 100) + "%";
                }
                if (panSlider && trackData.pan !== undefined) {
                    panSlider.value = trackData.pan;
                    if (ws && ws.media && ws.media._panner) {
                        ws.media._panner.pan.value = trackData.pan;
                    }
                    const panSpan = document.getElementById(`mt-pan-val-${i}`);
                    if (panSpan) panSpan.innerText = trackData.pan > 0 ? `R${Math.round(trackData.pan * 100)}` : (trackData.pan < 0 ? `L${Math.round(Math.abs(trackData.pan) * 100)}` : 'C');
                }

                if (trackData.color && ws) {
                    const bg = trackData.color;
                    const fg = generateDarkerColor(bg);
                    if (bg.startsWith('#')) {
                        ws.setOptions({ waveColor: bg, progressColor: fg });
                    }
                }
            });

            // Re-trigger the solo/mute logic map for volumes
            const anySolo = Array.from(document.querySelectorAll('.btn-solo')).some(b => b.classList.contains('active'));
            const mstVol = settings.masterVolume !== undefined ? settings.masterVolume : 1.0;

            file.stems.forEach((_, j) => {
                const mBtn = document.getElementById(`mt-mute-${j}`);
                const sBtn = document.getElementById(`mt-solo-${j}`);
                const hBtn = document.getElementById(`mt-hide-${j}`);
                const hmBtn = document.getElementById(`mt-hide-mute-${j}`);
                const vSlider = document.getElementById(`mt-vol-${j}`);
                const wss = window.multitrack.wavesurfers[j];

                const isMuted = mBtn ? mBtn.classList.contains('active') : false;
                const isSolo = sBtn ? sBtn.classList.contains('active') : false;
                const isHiddenMute = hmBtn ? hmBtn.classList.contains('active') : false;
                const baseVol = vSlider ? parseFloat(vSlider.value) : 1.0;

                let finalVol = baseVol * mstVol;

                if (isMuted || isHiddenMute) {
                    finalVol = 0;
                } else if (anySolo && !isSolo) {
                    finalVol = 0;
                }

                window.multitrack.setTrackVolume(j, finalVol);
                if (wss) {
                    wss.getWrapper().style.opacity = finalVol === 0 ? "0.3" : "1";
                }
            });

            // Update UI for hidden tracks list
            updateHiddenTracksList(file);
            
            // Force redraw of loaded state
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        }

    } catch (e) {
        console.error("Failed to parse saved multitrack settings:", e);
    }
}
async function playLocal(index) {
    const file = localFiles[index];
    if (!file) return;

    window.currentPlayingIndex = index; // Important : Stocker l'index actif pour TOUS les types de médias

    // Helper
    const getProfile = (item, def) => (item.target_profile && item.target_profile !== "Auto") ? item.target_profile : def;

    // Detect Type
    const isMultitrack = file.is_multitrack === true;
    const ext = file.path ? file.path.split('.').pop().toLowerCase() : '';
    const isAudio = !isMultitrack && ['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext);
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm']; // Explicit list from user request for log consistency
    const isVideo = !isMultitrack && videoExts.includes(ext); // Note: original code checked ['mp4', 'mkv', 'webm', 'avi', 'mov']

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
    if (audioVolSlider) { audioVolSlider.value = normalizedVolume; const ap = document.getElementById("audio-volume-percent"); if (ap) ap.innerText = trackVolume + "%"; }
    const videoVolSlider = document.getElementById("video-volume");
    if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vp = document.getElementById("video-volume-percent"); if (vp) vp.innerText = trackVolume + "%"; }

    // Explicitly sync all other modals at startup
    if (typeof syncVolumeToModals === 'function') syncVolumeToModals(trackVolume);

    // Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");

    // Load saved loops for this file
    loadLoopsForTrack(file);

    // Determine Autoplay/Autoreplay
    const isAutoplay = (file.autoplay !== undefined) ? file.autoplay : (currentSettings.autoplay || false);
    const isAutoreplay = (file.autoreplay !== undefined) ? file.autoreplay : (currentSettings.autoreplay || false);
    window.currentAutoreplay = isAutoreplay;
    updatePlaybackOptionsUI(isAutoreplay, isAutoplay);

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

    if (isMultitrack) {
        // Normalize stems to array of objects if they are strings
        if (file.stems && file.stems.length > 0 && typeof file.stems[0] === 'string') {
            file.stems = file.stems.map(s => ({ path: s, name: s.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "") }));
        }

        // Restore Stem Order from localStorage
        try {
            const saved = localStorage.getItem(getMultitrackStorageKey(file));
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.tracks && Array.isArray(settings.tracks) && settings.tracks.length === file.stems.length) {
                    const orderedStems = [];
                    const availableStems = [...file.stems];
                    settings.tracks.forEach(trackData => {
                        const matchIdx = availableStems.findIndex(s => s.path === trackData.path);
                        if (matchIdx !== -1) {
                            orderedStems.push(availableStems.splice(matchIdx, 1)[0]);
                        }
                    });
                    file.stems = orderedStems.concat(availableStems);
                }
            }
        } catch (e) { console.error("Order restore failed", e); }

        // --- MULTITRACK MODE ---
        const target = getProfile(file, "Web Audio Local");
        console.log("[DEBUG JS] Envoi demande setMode (MULTITRACK) avec profil :", target);
        setMode("AUDIO", target);

        videoContainer.style.display = "none";
        audioContainer.style.display = "none";
        document.getElementById("video-controls-container").style.display = "none";

        const multitrackContainer = document.getElementById("multitrack-container");
        if (multitrackContainer) multitrackContainer.style.display = "flex";

        document.getElementById("multitrack-title").innerText = file.title;

        if (wavesurfer) wavesurfer.pause();
        v.style.display = "none";

        const trackHeaders = document.getElementById("multitrack-headers");
        const trackWaveforms = document.getElementById("multitrack-waveforms");
        const loadingIndicator = document.getElementById("multitrack-loading");

        if (loadingIndicator) loadingIndicator.style.display = "block";
        if (trackWaveforms) trackWaveforms.innerHTML = "";

        initStemContextMenu();

        // Add hidden tracks container if not exists
        let hiddenContainer = document.getElementById("mt-hidden-tracks-container");
        if (!hiddenContainer) {
            hiddenContainer = document.createElement("div");
            hiddenContainer.id = "mt-hidden-tracks-container";
            hiddenContainer.style.cssText = "margin-top: 10px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;";
            document.getElementById("multitrack-header").appendChild(hiddenContainer);
        }
        hiddenContainer.innerHTML = "";
        // Inject track headers
        // Pre-determine colors outside logic block to use for border
        const defaultColors = ["#bb86fc", "#03dac6", "#cf6679", "#ffb86c", "#8be9fd", "#50fa7b", "#ff79c6", "#f1fa8c", "#bd93f9", "#ff5555"];
        const appliedColors = [];

        file.stems.forEach((stem, i) => {
            const savedSettingsStr = localStorage.getItem(getMultitrackStorageKey(file));
            let savedColor = null;
            if (savedSettingsStr) {
                 try {
                     const st = JSON.parse(savedSettingsStr);
                     if (st && st.tracks && st.tracks[i] && st.tracks[i].color) {
                         savedColor = st.tracks[i].color;
                     }
                 } catch(e) {}
            }
            const waveCol = savedColor || defaultColors[i % defaultColors.length];
            appliedColors.push(waveCol);

            const stemName = stem.name || stem.path.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "");
            const header = document.createElement('div');
            header.className = 'track-header';
            header.id = `mt-header-${i}`;
            header.style.borderLeft = `4px solid ${waveCol}`;
            header.innerHTML = `
                <div class="track-title-row" style="display:flex; align-items:center; justify-content:space-between; width:100%; margin-bottom: 2px;">
                    <span class="track-title" id="mt-title-${i}" title="Double-clic pour renommer">${stemName}</span>
                </div>
                <div class="track-controls" style="display:flex; gap:3px; align-items:center; margin-bottom:2px;">
                    <button class="btn-mute" id="mt-mute-${i}" style="flex: 0 0 24px;" title="${t('web.hint_mute')}">M</button>
                    <button class="btn-solo" id="mt-solo-${i}" style="flex: 0 0 24px;">S</button>
                    <button class="btn-stem-hide" id="mt-hide-${i}" style="flex: 0 0 24px;" title="${t('web.btn_hide')}"><i class="ph ph-eye"></i></button>
                    <button class="btn-stem-hide-mute" id="mt-hide-mute-${i}" style="flex: 0 0 24px;" title="${t('web.btn_hide_mute')}"><i class="ph ph-eye-slash"></i></button>
                    <button class="btn-stem-delete" id="mt-delete-${i}" style="flex: 0 0 24px;" title="${t('web.btn_delete_stem')}"><i class="ph ph-trash"></i></button>
                    <div style="flex:1"></div>
                    <i class="ph ph-hand-grabbing drag-handle" title="Déplacer" style="cursor: grab; font-size: 1.1em; color: #888;"></i>
                </div>
                <div class="track-slider-row" style="margin-top:4px; margin-bottom:4px; display:flex; align-items:center;">
                    <i class="ph ph-speaker-simple-high" style="color:var(--accent);"></i>
                    <input type="range" class="slider-vol" id="mt-vol-${i}" min="0" max="1" step="0.01" value="1" style="flex:1;">
                    <span id="mt-vol-val-${i}" style="font-size:0.7em; color:#bbb; min-width:30px; text-align:right;">100%</span>
                </div>
                <div class="track-slider-row" style="margin-top:4px; display:flex; align-items:center;">
                    <span class="pan-lbl" style="color:#03dac6;">L</span>
                    <input type="range" class="slider-pan" id="mt-pan-${i}" min="-1" max="1" step="0.1" value="0" style="flex:1;">
                    <span class="pan-lbl" style="color:#03dac6;">R</span>
                    <span id="mt-pan-val-${i}" style="font-size:0.7em; color:#03dac6; min-width:30px; text-align:right;">C</span>
                </div>
            `;
            trackHeaders.appendChild(header);

            header.oncontextmenu = (e) => {
                e.preventDefault();
                showStemContextMenu(e, i);
            };

            // Setup Drag and Drop
            const dragHandle = header.querySelector('.drag-handle');
            dragHandle.onmouseenter = () => header.draggable = true;
            dragHandle.onmouseleave = () => header.draggable = false;

            header.ondragstart = (e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", i.toString());
                header.style.opacity = "0.5";
            };
            header.ondragend = () => {
                header.style.opacity = "1";
                document.querySelectorAll('.track-header').forEach(h => h.style.borderBottom = '1px solid #333');
            };
            header.ondragover = (e) => {
                e.preventDefault(); // Necessary to allow dropping
                e.dataTransfer.dropEffect = "move";
                header.style.borderBottom = "2px solid var(--accent)";
            };
            header.ondragleave = () => {
                header.style.borderBottom = '1px solid #333';
            };
            header.ondrop = (e) => {
                e.preventDefault();
                header.style.borderBottom = '1px solid #333';
                const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
                if (!isNaN(fromIdx) && fromIdx !== i) {
                    moveStem(fromIdx, i);
                }
            };

            // Double click to rename
            const titleSpan = header.querySelector('.track-title');
            titleSpan.ondblclick = () => {
                const input = document.createElement('input');
                input.type = 'text';
                input.value = titleSpan.innerText;
                input.style.width = '100%';
                input.style.fontSize = 'inherit';
                input.style.background = '#333';
                input.style.color = '#fff';
                input.style.border = '1px solid var(--accent)';

                input.onblur = () => {
                    const newName = input.value.trim();
                    if (newName) {
                        file.stems[i].name = newName;
                        titleSpan.innerText = newName;
                    }
                    input.replaceWith(titleSpan);
                };

                input.onkeydown = (e) => {
                    if (e.key === 'Enter') input.blur();
                    if (e.key === 'Escape') {
                        input.value = titleSpan.innerText;
                        input.blur();
                    }
                };

                titleSpan.replaceWith(input);
                input.focus();
                input.select();
            };
        });
        const mtOptions = await Promise.all(file.stems.map(async (stem, i) => {
            const name = stem.name || stem.path.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "");

            // Fetch pre-calculated peaks AND the audio file entirely to RAM
            let peaksArray = undefined;
            let audioUrl = "/api/stream?path=" + encodeURIComponent(stem.path); // fallback
            let mediaElement = null;

            try {
                // Parallel fetch limits network bottleneck
                const [peaksRes, audioRes] = await Promise.all([
                    fetch(`/api/local/peaks/${index}/${i}`),
                    fetch("/api/stream?path=" + encodeURIComponent(stem.path))
                ]);

                if (peaksRes.ok) {
                    const data = await peaksRes.json();
                    if (data && data.length > 0) {
                        peaksArray = [new Float32Array(data)];
                    }
                }

                if (audioRes.ok) {
                    const blob = await audioRes.blob();
                    audioUrl = URL.createObjectURL(blob);

                    // Create explicit Audio media element forcing preload
                    mediaElement = new Audio();
                    mediaElement.src = audioUrl;
                    mediaElement.crossOrigin = "anonymous";
                    mediaElement.preload = "auto";

                    // Route to WebAudio for Panning
                    if (!window.mtAudioCtx) {
                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        window.mtAudioCtx = new AudioContext();
                    }

                    const source = window.mtAudioCtx.createMediaElementSource(mediaElement);
                    const panner = window.mtAudioCtx.createStereoPanner();
                    panner.pan.value = 0;
                    source.connect(panner);
                    panner.connect(window.mtAudioCtx.destination);

                    mediaElement._panner = panner;
                }
            } catch (e) {
                console.error("Multitrack fetch error:", e);
            }

            const waveCol = appliedColors[i];
            const progCol = generateDarkerColor(waveCol);

            return {
                id: i,
                url: audioUrl, // Fallback if media is strictly needed by plugins
                volume: 1,
                peaks: peaksArray,
                options: {
                    media: mediaElement, // Forces HTML5 but guarantees 0ms latency thanks to RAM blob
                    waveColor: waveCol,
                    progressColor: progCol,
                    height: 70,
                    barWidth: 2,
                    barGap: 1,
                    barRadius: 2
                }
            };
        }));

        window.multitrack = Multitrack.create(mtOptions, {
            container: trackWaveforms,
            rightButtonDrag: false,
            cursorWidth: 2,
            cursorColor: 'var(--accent)',
            trackBackground: '#2d2d2d',
            trackBorderColor: '#7C7C7C',
            timelineOptions: {
                height: 20,
                style: {
                    color: '#888',
                    fontSize: '10px'
                }
            }
        });

        window.multitrack.once('canplay', () => {
            if (loadingIndicator) loadingIndicator.style.display = "none";
            file.stems.forEach((_, i) => {
                const muteBtn = document.getElementById(`mt-mute-${i}`);
                const soloBtn = document.getElementById(`mt-solo-${i}`);
                const volSlider = document.getElementById(`mt-vol-${i}`);
                const panSlider = document.getElementById(`mt-pan-${i}`);
                const headerDiv = document.getElementById(`mt-header-${i}`);

                // Dynamic strict height alignment block
                const ws = window.multitrack.wavesurfers[i];
                if (ws && headerDiv) {
                    const wsContainer = ws.getWrapper().parentElement;
                    const h = wsContainer.offsetHeight;
                    if (h > 0) {
                        headerDiv.style.height = (h + 2) + "px";
                    } else {
                        headerDiv.style.height = "72px";
                    }

                    // Attach context menu to waveform
                    wsContainer.oncontextmenu = (e) => {
                        e.preventDefault();
                        showStemContextMenu(e, i);
                    };
                }

                if (!muteBtn || !soloBtn || !volSlider) return;

                const getMasterVol = () => {
                    const mst = document.getElementById("multitrack-master-volume");
                    return mst ? parseFloat(mst.value) : 1;
                };

                const updateTrackVol = (index) => {
                    const mBtn = document.getElementById(`mt-mute-${index}`);
                    const hmBtn = document.getElementById(`mt-hide-mute-${index}`);
                    const vSlider = document.getElementById(`mt-vol-${index}`);
                    const isMuted = mBtn.classList.contains('active');
                    const isHiddenMute = hmBtn && hmBtn.classList.contains('active');
                    const vol = (isMuted || isHiddenMute) ? 0 : (parseFloat(vSlider.value) * getMasterVol());
                    window.multitrack.setTrackVolume(index, vol);

                    // Visual feedback Opacity on waveform
                    const ws = window.multitrack.wavesurfers[index];
                    if (ws) {
                        ws.getWrapper().style.opacity = (isMuted || isHiddenMute) ? "0.3" : "1";
                    }
                };

                muteBtn.onclick = () => {
                    muteBtn.classList.toggle('active');
                    updateTrackVol(i);
                    saveMultitrackSettings(file);
                };

                soloBtn.onclick = () => {
                    soloBtn.classList.toggle('active');

                    const anySolo = Array.from(document.querySelectorAll('.btn-solo')).some(b => b.classList.contains('active'));

                    file.stems.forEach((_, j) => {
                        const sBtn = document.getElementById(`mt-solo-${j}`);
                        const wss = window.multitrack.wavesurfers[j];

                        if (anySolo) {
                            if (sBtn.classList.contains('active')) {
                                updateTrackVol(j);
                            } else {
                                window.multitrack.setTrackVolume(j, 0); // Force mute if not soloed
                                if (wss) wss.getWrapper().style.opacity = "0.3";
                            }
                        } else {
                            updateTrackVol(j); // Restore normal state
                        }
                    });
                    saveMultitrackSettings(file);
                };

                volSlider.oninput = (e) => {
                    const valSpan = document.getElementById(`mt-vol-val-${i}`);
                    if (valSpan) valSpan.innerText = Math.round(parseFloat(e.target.value) * 100) + '%';

                    // Unmute if changing volume
                    if (muteBtn.classList.contains('active')) {
                        muteBtn.classList.remove('active');
                    }
                    updateTrackVol(i);
                    saveMultitrackSettings(file);
                };

                if (panSlider) {
                    panSlider.oninput = (e) => {
                        const pan = parseFloat(e.target.value);
                        const ws = window.multitrack.wavesurfers[i];
                        if (ws && ws.media && ws.media._panner) {
                            ws.media._panner.pan.value = pan;
                        }

                        const panSpan = document.getElementById(`mt-pan-val-${i}`);
                        if (panSpan) {
                            if (pan === 0) panSpan.innerText = 'C';
                            else if (pan < 0) panSpan.innerText = 'L' + Math.round(Math.abs(pan) * 100);
                            else panSpan.innerText = 'R' + Math.round(pan * 100);
                        }

                        saveMultitrackSettings(file);
                    };
                }

                const hideBtn = document.getElementById(`mt-hide-${i}`);
                const hideMuteBtn = document.getElementById(`mt-hide-mute-${i}`);

                const applyHideState = (index) => {
                    const hBtn = document.getElementById(`mt-hide-${index}`);
                    const hmBtn = document.getElementById(`mt-hide-mute-${index}`);
                    const header = document.getElementById(`mt-header-${index}`);
                    const ws = window.multitrack.wavesurfers[index];
                    
                    const isVisual = hBtn.classList.contains('active');
                    const isFull = hmBtn.classList.contains('active');
                    const isHidden = isVisual || isFull;

                    if (header) {
                        header.style.display = isHidden ? 'none' : 'flex';
                    }
                    if (ws) {
                        const wsContainer = ws.getWrapper().parentElement;
                        if (isHidden) {
                            wsContainer.style.height = '0px';
                            wsContainer.style.overflow = 'hidden';
                            wsContainer.style.border = 'none';
                            wsContainer.style.margin = '0px';
                            wsContainer.style.padding = '0px';
                        } else {
                            wsContainer.style.height = '';
                            wsContainer.style.overflow = '';
                            wsContainer.style.border = '';
                            wsContainer.style.margin = '';
                            wsContainer.style.padding = '';
                        }
                    }
                    updateTrackVol(index);
                };

                if (hideBtn) {
                    hideBtn.onclick = () => {
                        hideBtn.classList.toggle('active');
                        // Exclusivity: if we hide visually, we turn off hide&mute if it was on
                        if (hideBtn.classList.contains('active')) hideMuteBtn.classList.remove('active');
                        applyHideState(i);
                        saveMultitrackSettings(file);
                        updateHiddenTracksList(file);
                    };
                }

                if (hideMuteBtn) {
                    hideMuteBtn.onclick = () => {
                        hideMuteBtn.classList.toggle('active');
                        if (hideMuteBtn.classList.contains('active')) hideBtn.classList.remove('active');
                        applyHideState(i);
                        saveMultitrackSettings(file);
                        updateHiddenTracksList(file);
                    };
                }

                const deleteBtn = document.getElementById(`mt-delete-${i}`);
                if (deleteBtn) {
                    deleteBtn.onclick = async () => {
                        if (confirm(t('web.msg_confirm_delete_stem'))) {
                            try {
                                const resp = await fetch(`/api/local/stem/${index}/${i}`, { method: 'DELETE' });
                                if (resp.ok) {
                                    // Reload library to update everything
                                    await loadLibrary(); 
                                    playLocal(index);
                                } else {
                                    alert("Erreur lors de la suppression");
                                }
                            } catch (e) {
                                console.error("Delete stem failed:", e);
                            }
                        }
                    };
                }
            });

            // Restore saved settings on load
            loadMultitrackSettings(file);
            updateHiddenTracksList(file);

            const isAutoplay = (file.autoplay !== undefined) ? file.autoplay : (currentSettings.autoplay || false);
            if (isAutoplay) {
                window.multitrack.play();
            }
            updatePlayPauseUI();
            setupMultitrackLoopSelection();
        });

        window.multitrack.on('play', () => {
            updatePlayPauseUI();
            saveMultitrackSettings(file);

            // Re-apply playback rate to all WebAudio instances upon playback
            // (WebAudio bufferNodes are recreated on play and default back to 1.0)
            const rateStr = document.getElementById("btn-multitrack-speed").innerText.replace("x", "");
            const rate = parseFloat(rateStr) || 1.0;
            if (window.multitrack.audios) {
                window.multitrack.audios.forEach(a => { if (a) a.playbackRate = rate; });
            }
        });
        window.multitrack.on('pause', () => {
            updatePlayPauseUI();
            saveMultitrackSettings(file); // Save exact stop time
        });

        // Removed mtInterval: loop monitoring handled by the global interval in app.js
        currentActivePlayer = 'multitrack';

    } else if (isAudio) {
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

        const vPitch = document.getElementById("video-pitch-control-inline");
        if (vPitch) vPitch.style.display = "none";

        const multitrackContainer = document.getElementById("multitrack-container");
        if (multitrackContainer) multitrackContainer.style.display = "none";

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

            const isAutoplay = (file.autoplay !== undefined) ? file.autoplay : (currentSettings.autoplay || false);
            const isAutoreplay = (file.autoreplay !== undefined) ? file.autoreplay : (currentSettings.autoreplay || false);
            window.currentAutoreplay = isAutoreplay;
            updateRepeatUI(isAutoreplay);

            wavesurfer.on('ready', () => {
                if (isAutoplay) {
                    wavesurfer.play();
                }
                if (isPitchEnabled) connectPitchEngine();
                updatePlayPauseUI();
            });

            wavesurfer.on('finish', () => {
                if (window.currentAutoreplay === true) {
                    wavesurfer.play();
                    updatePlayPauseUI();
                }
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
        const multitrackContainer = document.getElementById("multitrack-container");
        if (multitrackContainer) multitrackContainer.style.display = "none";

        // Show Custom Timeline
        const timeline = document.getElementById("video-timeline-container");
        if (timeline) {
            timeline.style.display = "flex";
            setupVideoTimeline();
        }

        const vPitch = document.getElementById("video-pitch-control-inline");
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
        v.volume = normalizedVolume; // Ensure it picks the right volume explicitly
        v.src = `/api/local/stream/${index}`;

        v.ontimeupdate = () => {
            updateActiveChapter(v.currentTime);
            updateSubtitle(v.currentTime); // Custom SRT Engine
        };

        // 2. Load Subtitles
        loadSubtitles(index, file);



        const startPlay = () => {
            const isAutoplay = (file.autoplay !== undefined) ? file.autoplay : (currentSettings.autoplay || false);
            if (isAutoplay) {
                v.play().catch(e => console.warn("Auto-play aborted", e));
            }
            v.removeEventListener('canplay', startPlay);
            if (isPitchEnabled) connectPitchEngine();
        };
        v.addEventListener('canplay', startPlay);

        v.onended = () => {
            v.pause();
            v.currentTime = 0;
            if (window.currentAutoreplay === true) {
                v.play();
            }
        };

        currentActivePlayer = 'local';
    }
}

// --- AUDIO CONTROLS (On Screen) ---
function audioControl(action) {
    if (currentActivePlayer === 'multitrack' && window.multitrack) {
        multitrackControl(action);
        return;
    }
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
    let vid = null;
    let ytTime = 0;
    const isYT = (currentActivePlayer === 'youtube');

    if (isYT) {
        if (!player) return;
        ytTime = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : 0;
    } else {
        vid = document.getElementById("html5-player");
        if (!vid) return;
    }

    switch (action) {
        case 'prev':
            if (isYT) {
                player.seekTo(ytTime - 5, true);
                updateTimelineUI(ytTime - 5);
            } else {
                vid.currentTime -= 5;
                updateTimelineUI(vid.currentTime);
            }
            break;

        case 'next':
            if (isYT) {
                player.seekTo(ytTime + 5, true);
                updateTimelineUI(ytTime + 5);
            } else {
                vid.currentTime += 5;
                updateTimelineUI(vid.currentTime);
            }
            break;

        case 'chapter_prev':
            if (currentChapters.length > 0) {
                let currentIdx = -1;
                const cTime = isYT ? ytTime : vid.currentTime;
                for (let i = 0; i < currentChapters.length; i++) {
                    if (cTime >= currentChapters[i].start_time) currentIdx = i;
                    else break;
                }

                if (currentIdx >= 0) {
                    const chapStart = currentChapters[currentIdx].start_time;
                    let targetTime = 0;
                    if (cTime - chapStart > 3) {
                        targetTime = chapStart;
                    } else if (currentIdx > 0) {
                        targetTime = currentChapters[currentIdx - 1].start_time;
                    }
                    if (isYT) player.seekTo(targetTime, true); else vid.currentTime = targetTime;
                    updateTimelineUI(targetTime);
                    return;
                }
            }
            // Fallback
            if (isYT) player.seekTo(0, true); else vid.currentTime = 0;
            updateTimelineUI(0);
            break;

        case 'chapter_next':
            if (currentChapters.length > 0) {
                let currentIdx = -1;
                const cTime = isYT ? ytTime : vid.currentTime;
                for (let i = 0; i < currentChapters.length; i++) {
                    if (cTime >= currentChapters[i].start_time) currentIdx = i;
                    else break;
                }

                let nextChap = currentChapters.find(c => c.start_time > cTime + 0.5);
                if (nextChap) {
                    if (isYT) player.seekTo(nextChap.start_time, true); else vid.currentTime = nextChap.start_time;
                    updateTimelineUI(nextChap.start_time);
                    return;
                }
            }
            break;

        case 'playpause':
            if (isYT) {
                if (player && typeof player.getPlayerState === "function") {
                    const state = player.getPlayerState();
                    if (state === 1) player.pauseVideo(); else player.playVideo();
                }
            } else {
                vid.paused ? vid.play() : vid.pause();
            }
            break;

        case 'restart':
            if (isYT) {
                if (player && typeof player.seekTo === "function") player.seekTo(0, true);
            } else {
                vid.currentTime = 0;
            }
            updateTimelineUI(0);
            break;

        case 'speed_up':
            if (isYT) {
                if (player && typeof player.getPlaybackRate === "function") {
                    let rateU = player.getPlaybackRate();
                    rateU = Math.min(rateU + 0.05, 2.0);
                    player.setPlaybackRate(rateU);
                    document.getElementById("btn-video-speed").innerText = rateU.toFixed(2) + "x";
                }
            } else {
                let rateU = vid.playbackRate;
                rateU = Math.min(rateU + 0.05, 2.0);
                vid.playbackRate = rateU;
                document.getElementById("btn-video-speed").innerText = rateU.toFixed(2) + "x";
            }
            break;

        case 'speed_down':
            if (isYT) {
                if (player && typeof player.getPlaybackRate === "function") {
                    let rateD = player.getPlaybackRate();
                    rateD = Math.max(rateD - 0.05, 0.25);
                    player.setPlaybackRate(rateD);
                    document.getElementById("btn-video-speed").innerText = rateD.toFixed(2) + "x";
                }
            } else {
                let rateD = vid.playbackRate;
                rateD = Math.max(rateD - 0.05, 0.5);
                vid.playbackRate = rateD;
                document.getElementById("btn-video-speed").innerText = rateD.toFixed(2) + "x";
            }
            break;
    }
}

// --- MULTITRACK CONTROLS (On Screen) ---
function multitrackControl(action) {
    if (!window.multitrack) return;

    switch (action) {
        case 'prev':
            window.multitrack.setTime(Math.max(0, window.multitrack.getCurrentTime() - 5));
            break;
        case 'next':
            window.multitrack.setTime(window.multitrack.getCurrentTime() + 5);
            break;
        case 'playpause':
            if (window.multitrack.isPlaying()) {
                window.multitrack.pause();
            } else {
                window.multitrack.play();
            }
            updatePlayPauseUI();
            break;
        case 'restart':
            window.multitrack.setTime(0);
            updatePlayPauseUI();
            break;
        case 'speed_up':
            {
                const wasPlaying = window.multitrack.isPlaying();
                const currentTime = window.multitrack.getCurrentTime();
                if (wasPlaying) window.multitrack.pause();

                let rate = window.multitrack.wavesurfers[0]?.getPlaybackRate() || 1.0;
                rate = Math.min(rate + 0.05, 2.0);
                rate = Math.round(rate * 100) / 100;

                window.multitrack.wavesurfers.forEach(ws => ws.setPlaybackRate(rate));
                if (window.multitrack.audios) {
                    window.multitrack.audios.forEach(a => { if (a) a.playbackRate = rate; });
                }

                document.getElementById("btn-multitrack-speed").innerText = rate + "x";

                // Force a total resynchronization of multitrack internals to the new speed
                window.multitrack.setTime(currentTime);

                if (wasPlaying) window.multitrack.play();
                updatePlayPauseUI();
            }
            break;
        case 'speed_down':
            {
                const wasPlaying = window.multitrack.isPlaying();
                const currentTime = window.multitrack.getCurrentTime();
                if (wasPlaying) window.multitrack.pause();

                let rate = window.multitrack.wavesurfers[0]?.getPlaybackRate() || 1.0;
                rate = Math.max(rate - 0.05, 0.5);
                rate = Math.round(rate * 100) / 100;

                window.multitrack.wavesurfers.forEach(ws => ws.setPlaybackRate(rate));
                if (window.multitrack.audios) {
                    window.multitrack.audios.forEach(a => { if (a) a.playbackRate = rate; });
                }

                document.getElementById("btn-multitrack-speed").innerText = rate + "x";

                // Force a total resynchronization of multitrack internals to the new speed
                window.multitrack.setTime(currentTime);

                if (wasPlaying) window.multitrack.play();
                updatePlayPauseUI();
            }
            break;
    }
}

function updatePlayPauseUI() {
    if (window.multitrack) {
        updatePlayPauseIcon('multitrack', window.multitrack.isPlaying());
    }
}

function updateMultitrackMasterVolume(val) {
    if (!window.multitrack) return;
    const master = parseFloat(val);

    const mstPerc = document.getElementById("multitrack-master-volume-percent");
    if (mstPerc) mstPerc.innerText = Math.round(master * 100) + '%';

    const anySolo = Array.from(document.querySelectorAll('.btn-solo')).some(b => b.classList.contains('active'));

    // We assume the number of tracks corresponds to the DOM elements created
    const trackHeaders = document.querySelectorAll('.track-header');

    trackHeaders.forEach((th, i) => {
        const muteBtn = document.getElementById(`mt-mute-${i}`);
        const soloBtn = document.getElementById(`mt-solo-${i}`);
        const volSlider = document.getElementById(`mt-vol-${i}`);

        if (muteBtn && soloBtn && volSlider) {
            let shouldPlay = !muteBtn.classList.contains('active');
            if (anySolo && !soloBtn.classList.contains('active')) {
                shouldPlay = false;
            }
            if (shouldPlay) {
                window.multitrack.setTrackVolume(i, parseFloat(volSlider.value) * master);
            }
        }
    });

    // Save master volume to the currently playing stem settings
    if (window.currentPlayingIndex !== undefined && localFiles[window.currentPlayingIndex]) {
        saveMultitrackSettings(localFiles[window.currentPlayingIndex]);
    }
}

// --- VOLUME LOGIC (Live Persistence) ---
function updateAudioVolume(val) {
    const numVal = parseFloat(val);
    const percentVol = Math.round(numVal * 100);

    // Apply physically
    if (wavesurfer && currentActivePlayer === 'waveform') {
        wavesurfer.setVolume(numVal);
    }

    // Save Persistently
    if (currentActivePlayer === 'waveform' && window.currentPlayingIndex !== undefined) {
        const file = localFiles[window.currentPlayingIndex];
        if (file) {
            file.volume = percentVol; // Mettre à jour la RAM pour que la modale lise la bonne valeur
            fetch(`/api/local/${window.currentPlayingIndex}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(file)
            }).catch(e => console.error("Volume Save Error (Audio)", e));
        }
    }
}

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
            file.volume = percentVol; // Mettre à jour la RAM pour que la modale lise la bonne valeur
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
                    track.volume = percentVol; // Mettre à jour la RAM pour que la modale lise la bonne valeur
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
        if (vid && currentActivePlayer === 'local') vid.volume = normalizedVolume;
        if (wavesurfer && currentActivePlayer === 'waveform' && document.getElementById("audio-player-container").style.display !== "none") {
            wavesurfer.setVolume(normalizedVolume);
        }

        // Sync the main player UI slider too
        const audioVolSlider = document.getElementById("audio-volume");
        if (audioVolSlider) { audioVolSlider.value = normalizedVolume; const ap = document.getElementById("audio-volume-percent"); if (ap) ap.innerText = percentVol + "%"; }
        const videoVolSlider = document.getElementById("video-volume");
        if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vp = document.getElementById("video-volume-percent"); if (vp) vp.innerText = percentVol + "%"; }

        // Also trigger persistent save since we are manipulating the slider
        if (currentActivePlayer === 'waveform') updateAudioVolume(normalizedVolume);
        if (currentActivePlayer === 'local') updateVideoVolume(normalizedVolume);

    } else if (type === 'edit' && editingIndex !== null && currentActivePlayer === 'youtube') {
        const track = currentTrackList.find(t => t.originalIndex === editingIndex);
        if (track && player && typeof player.getVideoData === "function") {
            const vidData = player.getVideoData();
            if (vidData && vidData.video_id === track.id) {
                player.setVolume(percentVol);

                // Sync the main player UI slider too
                const videoVolSlider = document.getElementById("video-volume");
                if (videoVolSlider) { videoVolSlider.value = normalizedVolume; const vp2 = document.getElementById("video-volume-percent"); if (vp2) vp2.innerText = percentVol + "%"; }

                // Trigger persistent save for youtube
                updateVideoVolume(normalizedVolume);
            }
        }
    }
}

function syncVolumeToModals(percentVol) {
    const s1 = document.getElementById("local-volume");
    if (s1) { s1.value = percentVol; const p1 = document.getElementById("local-volume-percent"); if (p1) p1.innerText = percentVol + "%"; }

    const s2 = document.getElementById("edit-volume");
    if (s2) { s2.value = percentVol; const p2 = document.getElementById("edit-volume-percent"); if (p2) p2.innerText = percentVol + "%"; }
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
        const percent = (100 - parseInt(sliderVal, 10));
        overlay.style.top = percent + "%";
        localStorage.setItem('lastSubtitlePosY', percent); // Save as global default
    }
    // Update labels in modals
    const lp = document.getElementById("local-sub-pos-percent"); if (lp) lp.innerText = sliderVal + "%";
    const ep = document.getElementById("edit-sub-pos-percent"); if (ep) ep.innerText = sliderVal + "%";
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

    // Apply saved pos - fallback to global last pos if no specific file pos set
    let posY = file.subtitle_pos_y;
    if (posY === undefined || posY === null) {
        posY = localStorage.getItem('lastSubtitlePosY');
        if (posY !== null) posY = parseInt(posY, 10);
        else posY = 80;
    }
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
    btnNone.innerText = t("web.btn_none_disable");

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

            const percent = Math.round((overlay.offsetTop / container.clientHeight) * 100);

            // Save globally for next viewing of new files
            localStorage.setItem('lastSubtitlePosY', percent);

            // Auto Save to current file if playing local
            if (currentActivePlayer === 'local' && window.currentPlayingIndex !== undefined) {
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

async function addLocalMultitrack() {
    const res = await fetch("/api/local/add_multitrack_folder", { method: "POST" });
    const data = await res.json();

    if (data.status === "ok") {
        loadLocalFiles();
    } else if (data.status === "import_needed") {
        openImportModal(data);
    } else if (data.status === "exists") {
        alert("Ce dossier est déjà dans la bibliothèque.");
    } else if (data.status === "error") {
        alert("Erreur: " + data.message);
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

    // Reset classes
    artContainer.classList.remove("wide-art", "square-art");

    // Simple check for video extensions
    if (item.path.match(/\.(mp4|mkv|mov|avi|webm|m4v)$/i)) {
        artContainer.classList.add("wide-art");
        subSettings.style.display = "flex";
        subSettings.style.flexDirection = "column";
        window.tempModalSubEnabled = item.subtitle_enabled || false;
        updateCCIconState(window.tempModalSubEnabled, 'local');

        let posVal = item.subtitle_pos_y;
        if (posVal === undefined) posVal = 80;
        const sVal = 100 - posVal;
        document.getElementById("local-sub-pos").value = sVal;
        const lsp = document.getElementById("local-sub-pos-percent"); if (lsp) lsp.innerText = sVal + "%";

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
        artContainer.classList.add("square-art");
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
    document.getElementById("local-bpm").value = item.bpm || "";
    document.getElementById("local-key").value = item.key || "";
    document.getElementById("local-media-key").value = item.media_key || "";
    document.getElementById("local-original-pitch").value = item.original_pitch || "";
    document.getElementById("local-target-pitch").value = item.target_pitch || "";
    document.getElementById("local-target-profile").value = item.target_profile || "Auto";
    let volValLoc = (item.volume !== undefined) ? item.volume : 100;
    document.getElementById("local-volume").value = volValLoc;
    const lvp = document.getElementById("local-volume-percent"); if (lvp) lvp.innerText = volValLoc + "%";
    document.getElementById("local-notes").value = item.user_notes || "";

    syncPlaybackSettingsToModals(item);

    // Load Art
    currentCoverData = null;
    document.getElementById("cover-upload").value = "";

    const img = document.getElementById("local-art-img");
    const placeholder = document.getElementById("local-art-placeholder");

    const btnDel = document.getElementById("btn-delete-cover");
    if (btnDel) btnDel.style.display = "none";

    img.onload = () => {
        img.style.display = "block";
        placeholder.style.display = "none";
        if (btnDel) btnDel.style.display = "flex";
    };
    img.onerror = () => {
        img.style.display = "none";
        placeholder.style.display = "flex";
        if (btnDel) btnDel.style.display = "none";
    };

    img.src = `/api/local/art/${index}?t=${Date.now()}`;
}

function closeLocalModal() {
    document.getElementById("modal-local").close();
    editingLocalIndex = null;
}

// --- MULTITRACK MODAL LOGIC ---
function openMultitrackModal(index) {
    editingLocalIndex = index;
    const item = localFiles[index];
    document.getElementById("modal-multitrack").showModal();

    // ASPECT RATIO
    const artContainer = document.getElementById("mt-art-container");
    artContainer.classList.remove("wide-art", "square-art");
    artContainer.classList.add("square-art"); // Multitrack is audio-based (1:1)

    document.getElementById("mt-path-display").innerText = item.path;
    document.getElementById("mt-title").value = item.title;
    document.getElementById("mt-artist").value = item.artist || "";
    document.getElementById("mt-album").value = item.album || "";
    document.getElementById("mt-genre").value = item.genre || "";
    document.getElementById("mt-category").value = item.category || t("web.default_mt_category", "Multipiste");
    document.getElementById("mt-year").value = item.year || "";
    document.getElementById("mt-bpm").value = item.bpm || "";
    document.getElementById("mt-key").value = item.key || "";
    document.getElementById("mt-media-key").value = item.media_key || "";
    document.getElementById("mt-original-pitch").value = item.original_pitch || "";
    document.getElementById("mt-target-pitch").value = item.target_pitch || "";
    document.getElementById("mt-target-profile").value = item.target_profile || "Auto";

    let volVal = (item.volume !== undefined) ? item.volume : 100;
    document.getElementById("mt-modal-volume").value = volVal;
    const mvp = document.getElementById("mt-modal-volume-percent");
    if (mvp) mvp.innerText = volVal + "%";

    document.getElementById("mt-notes").value = item.user_notes || "";

    document.getElementById("mt-autoplay").checked = !!item.autoplay;
    document.getElementById("mt-autoreplay").checked = !!item.autoreplay;

    // Load Art
    currentCoverData = null;
    document.getElementById("mt-cover-upload").value = "";
    const img = document.getElementById("mt-art-img");
    const placeholder = document.getElementById("mt-art-placeholder");
    const btnDel = document.getElementById("btn-mt-delete-cover");

    if (img) img.style.display = "none";
    if (placeholder) placeholder.style.display = "flex";
    if (btnDel) btnDel.style.display = "none";

    img.onload = () => {
        img.style.display = "block";
        placeholder.style.display = "none";
        if (btnDel) btnDel.style.display = "flex";
    };
    img.src = `/api/local/art/${index}?t=${Date.now()}`;
}

function closeMultitrackModal() {
    document.getElementById("modal-multitrack").close();
    editingLocalIndex = null;
}

async function saveMultitrackItem() {
    if (editingLocalIndex === null) return;

    const payload = {
        title: document.getElementById("mt-title").value,
        artist: document.getElementById("mt-artist").value,
        album: document.getElementById("mt-album").value,
        genre: document.getElementById("mt-genre").value,
        category: document.getElementById("mt-category").value || "Multipiste",
        year: document.getElementById("mt-year").value,
        bpm: document.getElementById("mt-bpm").value,
        key: document.getElementById("mt-key").value,
        media_key: document.getElementById("mt-media-key").value,
        original_pitch: document.getElementById("mt-original-pitch").value,
        target_pitch: document.getElementById("mt-target-pitch").value,
        target_profile: document.getElementById("mt-target-profile").value,
        user_notes: document.getElementById("mt-notes").value,
        cover_data: currentCoverData,
        volume: parseInt(document.getElementById("mt-modal-volume").value, 10) || 100,
        autoplay: document.getElementById("mt-autoplay").checked,
        autoreplay: document.getElementById("mt-autoreplay").checked
    };

    const res = await fetch(`/api/local/${editingLocalIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (res.ok) {
        closeMultitrackModal();
        loadLocalFiles();
    }
}

function handleMultitrackCover(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            currentCoverData = e.target.result;
            const img = document.getElementById("mt-art-img");
            img.src = currentCoverData;
            img.style.display = "block";
            document.getElementById("mt-art-placeholder").style.display = "none";
            document.getElementById("btn-mt-delete-cover").style.display = "flex";
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function removeMultitrackCover() {
    currentCoverData = "DELETE";
    const img = document.getElementById("mt-art-img");
    img.src = "";
    img.style.display = "none";
    document.getElementById("mt-art-placeholder").style.display = "flex";
    document.getElementById("btn-mt-delete-cover").style.display = "none";
}

async function autoTagMultitrack() {
    openUniversalTagModal('mt');
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
        bpm: document.getElementById("local-bpm").value,
        key: document.getElementById("local-key").value,
        media_key: document.getElementById("local-media-key").value,
        original_pitch: document.getElementById("local-original-pitch").value,
        target_pitch: document.getElementById("local-target-pitch").value,
        target_profile: document.getElementById("local-target-profile").value,
        user_notes: document.getElementById("local-notes").value,
        subtitle_enabled: window.tempModalSubEnabled,
        subtitle_pos_y: 100 - parseInt(document.getElementById("local-sub-pos").value, 10),
        subtitle_track: window.tempModalSelectedTrack || "",
        cover_data: currentCoverData, // Send base64 data if changed
        volume: parseInt(document.getElementById("local-volume").value, 10) || 100,
        autoplay: document.getElementById("local-autoplay").checked,
        autoreplay: document.getElementById("local-autoreplay").checked
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

    // Initialize Universal Loop Selection (One time)
    setupUniversalLoopSelection();

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


// --- UNIVERSAL AUTO-TAG ENGINE ---
let activeUniversalContext = null; // 'local', 'mt', or 'edit'

function openUniversalTagModal(context) {
    activeUniversalContext = context;
    let title = "";
    let artist = "";

    if (context === 'local') {
        title = document.getElementById("local-title").value;
        artist = document.getElementById("local-artist").value;
        if (!title) {
            const pathDisplay = document.getElementById("local-path-display").innerText;
            if (pathDisplay) {
                const parts = pathDisplay.split(/[\\/]/);
                title = parts[parts.length - 1].replace(/\.[^/.]+$/, ""); // strip extension
            }
        }
    } else if (context === 'mt') {
        title = document.getElementById("mt-title").value;
        artist = document.getElementById("mt-artist").value;
    } else if (context === 'edit') {
        title = document.getElementById("edit-title").value;
        artist = document.getElementById("edit-artist").value;
    }

    document.getElementById("utag-search-title").value = title;
    document.getElementById("utag-search-artist").value = artist;
    document.getElementById("utag-results-container").innerHTML = `<div style="padding:20px; text-align:center; color:#666;">Prêt à chercher pour "${title}"...</div>`;

    document.getElementById("modal-universal-tag").showModal();
}

async function performUniversalSearch() {
    const title = document.getElementById("utag-search-title").value;
    const artist = document.getElementById("utag-search-artist").value;
    const query = (artist ? artist + " " : "") + title;

    const container = document.getElementById("utag-results-container");
    container.innerHTML = `<div style='color:var(--accent); display:flex; align-items:center; justify-content:center; gap:10px; padding:20px;'>
                                <i class='ph ph-circle-notch ph-spin' style='font-size:1.5em;'></i> 
                                <span>Recherche enrichie...</span>
                           </div>`;

    try {
        const res = await fetch(`/api/metadata/search?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        container.innerHTML = "";

        if (results.length === 0) {
            container.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>Aucun résultat trouvé. Essayez de simplifier le titre.</div>";
            return;
        }

        results.forEach(item => {
            const div = document.createElement("div");
            div.className = "api-result-item";
            div.style.margin = "5px";
            
            let thumb = "<span style='font-size:24px;'>🎵</span>";
            if (item.cover_url) {
                thumb = `<img src="${item.cover_url}" style="width:40px; height:40px; border-radius:4px; object-fit:cover;">`;
            }

            let metaInfo = `${item.artist} - ${item.album} (${item.year})`;
            if (item.bpm || item.key) {
                metaInfo += `<br><span style="color:var(--accent); font-size:0.85em;">`;
                if (item.bpm) metaInfo += `🎵 ${item.bpm} BPM `;
                if (item.key) metaInfo += `🎹 Key: ${item.key}`;
                metaInfo += `</span>`;
            }

            div.innerHTML = `
                ${thumb}
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:0.95em;">${item.title}</div>
                    <div style="font-size:0.8em; color:#bbb;">${metaInfo}</div>
                </div>
                <button class="btn-primary" style="padding:4px 8px; font-size:0.8em;">Appliquer</button>
            `;

            div.onclick = () => applyUniversalMetadata(item);
            container.appendChild(div);
        });
    } catch (e) {
        container.innerHTML = "<div style='color:red; padding:20px;'>Erreur lors de la recherche.</div>";
    }
}

function applyUniversalMetadata(item) {
    const applyTitle = document.getElementById("utag-apply-title").checked;
    const applyArtist = document.getElementById("utag-apply-artist").checked;
    const applyBpmKey = document.getElementById("utag-apply-bpm-key").checked;
    const applyPochette = document.getElementById("utag-apply-pochette").checked;
    const applyTags = document.getElementById("utag-apply-tags").checked;

    const ctx = activeUniversalContext;

    if (applyTitle) document.getElementById(`${ctx}-title`).value = item.title || "";
    if (applyArtist) {
        const artInput = document.getElementById(`${ctx}-artist`);
        if (artInput) artInput.value = item.artist || "";
    }

    if (applyBpmKey) {
        const bpmInput = document.getElementById(`${ctx}-bpm`);
        const keyInput = document.getElementById(`${ctx}-key`);
        if (bpmInput && item.bpm) {
            bpmInput.value = item.bpm;
            bpmInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (keyInput && item.key) {
            keyInput.value = item.key;
            keyInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    if (applyTags) {
        const albInput = document.getElementById(`${ctx}-album`);
        const genreInput = document.getElementById(`${ctx}-genre`);
        const yearInput = document.getElementById(`${ctx}-year`);
        if (albInput) albInput.value = item.album || "";
        if (genreInput) genreInput.value = item.genre || "";
        if (yearInput) yearInput.value = item.year || "";
    }

    if (applyPochette && item.cover_url) {
        currentCoverData = item.cover_url;
        let imgId = "";
        let placeholderId = "";
        let deleteBtnId = "";

        if (ctx === 'local') { imgId = "local-art-img"; placeholderId = "local-art-placeholder"; deleteBtnId = "btn-delete-cover"; }
        else if (ctx === 'mt') { imgId = "mt-art-img"; placeholderId = "mt-art-placeholder"; deleteBtnId = "btn-mt-delete-cover"; }
        else if (ctx === 'edit') { imgId = "preview-thumbnail"; deleteBtnId = "btn-edit-delete-cover"; } // Edit has different structure

        const img = document.getElementById(imgId);
        if (img) {
            img.src = item.cover_url;
            img.style.display = "block";
            // If it's the center preview in edit modal, it might be a div with background
            if (ctx === 'edit') {
                img.style.backgroundImage = `url(${item.cover_url})`;
                img.style.backgroundSize = "cover";
                img.innerHTML = ""; // Clear the emoji
            }
        }
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) placeholder.style.display = "none";
        const delBtn = document.getElementById(deleteBtnId);
        if (delBtn) delBtn.style.display = "flex";
    }

    document.getElementById("modal-universal-tag").close();
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
    openUniversalTagModal('local');
}

function applyAutoTag(item) {
    // Deprecated for Universal Tag, but kept for legacy stability if called
    applyUniversalMetadata(item);
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
    const ids = ["edit-target-profile", "local-target-profile", "mt-target-profile"];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        // Keep "Auto"
        sel.innerHTML = `<option value="Auto" data-i18n="web.opt_auto_recommended">${t('web.opt_auto_recommended', 'Auto (Recommandé)')}</option>`;
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
    if (markersContainer && currentChapters.length > 0) {
        markersContainer.innerHTML = "";

        let dur = 0;
        if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
            const v = document.getElementById("html5-player");
            if (v && !isNaN(v.duration)) dur = v.duration;
        } else if (currentActivePlayer === 'youtube') {
            if (player && typeof player.getDuration === "function") dur = player.getDuration();
        }

        const drawMarkers = (duration) => {
            if (!duration || isNaN(duration) || duration <= 0) return;
            markersContainer.innerHTML = "";
            currentChapters.forEach((chap) => {
                if (chap.start_time <= 0) return;
                const pct = (chap.start_time / duration) * 100;

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

        if (dur > 0) {
            drawMarkers(dur);
        } else {
            // Wait for metadata (especially useful for local video)
            if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
                const v = document.getElementById("html5-player");
                if (v) {
                    v.addEventListener('loadedmetadata', () => {
                        if (!isNaN(v.duration)) drawMarkers(v.duration);
                    }, { once: true });
                }
            } else if (currentActivePlayer === 'youtube') {
                // For YouTube, if duration isn't ready immediately, we might need a small timeout
                setTimeout(() => {
                    if (player && typeof player.getDuration === "function") {
                        const lateDur = player.getDuration();
                        if (lateDur > 0) drawMarkers(lateDur);
                    }
                }, 1000);
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
    const slider = document.getElementById("video-seek-slider");
    const fill = document.getElementById("video-progress-fill");

    // Time Labels
    const lblCur = document.getElementById("video-time-current");
    const lblTot = document.getElementById("video-time-total");

    // We only update if we have a valid player context
    if (currentActivePlayer !== 'local' && currentActivePlayer !== 'waveform' && currentActivePlayer !== 'youtube') return;

    let dur = 0;
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const v = document.getElementById("html5-player");
        if (v && !isNaN(v.duration)) dur = v.duration;
    } else if (currentActivePlayer === 'youtube') {
        if (player && typeof player.getDuration === "function") dur = player.getDuration();
    }

    if (dur > 0 && slider && fill) {
        // Base value for slider (always absolute to video length)
        slider.value = (currentTime / dur) * 100;

        let pctLeft = 0;
        let pctWidth = 0;
        let displayCur = currentTime;
        let displayDur = dur;

        // Si boucle en cours de création ou active
        if (loopA !== null && isLoopActive) {
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
            // Lecture normale ou boucle inactive
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

    // Make local video clickable for play/pause like YouTube
    v.onclick = () => {
        if (v.paused) v.play();
        else v.pause();
    };
}

function updatePlayPauseIcon(type, isPlaying) {
    const btnId = `btn-${type}-play-toggle`;
    const icon = document.getElementById(btnId);
    if (!icon) return;

    if (isPlaying) {
        icon.classList.remove('ph-play-circle');
        icon.classList.add('ph-pause-circle');
    } else {
        icon.classList.remove('ph-pause-circle');
        icon.classList.add('ph-play-circle');
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

function getUniversalDuration() {
    let dur = 0;
    if (currentActivePlayer === 'youtube' && player && typeof player.getDuration === "function") dur = player.getDuration();
    else if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && !isNaN(vid.duration)) dur = vid.duration;
        if (dur === 0 && wavesurfer && !isNaN(wavesurfer.getDuration())) dur = wavesurfer.getDuration();
    } else if (currentActivePlayer === 'multitrack' && window.multitrack) {
        window.multitrack.wavesurfers.forEach(ws => {
            const wsDur = ws.getDuration();
            if (wsDur > dur) dur = wsDur;
        });
    }
    return dur;
}

function getCurrentPlayerTime() {
    if (currentActivePlayer === 'multitrack' && window.multitrack) {
        return window.multitrack.getCurrentTime();
    } else if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && vid.style.display !== "none") return vid.currentTime;
        if (wavesurfer && document.getElementById("audio-player-container").style.display !== "none") return wavesurfer.getCurrentTime();
    } else if (currentActivePlayer === 'youtube' && player && typeof player.getCurrentTime === "function") {
        return player.getCurrentTime();
    }
    return 0;
}

function seekPlayerTo(time) {
    if (currentActivePlayer === 'multitrack' && window.multitrack) {
        window.multitrack.setTime(time);
    } else if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
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
    const currentTime = getCurrentPlayerTime();
    if (loopA !== null && currentTime > loopA) {
        loopB = currentTime;
        isLoopActive = true;
    } else {
        alert(t("web.msg_loop_b_after_a"));
    }
    updateLoopUI();
}

function clearLoop() {
    loopA = null;
    loopB = null;
    isLoopActive = false;
    isSequentialLoop = false;
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
    const btnSave_a = document.getElementById("btn-loop-save-audio");
    const btnToggle_a = document.getElementById("btn-loop-toggle-audio");
    const btnPrev_a = document.getElementById("btn-loop-prev-audio");
    const btnNext_a = document.getElementById("btn-loop-next-audio");

    // Video UI
    const btnA_v = document.getElementById("btn-loop-a-video");
    const btnB_v = document.getElementById("btn-loop-b-video");
    const btnSave_v = document.getElementById("btn-loop-save-video");
    const btnToggle_v = document.getElementById("btn-loop-toggle-video");
    const btnPrev_v = document.getElementById("btn-loop-prev-video");
    const btnNext_v = document.getElementById("btn-loop-next-video");

    // Multitrack UI
    const btnA_m = document.getElementById("btn-loop-a-mt");
    const btnB_m = document.getElementById("btn-loop-b-mt");
    const btnSave_m = document.getElementById("btn-loop-save-mt");
    const btnToggle_m = document.getElementById("btn-loop-toggle-mt");
    const btnPrev_m = document.getElementById("btn-loop-prev-mt");
    const btnNext_m = document.getElementById("btn-loop-next-mt");

    const activeMode = (loopA !== null || loopB !== null); // Some points are marked

    if (btnA_a) btnA_a.style.color = loopA !== null ? "var(--accent)" : "#fff";
    if (btnB_a) btnB_a.style.color = loopB !== null ? "var(--accent)" : "#555";
    if (btnA_v) btnA_v.style.color = loopA !== null ? "var(--accent)" : "#fff";
    if (btnB_v) btnB_v.style.color = loopB !== null ? "var(--accent)" : "#555";
    if (btnA_m) btnA_m.style.color = loopA !== null ? "var(--accent)" : "#fff";
    if (btnB_m) btnB_m.style.color = loopB !== null ? "var(--accent)" : "#555";

    // Prev/Next Navigation visibility
    const hasSavedLoops = (currentLoops && currentLoops.length > 0);
    const showToggle = (activeMode || hasSavedLoops);

    // Toggle Button Logic
    let toggleHtml = '<i class="ph ph-repeat"></i>';
    let toggleColor = "#555";
    let toggleTooltip = t("web.tooltip_loop_off");

    if (isLoopActive && !isSequentialLoop) {
        toggleHtml = '<i class="ph ph-repeat-once"></i>';
        toggleColor = "var(--accent)";
        toggleTooltip = t("web.tooltip_loop_single");
    } else if (isLoopActive && isSequentialLoop) {
        toggleHtml = '<i class="ph ph-queue"></i>';
        toggleColor = "var(--accent)";
        toggleTooltip = t("web.tooltip_loop_seq");
    }

    if (btnToggle_a) {
        btnToggle_a.style.display = showToggle ? "inline-block" : "none";
        btnToggle_a.style.color = toggleColor;
        btnToggle_a.innerHTML = toggleHtml;
        btnToggle_a.title = toggleTooltip;
    }

    if (btnToggle_v) {
        btnToggle_v.style.display = showToggle ? "inline-block" : "none";
        btnToggle_v.style.color = toggleColor;
        btnToggle_v.innerHTML = toggleHtml;
        btnToggle_v.title = toggleTooltip;
    }

    if (btnToggle_m) {
        btnToggle_m.style.display = showToggle ? "inline-block" : "none";
        btnToggle_m.style.color = toggleColor;
        btnToggle_m.innerHTML = toggleHtml;
        btnToggle_m.title = toggleTooltip;
    }

    // Save Button Logic
    if (btnSave_a) btnSave_a.style.display = (loopA !== null && loopB !== null && isLoopActive) ? "inline-block" : "none";
    if (btnSave_v) btnSave_v.style.display = (loopA !== null && loopB !== null && isLoopActive) ? "inline-block" : "none";
    if (btnSave_m) btnSave_m.style.display = (loopA !== null && loopB !== null && isLoopActive) ? "inline-block" : "none";

    if (btnPrev_a) btnPrev_a.style.display = hasSavedLoops ? "inline-block" : "none";
    if (btnNext_a) btnNext_a.style.display = hasSavedLoops ? "inline-block" : "none";
    if (btnPrev_v) btnPrev_v.style.display = hasSavedLoops ? "inline-block" : "none";
    if (btnNext_v) btnNext_v.style.display = hasSavedLoops ? "inline-block" : "none";
    if (btnPrev_m) btnPrev_m.style.display = hasSavedLoops ? "inline-block" : "none";
    if (btnNext_m) btnNext_m.style.display = hasSavedLoops ? "inline-block" : "none";

    // Visual Timeline Markers for Local Video / Audio / Multitrack
    const isAudio = (currentActivePlayer === 'waveform');
    const isMultitrack = (currentActivePlayer === 'multitrack');

    // Primary Markers (The ones we drag/see on timelines)
    const markerA = isMultitrack ? document.getElementById("mt-loop-marker-a") : (isAudio ? document.getElementById("audio-loop-marker-a-bar") : document.getElementById("video-loop-marker-a"));
    const markerB = isMultitrack ? document.getElementById("mt-loop-marker-b") : (isAudio ? document.getElementById("audio-loop-marker-b-bar") : document.getElementById("video-loop-marker-b"));
    const area = isMultitrack ? document.getElementById("mt-loop-area") : (isAudio ? document.getElementById("audio-loop-area-bar") : document.getElementById("video-loop-area"));

    // Waveform Markers (Only for Audio mode, to keep visual on the wave)
    const waveMarkerA = isAudio ? document.getElementById("audio-loop-marker-a") : null;
    const waveMarkerB = isAudio ? document.getElementById("audio-loop-marker-b") : null;
    const waveArea = isAudio ? document.getElementById("audio-loop-area") : null;

    const visualOverlay = document.getElementById("mt-visual-loop-overlay");

    const duration = getUniversalDuration();

    if (duration > 0) {
        if (loopA !== null) {
            const pctA = (loopA / duration) * 100;
            if (markerA) { markerA.style.display = "block"; markerA.style.left = pctA + "%"; }
            if (waveMarkerA) { waveMarkerA.style.display = "block"; waveMarkerA.style.left = pctA + "%"; }
        } else {
            if (markerA) markerA.style.display = "none";
            if (waveMarkerA) waveMarkerA.style.display = "none";
        }

        if (loopB !== null && loopA !== null) {
            const pctB = (loopB / duration) * 100;
            const pctA = (loopA / duration) * 100;
            if (markerB) { markerB.style.display = "block"; markerB.style.left = pctB + "%"; }
            if (waveMarkerB) { waveMarkerB.style.display = "block"; waveMarkerB.style.left = pctB + "%"; }

            if (area) {
                area.style.display = "block";
                area.style.left = pctA + "%";
                area.style.width = (pctB - pctA) + "%";
                area.style.backgroundColor = isLoopActive ? "rgba(187,134,252, 0.4)" : "rgba(100, 100, 100, 0.3)";
                area.style.border = isLoopActive ? "1px dashed var(--accent)" : "1px dashed #666";
            }
            if (waveArea) {
                waveArea.style.display = "block";
                waveArea.style.left = pctA + "%";
                waveArea.style.width = (pctB - pctA) + "%";
                waveArea.style.backgroundColor = isLoopActive ? "rgba(3, 218, 198, 0.4)" : "rgba(100, 100, 100, 0.3)";
            }

            // Moises Style Visual Overlay for Multitrack
            if (isMultitrack && visualOverlay) {
                if (isLoopActive) {
                    visualOverlay.style.display = "block";
                    // Reverse clip-path: show everything EXCEPT the loop area is NOT what we want.
                    // Actually, we want a hole in the dimmed overlay.
                    // mask-image or clip-path: polygon with "hole" logic
                    visualOverlay.style.clipPath = `polygon(0% 0%, 0% 100%, ${pctA}% 100%, ${pctA}% 0%, ${pctB}% 0%, ${pctB}% 100%, ${pctA}% 100%, 100% 100%, 100% 0%)`;
                } else {
                    visualOverlay.style.display = "none";
                }
            }
        } else {
            if (markerB) markerB.style.display = "none";
            if (area) area.style.display = "none";
            if (visualOverlay) visualOverlay.style.display = "none";
        }
    } else {
        if (markerA) markerA.style.display = "none";
        if (markerB) markerB.style.display = "none";
        if (area) area.style.display = "none";
        if (visualOverlay) visualOverlay.style.display = "none";
    }
}

function checkLoop(currentTime) {
    if (!isLoopActive || loopA === null || loopB === null) return;
    if (currentTime >= loopB) {
        if (!isSequentialLoop) {
            seekPlayerTo(loopA);
        } else {
            // Find current loop to jump to next
            if (!currentLoops || currentLoops.length === 0) {
                seekPlayerTo(loopA);
                return;
            }
            const sortedLoops = [...currentLoops].sort((a, b) => a.start - b.start);
            let idx = sortedLoops.findIndex(l => Math.abs(l.start - loopA) < 0.1);
            if (idx >= 0) {
                idx = (idx + 1) % sortedLoops.length; // Next loop, wrap around
                playSavedLoop(sortedLoops[idx], true);
            } else {
                seekPlayerTo(loopA);
            }
        }
    }
}

// Ensure high frequency check for Loops & timeline UI for all
setInterval(() => {
    const time = getCurrentPlayerTime();
    if (isLoopActive) checkLoop(time);

    if (currentActivePlayer === 'youtube') {
        updateTimelineUI(time);
    }

    // Always update the universal timer (elapsed/remaining)
    updateUniversalTimer();
}, 50);

// --- LOOP MODAL LOGIC ---
function openLoopModal() {
    if (!isLoopActive || loopA === null || loopB === null) return;

    // 1. Pause the player while typing
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && !vid.paused) vid.pause();
        if (wavesurfer && wavesurfer.isPlaying()) wavesurfer.pause();
    } else if (currentActivePlayer === 'youtube' && player && typeof player.pauseVideo === "function") {
        player.pauseVideo();
    }

    // 2. Setup UI
    const modal = document.getElementById("loop-modal");
    document.getElementById("loop-modal-timing").innerText = `${formatTimeCustom(loopA)} - ${formatTimeCustom(loopB)}`;

    const nameInput = document.getElementById("loop-modal-name");
    const saveBtn = modal.querySelector(".btn-primary");

    if (activeSavedLoopId) {
        const loop = currentLoops.find(l => l.id === activeSavedLoopId);
        nameInput.value = loop ? loop.name : "";
        saveBtn.innerText = t("web.btn_update", "Mettre à jour");
    } else {
        nameInput.value = "";
        saveBtn.innerText = t("web.btn_save");
    }

    // 3. Populate existing loops for this track
    const existingContainer = document.getElementById("loop-modal-existing-container");
    const existingList = document.getElementById("loop-modal-existing-list");
    existingList.innerHTML = "";
    if (currentLoops && currentLoops.length > 0) {
        existingContainer.style.display = "block";
        currentLoops.forEach(l => {
            const div = document.createElement("div");
            div.style.cssText = "display:flex; justify-content:space-between; align-items:center; font-size:0.85em; background:#222; padding:4px 8px; border-radius:4px;";
            div.innerHTML = `
                <span id="loop-name-display-${l.id}" style="color:#fff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${l.name}</span>
                <input type="text" id="loop-name-input-${l.id}" value="${l.name}" style="display:none; flex:1; margin-right:5px; font-size:1em; padding:2px; box-sizing:border-box;">
                
                <span style="color:#888; font-family:monospace; margin:0 10px;">[${formatTimeCustom(l.start)}-${formatTimeCustom(l.end)}]</span>
                
                <div style="display:flex; gap:5px;">
                    <button id="btn-edit-${l.id}" class="btn-icon" onclick="toggleEditLoop(${l.id})" style="padding:2px; font-size:1.2em; color:#fff;" title="Renommer"><i class="ph ph-pencil-simple"></i></button>
                    <button id="btn-save-${l.id}" class="btn-icon" onclick="saveLoopName(${l.id})" style="display:none; padding:2px; font-size:1.2em; color:var(--accent);" title="Valider"><i class="ph ph-check"></i></button>
                    <button class="btn-icon" onclick="deleteLoop(${l.id})" style="padding:2px; font-size:1.2em; color:#cf6679;" title="Supprimer"><i class="ph ph-trash"></i></button>
                </div>
            `;
            existingList.appendChild(div);
        });
    } else {
        existingContainer.style.display = "none";
    }

    modal.showModal();
    document.getElementById("loop-modal-name").focus();
}

function closeLoopModal() {
    const modal = document.getElementById("loop-modal");
    if (modal) modal.close();
}

// Inline editing functions for the modal
function toggleEditLoop(id) {
    document.getElementById(`loop-name-display-${id}`).style.display = 'none';
    document.getElementById(`btn-edit-${id}`).style.display = 'none';

    document.getElementById(`loop-name-input-${id}`).style.display = 'block';
    document.getElementById(`btn-save-${id}`).style.display = 'block';

    document.getElementById(`loop-name-input-${id}`).focus();
}

function saveLoopName(id) {
    const newName = document.getElementById(`loop-name-input-${id}`).value.trim() || t("web.lbl_no_named_loop");
    const loop = currentLoops.find(l => l.id === id);
    if (loop) {
        loop.name = newName;
        // Re-open/refresh modal to show changes
        openLoopModal();
        renderLoopsUI(); // Refresh markers just in case

        // Save to Backend immediately
        saveLoopsToBackend();
    }
}

// Reusable backend persist
async function saveLoopsToBackend() {
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
        const item = localFiles[currentPlayingIndex];
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

async function confirmSaveLoop() {
    if (!isLoopActive || loopA === null || loopB === null) {
        closeLoopModal();
        return;
    }

    const nameInput = document.getElementById("loop-modal-name");
    const name = nameInput.value.trim() || t("web.lbl_no_named_loop");

    if (activeSavedLoopId) {
        const idx = currentLoops.findIndex(l => l.id === activeSavedLoopId);
        if (idx !== -1) {
            currentLoops[idx].name = name;
            currentLoops[idx].start = loopA;
            currentLoops[idx].end = loopB;
        }
    } else {
        const newLoop = {
            id: Date.now(),
            name: name,
            start: loopA,
            end: loopB
        };
        currentLoops.push(newLoop);
    }

    renderLoopsUI();
    closeLoopModal();

    // Save to backend
    saveLoopsToBackend();
}

function playSavedLoop(l, forceActive = true) {
    loopA = l.start;
    loopB = l.end;
    activeSavedLoopId = l.id;
    if (forceActive) {
        isLoopActive = true;
    }
    // else keep the current state of isLoopActive
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
}

function renderLoopsUI() {
    let timelineBg = null;
    let row = null;
    let timeDisplay = null;

    if (currentActivePlayer === 'multitrack') {
        timelineBg = document.getElementById("mt-loop-bar");
        row = document.getElementById("multitrack-timeline-row");
        timeDisplay = document.getElementById("mt-time-display");
    } else if (currentActivePlayer === 'waveform') {
        timelineBg = document.getElementById("audio-loop-bar");
        row = document.getElementById("audio-timeline-row");
        timeDisplay = document.getElementById("audio-time-row-display");
    } else {
        timelineBg = document.getElementById("video-loop-bar");
        row = document.getElementById("video-timeline-container");
        timeDisplay = document.getElementById("video-time-row-display");
    }

    if (!timelineBg) return;

    // Clear existing
    document.querySelectorAll('.saved-loop-region').forEach(el => el.remove());

    let dur = 0;
    if (currentActivePlayer === 'youtube' && player && typeof player.getDuration === "function") dur = player.getDuration();
    if (currentActivePlayer === 'local') {
        const vid = document.getElementById("html5-player");
        if (vid && !isNaN(vid.duration)) dur = vid.duration;
    } else if (currentActivePlayer === 'waveform') {
        if (wavesurfer && !isNaN(wavesurfer.getDuration())) dur = wavesurfer.getDuration();
    } else if (currentActivePlayer === 'multitrack' && window.multitrack) {
        window.multitrack.wavesurfers.forEach(ws => {
            const wsDur = ws.getDuration();
            if (wsDur > dur) dur = wsDur;
        });
    }

    if (dur === 0) {
        if (currentLoops && currentLoops.length > 0) setTimeout(renderLoopsUI, 500);
        return;
    }

    const loopColors = [
        'rgba(187, 134, 252, 0.45)', // Amethyst
        'rgba(3, 218, 198, 0.45)',   // Teal
        'rgba(255, 121, 198, 0.45)', // Magenta/Pink
        'rgba(241, 250, 140, 0.45)', // Bright Yellow
        'rgba(139, 233, 253, 0.45)', // Electric Blue
        'rgba(80, 250, 123, 0.45)',  // Neon Green
        'rgba(255, 184, 108, 0.45)', // Orange
        'rgba(255, 85, 85, 0.45)'    // Coral
    ];

    if (!currentLoops || currentLoops.length === 0) {
        if (row) row.style.height = "16px";
        return;
    }

    const sorted = [...currentLoops].sort((a, b) => a.start - b.start);
    const loopLanes = [];
    const laneEnds = [];

    sorted.forEach(l => {
        let laneIndex = laneEnds.findIndex(endTime => endTime <= l.start);
        if (laneIndex === -1) {
            laneIndex = laneEnds.length;
            laneEnds.push(l.end);
        } else {
            laneEnds[laneIndex] = l.end;
        }
        loopLanes.push(laneIndex);
    });

    const totalLanes = Math.max(1, laneEnds.length);
    const SINGLE_LANE_HEIGHT = 16;
    const targetHeight = totalLanes * SINGLE_LANE_HEIGHT;

    if (row) row.style.height = targetHeight + "px";

    sorted.forEach((l, i) => {
        const laneIndex = loopLanes[i];
        const region = document.createElement("div");
        region.className = "saved-loop-region";

        const pctLeft = Math.max(0, Math.min(100, (l.start / dur) * 100));
        let pctWidth = ((l.end - l.start) / dur) * 100;
        pctWidth = Math.max(0, Math.min(100 - pctLeft, pctWidth));

        const top = laneIndex * SINGLE_LANE_HEIGHT;
        const color = loopColors[i % loopColors.length];

        region.style.cssText = `
            position: absolute;
            top: ${top}px;
            left: ${pctLeft}%;
            width: ${pctWidth}%;
            height: ${SINGLE_LANE_HEIGHT}px;
            background-color: ${color};
            border-left: 1px solid rgba(255,255,255,0.2);
            border-right: 1px solid rgba(255,255,255,0.2);
            cursor: pointer;
            z-index: 5;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            overflow: hidden;
            white-space: nowrap;
            padding: 0 6px;
            transition: background-color 0.2s;
        `;

        const nameLabel = document.createElement("span");
        nameLabel.innerText = l.name;
        nameLabel.style.cssText = "font-size: 11px; color: #fff; pointer-events: none; text-shadow: 1px 1px 2px rgba(0,0,0,0.9); font-weight: 600; overflow: hidden; text-overflow: ellipsis;";
        region.appendChild(nameLabel);

        region.title = l.name + " (" + formatTimeCustom(l.start) + " - " + formatTimeCustom(l.end) + ")";
        region.onclick = (e) => { e.stopPropagation(); playSavedLoop(l, true); };
        timelineBg.appendChild(region);
    });
}

function toggleLoopState() {
    if (!isLoopActive) {
        // State 0 -> 1: OFF to SINGLE
        const t = getCurrentPlayerTime();

        // Check if we are currently inside a saved loop
        const activeLoop = currentLoops.find(l => t >= l.start && t <= l.end);

        if (activeLoop && loopA === null) {
            // We are inside a loop, but no manual points set. Snap to this loop's boundaries!
            loopA = activeLoop.start;
            loopB = activeLoop.end;
            isLoopActive = true;
            isSequentialLoop = false;
        } else if (!activeLoop && currentLoops.length > 0 && loopA === null) {
            // Auto-start first loop if we are not currently in one and have no manual points
            const sortedLoops = [...currentLoops].sort((a, b) => a.start - b.start);
            playSavedLoop(sortedLoops[0], true);
            isSequentialLoop = false;
            return; // playSavedLoop already handles UI updates
        } else {
            // Manual loop points exist, or no saved loops exist. Just toggle state.
            isLoopActive = true;
            isSequentialLoop = false;
        }
    } else if (isLoopActive && !isSequentialLoop && currentLoops.length > 0) {
        // State 1 -> 2: SINGLE to SEQUENTIAL
        isSequentialLoop = true;
    } else {
        // State 2 -> 0: SEQUENTIAL (or SINGLE if no saved loops) to OFF
        isLoopActive = false;
        isSequentialLoop = false;
    }
    updateLoopUI();
}

function navigateLoop(direction) {
    if (!currentLoops || currentLoops.length === 0) return;

    // Sort loops chronologically
    const sortedLoops = [...currentLoops].sort((a, b) => a.start - b.start);

    const currentTime = getCurrentPlayerTime();
    let targetLoop = null;

    if (direction === 1) { // Next
        // Find the first loop that starts AFTER the current time (with a tiny buffer to avoid triggering the current loop)
        targetLoop = sortedLoops.find(l => l.start > currentTime + 0.5);
        if (!targetLoop) targetLoop = sortedLoops[0]; // Wrap around
    } else { // Prev
        // Find the last loop that starts BEFORE the current time
        // Need to reverse to find the closest previous one
        targetLoop = [...sortedLoops].reverse().find(l => l.start < currentTime - 1.0); // 1s buffer backwards so we don't just stay stuck
        if (!targetLoop) targetLoop = sortedLoops[sortedLoops.length - 1]; // Wrap around
    }

    if (targetLoop) {
        playSavedLoop(targetLoop, false); // Don't force active; preserve user's toggle state
    }
}

function deleteLoop(id) {
    if (!confirm(t("web.msg_confirm_delete_loop"))) return;
    currentLoops = currentLoops.filter(l => l.id !== id);
    renderLoopsUI();

    // Re-render modal to reflect deletion if we are doing this from inside the modal
    const modal = document.getElementById("loop-modal");
    if (modal && modal.open) {
        openLoopModal();
    }

    // Save to backend
    saveLoopsToBackend();
}

function loadLoopsForTrack(trackOrItem) {
    clearLoop(); // Reset active loops when loading a new track
    currentLoops = trackOrItem.loops || [];
    renderLoopsUI();
    updateLoopUI(); // Refresh Toolbar Buttons visibility
}

// --- PLAYBACK TOGGLE UTILITIES ---

function togglePlaybackOption(option) {
    if (window.currentPlayingIndex === undefined) return;

    let item = null;
    if (currentActivePlayer === 'local' || currentActivePlayer === 'multitrack' || currentActivePlayer === 'waveform') {
        item = localFiles[window.currentPlayingIndex];
    } else if (currentActivePlayer === 'youtube') {
        item = currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex);
    }
    if (!item) return;

    if (option === 'autoreplay') {
        window.currentAutoreplay = !window.currentAutoreplay;
        item.autoreplay = window.currentAutoreplay;
        updatePlaybackOptionsUI(window.currentAutoreplay, item.autoplay);
        syncPlaybackSettingsToModals(item);

        // Save based on type
        if (item.is_multitrack) saveMultitrackSettings(item);
        else if (item.path) saveLocalItemQuiet(window.currentPlayingIndex, item);
        else saveItemQuiet(window.currentPlayingIndex, item);

    } else if (option === 'autoplay') {
        const currentAutoplay = (item.autoplay !== undefined) ? item.autoplay : (currentSettings.autoplay || false);
        item.autoplay = !currentAutoplay;
        updatePlaybackOptionsUI(window.currentAutoreplay, item.autoplay);
        syncPlaybackSettingsToModals(item);

        // Save based on type
        if (item.is_multitrack) saveMultitrackSettings(item);
        else if (item.path) saveLocalItemQuiet(window.currentPlayingIndex, item);
        else saveItemQuiet(window.currentPlayingIndex, item);
    }
}

function updatePlaybackOptionsUI(repeatActive, autoplayActive) {
    const repeatBtns = ["btn-audio-repeat-toggle", "btn-multitrack-repeat-toggle", "btn-video-repeat-toggle"];
    const autoplayBtns = ["btn-audio-autoplay-toggle", "btn-multitrack-autoplay-toggle", "btn-video-autoplay-toggle"];

    repeatBtns.forEach(id => {
        const b = document.getElementById(id);
        if (b) {
            if (repeatActive) b.classList.add("active");
            else b.classList.remove("active");
        }
    });

    autoplayBtns.forEach(id => {
        const b = document.getElementById(id);
        if (b) {
            if (autoplayActive) b.classList.add("active");
            else b.classList.remove("active");
        }
    });
}

function syncPlaybackSettingsToModals(item) {
    const isAutoreplay = (item.autoreplay !== undefined) ? item.autoreplay : (currentSettings.autoreplay || false);
    const isAutoplay = (item.autoplay !== undefined) ? item.autoplay : (currentSettings.autoplay || false);

    // YouTube / Setlist Modal
    const editAutoreplay = document.getElementById("edit-autoreplay");
    const editAutoplay = document.getElementById("edit-autoplay");
    if (editAutoreplay) editAutoreplay.checked = isAutoreplay;
    if (editAutoplay) editAutoplay.checked = isAutoplay;

    // Local Modal
    const localAutoreplay = document.getElementById("local-autoreplay");
    const localAutoplay = document.getElementById("local-autoplay");
    if (localAutoreplay) localAutoreplay.checked = isAutoreplay;
    if (localAutoplay) localAutoplay.checked = isAutoplay;
}

function updateRepeatUI(active) {
    let itemAutoplay = false;
    if (window.currentPlayingIndex !== undefined) {
        let item = null;
        if (currentActivePlayer === 'local' || currentActivePlayer === 'multitrack' || currentActivePlayer === 'waveform') {
            item = localFiles[window.currentPlayingIndex];
        } else if (currentActivePlayer === 'youtube') {
            item = currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex);
        }
        if (item) itemAutoplay = (item.autoplay !== undefined) ? item.autoplay : (currentSettings.autoplay || false);
    }
    updatePlaybackOptionsUI(active, itemAutoplay);
}

async function saveLocalItemQuiet(index, item) {
    await fetch(`/api/local/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
    });
}

async function saveItemQuiet(index, item) {
    await fetch(`/api/setlist/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
    });
}

function liveUpdatePlaybackOption(option, value) {
    if (window.currentPlayingIndex === undefined) return;

    let item = null;
    if (currentActivePlayer === 'local' || currentActivePlayer === 'multitrack' || currentActivePlayer === 'waveform') {
        item = localFiles[window.currentPlayingIndex];
    } else if (currentActivePlayer === 'youtube') {
        item = currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex);
    }
    if (!item) return;

    if (option === 'autoreplay') {
        window.currentAutoreplay = value;
        item.autoreplay = value;
    } else if (option === 'autoplay') {
        item.autoplay = value;
    }

    // Sync UI & Save
    updatePlaybackOptionsUI(window.currentAutoreplay, item.autoplay);
    syncPlaybackSettingsToModals(item);

    if (item.is_multitrack) saveMultitrackSettings(item);
    else if (item.path) saveLocalItemQuiet(window.currentPlayingIndex, item);
    else saveItemQuiet(window.currentPlayingIndex, item);
}

// --- MULTITRACK MOUSE LOOP SELECTION ---
// --- UNIVERSAL MOUSE LOOP SELECTION ---
function setupUniversalLoopSelection() {
    let isDragging = false;
    let dragMode = 'CREATE'; // 'CREATE', 'RESIZE_A', 'RESIZE_B'

    const getXTime = (clientX, rect) => {
        const x = clientX - rect.left;
        const dur = getUniversalDuration();
        return (x / rect.width) * dur;
    };

    const getTargetElements = () => {
        if (currentActivePlayer === 'multitrack') {
            return { bar: document.getElementById("mt-loop-bar"), content: document.getElementById("mt-waveform-wrapper") };
        } else if (currentActivePlayer === 'waveform') {
            return { bar: document.getElementById("audio-loop-bar"), content: document.getElementById("audio-waveform-container") };
        } else if (currentActivePlayer === 'youtube' || currentActivePlayer === 'local') {
            return { bar: document.getElementById("video-loop-bar"), content: document.getElementById("video-timeline-wrapper") };
        }
        return { bar: null, content: null };
    };

    const onMouseDown = (e) => {
        const { bar, content } = getTargetElements();
        if (!bar && !content) return;

        const targetNode = (bar && bar.contains(e.target)) ? bar : (content && content.contains(e.target) ? content : null);
        if (!targetNode) return;

        const rect = targetNode.getBoundingClientRect();
        const time = getXTime(e.clientX, rect);
        const dur = getUniversalDuration();
        if (dur === 0) return;

        const thresholdPx = 10;
        const thresholdSec = (thresholdPx / rect.width) * dur;

        if (loopA !== null && Math.abs(time - loopA) < thresholdSec) {
            dragMode = 'RESIZE_A';
        } else if (loopB !== null && Math.abs(time - loopB) < thresholdSec) {
            dragMode = 'RESIZE_B';
        } else {
            dragMode = 'CREATE';
            activeSavedLoopId = null;
            loopA = time;
            loopB = null;
            isLoopActive = false;
        }

        e.preventDefault();
        isDragging = true;
        updateLoopUI();
    };

    const onMouseMove = (e) => {
        const { bar, content } = getTargetElements();
        if (!bar && !content) return;

        // Visual feedback
        if (!isDragging) {
            const targetNode = (bar && bar.contains(e.target)) ? bar : (content && content.contains(e.target) ? content : null);
            if (targetNode) {
                const rect = targetNode.getBoundingClientRect();
                const time = getXTime(e.clientX, rect);
                const dur = getUniversalDuration();
                if (dur > 0) {
                    const thresholdSec = (10 / rect.width) * dur;
                    const isNearA = loopA !== null && Math.abs(time - loopA) < thresholdSec;
                    const isNearB = loopB !== null && Math.abs(time - loopB) < thresholdSec;
                    targetNode.style.cursor = (isNearA || isNearB) ? 'ew-resize' : 'crosshair';
                }
            }
            return;
        }

        const dur = getUniversalDuration();
        const rect = (bar && bar.contains(e.target)) ? bar.getBoundingClientRect() : (content ? content.getBoundingClientRect() : bar.getBoundingClientRect());
        const time = getXTime(e.clientX, rect);
        const clampedTime = Math.max(0, Math.min(dur, time));

        if (dragMode === 'CREATE') {
            if (clampedTime > loopA) {
                loopB = clampedTime;
            } else {
                loopB = loopA;
                loopA = clampedTime;
            }
            isLoopActive = true;
        } else if (dragMode === 'RESIZE_A') {
            loopA = Math.min(clampedTime, (loopB !== null ? loopB - 0.1 : dur));
            isLoopActive = true;
        } else if (dragMode === 'RESIZE_B') {
            loopB = Math.max(clampedTime, (loopA !== null ? loopA + 0.1 : 0));
            isLoopActive = true;
        }

        updateLoopUI();
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        if (loopA !== null && loopB !== null && Math.abs(loopB - loopA) > 0.1) {
            isLoopActive = true;
            if (dragMode === 'CREATE' || dragMode === 'RESIZE_A') seekPlayerTo(loopA);
        } else if (dragMode === 'CREATE') {
            if (loopA !== null) seekPlayerTo(loopA);
            clearLoop();
        }
        updateLoopUI();
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}
// --- MULTITRACK TIMER ---
function updateUniversalTimer() {
    let el = null;
    if (currentActivePlayer === 'multitrack') el = document.getElementById("mt-time-display-integrated");
    else if (currentActivePlayer === 'waveform') el = document.getElementById("audio-time-display-integrated");
    else if (currentActivePlayer === 'youtube' || currentActivePlayer === 'local') el = document.getElementById("video-time-display-integrated");

    if (!el) return;

    const cur = getCurrentPlayerTime();
    const dur = getUniversalDuration();
    if (dur === 0) return;

    const elapsed = formatTimeCustom(cur);
    const remaining = formatTimeCustom(Math.max(0, dur - cur));

    el.innerText = `${elapsed} / -${remaining}`;

    // Update progress bars
    if (currentActivePlayer === 'waveform') {
        const progressFill = document.getElementById("audio-progress-fill");
        if (progressFill) {
            const percent = (cur / dur) * 100;
            progressFill.style.width = percent + "%";
        }
    } else if (currentActivePlayer === 'youtube' || currentActivePlayer === 'local') {
        const progressFill = document.getElementById("video-progress-fill");
        if (progressFill) {
            const percent = (cur / dur) * 100;
            progressFill.style.width = percent + "%";
        }
    }
}

// --- MUSIC API METADATA FETCH ---
let activeApiPrefix = null; // Store prefix to know where to apply results

async function fetchMetadataForModal(prefix, event) {
    const artistInput = document.getElementById(`${prefix}-artist`);
    const titleInput = document.getElementById(`${prefix}-title`);

    if (!artistInput || !titleInput) return;

    activeApiPrefix = prefix;

    const artist = artistInput.value.trim();
    const title = titleInput.value.trim();

    if (!title) {
        alert(t("web.api_error_missing_title") || "Erreur: Le titre est requis pour la recherche.");
        return;
    }

    const btn = event ? event.currentTarget : null;
    let originalBtnHTML = "";
    if (btn) {
        originalBtnHTML = btn.innerHTML;
        btn.innerHTML = "⏳";
        btn.disabled = true;
    }

    try {
        const url = `/api/media/metadata?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`;
        const res = await fetch(url);

        if (res.ok) {
            const result = await res.json();
            if (result.status === "ok" && result.data && result.data.length > 0) {
                renderApiResults(result.data);
            } else {
                alert(t("web.api_no_result") || "ℹ️ Aucune donnée BPM ou Tonalité trouvée via l'API.");
            }
        } else {
            console.error("API Fetch Error");
            alert(t("web.api_error_request") || "❌ Erreur lors de la requête API.");
        }
    } catch (e) {
        console.error("Fetch Exception:", e);
        alert(t("web.api_error_network") || "❌ Erreur réseau.");
    } finally {
        if (btn) {
            btn.innerHTML = originalBtnHTML;
            btn.disabled = false;
        }
    }
}

function renderApiResults(results) {
    const listContainer = document.getElementById("api-results-list");
    listContainer.innerHTML = "";

    results.forEach(item => {
        const div = document.createElement("div");
        div.className = "api-result-item";
        div.onclick = () => applyApiResult(item.bpm, item.key, item.cover);

        let html = `<div class="api-result-info">
            <div class="api-result-title">${item.title}</div>
            <div class="api-result-artist">${item.artist}</div>
            <div class="api-result-meta">`;

        if (item.bpm) html += `<span>🎵 ${item.bpm} BPM</span>`;
        if (item.key) html += `<span>🎹 Key: ${item.key}</span>`;
        if (item.year) html += `<span>📅 ${item.year}</span>`;
        if (item.genres && Array.isArray(item.genres) && item.genres.length > 0) {
            html += `<span class="api-genre">🏷️ ${item.genres.slice(0, 2).join(", ")}</span>`;
        }

        html += `   </div>
                </div>`;

        // Optional cover art from Spotify/Web or placeholder
        if (item.cover) {
            html += `<img src="${item.cover}" style="height: 50px; width: 50px; object-fit: cover; border-radius: 4px; margin-left: 10px;">`;
        } else {
            // Use a placeholder if no cover available - Added border for visibility
            html += `<div style="height: 50px; width: 50px; background: #222; border: 1px solid #444; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: #888; margin-left: 10px;">
                        <i class="ph ph-music-notes" style="font-size: 1.5rem;"></i>
                    </div>`;
        }

        div.innerHTML = html;
        listContainer.appendChild(div);
    });

    document.getElementById("api-results-modal").showModal();
}

function applyApiResult(bpm, key, cover) {
    if (!activeApiPrefix) return;

    const bpmInput = document.getElementById(`${activeApiPrefix}-bpm`);
    const keyInput = document.getElementById(`${activeApiPrefix}-key`);

    if (bpmInput && bpm) {
        bpmInput.value = bpm;
        bpmInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (keyInput && key) {
        keyInput.value = key;
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (cover) {
        if (activeApiPrefix === 'edit') {
            document.getElementById("preview-thumbnail").innerHTML = `<img src="${cover}">`;
            document.getElementById("btn-edit-delete-cover").style.display = 'flex';
        } else if (activeApiPrefix === 'local') {
            const img = document.getElementById("local-art-img");
            if (img) {
                img.src = cover;
                img.style.display = "block";
                document.getElementById("local-art-placeholder").style.display = "none";
                document.getElementById("btn-delete-cover").style.display = "flex";
            }
        } else if (activeApiPrefix === 'mt') {
            const img = document.getElementById("mt-art-img");
            if (img) {
                img.src = cover;
                img.style.display = "block";
                document.getElementById("mt-art-placeholder").style.display = "none";
                document.getElementById("btn-mt-delete-cover").style.display = "flex";
            }
        }
    }

    closeApiResultsModal();
}

function closeApiResultsModal() {
    document.getElementById("api-results-modal").close();
    activeApiPrefix = null;
}
function updateHiddenTracksList(file) {
    const container = document.getElementById("mt-hidden-tracks-container");
    if (!container) return;
    container.innerHTML = "";

    // Reactive: Check DOM instead of localStorage
    const hiddenEntries = [];
    file.stems.forEach((stem, i) => {
        const hBtn = document.getElementById(`mt-hide-${i}`);
        const hmBtn = document.getElementById(`mt-hide-mute-${i}`);
        if ((hBtn && hBtn.classList.contains('active')) || (hmBtn && hmBtn.classList.contains('active'))) {
            hiddenEntries.push({
                index: i,
                name: stem.name || stem.path.split(/[\\/]/).pop().replace(/\.[^/.]+$/, ""),
                isMuted: hmBtn && hmBtn.classList.contains('active')
            });
        }
    });

    if (hiddenEntries.length > 0) {
        const btn = document.createElement("button");
        btn.className = "btn-secondary";
        btn.style.fontSize = "0.75em";
        btn.style.padding = "2px 8px";
        btn.innerHTML = `<i class="ph ph-eye"></i> ${t('web.btn_show_hidden').replace('{count}', hiddenEntries.length)}`;
        
        const list = document.createElement("div");
        list.id = "mt-hidden-list-popup";
        list.style.cssText = "display:none; position:absolute; background:#252525; border:1px solid #444; border-radius:4px; padding:8px; z-index:200; box-shadow:0 4px 10px rgba(0,0,0,0.5); margin-top:-10px; max-width:250px;";
        
        btn.onclick = (e) => {
            e.stopPropagation();
            const rect = btn.getBoundingClientRect();
            list.style.display = list.style.display === "none" ? "block" : "none";
            list.style.top = (rect.bottom + window.scrollY + 5) + "px";
            list.style.left = rect.left + "px";
            if (!list.parentElement) document.body.appendChild(list);
        };

        document.addEventListener('click', () => { if(list) list.style.display = 'none'; });
        list.onclick = (e) => e.stopPropagation();

        hiddenEntries.forEach(he => {
            const item = document.createElement("div");
            item.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:5px; font-size:0.85em; border-bottom:1px solid #333; padding-bottom:3px;";
            const icon = he.isMuted ? 'ph-eye-slash' : 'ph-eye';
            item.innerHTML = `
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color: ${he.isMuted ? '#aaa' : '#fff'}">${he.name}</span>
                <button class="btn-icon" style="padding:0 4px;" title="${t('web.btn_show')}"><i class="ph ${icon}"></i></button>
            `;
            item.querySelector('button').onclick = () => {
                const hBtn = document.getElementById(`mt-hide-${he.index}`);
                const hmBtn = document.getElementById(`mt-hide-mute-${he.index}`);
                if (he.isMuted && hmBtn) hmBtn.click();
                else if (hBtn) hBtn.click();
                
                // Close if no more
                if (hiddenEntries.length <= 1) list.style.display = 'none';
            };
            list.appendChild(item);
        });

        container.appendChild(btn);
    }
}
