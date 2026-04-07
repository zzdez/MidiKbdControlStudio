let currentMode = "WIN";
let websocket;
let currentProfile = null;
let currentActivePlayer = 'youtube';
let isInitialSettingsLoad = true;
let sidebarUserOverride = false;

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
window._ = t; // Alias for other components (Drum Machine, etc.)

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

    if (typeof renderDrumMixer === 'function') {
        renderDrumMixer();
    }
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

// --- AUDIO CUES (COUNT-INS) ---
let currentCues = [];
let pendingCueTime = null;
let lastPlayedCueId = null;

// --- WEB LINKS ---
let webLinks = [];
let currentWebLinkIndex = -1;
let currentWebLinkTrackList = [];

// --- GLOBAL DEVICE STATUS ---
let currentDeviceName = "Aucun";
let currentConnectionMode = "MIDO";
let currentIsConnected = false;
let lastEditContext = null; // 'setlist' or 'library'

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

/**
 * Airstep V55: Global Toast Notification System
 * type: 'success', 'error', 'info', 'warning'
 */
function showToast(message, type = "info") {
    console.log(`[TOAST] [${type.toUpperCase()}] ${message}`);
    const existing = document.getElementById("airstep-toast-container");
    let container = existing;
    
    if (!container) {
        container = document.createElement("div");
        container.id = "airstep-toast-container";
        container.style.cssText = "position:fixed; top:20px; right:20px; z-index:10000; display:flex; flex-direction:column; gap:10px; pointer-events:none;";
        document.body.appendChild(container);
    }
    
    const toast = document.createElement("div");
    toast.style.cssText = `
        padding: 12px 24px; border-radius: 8px; 
        color: white; font-weight: bold; min-width: 200px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5);
        background: ${type === 'success' ? '#03dac6' : (type === 'error' ? '#cf6679' : (type === 'warning' ? '#ffb74d' : '#bb86fc'))};
        transform: translateX(100%); transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        pointer-events: auto; font-family: 'Segoe UI', sans-serif;
    `;
    toast.innerText = message;
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.style.transform = "translateX(0)", 10);
    
    // Cleanup
    setTimeout(() => {
        toast.style.transform = "translateX(120%)";
        setTimeout(() => toast.remove(), 500);
    }, 4000);
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

// --- HEADER VISIBILITY HELPER (V56: Robust 3-column / 2-row layout) ---
function updateHeaderVisibility(show) {
    const info = document.getElementById("global-video-info");
    const bottom = document.getElementById("header-bottom-row");
    const cover = document.getElementById("global-video-cover");
    const center = document.getElementById("header-center-column");
    
    const displayVal = show ? "flex" : "none";
    if (info) info.style.display = displayVal;
    if (bottom) bottom.style.display = displayVal;
    if (center) center.style.display = displayVal;
    if (cover) cover.style.display = show ? "block" : "none";
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
                // TRAINING HOOK: Autoreplay YouTube
                if (window.MediaTrainingManager && window.MediaTrainingManager.video && window.MediaTrainingManager.video.active) {
                    const now = Date.now();
                    if (now - window.MediaTrainingManager.lastCycleEnd > 500) {
                        window.MediaTrainingManager.lastCycleEnd = now;
                        window.MediaTrainingManager.onCycleEnd('video');
                    }
                }
            } else {
                player.seekTo(0);
                player.pauseVideo();
                updatePlayPauseIcon('video', false);
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
        loadLocalFiles(); // Load local early for interconnection
        loadWebLinks();  // Load web links early for interconnection
        loadApps();
        checkMissingItems(); // Check for orphans on startup
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
    document.getElementById("tab-web-links").classList.toggle("active", viewName === "web-links");

    // Containers
    document.getElementById("view-library").style.display = viewName === "library" ? "block" : "none";
    document.getElementById("view-apps").style.display = viewName === "apps" ? "block" : "none";
    document.getElementById("view-local").style.display = viewName === "local" ? "block" : "none";
    document.getElementById("view-web-links").style.display = viewName === "web-links" ? "block" : "none";

    if (viewName === "local") {
        loadLocalFiles();
        checkMissingItems();
    } else if (viewName === "web-links") {
        loadWebLinks();
    }
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
    checkMissingItems(); // Sync bulk banner
}

// --- WEB LINKS CRUD ---
async function loadWebLinks() {
    try {
        const res = await fetch("/api/web_links");
        if (res.ok) {
            const rawList = await res.json();
            console.log("[LOAD_WEB] Items loaded:", rawList.length, rawList);
            webLinks = rawList.map((link, idx) => ({ ...link, originalIndex: idx }));
            currentWebLinkTrackList = [...webLinks];
        }
    } catch (e) {
        console.error("Web Links load error:", e);
        logToBackend("[LOAD_WEB] ERROR: " + e.message);
    }
    console.log("[LOAD_WEB] Rendering links...");
    renderWebLinks();
}

function renderWebLinks() {
    const tbody = document.getElementById("web-links-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const fArtist = document.getElementById("filter-web-artist").value.toLowerCase();
    const fTitle = document.getElementById("filter-web-title").value.toLowerCase();

    const filtered = currentWebLinkTrackList.filter(l => {
        const matchArtist = (l.artist || "").toLowerCase().includes(fArtist);
        const matchTitle = (l.title || "").toLowerCase().includes(fTitle);
        return matchArtist && matchTitle;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:gray;">${t("web.msg_no_result")}</td></tr>`;
        return;
    }

    filtered.forEach(link => {
        const realIndex = link.originalIndex;
        const tr = document.createElement("tr");
        
        let iconHtml = `<i class="ph ph-globe" style="font-size:1.2em; color:var(--accent);"></i>`;
        
        // V55: Show Site Icon (Favicon) for Web Links by default (Priority)
        const favIcon = getIcon(link.url);
        const isYoutube = link.url && (link.url.includes('youtube.com') || link.url.includes('youtu.be'));

        if (favIcon && !isYoutube) {
             iconHtml = `<img src="${favIcon}" style="width:20px; height:20px; border-radius:4px; vertical-align:middle;">`;
        } else if (link.cover) {
            const coverUrl = link.cover.startsWith('http') ? link.cover : `/api/cover?path=${encodeURIComponent(link.cover)}&t=${Date.now()}`;
            iconHtml = `<img src="${coverUrl}" style="width:24px; height:24px; border-radius:4px; vertical-align:middle; object-fit:cover; border:1px solid rgba(255,255,255,0.1);">`;
        }


        // V55: Show Link Indicator
        const linkCount = (link.linked_ids || []).length;
        const linkIndicator = linkCount > 0 
            ? `<span class="link-badge active" style="margin-right:8px;" title="${linkCount} liens actifs"><i class="ph ph-link-simple"></i>${linkCount > 1 ? `<span class="count">${linkCount}</span>` : ""}</span>`
            : `<span class="link-badge" style="margin-right:8px; opacity:0.3;"><i class="ph ph-link-simple"></i></span>`;

        tr.innerHTML = `
            <td style="text-align:center;">${iconHtml}</td>
            <td>${link.artist || ""}</td>
            <td style="cursor:pointer; color:var(--accent);" onclick="playWebLink(${realIndex})">
                ${linkIndicator}
                ${link.title || link.url}
            </td>
            <td style="text-align:right;">
                <button class="btn-action" onclick="openWebLinkModal(${realIndex})" title="${t("web.btn_edit")}">✎</button>
                <button class="btn-action" onclick="deleteWebLink(${realIndex})" style="color:#cf6679;" title="${t("web.btn_delete")}">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openWebLinkModal(index = -1) {
    currentWebLinkIndex = index;
    // V55: Initialize linked IDs for session
    currentEditingLinkedIds = (index === -1) ? [] : (webLinks[index].linked_ids || []);
    
    const modal = document.getElementById("modal-web-link");
    const titleEl = document.getElementById("web-link-modal-title");

    // Reset Cover
    document.getElementById("web-link-art-img").src = "";
    document.getElementById("web-link-art-img").style.display = "none";
    document.getElementById("web-link-art-placeholder").style.display = "flex";
    document.getElementById("btn-web-link-delete-cover").style.display = "none";
    window.currentWebLinkCover = null;

    if (index === -1) {
        titleEl.innerText = t("web.modal_web_link_title_add", "Ajouter un Lien Web");
        document.getElementById("web-link-title").value = "";
        document.getElementById("web-link-artist").value = "";
        document.getElementById("web-link-url").value = "";
        document.getElementById("web-link-type").value = "other";
        document.getElementById("web-link-category").value = "";
        document.getElementById("web-link-genre").value = "";
        document.getElementById("web-link-notes").value = "";
        
        // New fields
        document.getElementById("web-link-vol").value = 100;
        document.getElementById("web-link-volume-percent").innerText = "100%";
        document.getElementById("web-link-bpm").value = "";
        document.getElementById("web-link-key").value = "";
        document.getElementById("web-link-scale").value = "";
        document.getElementById("web-link-tuning").value = "standard";
    } else {
        const link = webLinks[index];
        titleEl.innerText = t("web.modal_web_link_title_edit", "Modifier le Lien Web");
        document.getElementById("web-link-title").value = link.title || "";
        document.getElementById("web-link-artist").value = link.artist || "";
        document.getElementById("web-link-url").value = link.url || "";
        document.getElementById("web-link-type").value = link.type || "other";
        document.getElementById("web-link-category").value = link.category || "";
        document.getElementById("web-link-genre").value = link.genre || "";
        document.getElementById("web-link-notes").value = link.notes || "";
        
        // New fields
        document.getElementById("web-link-vol").value = link.volume !== undefined ? link.volume * 100 : 100;
        document.getElementById("web-link-volume-percent").innerText = (link.volume !== undefined ? Math.round(link.volume * 100) : 100) + "%";
        document.getElementById("web-link-bpm").value = link.bpm || "";
        document.getElementById("web-link-key").value = link.key || "";
        document.getElementById("web-link-scale").value = link.scale || "";
        document.getElementById("web-link-tuning").value = link.tuning || "standard";

        // Cover
        if (link.cover) {
            window.currentWebLinkCover = link.cover;
            const img = document.getElementById("web-link-art-img");
            img.src = link.cover.startsWith('http') ? link.cover : `/api/cover?path=${encodeURIComponent(link.cover)}&t=${Date.now()}`;
            img.style.display = "block";
            document.getElementById("web-link-art-placeholder").style.display = "none";
            document.getElementById("btn-web-link-delete-cover").style.display = "flex";
        }
    }
    modal.showModal();
}

function closeWebLinkModal() {
    document.getElementById("modal-web-link").close();
}

async function handleWebLinkCover(input) {
    if (input.files && input.files[0]) {
        const formData = new FormData();
        formData.append('file', input.files[0]);
        // Reusing standard cover upload endpoint if possible, or we might need a specific one.
        // Usually /api/upload_cover works for any media if we don't strictly bind it to a track index during upload.
        // Let's assume we can upload a generic cover.
        try {
            const res = await fetch("/api/upload_cover_generic", {
                method: "POST",
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                window.currentWebLinkCover = data.path;
                const img = document.getElementById("web-link-art-img");
                img.src = `/api/cover?path=${encodeURIComponent(data.path)}&t=${Date.now()}`;
                img.style.display = "block";
                document.getElementById("web-link-art-placeholder").style.display = "none";
                document.getElementById("btn-web-link-delete-cover").style.display = "flex";
            }
        } catch (e) { console.error("Cover upload error:", e); }
    }
}

function removeWebLinkCover() {
    window.currentWebLinkCover = null;
    document.getElementById("web-link-art-img").src = "";
    document.getElementById("web-link-art-img").style.display = "none";
    document.getElementById("web-link-art-placeholder").style.display = "flex";
    document.getElementById("btn-web-link-delete-cover").style.display = "none";
}

async function saveWebLink() {
    // V55: Last resort recovery of cover from UI if global is null
    let coverToSave = window.currentWebLinkCover;
    
    // V55: SECURITY - Never save a directory path as a cover (e.g. Multitrack folders)
    if (coverToSave && !coverToSave.startsWith("http") && !coverToSave.startsWith("data:")) {
        console.warn("[SAVE_WEB] Filtered out folder path from cover:", coverToSave);
        coverToSave = null;
    }

    if (!coverToSave) {
        const uiImg = document.getElementById("web-link-art-img");
        if (uiImg && uiImg.style.display !== "none" && uiImg.src && !uiImg.src.endsWith('/')) {
            const src = uiImg.src;
            if (src.includes("/api/cover?path=")) {
                coverToSave = decodeURIComponent(src.split("path=")[1].split("&")[0]);
            } else if (src.startsWith("http")) {
                coverToSave = src;
            }
        }
    }

    const payload = {
        title: document.getElementById("web-link-title").value,
        artist: document.getElementById("web-link-artist").value,
        url: document.getElementById("web-link-url").value,
        type: document.getElementById("web-link-type").value,
        category: document.getElementById("web-link-category").value,
        genre: document.getElementById("web-link-genre").value,
        notes: document.getElementById("web-link-notes").value,
        volume: document.getElementById("web-link-vol") ? parseInt(document.getElementById("web-link-vol").value) : 100,
        bpm: document.getElementById("web-link-bpm")?.value || null,
        metadata: {
            key: document.getElementById("web-link-key")?.value || null,
            scale: document.getElementById("web-link-scale")?.value || null,
            tuning: document.getElementById("web-link-tuning")?.value || "standard"
        },
        cover: coverToSave || null,
        linked_ids: currentEditingLinkedIds
    };

    console.log("[SAVE_WEB] Final Payload:", payload);
    console.warn("[SAVE_WEB] window.currentWebLinkCover before save:", window.currentWebLinkCover);
    logToBackend(`[SAVE_WEB] Payload Cover: ${payload.cover} | Global: ${window.currentWebLinkCover}`);

    const method = currentWebLinkIndex === -1 ? "POST" : "PUT";
    const url = currentWebLinkIndex === -1 ? "/api/web_links" : `/api/web_links/${currentWebLinkIndex}`;

    console.log("[SAVE_WEB] Method:", method, "URL:", url);
    try {
        const res = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            const data = await res.json();
            console.log("[SAVE_WEB] SUCCESS", data);
            
            // i18n Fix: The key is flat, not nested under 'web'
            showToast(t("msg_save_success"), "success");
            
            const modalEl = document.getElementById("modal-web-link");
            if (modalEl && modalEl.close) modalEl.close();
            loadWebLinks();
        } else {
            const errBody = await res.text();
            console.error("[SAVE_WEB] SERVER ERROR:", res.status, errBody);
            logToBackend("[SAVE_WEB] SERVER ERROR: " + res.status + " " + errBody);
            alert("Erreur lors de la sauvegarde: " + res.status + " " + errBody);
        }
    } catch (e) {
        console.error("[SAVE_WEB] NETWORK ERROR:", e);
        logToBackend("[SAVE_WEB] NETWORK ERROR: " + e.message);
        alert("Erreur réseau: " + e.message);
    }
}

async function deleteWebLink(index) {
    if (!confirm(t("web.msg_confirm_delete", "Supprimer ce lien ?"))) return;
    try {
        await fetch(`/api/web_links/${index}`, { method: "DELETE" });
        loadWebLinks();
    } catch (e) { console.error("Delete Web Link error:", e); }
}

function playWebLink(index) {
    const link = webLinks[index];
    if (!link) return;
    
    // Open in browser
    fetch(`/api/open_external?url=${encodeURIComponent(link.url)}`);
    
    // Update active highlight (visual only)
    window.currentSource = 'web_links';
    window.currentPlayingIndex = index;
    renderWebLinks();
    
    // Trigger Interconnection UI
    updateInterconnectionUI(link);
}

// --- SORT WEB LINKS ---
let currentWebSortKey = 'artist';
let currentSortOrderWeb = 'asc';

function sortWebLinks(key) {
    if (currentWebSortKey === key) {
        currentSortOrderWeb = (currentSortOrderWeb === 'asc' ? 'desc' : 'asc');
    } else {
        currentWebSortKey = key;
        currentSortOrderWeb = 'asc';
    }

    currentWebLinkTrackList.sort((a, b) => {
        let valA = (a[key] || "").toString().toLowerCase();
        let valB = (b[key] || "").toString().toLowerCase();
        
        if (valA < valB) return currentSortOrderWeb === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortOrderWeb === 'asc' ? 1 : -1;
        return 0;
    });

    renderWebLinks();
}

// --- INTERCONNECTION ENGINE ---
function getLocalType(item) {
    if (item.is_multitrack) return 'multitrack';
    if (item.path && item.path.match(/\.(mp4|mkv|mov|avi|webm|m4v)$/i)) return 'video';
    return 'audio';
}

function updateInterconnectionUI(activeItem) {
    const container = document.getElementById("header-interconnection-links");
    if (!container) return;
    container.innerHTML = "";

    if (!activeItem) return;

    const matches = {
        youtube: [],
        audio_local: [],
        video_local: [],
        multitrack_local: [],
        songsterr: [],
        moises: [],
        spotify: [],
        lesson: [],
        other: []
    };

    const currentUID = `${window.currentSource.substring(0, 3)}:${window.currentPlayingIndex}`;
    const headerBottomRow = document.getElementById("header-bottom-row");
    const globalInfoRow = document.getElementById("global-video-info");

    if (globalInfoRow) globalInfoRow.style.display = "flex";


    // 0. Manual Links (Priority)
    if (activeItem.linked_ids && activeItem.linked_ids.length > 0) {
        activeItem.linked_ids.forEach(uid => {
            const item = getLinkedItem(uid);
            if (!item) return;
            
            // Determine category
            if (uid.startsWith('set')) matches.youtube.push(item);
            else if (uid.startsWith('lib')) {
                const type = getLocalType(item);
                if (type === 'video') matches.video_local.push(item);
                else if (type === 'multitrack') matches.multitrack_local.push(item);
                else matches.audio_local.push(item);
            }
            else if (uid.startsWith('web')) {
                const type = item.type || 'other';
                if (matches[type]) matches[type].push(item);
                else matches.other.push(item);
            }
        });
    }

    // 1. Auto Search
    const artist = (activeItem.artist || "").toLowerCase().trim();
    const title = (activeItem.title || "").toLowerCase().trim();

    if (artist || title) {
        // Search in YouTube Setlist
        currentTrackList.forEach((t, idx) => {
            const uid = `set:${idx}`;
            if (activeItem.linked_ids && activeItem.linked_ids.includes(uid)) return; // Already added
            if (isMatch(t, artist, title) && idx !== (window.currentSource === 'setlist' ? window.currentPlayingIndex : -1)) {
                matches.youtube.push(t);
            }
        });

        // Search in Local Files
        if (typeof localFiles !== 'undefined') {
            localFiles.forEach((f, idx) => {
                const uid = `lib:${idx}`;
                if (activeItem.linked_ids && activeItem.linked_ids.includes(uid)) return; // Already added
                if (isMatch(f, artist, title) && idx !== (window.currentSource === 'library' ? window.currentPlayingIndex : -1)) {
                    const type = getLocalType(f);
                    const itemToAdd = { ...f, originalIndex: idx };
                    if (type === 'video') matches.video_local.push(itemToAdd);
                    else if (type === 'multitrack') matches.multitrack_local.push(itemToAdd);
                    else matches.audio_local.push(itemToAdd);
                }
            });
        }

        // Search in Web Links
        if (typeof webLinks !== 'undefined') {
            webLinks.forEach((w, idx) => {
                const uid = `web:${idx}`;
                if (activeItem.linked_ids && activeItem.linked_ids.includes(uid)) return; // Already added
                if (isMatch(w, artist, title) && idx !== (window.currentSource === 'web_links' ? window.currentPlayingIndex : -1)) {
                    const type = w.type || 'other';
                    const itemToAdd = { ...w, originalIndex: idx };
                    if (matches[type]) matches[type].push(itemToAdd);
                    else matches.other.push(itemToAdd);
                }
            });
        }
    }

    // Render Icons
    const renderIcon = (type, list, iconClass, color, titlePrefix) => {
        if (list.length > 0) {
            const btn = document.createElement("button");
            btn.className = "btn-icon-small";
            btn.style.color = color;
            
            // SPECIAL: Web Links show Real Favicons
            const isLocalOrYT = ['youtube', 'audio_local', 'video_local', 'multitrack_local'].includes(type);
            if (!isLocalOrYT && list[0].url) {
                const iconUrl = getIcon(list[0].url);
                if (iconUrl) {
                    btn.innerHTML = `<img src="${iconUrl}" style="width:18px; height:18px; border-radius:3px; vertical-align:middle;">`;
                } else {
                    btn.innerHTML = `<i class="${iconClass}"></i>`;
                }
            } else {
                btn.innerHTML = `<i class="${iconClass}"></i>`;
            }

            // Multiple matches indicator
            if (list.length > 1) {
                const badge = document.createElement("span");
                badge.style = "position:absolute; top:-5px; right:-5px; background:var(--accent); color:var(--bg-color); font-size:9px; font-weight:bold; border-radius:50%; width:14px; height:14px; display:flex; align-items:center; justify-content:center; border:1px solid var(--bg-color);";
                badge.innerText = list.length;
                btn.style.position = "relative";
                btn.appendChild(badge);
            }

            btn.title = `${titlePrefix} (${list.length} item${list.length > 1 ? 's' : ''})`;
            btn.onclick = () => {
                if (list.length === 1) {
                    const item = list[0];
                    if (type === 'youtube') playTrackAt(item.originalIndex);
                    else if (type.endsWith('_local')) playLocal(item.originalIndex);
                    else playWebLink(item.originalIndex);
                } else {
                    openInterconnectionChoice(type, list);
                }
            };
            container.appendChild(btn);
        }
    };

    renderIcon('youtube', matches.youtube, 'ph ph-youtube-logo', '#ff0000', 'YouTube');
    renderIcon('audio_local', matches.audio_local, 'ph ph-music-notes', '#03dac6', t('web.lbl_interconnect_audio') || 'Audio');
    renderIcon('video_local', matches.video_local, 'ph ph-film-strip', '#ffb86c', t('web.lbl_interconnect_video') || 'Video');
    renderIcon('multitrack_local', matches.multitrack_local, 'ph ph-stack-simple', '#bb86fc', t('web.lbl_interconnect_multitrack') || 'Multitrack');
    renderIcon('songsterr', matches.songsterr, 'ph ph-guitar', '#f39c12', 'Songsterr');
    renderIcon('moises', matches.moises, 'ph ph-scissors', '#9b59b6', 'Moises');
    renderIcon('spotify', matches.spotify, 'ph ph-spotify-logo', '#1db954', 'Spotify');
    renderIcon('lesson', matches.lesson, 'ph ph-graduation-cap', '#3498db', 'Lesson');
    renderIcon('other', matches.other, 'ph ph-globe', '#999', 'Autre');

    // Show/Hide the entire row based on matches (V53)
    if (headerBottomRow) {
        const hasMatches = Object.values(matches).some(m => m.length > 0);
        headerBottomRow.style.display = hasMatches ? "flex" : "none";
    }
}

function openInterconnectionChoice(type, list) {
    const dialog = document.getElementById("modal-interconnection-choice");
    const listContainer = document.getElementById("interconnection-choice-list");
    if (!dialog || !listContainer) return;

    listContainer.innerHTML = "";
    
    // Icon mapping for the modal
    const icons = {
        youtube: 'ph ph-youtube-logo',
        audio_local: 'ph ph-music-notes',
        video_local: 'ph ph-film-strip',
        multitrack_local: 'ph ph-stack-simple',
        songsterr: 'ph ph-guitar',
        moises: 'ph ph-scissors',
        spotify: 'ph ph-spotify-logo',
        lesson: 'ph ph-graduation-cap',
        other: 'ph ph-globe'
    };
    const iconClass = icons[type] || 'ph ph-link';

    list.forEach(item => {
        const btn = document.createElement("button");
        btn.className = "btn-secondary";
        btn.style = "width:100%; display:flex; align-items:center; gap:12px; padding:12px; text-align:left; border-radius:8px; background:rgba(255,255,255,0.03);";
        
        let coverHtml = "";
        if (type.endsWith('_local')) {
            coverHtml = `<img src="/api/local/art/${item.originalIndex}" style="width:40px; height:25px; object-fit:cover; border-radius:4px; background:#222;" onerror="this.style.display='none'">`;
        } else if (type === 'youtube') {
            coverHtml = `<img src="https://img.youtube.com/vi/${item.url.split('v=')[1]?.split('&')[0]}/default.jpg" style="width:40px; height:25px; object-fit:cover; border-radius:4px;" onerror="this.style.display='none'">`;
        }

        btn.innerHTML = `
            ${coverHtml}
            <div style="flex:1; overflow:hidden;">
                <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title}</div>
                <div style="font-size:0.8em; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.artist || ""}</div>
            </div>
            <i class="ph ph-caret-right" style="color:var(--accent);"></i>
        `;

        btn.onclick = () => {
            dialog.close();
            if (type === 'youtube') playTrackAt(item.originalIndex);
            else if (type.endsWith('_local')) playLocal(item.originalIndex);
            else playWebLink(item.originalIndex);
        };

        listContainer.appendChild(btn);
    });

    dialog.showModal();
}

function isMatch(item, artist, title) {
    const itemArtist = (item.artist || "").toLowerCase().trim();
    const itemTitle = (item.title || "").toLowerCase().trim();

    // Strategy 1: Artist AND Title match (robust)
    if (artist && title && itemArtist.includes(artist) && itemTitle.includes(title)) return true;
    
    // Strategy 2: Exact Title match if artist is missing or doesn't match perfectly
    if (title && itemTitle === title) return true;

    return false;
}

function getLinkedItem(uid) {
    const [type, idxStr] = uid.split(':');
    const idx = parseInt(idxStr);
    
    // Safety: check if list exists before searching
    const findIn = (list, i) => {
        if (!list || list.length === 0) return null;
        // Search by originalIndex FIRST, then fallback to direct array index if possible
        return list.find(t => t.originalIndex === i) || (i >= 0 && i < list.length ? list[i] : null);
    };
    
    if (type === 'set') return findIn(currentTrackList, idx);
    if (type === 'lib') return findIn(localFiles, idx);
    if (type === 'web') return findIn(webLinks, idx);
    return null;
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
        tr.setAttribute('data-index', realIndex); // Attribut technique pour robustesse V7.2
        if (realIndex === window.currentPlayingIndex) {
            tr.classList.add('active');
        }

        const isMissing = track.is_missing === true;
        if (isMissing) tr.classList.add('track-missing');

        const iconUrl = getIcon(track.url);
        let iconImg = iconUrl ? `<img src="${iconUrl}" style="width:16px; height:16px; margin-right:8px; vertical-align:middle;">` : '';
        
        if (isMissing) {
            iconImg = `<i class="ph ph-warning-circle" style="margin-right:8px; vertical-align:middle;" title="Fichier introuvable"></i>`;
        }

        const linkCount = (track.linked_ids || []).length;
        const linkIndicator = linkCount > 0 
            ? `<span class="link-badge active" style="margin-right:8px;" title="${linkCount} liens actifs"><i class="ph ph-link-simple"></i>${linkCount > 1 ? `<span class="count">${linkCount}</span>` : ""}</span>`
            : `<span class="link-badge" style="margin-right:8px; opacity:0.3;"><i class="ph ph-link-simple"></i></span>`;

        // Swapped Columns: Artist | Title (with icon) | Category
        tr.innerHTML = `
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${track.artist || ""}</td>
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">
                ${linkIndicator}${iconImg}${track.title || track.url}
            </td>
            <td style="cursor:pointer;" onclick="playTrackAt(${realIndex})">${track.category || ""}</td>
            <td style="text-align:right;">
                <button class="btn-action" onclick="openEditModal(${realIndex})" title="${t("web.btn_edit")}">✎</button>
                <button class="btn-action" onclick="deleteTrack(${realIndex})" style="color:#cf6679;" title="${t("web.btn_delete")}">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDatalists(currentTrackList);
    
    // Auto-highlight active track in the newly rendered list
    if (typeof refreshSetlistHighlights === "function") refreshSetlistHighlights();
    
    // Auto-scroll to active item after a short delay to let browser render
    setTimeout(scrollToActiveTrack, 100);
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

            // Sync Fretboard State if loaded
            if (typeof fretboardState !== 'undefined') {
                fretboardState.skin = currentSettings.fretboard_skin || "flat";
            }

            // Sync Header Buttons
            updateSidebarButtonsUI();

            // Apply sidebar default state (ONLY on first application load)
            if (isInitialSettingsLoad && currentSettings.sidebar_default_hidden === true) {
                isInitialSettingsLoad = false; // Consumption of the initial flag
                // We use setTimeout to ensure the DOM is ready and the toggle doesn't conflict with initial layout
                setTimeout(() => {
                    toggleTheaterMode(true);
                }, 100);
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

        const fbSkin = document.getElementById("setting-fretboard-skin");
        if (fbSkin) fbSkin.value = currentSettings.fretboard_skin || "flat"; // Default

        const fbAutoClose = document.getElementById("setting-fretboard-autoclose");
        if (fbAutoClose) fbAutoClose.checked = currentSettings.fretboard_autoclose || false;

        // Interface Settings
        const saCb = document.getElementById("setting-sidebar-autohide");
        if (saCb) saCb.checked = currentSettings.sidebar_autohide === true;

        const sdhCb = document.getElementById("setting-sidebar-default-hidden");
        if (sdhCb) sdhCb.checked = currentSettings.sidebar_default_hidden === true;

        const shtCb = document.getElementById("setting-sidebar-hover-trigger");
        if (shtCb) shtCb.checked = currentSettings.sidebar_hover_trigger === true;

        renderSettingsFolders();

        // Show Modal
        document.getElementById("settings-modal").showModal();
        switchSettingsTab('general'); // Reset to first tab
    }
}

function changeFretboardSkin() {
    const selector = document.getElementById("setting-fretboard-skin");
    if (!selector) return;

    // Live update if the fretboard is open
    if (typeof fretboardState !== 'undefined') {
        fretboardState.skin = selector.value;
        renderFretboard();
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
    document.getElementById("tab-settings-storage").style.display = "none";
    document.getElementById("tab-settings-controller").style.display = "none";

    // Deactivate Buttons
    const btns = document.querySelectorAll(".settings-nav .nav-btn");
    btns.forEach(b => b.classList.remove("active"));

    // Show Target
    const target = document.getElementById(`tab-settings-${tabName}`);
    if (target) target.style.display = "block";

    // Activate Button (Mapping correct avec l'ordre de l'index.html)
    const map = { 'general': 0, 'library': 1, 'storage': 2, 'controller': 3 };
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

    const fbSkin = document.getElementById("setting-fretboard-skin");
    if (fbSkin) {
        currentSettings.fretboard_skin = fbSkin.value;
        if (typeof fretboardState !== 'undefined') {
            fretboardState.skin = fbSkin.value;
            renderFretboard();
        }
    }

    const fbAutoClose = document.getElementById("setting-fretboard-autoclose");
    if (fbAutoClose) {
        currentSettings.fretboard_autoclose = fbAutoClose.checked;
    }

    // Sidebar Settings (Now handled via toggleSidebarOption in header)
    // - Deleted from here to avoid overwriting on-the-fly choices -

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
    lastEditContext = 'setlist';
    // Find track by original index in the current (possibly sorted) list
    const track = currentTrackList.find(t => t.originalIndex === index);
    if (!track) return;

    // Reveal sidebar if in theater mode to give context to editing
    if (isTheaterMode && typeof toggleTheaterMode === 'function') {
        toggleTheaterMode(false);
    }

    document.getElementById("media-modal").showModal();
    
    // Auto-scroll in background
    setTimeout(scrollToActiveTrack, 200);

    // Fill Form
    document.getElementById("yt-search-input").value = "";
    document.getElementById("search-results").innerHTML = ""; // Clear old search

    document.getElementById("edit-title").value = track.title;
    document.getElementById("edit-artist").value = track.artist || "";
    document.getElementById("edit-channel").value = track.channel || "";
    
    const urlField = document.getElementById("edit-url");
    urlField.value = track.url;
    urlField.parentElement.style.display = "block"; // Show URL for YouTube
    document.getElementById("yt-local-path-container").style.display = "none"; // Hide local path for YouTube
    document.getElementById("search-zone-container").style.display = "block"; // Ensure search zone is available for YouTube
    document.getElementById("edit-category").value = track.category || "Général";
    document.getElementById("edit-genre").value = track.genre || "Divers";
    document.getElementById("edit-mode").value = track.open_mode || "auto";
    document.getElementById("edit-target-profile").value = track.target_profile || "Auto";
    document.getElementById("edit-bpm").value = track.bpm || "";
    document.getElementById("edit-key").value = track.key || "";
    document.getElementById("edit-media-key").value = track.media_key || "";
    document.getElementById("edit-scale").value = track.scale || "";
    document.getElementById("edit-tuning").value = track.tuning || "standard";
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
        scale: document.getElementById("edit-scale").value,
        tuning: document.getElementById("edit-tuning").value,
        original_pitch: document.getElementById("edit-original-pitch").value,
        target_pitch: document.getElementById("edit-target-pitch").value,
        subtitle_enabled: window.tempModalSubEnabled || false,
        subtitle_pos_y: 100 - parseInt(document.getElementById("edit-sub-pos").value || 20, 10),
        autoplay: document.getElementById("edit-autoplay").checked,
        autoreplay: document.getElementById("edit-autoreplay").checked,
        linked_ids: (editingIndex !== null && currentTrackList[editingIndex]) ? (currentTrackList[editingIndex].linked_ids || []) : []
    };

    if (editingIndex !== null) {
        // UPDATE
        await fetch(`/api/setlist/${editingIndex}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // Only update live UI if the currently playing track is the one we just edited
        if (currentActivePlayer === 'youtube' && window.currentPlayingIndex === editingIndex) {
            window.currentAutoreplay = payload.autoreplay;
            updatePlaybackOptionsUI(payload.autoreplay, payload.autoplay);
        }
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
    currentActivePlayer = null; // Important to prevent clearLoop from restarting old media during transition

    if (window.currentMultitrackAbortController) {
        window.currentMultitrackAbortController.abort();
        window.currentMultitrackAbortController = null;
    }

    if (window.currentMultitrackBlobUrls) {
        window.currentMultitrackBlobUrls.forEach(url => {
            try { URL.revokeObjectURL(url); } catch(e){}
        });
        window.currentMultitrackBlobUrls = [];
    }

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

    // Hide Loop Overlay
    const visualOverlay = document.getElementById("mt-visual-loop-overlay");
    if (visualOverlay) visualOverlay.style.display = "none";
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
    if (track.is_missing === true) {
        openMissingFileModal(track, 'setlist');
        return;
    }
    window.currentSource = 'setlist';
    window.currentPlayingIndex = track.originalIndex;
    
    // Sync UI Highlight immediately
    if (typeof refreshSetlistHighlights === "function") refreshSetlistHighlights();

    const ytDiv = document.getElementById("player");
    const genFrame = document.getElementById("generic-player");
    const html5 = document.getElementById("html5-player");
    // STOP ALL MEDIA first
    stopAllMedia();

    // Fretboard intelligent handling on track change
    if (typeof fretboardState !== 'undefined' && fretboardState.visible) {
        if (currentSettings && currentSettings.fretboard_autoclose) {
             toggleFretboard(); // Close it
        } else {
             // Keep it open but update to new track scale
             setTimeout(() => {
                  detectCurrentScale();
                  renderFretboard();
             }, 500);
        }
    }

    // Auto-hide sidebar if setting is enabled (ONLY IF user hasn't manually opened it)
    if (currentSettings && currentSettings.sidebar_autohide && !isTheaterMode && !sidebarUserOverride) {
        toggleTheaterMode(true);
    } else {
        // Ensure scroll even if sidebar stays open
        setTimeout(scrollToActiveTrack, 500);
    }

    const globalTitle = document.getElementById("global-video-title");
    const globalBpm = document.getElementById("global-video-bpm");
    updateHeaderScaleDisplay(track);

    // Determine Autoplay/Autoreplay
    // Important: if not defined in track, we use global settings, but we assign it to memory
    // so any subsequent save from modals or UI doesn't send "undefined"
    if (track.autoplay === undefined) track.autoplay = (currentSettings.autoplay || false);
    if (track.autoreplay === undefined) track.autoreplay = (currentSettings.autoreplay || false);

    const isAutoplay = track.autoplay;
    const isAutoreplay = track.autoreplay;
    window.currentAutoreplay = isAutoreplay; // Global state for end-of-track logic
    updatePlaybackOptionsUI(isAutoreplay, isAutoplay);

    // Reset Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");
    const multitrackContainer = document.getElementById("multitrack-container");
    videoContainer.style.display = "flex";
    audioContainer.style.display = "none";
    if (multitrackContainer) multitrackContainer.style.display = "none";

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
    // If sidebar autohide is enabled, hide it now
    if (currentSettings && currentSettings.sidebar_autohide && !isTheaterMode) {
        toggleTheaterMode(true);
    }
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

        // GLOBAL HEADER
        updateHeaderVisibility(true);

        globalTitle.innerText = track.title || track.url;
        if (track.bpm) { globalBpm.style.display = "inline"; globalBpm.querySelector(".val").innerText = track.bpm; } else { globalBpm.style.display = "none"; }
        updateHeaderScaleDisplay(track);

        const globalCover = document.getElementById("global-video-cover");
        if (globalCover) {
            globalCover.style.display = "block";
            globalCover.src = track.thumbnail || `https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`;
            globalCover.onerror = () => { globalCover.style.display = "none"; };
        }

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
            if (isAutoplay) {
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

        updateHeaderVisibility(false);


        // SMART EMBED CONVERSION
        // Automatically convert known platforms to Embed URL
        const smartUrl = getEmbedUrl(track.url);

        genFrame.style.display = "block";
        genFrame.src = smartUrl;
    }

    // Load loops AFTER player state is established
    loadLoopsForTrack(track);

    // Update Interconnection UI
    updateInterconnectionUI(track);
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
let isTheaterTransitioning = false;

function toggleTheaterMode(forceState = null) {
    if (isTheaterTransitioning) return;
    
    const newState = (forceState !== null) ? forceState : !isTheaterMode;
    if (newState === isTheaterMode) return;
    
    // If we are SHOWING the sidebar (newState = false), consider it a user override 
    // to prevent Auto-Hide from stealing it back during this session.
    if (newState === false) {
        sidebarUserOverride = true;
    } else {
        // If user manually HIDES, we reset override so Auto-Hide can work again if they want.
        sidebarUserOverride = false;
    }

    isTheaterMode = newState;
    isTheaterTransitioning = true;

    // Elements to toggle
    const sidebar = document.querySelector(".sidebar-zone");
    const pedalboard = document.getElementById("pedalboard-container");
    const mediaZone = document.querySelector(".media-zone");

    if (isTheaterMode) {
        if (sidebar) sidebar.style.display = "none";
        if (pedalboard) pedalboard.style.display = "none";
        if (mediaZone) mediaZone.style.borderRight = "none";
    } else {
        if (sidebar) {
            sidebar.classList.remove('hover-active'); // On nettoie le mode survol si on repasse en mode normal
            sidebar.style.display = "flex"; 
        }
        if (pedalboard) pedalboard.style.display = "block";
        if (mediaZone) mediaZone.style.borderRight = "1px solid #333";
    }

    // Update Header Button UI
    const btnTheater = document.getElementById("btn-toggle-theater");
    if (btnTheater) btnTheater.classList.toggle('active', isTheaterMode);

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
        
        // Finalize transition
        isTheaterTransitioning = false;
        
        // Sync header buttons UI
        if (typeof updateSidebarButtonsUI === 'function') updateSidebarButtonsUI();

    }, 300); // 300ms is enough for the sidebar CSS transition to complete
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
            if (e.altKey) {
                if (typeof fretboardTogglePlay === 'function') fretboardTogglePlay();
                e.preventDefault();
                return;
            }
            command = 'media_play_pause';
            break;
        case 'ArrowLeft':
        case 'KeyJ': // YouTube standard (-10s usually, we do -5s)
            if (e.altKey) {
                if (typeof fretboardNavPosition === 'function') fretboardNavPosition(-1);
                e.preventDefault();
                return;
            }
            if (e.shiftKey) command = 'media_loop_prev';
            else if (e.ctrlKey) command = 'media_chapter_prev';
            else command = 'media_rewind';
            break;
        case 'ArrowRight':
        case 'KeyL': // YouTube standard (+10s usually)
            if (e.altKey) {
                if (typeof fretboardNavPosition === 'function') fretboardNavPosition(1);
                e.preventDefault();
                return;
            }
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
            if (e.altKey) {
                if (typeof adjustFretBpm === 'function') adjustFretBpm(1);
                e.preventDefault(); return;
            }
            if (e.shiftKey) command = 'media_pitch_up';
            else command = 'media_speed_up';
            break;
        case 'ArrowDown':
            if (e.altKey) {
                if (typeof adjustFretBpm === 'function') adjustFretBpm(-1);
                e.preventDefault(); return;
            }
            if (e.shiftKey) command = 'media_pitch_down';
            else command = 'media_speed_down';
            break;
        case 'KeyR':
            command = 'media_loop_toggle';
            break;
        case 'Digit0':
        case 'Numpad0':
        case 'Home':
            if (e.altKey) {
                if (typeof fretboardRestart === 'function') fretboardRestart();
                e.preventDefault();
                return;
            }
            command = 'media_restart';
            break;
        case 'Escape':
            clearLoop();
            updateLoopUI();
            e.preventDefault();
            return;
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
                    const minSeek = (isLoopActive && loopA !== null) ? loopA : 0;
                    player.seekTo(Math.max(minSeek, cur - 5));
                    break;
                case 'media_forward':
                    const curF = player.getCurrentTime();
                    const maxSeekF = (isLoopActive && loopB !== null) ? loopB : Infinity;
                    player.seekTo(Math.min(maxSeekF, curF + 5));
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

        wavesurfer.on('error', (err) => {
            console.error("WaveSurfer Error:", err);
            // If it's a 404 or load error, try to flag as missing
            if (window.currentPlayingIndex !== null) {
                const track = findTrackInLibraryOrSetlist(window.currentPlayingIndex);
                if (track && !track.url?.startsWith('http')) {
                    track.is_missing = true;
                    openMissingFileModal(track);
                }
            }
        });

        wavesurfer.on('ready', () => {
            // Retrieve strictly from the wavesurfer object state so we don't accidentally play
            // a previous song's state if loaded quickly from cache.
            if (wavesurfer._currentIsAutoplay === true) {
                wavesurfer.play();
            } else {
                wavesurfer.pause(); // Explicitly ensure it's not playing if false
            }
            if (isPitchEnabled) connectPitchEngine();
            updatePlayPauseUI();
            updateLoopUI();
            renderLoopsUI();
        });

        wavesurfer.on('finish', () => {
            wavesurfer.pause();
            wavesurfer.seekTo(0);
            if (window.currentAutoreplay === true) {
                wavesurfer.play();
                updatePlayPauseUI();
                // TRAINING HOOK: Local Audio Autoreplay
                if (window.MediaTrainingManager && window.MediaTrainingManager.audio && window.MediaTrainingManager.audio.active) {
                    const now = Date.now();
                    if (now - window.MediaTrainingManager.lastCycleEnd > 500) {
                        window.MediaTrainingManager.lastCycleEnd = now;
                        window.MediaTrainingManager.onCycleEnd('audio');
                    }
                }
            }
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
        const rawLocal = await res.json();
        // Assign originalIndex for safe referencing during relocation/edit
        localFiles = rawLocal.map((f, idx) => ({ ...f, originalIndex: idx }));
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
        const isMissing = file.is_missing === true;
        let iconHtml = '';
        if (isMissing) {
            iconHtml = `<i class="ph ph-warning-circle" style="color:#ff4444; font-size:1.2em; vertical-align:middle; margin-right:5px;" title="Fichier introuvable"></i>`;
        } else if (isAudio) {
            iconHtml = `<i class="ph ph-music-notes" style="color:#bb86fc; font-size:1.2em; vertical-align:middle; margin-right:5px;"></i>`;
        } else {
            // Video / Film Strip
            iconHtml = `<i class="ph ph-film-strip" style="color:#03dac6; font-size:1.2em; vertical-align:middle; margin-right:5px;"></i>`;
        }

        const tr = document.createElement("tr");
        tr.setAttribute('data-index', realIndex); // Attribut technique pour robustesse V7.4

        if (isMissing) tr.classList.add('track-missing');

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

    // Auto-highlight local media
    if (typeof refreshSetlistHighlights === "function") refreshSetlistHighlights();
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
    } else if (mode === 'web_links' || mode === 'web-links') {
        document.getElementById("filter-web-artist").value = "";
        document.getElementById("filter-web-title").value = "";
        renderWebLinks();
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
                if (header) {
                    header.dataset.currentColor = bg;
                    header.style.borderLeft = `4px solid ${bg}`;
                    header.style.borderTop = `1px solid ${bg}`;
                    header.style.borderBottom = `1px solid ${bg}`;
                    header.style.borderRight = '1px solid #333';
                }
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

        // 2. Fallback to LocalStorage ONLY for stems UI data (mute/solo/etc) if backend empty
        // Autoplay and Autoreplay are strictly controlled by the file definition from API.
        if (!settings || !settings.tracks) {
            settings = JSON.parse(localStorage.getItem(getMultitrackStorageKey(file)) || "{}");
        }

        if (settings && settings.tracks) {
            // Apply master volume
            if (settings.masterVolume !== undefined) {
                const mst = document.getElementById("multitrack-master-volume");
                if (mst) {
                    mst.value = settings.masterVolume;
                    mst.setAttribute('data-initial-value', settings.masterVolume); // Capture initial
                    const mstPerc = document.getElementById("multitrack-master-volume-percent");
                    if (mstPerc) mstPerc.innerText = Math.round(settings.masterVolume * 100) + '%';
                }
            }

            // Sync JS state strictly from database values to avoid local cache bleeding
            // IMPORTANT: If 'settings' came from backend API (which has the real saved state), we must apply it.
            // Since 'file' (the localFiles object in RAM) might have been populated with default values
            // globally at start of playLocal(), we OVERRIDE file with settings if settings has it defined.
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
                    volSlider.setAttribute('data-initial-value', trackData.volume); // Capture initial
                    const valSpan = document.getElementById(`mt-vol-val-${i}`);
                    if (valSpan) valSpan.innerText = Math.round(trackData.volume * 100) + "%";
                }
                if (panSlider && trackData.pan !== undefined) {
                    panSlider.value = trackData.pan;
                    panSlider.setAttribute('data-initial-value', trackData.pan); // Capture initial
                    if (ws && ws.media && ws.media._panner) {
                        ws.media._panner.pan.value = trackData.pan;
                    }
                    const panSpan = document.getElementById(`mt-pan-val-${i}`);
                    if (panSpan) panSpan.innerText = trackData.pan > 0 || trackData.pan < 0 ? (trackData.pan > 0 ? `R${Math.round(trackData.pan * 100)}` : `L${Math.round(Math.abs(trackData.pan) * 100)}`) : 'C';
                }

                if (trackData.color && ws) {
                    const bg = trackData.color;
                    const fg = generateDarkerColor(bg);
                    if (bg.startsWith('#')) {
                        ws.setOptions({ waveColor: bg, progressColor: fg });
                        const header = document.getElementById(`mt-header-${i}`);
                        if (header) {
                            header.dataset.currentColor = bg;
                            header.style.borderLeft = `4px solid ${bg}`;
                            header.style.borderTop = `1px solid ${bg}`;
                            header.style.borderBottom = `1px solid ${bg}`;
                            header.style.borderRight = '1px solid #333';
                        }
                    }
                }
            });

            if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();
            updateHiddenTracksList(file);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        } else {
            if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();
            updateHiddenTracksList(file);
        }
    } catch (e) {
        console.error("Failed to parse saved multitrack settings:", e);
    }
}

function openEditLocalModal(index) {
    editingIndex = index;
    const file = localFiles[index];
    if (!file) return;

    // Reveal sidebar if in theater mode to give context to editing
    if (isTheaterMode && typeof toggleTheaterMode === 'function') {
        toggleTheaterMode(false);
    }

    document.getElementById("media-modal").showModal();
    
    // Auto-scroll in background
    setTimeout(scrollToActiveTrack, 200);
}

async function playLocal(index) {
    const file = localFiles[index];
    if (!file) return;

    if (file.is_missing === true) {
        openMissingFileModal(file, 'library');
        return;
    }

    window.currentSource = 'library';
    window.currentPlayingIndex = index; // Important : Stocker l'index actif pour TOUS les types de médias
    
    // Sync UI Highlight immediately
    if (typeof refreshSetlistHighlights === "function") refreshSetlistHighlights();

    // Trigger Interconnection UI for all local types (V53)
    updateInterconnectionUI(file);

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

    const globalTitle = document.getElementById("global-video-title");
    const globalBpm = document.getElementById("global-video-bpm");
    updateHeaderScaleDisplay(file);

    // AUTO-RESET PITCH
    updatePitch(0);

    // Auto-hide sidebar if setting is enabled
    if (currentSettings && currentSettings.sidebar_autohide && !isTheaterMode && !sidebarUserOverride) {
        toggleTheaterMode(true);
    } else {
        // If sidebar is visible, scroll to active
        setTimeout(scrollToActiveTrack, 500);
    }

    // Volume Default logic
    const trackVolume = (file.volume !== undefined) ? parseInt(file.volume, 10) : 100;
    const normalizedVolume = trackVolume / 100;

    // Reset Volume Slider
    const audioVolSlider = document.getElementById("audio-volume");
    if (audioVolSlider) { 
        audioVolSlider.value = normalizedVolume; 
        audioVolSlider.setAttribute('data-initial-value', normalizedVolume); // Capture initial
        const ap = document.getElementById("audio-volume-percent"); 
        if (ap) ap.innerText = trackVolume + "%"; 
    }
    const videoVolSlider = document.getElementById("video-volume");
    if (videoVolSlider) { 
        videoVolSlider.value = normalizedVolume; 
        videoVolSlider.setAttribute('data-initial-value', normalizedVolume); // Capture initial
        const vp = document.getElementById("video-volume-percent"); 
        if (vp) vp.innerText = trackVolume + "%"; 
    }

    // Explicitly sync all other modals at startup
    if (typeof syncVolumeToModals === 'function') syncVolumeToModals(trackVolume);

    // Containers
    const videoContainer = document.getElementById("video-container");
    const audioContainer = document.getElementById("audio-player-container");

    // Determine Autoplay/Autoreplay
    if (file.autoplay === undefined) file.autoplay = (currentSettings.autoplay || false);
    if (file.autoreplay === undefined) file.autoreplay = (currentSettings.autoreplay || false);

    const isAutoplay = file.autoplay;
    const isAutoreplay = file.autoreplay;
    window.currentAutoreplay = isAutoreplay;
    updatePlaybackOptionsUI(isAutoreplay, isAutoplay);

    // Common Resets
    document.getElementById("player").style.display = "none";
    const genFrame = document.getElementById("generic-player");
    if (genFrame) genFrame.style.display = "none";

    // GLOBAL STOP
    stopAllMedia();

    // Fretboard intelligent handling on track change
    if (typeof fretboardState !== 'undefined' && fretboardState.visible) {
        if (currentSettings && currentSettings.fretboard_autoclose) {
             toggleFretboard(); // Close it
        } else {
             // Keep it open but update to new track scale
             setTimeout(() => {
                  detectCurrentScale();
                  renderFretboard();
             }, 500); // slight delay to ensure window.currentPlayingIndex has fully resolved everywhere
        }
    }

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
        
        updateHeaderVisibility(true);
        globalTitle.innerText = file.title || "Multitrack";
        if (file.bpm) { globalBpm.style.display = "inline"; globalBpm.querySelector(".val").innerText = file.bpm; } else { globalBpm.style.display = "none"; }
        updateHeaderScaleDisplay(file);


        videoContainer.style.display = "none";
        audioContainer.style.display = "none";
        document.getElementById("video-controls-container").style.display = "none";

        const multitrackContainer = document.getElementById("multitrack-container");
        if (multitrackContainer) multitrackContainer.style.display = "flex";

        // Fix Loop Bar persistence: Hide Video Timeline when switching to Multitrack
        const valT = document.getElementById("video-timeline-container");
        if (valT) valT.style.display = "none";

        const globalCover = document.getElementById("global-video-cover");
        if (globalCover) {
            globalCover.onload = () => globalCover.style.display = "block";
            globalCover.onerror = () => globalCover.style.display = "none";
            globalCover.src = `/api/local/art/${index}?t=${Date.now()}`;
        }

        if (wavesurfer) wavesurfer.pause();
        v.style.display = "none";

        const trackHeaders = document.getElementById("multitrack-headers");
        const trackWaveforms = document.getElementById("multitrack-waveforms");
        const loadingIndicator = document.getElementById("multitrack-loading");

        if (loadingIndicator) loadingIndicator.style.display = "block";
        if (trackHeaders) trackHeaders.innerHTML = "";
        if (trackWaveforms) trackWaveforms.innerHTML = "";

        // ROBUST SYNC DEFINITION (At Top, scoped to this 'file' call)
        window.syncAllMultitrackStates = () => {
            if (!window.multitrack || !file) {
                console.warn("[MT] Sync skipped: multitrack or file missing");
                return;
            }
            const allHeaders = Array.from(document.querySelectorAll('#multitrack-headers .track-header'));
            const anySolo = allHeaders.some(h => {
                const s = h.querySelector('.btn-solo');
                return s && s.classList.contains('active');
            });
            const mst = document.getElementById("multitrack-master-volume");
            if (mst && !mst.hasAttribute('data-initial-value')) mst.setAttribute('data-initial-value', '1'); // Default if not yet set
            const mstVol = mst ? parseFloat(mst.value) : 1;

            allHeaders.forEach(h => {
                const idx = parseInt(h.id.replace('mt-header-', ''));
                const mBtn = h.querySelector('.btn-mute');
                const sBtn = h.querySelector('.btn-solo');
                const hmBtn = h.querySelector('.btn-stem-hide-mute');
                const vSlider = h.querySelector('.slider-vol');
                const wss = window.multitrack.wavesurfers[idx];

                if (!mBtn || !sBtn || !vSlider) return;

                const isMuted = mBtn.classList.contains('active');
                const isSoloed = sBtn.classList.contains('active');
                const isHiddenMute = hmBtn ? hmBtn.classList.contains('active') : false;
                const baseVol = parseFloat(vSlider.value);
                
                let finalVol = baseVol * mstVol;
                let visualMuted = isMuted || isHiddenMute;

                if (isMuted || isHiddenMute) {
                    finalVol = 0;
                } else if (anySolo && !isSoloed) {
                    finalVol = 0;
                    visualMuted = true;
                }

                window.multitrack.setTrackVolume(idx, finalVol);
                if (wss) {
                    wss.getWrapper().style.opacity = visualMuted ? "0.3" : "1";
                }
            });
            console.log("[MT] Global sync complete (anySolo=" + anySolo + ")");
        };

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
            header.dataset.currentColor = waveCol;
            header.style.borderLeft = `4px solid ${waveCol}`;
            header.style.setProperty('border-top', `1px solid ${waveCol}`, 'important');
            header.style.setProperty('border-bottom', `1px solid ${waveCol}`, 'important');
            header.style.borderRight = '1px solid #333';
            header.style.setProperty('border-right', '1px solid #333', 'important');
            header.style.boxSizing = 'border-box';
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
                    <input type="range" class="slider-vol" id="mt-vol-${i}" min="0" max="1" step="0.01" value="1" style="flex:1;" data-initial-value="1">
                    <span id="mt-vol-val-${i}" style="font-size:0.7em; color:#bbb; min-width:30px; text-align:right;">100%</span>
                </div>
                <div class="track-slider-row" style="margin-top:4px; display:flex; align-items:center;">
                    <span class="pan-lbl" style="color:#03dac6;">L</span>
                    <input type="range" class="slider-pan" id="mt-pan-${i}" min="-1" max="1" step="0.1" value="0" style="flex:1;" data-initial-value="0">
                    <span class="pan-lbl" style="color:#03dac6;">R</span>
                    <span id="mt-pan-val-${i}" style="font-size:0.7em; color:#03dac6; min-width:30px; text-align:right;">C</span>
                </div>
            `;
            trackHeaders.appendChild(header);

            header.oncontextmenu = (e) => {
                e.preventDefault();
                showStemContextMenu(e, i);
            };

            // ATTACH LISTENERS IMMEDIATELY (Fix for broken buttons)
            const muteBtn = header.querySelector('.btn-mute');
            const soloBtn = header.querySelector('.btn-solo');
            const volSlider = header.querySelector('.slider-vol');
            const panSlider = header.querySelector('.slider-pan');
            const hideBtn = header.querySelector('.btn-stem-hide');
            const hideMuteBtn = header.querySelector('.btn-stem-hide-mute');
            const deleteBtn = header.querySelector('.btn-stem-delete');

            if (muteBtn) {
                muteBtn.onclick = () => {
                    muteBtn.classList.toggle('active');
                    if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();
                    saveMultitrackSettings(file);
                };
            }

            if (soloBtn) {
                soloBtn.onclick = () => {
                    soloBtn.classList.toggle('active');
                    if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();
                    saveMultitrackSettings(file);
                };
            }

            if (volSlider) {
                volSlider.oninput = (e) => {
                    const valSpan = document.getElementById(`mt-vol-val-${i}`);
                    if (valSpan) valSpan.innerText = Math.round(parseFloat(e.target.value) * 100) + '%';
                    if (muteBtn && muteBtn.classList.contains('active')) muteBtn.classList.remove('active');
                    if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();
                    saveMultitrackSettings(file);
                };
                setupSliderReset(volSlider, "volume");
            }

            if (panSlider) {
                panSlider.oninput = (e) => {
                    const pan = parseFloat(e.target.value);
                    const ws = window.multitrack ? window.multitrack.wavesurfers[i] : null;
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
                setupSliderReset(panSlider, "pan");
            }

            const applyHideState = (index) => {
                const hb = document.getElementById(`mt-hide-${index}`);
                const hmb = document.getElementById(`mt-hide-mute-${index}`);
                const h = document.getElementById(`mt-header-${index}`);
                const w = window.multitrack ? window.multitrack.wavesurfers[index] : null;
                
                const isHidden = (hb && hb.classList.contains('active')) || (hmb && hmb.classList.contains('active'));

                if (h) h.style.display = isHidden ? 'none' : 'flex';
                if (w) {
                    const wsContainer = w.getWrapper().parentElement;
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
                if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();
            };

            if (hideBtn) {
                hideBtn.onclick = () => {
                    hideBtn.classList.toggle('active');
                    if (hideBtn.classList.contains('active') && hideMuteBtn) hideMuteBtn.classList.remove('active');
                    applyHideState(i);
                    saveMultitrackSettings(file);
                    updateHiddenTracksList(file);
                };
            }

            if (hideMuteBtn) {
                hideMuteBtn.onclick = () => {
                    hideMuteBtn.classList.toggle('active');
                    if (hideMuteBtn.classList.contains('active') && hideBtn) hideBtn.classList.remove('active');
                    applyHideState(i);
                    saveMultitrackSettings(file);
                    updateHiddenTracksList(file);
                };
            }

            if (deleteBtn) {
                deleteBtn.onclick = async () => {
                    if (confirm(t('web.msg_confirm_delete_stem'))) {
                        try {
                            const resp = await fetch(`/api/local/stem/${window.currentPlayingIndex}/${i}`, { method: 'DELETE' });
                            if (resp.ok) { await loadLibrary(); playLocal(window.currentPlayingIndex); }
                        } catch (e) { console.error("Delete stem failed:", e); }
                    }
                };
            }

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
                document.querySelectorAll('.track-header').forEach(h => {
                    const col = h.dataset.currentColor || '#333';
                    h.style.borderBottom = `1px solid ${col}`;
                });
            };
            header.ondragover = (e) => {
                e.preventDefault(); // Necessary to allow dropping
                e.dataTransfer.dropEffect = "move";
                header.style.borderBottom = "2px solid var(--accent)";
            };
            header.ondragleave = () => {
                const col = header.dataset.currentColor || '#333';
                header.style.borderBottom = `1px solid ${col}`;
            };
            header.ondrop = (e) => {
                e.preventDefault();
                const col = header.dataset.currentColor || '#333';
                header.style.borderBottom = `1px solid ${col}`;
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
        if (window.currentMultitrackAbortController) {
            window.currentMultitrackAbortController.abort();
        }
        window.currentMultitrackAbortController = new AbortController();
        const signal = window.currentMultitrackAbortController.signal;
        window.currentMultitrackBlobUrls = [];

        let mtOptions = [];
        try {
            console.log("[MT] Starting Promise.all for stems...", file.stems.length);
            mtOptions = await Promise.all(file.stems.map(async (stem, i) => {
                const name = stem.name || stem.path.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "");

                let peaksArray = undefined;
                let audioUrl = "/api/stream?path=" + encodeURIComponent(stem.path);
                let mediaElement = null;

                try {
                    console.log(`[MT] Stem ${i} : Fetching data...`);
                    const [peaksRes, audioRes] = await Promise.all([
                        fetch(`/api/local/peaks/${index}/${i}`, { signal }),
                        fetch("/api/stream?path=" + encodeURIComponent(stem.path), { signal })
                    ]);
                    console.log(`[MT] Stem ${i} : Fetch headers received. AudioRes OK=?`, audioRes.ok);

                    if (peaksRes.ok) {
                        const data = await peaksRes.json();
                        if (data && data.length > 0) peaksArray = [new Float32Array(data)];
                    }

                    if (audioRes.ok) {
                        console.log(`[MT] Stem ${i} : Starting blob download...`);
                        const blob = await audioRes.blob();
                        console.log(`[MT] Stem ${i} : Blob downloaded, creating ObjectURL...`);
                        audioUrl = URL.createObjectURL(blob);
                        window.currentMultitrackBlobUrls.push(audioUrl);

                        mediaElement = new Audio();
                        mediaElement.src = audioUrl;
                        mediaElement.crossOrigin = "anonymous";
                        mediaElement.preload = "auto";

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
                    if (e.name === 'AbortError') throw e;
                    console.error(`[MT] Multitrack fetch error for stem ${i}:`, e);
                }

                const waveCol = appliedColors[i];
                const progCol = generateDarkerColor(waveCol);

                return {
                    id: i,
                    url: audioUrl,
                    volume: 1,
                    peaks: peaksArray,
                    options: {
                        media: mediaElement,
                        waveColor: waveCol,
                        progressColor: progCol,
                        height: 70,
                        barWidth: 2,
                        barGap: 1,
                        barRadius: 2
                    }
                };
            }));
            
            console.log("[MT] Promise.all completed successfully. Signal aborted?", signal.aborted);
            if (signal.aborted) {
                console.log("[MT] Load cleanly aborted before creating Wavesurfers.");
                return;
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log("[MT] Load aborted by user switching tracks.");
                return;
            }
            console.error("[MT] Multitrack Promise.all failed critically:", e);
            return;
        }

        console.log("[MT] Creating Multitrack instance...");
        try {
            window.multitrack = Multitrack.create(mtOptions, {
                container: trackWaveforms,
                rightButtonDrag: false,
                cursorWidth: 2,
                cursorColor: '#fff',
                trackBackground: '#2d2d2d',
                trackBorderColor: '#333',
                timelineOptions: {
                    height: 20,
                    style: { color: '#888', fontSize: '10px' }
                }
            });
            console.log("[MT] Instance created successfully.");
        } catch(e) {
            console.error("[MT] Multitrack.create failed:", e);
        }

        // Global Sync was moved to Top

        window.multitrack.once('canplay', () => {
            if (loadingIndicator) loadingIndicator.style.display = "none";
            file.stems.forEach((_, i) => {
                const headerDiv = document.getElementById(`mt-header-${i}`);
                const ws = window.multitrack.wavesurfers[i];
                if (ws && headerDiv) {
                    const wsContainer = ws.getWrapper().parentElement;
                    const h = wsContainer.offsetHeight;
                    if (h > 0) headerDiv.style.height = (h + 3) + "px";
                    
                    // Unified Horizontal Borders (Match Header)
                    const stemCol = appliedColors[i];
                    wsContainer.style.setProperty('border-top', `1px solid ${stemCol}`, 'important');
                    wsContainer.style.setProperty('border-bottom', `1px solid ${stemCol}`, 'important');
                    wsContainer.style.boxSizing = 'border-box';

                    wsContainer.oncontextmenu = (e) => { e.preventDefault(); showStemContextMenu(e, i); };
                }
            });

            // Restore saved settings on load (async)
            loadMultitrackSettings(file).then(() => {
                if (window.syncAllMultitrackStates) window.syncAllMultitrackStates();

                const isAutoplay = (file.autoplay !== undefined) ? file.autoplay : (currentSettings.autoplay || false);
                if (isAutoplay) {
                    window.multitrack.play();
                }
                updatePlayPauseUI();
            });
            updateHiddenTracksList(file);

            updateLoopUI();
            renderLoopsUI();
            
            // Update Interconnection UI
            updateInterconnectionUI(file);
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

        // Removed multitrack.on('finish'): Using fail-safe check in the main loop instead for reliability.

        // Removed mtInterval: loop monitoring handled by the global interval in app.js
        currentActivePlayer = 'multitrack';
        loadLoopsForTrack(file);

    } else if (isAudio) {
        // --- AUDIO MODE (Hide Video Container) ---
        const target = getProfile(file, "Web Audio Local");
        console.log("[DEBUG JS] Envoi demande setMode (AUDIO) avec profil :", target);
        setMode("AUDIO", target); // Context Switch
        
        updateHeaderVisibility(true);

        globalTitle.innerText = file.title || "Audio";
        if (file.bpm) { globalBpm.style.display = "inline"; globalBpm.querySelector(".val").innerText = file.bpm; } else { globalBpm.style.display = "none"; }
        updateHeaderScaleDisplay(file);

        const globalCover = document.getElementById("global-video-cover");
        if (globalCover) {
            globalCover.onload = () => globalCover.style.display = "block";
            globalCover.onerror = () => globalCover.style.display = "none";
            globalCover.src = `/api/local/art/${index}?t=${Date.now()}`;
        }

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

    const eBpm = document.getElementById("audio-bpm-info");
    const eKey = document.getElementById("audio-key-info");
    const eScale = document.getElementById("audio-scale-info");
    const eTuning = document.getElementById("audio-tuning-info");

    if (file.bpm) { eBpm.style.display = "inline"; eBpm.querySelector(".val").innerText = file.bpm; } else { eBpm.style.display = "none"; }
    if (file.key) { eKey.style.display = "inline"; eKey.querySelector(".val").innerText = file.key; } else { eKey.style.display = "none"; }
    if (file.scale) {
        eScale.style.display = "inline";
        const txt = document.getElementById("fretboard-scale").querySelector(`option[value="${file.scale}"]`)?.text || file.scale;
        eScale.querySelector(".val").innerText = txt;
    } else { eScale.style.display = "none"; }

    if (file.tuning && file.tuning !== 'standard') {
        eTuning.style.display = "inline";
        const txt = document.getElementById("fretboard-tuning").querySelector(`option[value="${file.tuning}"]`)?.text || file.tuning;
        eTuning.querySelector(".val").innerText = txt;
    } else { eTuning.style.display = "none"; }


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
            if (file.autoplay === undefined) file.autoplay = (currentSettings.autoplay || false);
            if (file.autoreplay === undefined) file.autoreplay = (currentSettings.autoreplay || false);

            const isAutoplay = file.autoplay;
            const isAutoreplay = file.autoreplay;

            // Set state directly on the wavesurfer instance *before* loading
            // to guarantee the `ready` event reads the correct boolean for this song
            wavesurfer._currentIsAutoplay = isAutoplay;
            window.currentAutoreplay = isAutoreplay;
            updateRepeatUI(isAutoreplay);

            wavesurfer.setVolume(normalizedVolume); // SET WAVESURFER VOLUME
            wavesurfer.load("/api/stream?path=" + encodeURIComponent(file.path));
        }

        currentActivePlayer = 'waveform';
        loadLoopsForTrack(file);

    } else if (isVideo) {
        // --- VIDEO MODE (Show Video Container) ---
        const target = getProfile(file, "Web Video Local");
        console.log("[DEBUG JS] Envoi demande setMode (VIDEO) avec profil :", target);
        setMode("VIDEO", target); // Context Switch

        updateHeaderVisibility(true);

        globalTitle.innerText = file.title || "Video";
        if (file.bpm) { globalBpm.style.display = "inline"; globalBpm.querySelector(".val").innerText = file.bpm; } else { globalBpm.style.display = "none"; }
        updateHeaderScaleDisplay(file);

        const globalCover = document.getElementById("global-video-cover");
        if (globalCover) {
            globalCover.onload = () => globalCover.style.display = "block";
            globalCover.onerror = () => globalCover.style.display = "none";
            globalCover.src = `/api/local/art/${index}?t=${Date.now()}`;
        }

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
            if (file.autoplay === undefined) file.autoplay = (currentSettings.autoplay || false);
            const isAutoplay = file.autoplay;

            if (isAutoplay) {
                v.play().catch(e => console.warn("Auto-play aborted", e));
            } else {
                v.pause(); // Explicitly enforce paused state when canplay fires
            }
            v.oncanplay = null; // Remove listener safely to avoid memory leaks/accumulations

            if (isPitchEnabled) connectPitchEngine();
            updateLoopUI();
            renderLoopsUI();
        };
        v.oncanplay = startPlay;

        // Also manually verify immediately in case the video is already cached and ready
        if (v.readyState >= 3) {
            startPlay();
        }

        v.onended = () => {
            v.pause();
            v.currentTime = 0;
            if (window.currentAutoreplay === true) {
                v.play();
            }
        };

        currentActivePlayer = 'local';
        loadLoopsForTrack(file);
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
        case 'prev': 
            if (isLoopActive && loopA !== null) {
                wavesurfer.setTime(Math.max(loopA, wavesurfer.getCurrentTime() - 5));
            } else {
                wavesurfer.skip(-5);
            }
            break;
        case 'next': 
            if (isLoopActive && loopB !== null) {
                wavesurfer.setTime(Math.min(loopB, wavesurfer.getCurrentTime() + 5));
            } else {
                wavesurfer.skip(5);
            }
            break;
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
                let target = ytTime - 5;
                if (isLoopActive && loopA !== null) target = Math.max(loopA, target);
                player.seekTo(target, true);
                updateTimelineUI(target);
            } else {
                let target = vid.currentTime - 5;
                if (isLoopActive && loopA !== null) target = Math.max(loopA, target);
                vid.currentTime = target;
                updateTimelineUI(target);
            }
            break;

        case 'next':
            if (isYT) {
                let target = ytTime + 5;
                if (isLoopActive && loopB !== null) target = Math.min(loopB, target);
                player.seekTo(target, true);
                updateTimelineUI(target);
            } else {
                let target = vid.currentTime + 5;
                if (isLoopActive && loopB !== null) target = Math.min(loopB, target);
                vid.currentTime = target;
                updateTimelineUI(target);
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
            const minT = (isLoopActive && loopA !== null) ? loopA : 0;
            window.multitrack.setTime(Math.max(minT, window.multitrack.getCurrentTime() - 5));
            break;
        case 'next':
            const maxT = (isLoopActive && loopB !== null) ? loopB : Infinity;
            window.multitrack.setTime(Math.min(maxT, window.multitrack.getCurrentTime() + 5));
            break;
        case 'playpause':
            if (window.multitrack.isPlaying()) {
                window.multitrack.pause();
            } else {
                // Fail-safe : Si on est à la toute fin (0.1s de battement), revenir au début avant de jouer
                const dur = getUniversalDuration();
                const cur = getCurrentPlayerTime();
                if (cur >= dur - 0.1 && cur > 0) {
                    window.multitrack.setTime(0);
                }
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

// --- SLIDER UTILITIES ---
function setupSliderReset(slider, type) {
    if (!slider) return;
    slider.ondblclick = () => {
        const initial = parseFloat(slider.getAttribute('data-initial-value'));
        if (isNaN(initial)) return;

        if (type === 'pan') {
            const current = parseFloat(slider.value);
            // Cycle: if not 0 -> 0. If 0 -> initial.
            if (current !== 0) {
                slider.value = 0;
            } else {
                slider.value = initial;
            }
        } else {
            // Volume
            slider.value = initial;
        }

        // Trigger input event to update labels and audio engine
        slider.dispatchEvent(new Event('input'));
    };
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
    if (s1) { 
        s1.value = percentVol; 
        s1.setAttribute('data-initial-value', percentVol);
        const p1 = document.getElementById("local-volume-percent"); 
        if (p1) p1.innerText = percentVol + "%"; 
    }

    const s2 = document.getElementById("edit-volume");
    if (s2) { 
        s2.value = percentVol; 
        s2.setAttribute('data-initial-value', percentVol);
        const p2 = document.getElementById("edit-volume-percent"); 
        if (p2) p2.innerText = percentVol + "%"; 
    }

    const s3 = document.getElementById("mt-modal-volume");
    if (s3) { 
        s3.value = percentVol; 
        s3.setAttribute('data-initial-value', percentVol);
        const p3 = document.getElementById("mt-modal-volume-percent"); 
        if (p3) p3.innerText = percentVol + "%"; 
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
    lastEditContext = 'library';
    const item = localFiles[index];
    
    // Reveal sidebar if in theater mode to give context to editing
    if (isTheaterMode && typeof toggleTheaterMode === 'function') {
        toggleTheaterMode(false);
    }

    document.getElementById("media-modal").showModal();

    // Auto-scroll in background
    setTimeout(scrollToActiveTrack, 200);

    // Fill Form (Mappings from local- to edit-)
    document.getElementById("edit-title").value = item.title;
    document.getElementById("edit-artist").value = item.artist || "";
    
    const urlField = document.getElementById("edit-url");
    urlField.value = ""; // URL empty for local, path shown below
    urlField.parentElement.style.display = "none"; // Hide URL field for local
    document.getElementById("edit-category").value = item.category || "Général";
    document.getElementById("edit-genre").value = item.genre || "Divers";
    document.getElementById("edit-target-profile").value = item.target_profile || "Auto";
    document.getElementById("edit-bpm").value = item.bpm || "";
    document.getElementById("edit-key").value = item.key || "";
    document.getElementById("edit-media-key").value = item.media_key || "";
    document.getElementById("edit-scale").value = item.scale || "";
    document.getElementById("edit-tuning").value = item.tuning || "standard";
    document.getElementById("edit-original-pitch").value = item.original_pitch || "";
    document.getElementById("edit-target-pitch").value = item.target_pitch || "";

    // Specific local display elements
    document.getElementById("local-path-display").innerText = item.path;
    document.getElementById("yt-local-path-container").style.display = "flex";
    document.getElementById("search-zone-container").style.display = "none";
    document.getElementById("btn-back-search").style.display = "none";

    let volValLoc = (item.volume !== undefined) ? item.volume : 100;
    document.getElementById("edit-volume").value = volValLoc;
    const evp = document.getElementById("edit-volume-percent"); if (evp) evp.innerText = volValLoc + "%";
    
    document.getElementById("user-notes-input").value = item.user_notes || "";
    document.getElementById("youtube-desc-input").value = "";

    // ASPECT RATIO & SUBTITLES LOGIC
    const thumbContainer = document.getElementById("preview-thumbnail");
    const subSettings = document.getElementById("edit-subtitle-settings");

    // Reset classes
    thumbContainer.classList.remove("wide-art", "square-art");

    // Simple check for video extensions
    if (item.path.match(/\.(mp4|mkv|mov|avi|webm|m4v)$/i)) {
        thumbContainer.classList.add("wide-art");
        subSettings.style.display = "flex";
        subSettings.style.flexDirection = "column";
        window.tempModalSubEnabled = item.subtitle_enabled || false;
        updateCCIconState(window.tempModalSubEnabled, 'edit');

        let posVal = item.subtitle_pos_y;
        if (posVal === undefined) posVal = 80;
        const sVal = 100 - posVal;
        document.getElementById("edit-sub-pos").value = sVal;
        const esp = document.getElementById("edit-sub-pos-percent"); if (esp) esp.innerText = sVal + "%";

        // Fetch list to enable context-menu support
        fetch(`/api/local/subs_list/${index}`)
            .then(r => r.json())
            .then(data => {
                if (data.status === "ok" && data.subs.length > 0) {
                    window.currentAvailableSubs = data.subs;
                    window.tempModalSelectedTrack = item.subtitle_track || "";
                } else {
                    window.currentAvailableSubs = [];
                    window.tempModalSelectedTrack = "";
                }
            })
            .catch(e => { console.error("Error fetching sub list", e); window.currentAvailableSubs = []; });

    } else {
        thumbContainer.classList.add("wide-art");
        subSettings.style.display = "none";
        window.currentAvailableSubs = [];
        window.tempModalSelectedTrack = "";
    }

    syncPlaybackSettingsToModals(item);

    // Load Art
    currentCoverData = null;
    const imgHtml = `<img id="edit-art-img" src="/api/local/art/${index}?t=${Date.now()}" style="width:100%; height:100%; object-fit:contain;">
                     <div id="btn-edit-delete-cover" class="btn-delete-cover" style="display:none;"
                          onclick="event.stopPropagation(); removeEditCover();">×</div>`;
    thumbContainer.innerHTML = imgHtml;

    const img = thumbContainer.querySelector("img");
    const btnDel = thumbContainer.querySelector(".btn-delete-cover");

    img.onload = () => { if (btnDel) btnDel.style.display = "flex"; };
    img.onerror = () => {
        thumbContainer.innerHTML = `<span style="font-size:30px;">🎵</span>
                                    <div id="btn-edit-delete-cover" class="btn-delete-cover" style="display:none;"
                                         onclick="event.stopPropagation(); removeEditCover();">×</div>`;
    };
}

function closeLocalModal() {
    closeModal();
}

// --- MULTITRACK MODAL LOGIC ---
function openMultitrackModal(index) {
    editingLocalIndex = index;
    lastEditContext = 'library';
    const item = localFiles[index];
    if (!item) return;

    // Reveal sidebar if in theater mode to give context to editing
    if (isTheaterMode && typeof toggleTheaterMode === 'function') {
        toggleTheaterMode(false);
    }

    document.getElementById("modal-multitrack").showModal();
    
    // Auto-scroll in background
    setTimeout(scrollToActiveTrack, 200);

    // ASPECT RATIO
    const artContainer = document.getElementById("mt-art-container");
    artContainer.classList.remove("wide-art", "square-art");
    artContainer.classList.add("wide-art"); // Use wide-art to allow 16:9 even for audio-based folders

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
    document.getElementById("mt-scale").value = item.scale || "";
    document.getElementById("mt-tuning").value = item.tuning || "standard";
    document.getElementById("mt-original-pitch").value = item.original_pitch || "";
    document.getElementById("mt-target-pitch").value = item.target_pitch || "";
    document.getElementById("mt-target-profile").value = item.target_profile || "Auto";

    let volVal = (item.volume !== undefined) ? item.volume : 100;
    document.getElementById("mt-modal-volume").value = volVal;
    const mvp = document.getElementById("mt-modal-volume-percent");
    if (mvp) mvp.innerText = volVal + "%";

    document.getElementById("mt-notes").value = item.user_notes || "";

    // Physical Management (V41)
    const physCont = document.getElementById("mt-physical-management-container");
    if (physCont) {
        physCont.style.display = "block";
        const pathDisp = document.getElementById("mt-path-display");
        if (pathDisp) pathDisp.innerText = item.path;
        const destMode = document.getElementById("mt-relocate-dest-mode");
        if (destMode) {
            destMode.value = "AUTO"; // Reset to Auto by default
            loadRelocationFolders();
        }
        const useArtistChk = document.getElementById("mt-relocate-use-artist");
        if (useArtistChk) useArtistChk.checked = true; // Default to checked
    }

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
        scale: document.getElementById("mt-scale").value,
        tuning: document.getElementById("mt-tuning").value,
        original_pitch: document.getElementById("mt-original-pitch").value,
        target_pitch: document.getElementById("mt-target-pitch").value,
        target_profile: document.getElementById("mt-target-profile").value,
        user_notes: document.getElementById("mt-notes").value,
        cover_data: currentCoverData,
        volume: parseInt(document.getElementById("mt-modal-volume").value, 10) || 100,
        autoplay: document.getElementById("mt-autoplay").checked,
        autoreplay: document.getElementById("mt-autoreplay").checked,
        linked_ids: (editingLocalIndex !== null && localFiles[editingLocalIndex]) ? (localFiles[editingLocalIndex].linked_ids || []) : []
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
        title: document.getElementById("edit-title").value,
        artist: document.getElementById("edit-artist").value,
        album: (editingLocalIndex !== null && localFiles[editingLocalIndex]) ? localFiles[editingLocalIndex].album : "", // Keep album if existing
        genre: document.getElementById("edit-genre").value,
        category: document.getElementById("edit-category").value || "Général",
        year: (editingLocalIndex !== null && localFiles[editingLocalIndex]) ? localFiles[editingLocalIndex].year : "", // Keep year if existing
        bpm: document.getElementById("edit-bpm").value,
        key: document.getElementById("edit-key").value,
        media_key: document.getElementById("edit-media-key").value,
        scale: document.getElementById("edit-scale").value,
        tuning: document.getElementById("edit-tuning").value,
        original_pitch: document.getElementById("edit-original-pitch").value,
        target_pitch: document.getElementById("edit-target-pitch").value,
        target_profile: document.getElementById("edit-target-profile").value,
        user_notes: document.getElementById("user-notes-input").value,
        subtitle_enabled: window.tempModalSubEnabled,
        subtitle_pos_y: 100 - parseInt(document.getElementById("edit-sub-pos").value, 10),
        subtitle_track: window.tempModalSelectedTrack || "",
        cover_data: currentCoverData,
        volume: parseInt(document.getElementById("edit-volume").value, 10) || 100,
        autoplay: document.getElementById("edit-autoplay").checked,
        autoreplay: document.getElementById("edit-autoreplay").checked,
        linked_ids: (editingLocalIndex !== null && localFiles[editingLocalIndex]) ? (localFiles[editingLocalIndex].linked_ids || []) : []
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

        // Only update live UI if the currently playing local file is the one we just edited
        if ((currentActivePlayer === 'local' || currentActivePlayer === 'waveform') && window.currentPlayingIndex === editingLocalIndex) {
            window.currentAutoreplay = payload.autoreplay;
            updatePlaybackOptionsUI(payload.autoreplay, payload.autoplay);
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

    setupSliderReset(document.getElementById("mt-modal-volume"), "volume");

    // Sidebar Hover Logic
    const hoverTrigger = document.getElementById('sidebar-hover-trigger');
    const sidebar = document.querySelector('.sidebar-zone');
    if (hoverTrigger && sidebar) {
        hoverTrigger.addEventListener('mouseenter', () => {
            // Uniquement si le mode survol est actif ET que la sidebar est officiellement masquée (Theater Mode)
            if (currentSettings && currentSettings.sidebar_hover_trigger && isTheaterMode) {
                console.log("[DEBUG] Sidebar Hover Triggered");
                sidebar.classList.add('hover-active');
            }
        });
        sidebar.addEventListener('mouseleave', () => {
            // Toujours retirer le mode hover quand on quitte la zone
            if (sidebar.classList.contains('hover-active')) {
                console.log("[DEBUG] Sidebar Hover Left");
                sidebar.classList.remove('hover-active');
            }
        });
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
    } else if (context === 'web-link') {
        title = document.getElementById("web-link-title").value;
        artist = document.getElementById("web-link-artist").value;
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
    container.innerHTML = ""; // V54: Clear once at START

    const loadingDiv = document.createElement("div");
    loadingDiv.id = "utag-loading-indicator";
    loadingDiv.style = 'color:var(--accent); display:flex; align-items:center; justify-content:center; gap:10px; padding:20px;';
    loadingDiv.innerHTML = `<i class='ph ph-circle-notch ph-spin' style='font-size:1.5em;'></i> <span>Recherche enrichie...</span>`;
    container.appendChild(loadingDiv);

    try {
        // 0. CHECK FOR LINKED MEDIA (V54)
        // ... (existing sourceItem picking logic)
        const container = document.getElementById("utag-results-container");
        
        // 0. CHECK FOR LINKED MEDIA (V54)
        // Find current object being edited
        let sourceItem = null;
        if (activeUniversalContext === 'local') sourceItem = localFiles[editingLocalIndex];
        else if (activeUniversalContext === 'mt') sourceItem = localFiles[editingLocalIndex];
        else if (activeUniversalContext === 'edit') sourceItem = currentTrackList.find(t => t.originalIndex === editingIndex);
        else if (activeUniversalContext === 'web-link') sourceItem = (currentWebLinkIndex !== -1) ? webLinks[currentWebLinkIndex] : { linked_ids: currentEditingLinkedIds };

        if (sourceItem && sourceItem.linked_ids && sourceItem.linked_ids.length > 0) {
            sourceItem.linked_ids.forEach(uid => {
                const linked = getLinkedItem(uid);
                if (linked) {
                    const res = {
                        title: linked.title,
                        artist: linked.artist,
                        album: linked.album || "Média Lié",
                        year: linked.year || "",
                        bpm: linked.bpm,
                        key: linked.key,
                        cover_url: linked.cover ? (linked.cover.startsWith('http') ? linked.cover : `/api/cover?path=${encodeURIComponent(linked.cover)}`) : null,
                        original_cover_path: linked.cover, // V54: Keep original path for internal sync
                        url: linked.url, // V55: Pass URL for icon rendering
                        is_linked_suggestion: true
                    };
                    renderUniversalResultItem(res, true);

                }
            });
        }

        // 1. SMART LOCAL SEARCH (V55: Unified Search & Link)
        const q = title.toLowerCase().trim();
        const artistQ = artist ? artist.toLowerCase().trim() : "";
        
        if (q.length > 2) {
            const localMatches = localFiles.filter(item => {
                const itemTitle = (item.title || "").toLowerCase();
                const itemArtist = (item.artist || "").toLowerCase();
                // Check if already linked
                const itemUid = `lib:${item.originalIndex}`;
                if (sourceItem && sourceItem.linked_ids && sourceItem.linked_ids.includes(itemUid)) return false;
                
                return itemTitle.includes(q) || (artistQ && itemArtist.includes(artistQ));
            });

            if (localMatches.length > 0) {
                localMatches.forEach(item => {
                    const res = {
                        title: item.title,
                        artist: item.artist,
                        album: item.album || "Bibliothèque Locale",
                        year: item.year || "",
                        bpm: item.bpm,
                        key: item.key,
                        original_cover_path: item.cover || item.path, // V55: Fallback to path for extraction if no specific cover file
                        uid: `lib:${item.originalIndex}`,
                        is_local_match: true
                    };

                    renderUniversalResultItem(res, false, true);
                });
            }
        }


        const res = await fetch(`/api/metadata/search?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        
        // Remove loading indicator JUST before showing API results
        const indicator = document.getElementById("utag-loading-indicator");
        if (indicator) indicator.remove();

        if (results.length === 0 && container.children.length === 0) {
            container.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>Aucun résultat trouvé. Essayez de simplifier le titre.</div>";
            return;
        }

        results.forEach(item => {
            renderUniversalResultItem(item);
        });
    } catch (e) {
        container.innerHTML = "<div style='color:red; padding:20px;'>Erreur lors de la recherche.</div>";
    }
}

function renderUniversalResultItem(item, isLinkedSync = false, isLocalMatch = false) {
    const container = document.getElementById("utag-results-container");
    const div = document.createElement("div");
    div.className = "api-result-item";
    div.style.margin = "5px";
    
    if (isLinkedSync) {
        div.style.border = "1px solid var(--accent)";
        div.style.background = "rgba(187,134,252,0.1)";
    } else if (isLocalMatch) {
        div.style.border = "1px solid #4CAF50";
        div.style.background = "rgba(76,175,80,0.1)";
    }
    
    let thumb = "<span style='font-size:24px;'>🎵</span>";
    const coverToUse = item.cover_url || (item.original_cover_path ? `/api/cover?path=${encodeURIComponent(item.original_cover_path)}` : null);
    
    // V55: Show Site Icon (Favicon) for Web Links instead of song cover, for better recognition
    if (item.url && !item.url.includes('youtube.com') && !item.url.includes('youtu.be')) {
        const iconUrl = getIcon(item.url);
        if (iconUrl) {
            thumb = `<img src="${iconUrl}" style="width:32px; height:32px; border-radius:4px; margin: 4px;">`;
        }
    } else if (coverToUse) {
        thumb = `<img src="${coverToUse}" style="width:40px; height:40px; border-radius:4px; object-fit:cover;">`;
    }


    let metaInfo = `${item.artist} - ${item.album} (${item.year || ""})`;
    if (item.bpm || item.key) {
        metaInfo += `<br><span style="color:var(--accent); font-size:0.85em;">`;
        if (item.bpm) metaInfo += `🎵 ${item.bpm} BPM `;
        if (item.key) metaInfo += `🎹 Key: ${item.key}`;
        metaInfo += `</span>`;
    }

    let btnLabel = isLinkedSync ? 'SYNC LINK' : (isLocalMatch ? 'LINK & SYNC' : 'Appliquer');
    let btnStyle = `padding:4px 8px; font-size:0.8em; min-width:80px;`;
    if (isLinkedSync) btnStyle += `background:var(--accent);`;
    else if (isLocalMatch) btnStyle += `background:#2E7D32;`;

    div.innerHTML = `
        ${thumb}
        <div style="flex:1; min-width:0;">
            <div style="font-weight:bold; font-size:0.95em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title}</div>
            <div style="font-size:0.8em; color:#bbb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${metaInfo}</div>
        </div>
        <button class="btn-primary" style="${btnStyle}">
            ${btnLabel}
        </button>
    `;

    div.onclick = (e) => {
        console.log("[UTAG] Result clicked:", item.title);
        applyUniversalMetadata(item);
    };
    container.appendChild(div);
}


function applyUniversalMetadata(item) {
    try {
        console.warn("[UTAG] applyUniversalMetadata CALLED with item:", item);
        logToBackend(`[UTAG] applyUniversalMetadata CALLED. ctx=${activeUniversalContext}`);

        const applyTitle = document.getElementById("utag-apply-title")?.checked;
        const applyArtist = document.getElementById("utag-apply-artist")?.checked;
        const applyBpmKey = document.getElementById("utag-apply-bpm-key")?.checked;
        const applyPochette = document.getElementById("utag-apply-pochette")?.checked;
        const applyTags = document.getElementById("utag-apply-tags")?.checked;

        const ctx = activeUniversalContext;
        console.log("[UTAG] Context is:", ctx);

        // 1. Text Fields
        if (applyTitle) {
            const el = document.getElementById(`${ctx}-title`);
            if (el) el.value = item.title || "";
        }
        if (applyArtist) {
            const el = document.getElementById(`${ctx}-artist`);
            if (el) el.value = item.artist || "";
        }
        if (applyBpmKey) {
            const bpmEl = document.getElementById(`${ctx}-bpm`);
            const keyEl = document.getElementById(`${ctx}-key`);
            if (bpmEl && item.bpm !== undefined) {
                bpmEl.value = item.bpm || "";
                bpmEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (keyEl && item.key !== undefined) {
                keyEl.value = item.key || "";
                keyEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        if (applyTags) {
            const albEl = document.getElementById(`${ctx}-album`);
            const genEl = document.getElementById(`${ctx}-genre`);
            const yeaEl = document.getElementById(`${ctx}-year`);
            if (albEl) albEl.value = item.album || "";
            if (genEl) genEl.value = item.genre || "";
            if (yeaEl) yeaEl.value = item.year || "";
        }

        // 3. AUTO-LINKING (V55: Unified Workflow)
        if (item.uid && ctx === 'web-link') {
            console.log("[UTAG] Auto-linking triggered for:", item.uid);
            // Prepare linker state as if we opened openMediaLinker
            const [typePrefix, index] = item.uid.split(':');
            const targetType = typePrefix === 'lib' ? 'library' : (typePrefix === 'set' ? 'setlist' : 'web_links');
            const targetIndex = parseInt(index);

            linkerSourceType = 'web_links';
            linkerSourceItem = (currentWebLinkIndex === -1) ? { linked_ids: currentEditingLinkedIds } : webLinks[currentWebLinkIndex];
            
            // Execute link (bidirectional)
            toggleMediaLink(targetType, targetIndex).then(() => {
                console.log("[UTAG] Link established successfully.");
            });
        }


        // 2. Pochette
        if (applyPochette && (item.cover_url || item.original_cover_path)) {
            console.log("[UTAG] Processing cover...");
            let imgId = "", placeholderId = "", deleteBtnId = "";

            if (ctx === 'local') { imgId = "local-art-img"; placeholderId = "local-art-placeholder"; deleteBtnId = "btn-delete-cover"; }
            else if (ctx === 'mt') { imgId = "mt-art-img"; placeholderId = "mt-art-placeholder"; deleteBtnId = "btn-mt-delete-cover"; }
            else if (ctx === 'edit') { imgId = "preview-thumbnail"; deleteBtnId = "btn-edit-delete-cover"; }
            else if (ctx === 'web-link') { 
                imgId = "web-link-art-img"; 
                placeholderId = "web-link-art-placeholder"; 
                deleteBtnId = "btn-web-link-delete-cover"; 
                
                // IMPORTANT: Update the global variable used for save
                // V55: If no cover_url but original_cover_path is present, use it
                window.currentWebLinkCover = item.original_cover_path || item.cover_url;
                console.warn("[UTAG] Global currentWebLinkCover set to:", window.currentWebLinkCover);
            }

            const img = document.getElementById(imgId);
            if (img) {
                const displayUrl = item.cover_url || (item.original_cover_path ? `/api/cover?path=${encodeURIComponent(item.original_cover_path)}` : "");
                img.src = displayUrl;
                
                // V55: Handle placeholder UI
                if (placeholderId) {
                    const p = document.getElementById(placeholderId);
                    if (p) p.style.display = "none";
                }
                if (deleteBtnId) {
                    const d = document.getElementById(deleteBtnId);
                    if (d) d.style.display = "flex";
                }

                img.style.display = "block";
                if (ctx === 'edit') {
                    img.style.backgroundImage = `url(${displayUrl})`;
                    img.style.backgroundSize = "cover";
                    img.innerHTML = "";
                }

                console.log("[UTAG] UI updated for img:", imgId);
            }

            const placeholder = document.getElementById(placeholderId);
            if (placeholder) placeholder.style.setProperty('display', 'none', 'important');
            
            const delBtn = document.getElementById(deleteBtnId);
            if (delBtn) delBtn.style.display = "flex";
        }

        document.getElementById("modal-universal-tag").close();
        console.log("[UTAG] SUCCESS: Metadata applied.");

    } catch (err) {
        console.error("[UTAG] CRITICAL ERROR in applyUniversalMetadata:", err);
        logToBackend(`[UTAG] CRITICAL ERROR: ${err.message}`);
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
    if (markersContainer) {
        markersContainer.innerHTML = "";
    }
    
    if (markersContainer && currentChapters.length > 0) {

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

    // --- NEW: Autoreplay & Training Hook ---
    v.onended = () => {
        if (window.currentAutoreplay === true) {
            v.currentTime = 0;
            v.play();
            // TRAINING HOOK: Local Video Autoreplay
            if (window.MediaTrainingManager && window.MediaTrainingManager.video && window.MediaTrainingManager.video.active) {
                const now = Date.now();
                if (now - window.MediaTrainingManager.lastCycleEnd > 500) {
                    window.MediaTrainingManager.lastCycleEnd = now;
                    window.MediaTrainingManager.onCycleEnd('video');
                }
            }
        } else {
            v.currentTime = 0;
            v.pause();
            updatePlayPauseIcon('video', false);
        }
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

    // -- METRONOME SYNC --
    if (window.isSyncMedia && window.metronome) {
        if (isPlaying && !window.metronome.isPlaying) {
            // Adjust BPM dynamically from UI just in case
            const currentBpm = parseInt(document.getElementById("metro-bpm-input").value) || 120;
            // Get current speed factor
            let rate = 1.0;
            if (type === 'multitrack') rate = parseFloat(document.getElementById('btn-multitrack-speed').innerText) || 1.0;
            else if (type === 'video') rate = parseFloat(document.getElementById('btn-video-speed').innerText) || 1.0;
            else if (type === 'audio') rate = parseFloat(document.getElementById('btn-audio-speed').innerText) || 1.0;
            
            window.metronome.setBpm(currentBpm * rate);
            
            // Start
            metronomeTogglePlay();
            
            // Apply Offset
            const offsetMs = parseInt(document.getElementById("metro-sync-offset").value) || 0;
            window.metronome.nextNoteTime = window.metronome.audioContext.currentTime + (offsetMs / 1000.0);
            
        } else if (!isPlaying && window.metronome.isPlaying) {
            metronomeTogglePlay();
        }
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
    else if (currentActivePlayer === 'local') {
        const vid = document.getElementById("html5-player");
        if (vid && !isNaN(vid.duration)) dur = vid.duration;
    } else if (currentActivePlayer === 'waveform') {
        if (wavesurfer && !isNaN(wavesurfer.getDuration())) dur = wavesurfer.getDuration();
    } else if (currentActivePlayer === 'multitrack' && window.multitrack && window.multitrack.wavesurfers) {
        window.multitrack.wavesurfers.forEach(ws => {
            const wsDur = ws.getDuration();
            if (wsDur > dur) dur = wsDur;
        });
    }
    return dur;
}

function getCurrentPlayerTime() {
    if (currentActivePlayer === 'multitrack' && window.multitrack) {
        return (typeof window.multitrack.getCurrentTime === 'function') 
            ? window.multitrack.getCurrentTime() : 0;
    } else if (currentActivePlayer === 'local') {
        const vid = document.getElementById("html5-player");
        return vid ? vid.currentTime : 0;
    } else if (currentActivePlayer === 'waveform') {
        return wavesurfer ? wavesurfer.getCurrentTime() : 0;
    } else if (currentActivePlayer === 'youtube' && player && typeof player.getCurrentTime === "function") {
        return player.getCurrentTime();
    }
    return 0;
}

/**
 * Updates the modern grouped Scale/Key badge in the header
 */
function updateHeaderScaleDisplay(item) {
    const pill = document.getElementById("header-smart-scale-pill");
    const text = document.getElementById("header-smart-scale-text");
    if (!pill || !text) return;

    if (!item) {
        pill.style.display = "none";
        return;
    }

    const key = item.media_key || item.key;
    const scale = item.scale;
    const scaleName = scale ? (document.getElementById("fretboard-scale").querySelector(`option[value="${scale}"]`)?.text || scale) : "";

    if (key) {
        pill.style.display = "flex";
        text.innerText = `${key} ${scaleName}`.trim();
    } else {
        pill.style.display = "none";
    }
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

function clearLoop() {
    loopA = null;
    loopB = null;
    isLoopActive = false;
    isSequentialLoop = false;

    // Force clear all visual markers regardless of currentActivePlayer
    const markersA = ["mt-loop-marker-a", "audio-loop-marker-a-bar", "video-loop-marker-a", "audio-loop-marker-a"];
    const markersB = ["mt-loop-marker-b", "audio-loop-marker-b-bar", "video-loop-marker-b", "audio-loop-marker-b"];
    const areas = ["mt-loop-area", "audio-loop-area-bar", "video-loop-area", "audio-loop-area", "mt-visual-loop-overlay"];

    markersA.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
    markersB.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
    areas.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
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

    if (btnPrev_m) btnPrev_m.style.display = hasSavedLoops ? "inline-block" : "none";
    if (btnNext_m) btnNext_m.style.display = hasSavedLoops ? "inline-block" : "none";

    // Update Fretboard Button Highlights
    const fbBtnA = document.getElementById("btn-audio-scale");
    const fbBtnV = document.getElementById("btn-video-scale");
    const fbBtnM = document.getElementById("btn-mt-scale");
    const currentItem = (currentActivePlayer === 'youtube') 
        ? currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex)
        : localFiles[window.currentPlayingIndex];

    const hasScale = currentItem && (currentItem.media_key || currentItem.key);
    [fbBtnA, fbBtnV, fbBtnM].forEach(btn => {
        if (btn) btn.classList.toggle("btn-active-scale", !!hasScale);
    });

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
        
        // TRAINING HOOK: Loop Cycle End
        if (window.MediaTrainingManager) {
            let playerType = 'audio';
            if (currentActivePlayer === 'video' || currentActivePlayer === 'local' || currentActivePlayer === 'youtube') playerType = 'video';
            else if (currentActivePlayer === 'multitrack') playerType = 'multitrack';
            
            if (window.MediaTrainingManager[playerType] && window.MediaTrainingManager[playerType].active) {
                // DEBOUNCE: Only trigger training cycle once per 500ms to allow seek to finish
                const now = Date.now();
                if (now - window.MediaTrainingManager.lastCycleEnd > 500) {
                    window.MediaTrainingManager.lastCycleEnd = now;
                    window.MediaTrainingManager.onCycleEnd(playerType);
                }
            }
        }

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
    checkCues(time);

    // Fail-safe pour le multipiste (si la détection par événement échoue)
    if (currentActivePlayer === 'multitrack' && window.multitrack && !isLoopActive) {
        const dur = getUniversalDuration();
        if (dur > 0 && time >= dur - 0.1 && window.multitrack.isPlaying()) {
            // Fin atteinte !
            window.multitrack.pause();
            window.multitrack.setTime(0);
            if (window.currentAutoreplay === true) {
                window.multitrack.play();
                // TRAINING HOOK: Autoreplay
                if (window.MediaTrainingManager && window.MediaTrainingManager['multitrack'] && window.MediaTrainingManager['multitrack'].active) {
                    const now = Date.now();
                    if (now - window.MediaTrainingManager.lastCycleEnd > 500) {
                        window.MediaTrainingManager.lastCycleEnd = now;
                        window.MediaTrainingManager.onCycleEnd('multitrack');
                    }
                }
            }
            updatePlayPauseUI();
        }
    }

    if (currentActivePlayer === 'youtube') {
        updateTimelineUI(time);
        
        // TRAINING HOOK: YT Autoreplay
        if (window.currentAutoreplay === true && player && player.getPlayerState() === YT.PlayerState.ENDED) {
             // YT state logic handles replay, but we need to catch the "end" event in the interval if needed
             // Actually, YT onStateChange might be better for "End of media"
        }
    }

    // Always update the universal timer (elapsed/remaining)
    updateUniversalTimer();
}, 50);

// ==========================================
// MEDIA TRAINING ENGINE (SPEED TRAINER)
// ==========================================
window.MediaTrainingManager = {
    audio: { active: false, startBpm: 100, finalBpm: 140, increment: 5, cyclesPerStep: 1, stopAtTarget: false, currentCycles: 0, currentBpm: 100 },
    video: { active: false, startBpm: 100, finalBpm: 140, increment: 5, cyclesPerStep: 1, stopAtTarget: false, currentCycles: 0, currentBpm: 100 },
    multitrack: { active: false, startBpm: 100, finalBpm: 140, increment: 5, cyclesPerStep: 1, stopAtTarget: false, currentCycles: 0, currentBpm: 100 },
    lastCycleEnd: 0, // Debounce timestamp

    toggle(player) {
        const panel = document.getElementById(`${player}-training-panel`);
        if (!panel) return;
        const isVisible = panel.style.display === 'flex';
        panel.style.display = isVisible ? 'none' : 'flex';
        
        const btn = document.getElementById(`btn-${player}-training`);
        if (btn) btn.style.color = isVisible ? '' : 'var(--accent)';

        if (!isVisible) {
            this.initPlayer(player);
        } else {
            this[player].active = false;
        }
    },

    getActiveTrack() {
        if (window.currentSource === 'setlist') {
            return currentTrackList.find(t => t.originalIndex === window.currentPlayingIndex);
        } else {
            // Library / Local view - note: localFiles is not on window.
            if (typeof localFiles !== 'undefined' && window.currentPlayingIndex !== null) {
                return localFiles[window.currentPlayingIndex];
            }
        }
        return null;
    },

    initPlayer(player) {
        let refBpm = 120;
        const item = this.getActiveTrack();
        
        if (item && item.bpm) refBpm = parseFloat(item.bpm);
        console.log(`[TRAINING] Init player ${player}. Active track: ${item ? (item.title || item.path) : 'None'} | Track BPM: ${refBpm}`);

        const startInput = document.getElementById(`${player}-train-start`);
        const finalInput = document.getElementById(`${player}-train-final`);
        
        // Only pre-fill IF empty or at static 100/140 default
        if (startInput && (startInput.value === "" || startInput.value == "100")) startInput.value = Math.round(refBpm * 0.75);
        if (finalInput && (finalInput.value === "" || finalInput.value == "140")) finalInput.value = Math.round(refBpm);

        this[player].startBpm = parseFloat(startInput.value) || refBpm;
        this[player].finalBpm = parseFloat(finalInput.value) || 140;
        this[player].increment = parseFloat(document.getElementById(`${player}-train-inc`).value) || 5;
        this[player].cyclesPerStep = parseInt(document.getElementById(`${player}-train-cycles`).value) || 1;
        this[player].stopAtTarget = document.getElementById(`${player}-train-stop`).checked;
        
        this[player].currentCycles = 0;
        this[player].currentBpm = this[player].startBpm;
        this[player].active = true;

        this.updatePlayerSpeed(player);
        this.updateUI(player);
    },

    updateParam(player) {
        if (!this[player]) return;
        this[player].startBpm = parseFloat(document.getElementById(`${player}-train-start`).value) || 120;
        this[player].finalBpm = parseFloat(document.getElementById(`${player}-train-final`).value) || 140;
        this[player].increment = parseFloat(document.getElementById(`${player}-train-inc`).value) || 5;
        this[player].cyclesPerStep = parseInt(document.getElementById(`${player}-train-cycles`).value) || 1;
        this[player].stopAtTarget = document.getElementById(`${player}-train-stop`).checked;
        
        // SYNC: If training is just starting (cycles=0), force currentBpm to match user's new startBpm immediately
        if (this[player].active && this[player].currentCycles === 0) {
            this[player].currentBpm = this[player].startBpm;
            this.updatePlayerSpeed(player);
        }
        
        this.updateUI(player);
    },

    updatePlayerSpeed(player) {
        if (!this[player].active) return;
        
        let refBpm = 120;
        const item = this.getActiveTrack();
        if (item && item.bpm) refBpm = parseFloat(item.bpm);

        const newSpeed = this[player].currentBpm / refBpm;
        console.log(`[TRAINING] Speed calculation: CurrentBpm=${this[player].currentBpm.toFixed(1)} / RefBpm=${refBpm} = ${newSpeed.toFixed(2)}x`);
        
        if (player === 'audio') {
            if (wavesurfer) wavesurfer.setPlaybackRate(newSpeed);
            const speedSpan = document.getElementById("btn-audio-speed");
            if (speedSpan) speedSpan.innerText = newSpeed.toFixed(2) + "x";
        } else if (player === 'video') {
            if (currentActivePlayer === 'youtube') {
                if (player && typeof player.setPlaybackRate === 'function') player.setPlaybackRate(newSpeed);
            } else {
                const vid = document.getElementById("html5-player");
                if (vid) vid.playbackRate = newSpeed;
            }
            const speedSpan = document.getElementById("btn-video-speed");
            if (speedSpan) speedSpan.innerText = newSpeed.toFixed(2) + "x";
        } else if (player === 'multitrack') {
            if (window.multitrack) {
                // FIXED: Iterate over audios for Multitrack
                if (window.multitrack.audios) {
                    window.multitrack.audios.forEach(a => { if (a) a.playbackRate = newSpeed; });
                }
            }
            const speedSpan = document.getElementById("btn-multitrack-speed");
            if (speedSpan) speedSpan.innerText = newSpeed.toFixed(2) + "x";
        }
    },

    onCycleEnd(player) {
        if (!this[player].active) return;

        this[player].currentCycles++;
        console.log(`[TRAINING] Cycle end for ${player}. Count: ${this[player].currentCycles}/${this[player].cyclesPerStep} | Current BPM: ${this[player].currentBpm.toFixed(1)}`);
        
        if (this[player].currentCycles >= this[player].cyclesPerStep) {
            this[player].currentCycles = 0;
            
            // Allow a small margin for float comparison
            if (this[player].currentBpm >= this[player].finalBpm - 0.1) {
                // Target reached or exceeded
                if (this[player].stopAtTarget) {
                    console.log(`[TRAINING] Target reached (${this[player].finalBpm} BPM). Stopping media.`);
                    this.stopMedia(player);
                    this[player].active = false;
                } else {
                    console.log(`[TRAINING] Target reached but CONTINUE option is ON.`);
                }
            } else {
                const oldBpm = this[player].currentBpm;
                this[player].currentBpm += this[player].increment;
                if (this[player].currentBpm > this[player].finalBpm) {
                    this[player].currentBpm = this[player].finalBpm;
                }
                console.log(`[TRAINING] Incrementing BPM: ${oldBpm} -> ${this[player].currentBpm}`);
                this.updatePlayerSpeed(player);
            }
        }
        this.updateUI(player);
    },

    updateUI(player) {
        const info = document.getElementById(`${player}-train-live-info`);
        if (!info) return;
        const valSpan = info.querySelector('.val');
        const remaining = this[player].cyclesPerStep - this[player].currentCycles;
        valSpan.innerText = `${remaining} cycle(s) - Actual: ${Math.round(this[player].currentBpm)} BPM`;
    },

    stopMedia(player) {
         if (player === 'audio') audioControl('playpause');
         else if (player === 'video') videoControl('playpause');
         else if (player === 'multitrack') multitrackControl('playpause');
    }
};

// GLOBAL BRIDGES FOR HTML
function toggleTrainingUI(player) { window.MediaTrainingManager.toggle(player); }
function updateTrainingParam(player) { window.MediaTrainingManager.updateParam(player); }

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
            div.className = "loop-modal-item " + (activeSavedLoopId === l.id ? "selected" : "");
            div.style.cssText = "display:flex; justify-content:space-between; align-items:center; font-size:0.85em; background:#222; padding:4px 8px; border-radius:4px; cursor:pointer;";
            div.onclick = () => selectLoopForUpdate(l.id);
            div.innerHTML = `
                <span id="loop-name-display-${l.id}" style="color:#fff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${l.name}</span>
                <input type="text" id="loop-name-input-${l.id}" value="${l.name}" style="display:none; flex:1; margin-right:5px; font-size:1em; padding:2px; box-sizing:border-box;">
                
                <span style="color:#888; font-family:monospace; margin:0 10px;">[${formatTimeCustom(l.start)}-${formatTimeCustom(l.end)}]</span>
                
                <div style="display:flex; gap:5px;">
                    <button id="btn-edit-${l.id}" class="btn-icon" onclick="event.stopPropagation(); toggleEditLoop(${l.id})" style="padding:2px; font-size:1.2em; color:#fff;" title="Renommer"><i class="ph ph-pencil-simple"></i></button>
                    <button id="btn-save-${l.id}" class="btn-icon" onclick="event.stopPropagation(); saveLoopName(${l.id})" style="display:none; padding:2px; font-size:1.2em; color:var(--accent);" title="Valider"><i class="ph ph-check"></i></button>
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteLoop(${l.id})" style="padding:2px; font-size:1.2em; color:#cf6679;" title="Supprimer"><i class="ph ph-trash"></i></button>
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

function selectLoopForUpdate(id) {
    activeSavedLoopId = id;
    const loop = currentLoops.find(l => l.id === id);
    if (loop) {
        document.getElementById("loop-modal-name").value = loop.name;
        
        // Refresh UI of the modal (especially button text and selection highlight)
        const modal = document.getElementById("loop-modal");
        const saveBtn = modal.querySelector(".btn-primary");
        if (saveBtn) saveBtn.innerText = t("web.btn_update", "Mettre à jour");
        
        // Update highlight
        document.querySelectorAll('.loop-modal-item').forEach(el => el.classList.remove('selected'));
        // Find the div by examining children or just re-render (re-render is safer but more heavy)
        // Since we already set activeSavedLoopId, let's just refresh the list part!
        const existingList = document.getElementById("loop-modal-existing-list");
        Array.from(existingList.children).forEach(child => {
            // Find if this is the right one (using the id in child but it's not straightforward)
            // Actually, we can just re-render the list only
            const btnEdit = child.querySelector(`[id^='btn-edit-']`);
            if (btnEdit && btnEdit.id === `btn-edit-${id}`) {
                child.classList.add('selected');
            }
        });
    }
}

// Reusable backend persist
async function saveLoopsToBackend() {
    if (currentActivePlayer === 'youtube') {
        const track = currentTrackList.find(t => t.originalIndex === currentPlayingIndex);
        if (track) {
            track.loops = currentLoops;
            track.audio_cues = currentCues;
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
            item.audio_cues = currentCues;
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

// --- AUDIO CUES MODAL LOGIC & ENGINE ---
let globalCueAudioEnabled = true;
let globalCueVisualEnabled = true;

let userForceAudio = false;
let userForceVisual = false;

function toggleGlobalCueAudio() {
    globalCueAudioEnabled = !globalCueAudioEnabled;
    userForceAudio = globalCueAudioEnabled;
    const btn = document.getElementById("btn-toggle-global-audio-cues");
    if (btn) btn.style.color = globalCueAudioEnabled ? "var(--success)" : "#888";
}

function toggleGlobalCueVisual() {
    globalCueVisualEnabled = !globalCueVisualEnabled;
    userForceVisual = globalCueVisualEnabled;
    const btn = document.getElementById("btn-toggle-global-visual-cues");
    if (btn) btn.style.color = globalCueVisualEnabled ? "var(--success)" : "#888";
}

function updateGlobalCueButtonsState() {
    userForceAudio = false;
    userForceVisual = false;
    
    const btnAudio = document.getElementById("btn-toggle-global-audio-cues");
    const btnVisual = document.getElementById("btn-toggle-global-visual-cues");
    const btnFlag = document.getElementById("btn-global-cue-add");
    
    if (!currentCues || currentCues.length === 0) {
        if (btnAudio) btnAudio.style.color = "#444";
        if (btnVisual) btnVisual.style.color = "#444";
        if (btnFlag) btnFlag.style.color = "#888";
        globalCueAudioEnabled = false;
        globalCueVisualEnabled = false;
        return;
    }
    
    if (btnFlag) btnFlag.style.color = "var(--danger)";
    
    const hasAudioCue = currentCues.some(c => !c.visual_only);
    const hasVisualCue = currentCues.some(c => c.visual !== false);
    
    globalCueAudioEnabled = hasAudioCue;
    globalCueVisualEnabled = hasVisualCue;
    
    if (btnAudio) btnAudio.style.color = globalCueAudioEnabled ? "var(--success)" : "#888";
    if (btnVisual) btnVisual.style.color = globalCueVisualEnabled ? "var(--success)" : "#888";
}

let activeEditCueId = null;

function renderCueList() {
    const list = document.getElementById("cue-modal-list");
    if (!list) return;
    list.innerHTML = "";
    if (!currentCues || currentCues.length === 0) {
        list.innerHTML = `<li style='padding:8px 10px; font-size:11px; color:#888; text-align:center;'>${t("web.lbl_no_cue_recorded", "Aucun repère enregistré")}</li>`;
        return;
    }
    
    const sortedCues = [...currentCues].sort((a,b) => a.time - b.time);
    sortedCues.forEach(cue => {
        const li = document.createElement("li");
        li.style.padding = "6px 10px";
        li.style.borderBottom = "1px solid #222";
        li.style.cursor = "pointer";
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        li.style.fontSize = "11px";
        
        if (activeEditCueId === cue.id) {
            li.style.background = "rgba(3, 218, 198, 0.2)"; // actif
        } else {
            li.style.background = "transparent";
            li.addEventListener('mouseenter', () => { if (activeEditCueId !== cue.id) li.style.background = "rgba(255,255,255,0.05)"; });
            li.addEventListener('mouseleave', () => { if (activeEditCueId !== cue.id) li.style.background = "transparent"; });
        }
        
        li.onclick = () => editCue(cue.id);
        
        const leftDiv = document.createElement("div");
        leftDiv.style.display = "flex";
        leftDiv.style.gap = "8px";
        leftDiv.style.alignItems = "center";
        leftDiv.style.overflow = "hidden";
        leftDiv.style.flexGrow = "1";
        
        const timeSpan = document.createElement("span");
        timeSpan.innerText = formatTimeCustom(cue.time);
        timeSpan.style.color = "var(--success)";
        timeSpan.style.fontFamily = "monospace";
        timeSpan.style.flexShrink = "0";
        
        const nameSpan = document.createElement("span");
        nameSpan.innerText = cue.name || t("web.lbl_no_name", "Sans nom");
        nameSpan.style.color = "white";
        nameSpan.style.whiteSpace = "nowrap";
        nameSpan.style.overflow = "hidden";
        nameSpan.style.textOverflow = "ellipsis";
        
        leftDiv.appendChild(timeSpan);
        leftDiv.appendChild(nameSpan);
        
        const rightDiv = document.createElement("div");
        rightDiv.style.display = "flex";
        rightDiv.style.alignItems = "center";
        rightDiv.style.flexShrink = "0";
        
        const deleteBtn = document.createElement("button");
        deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
        deleteBtn.style.background = "transparent";
        deleteBtn.style.border = "none";
        deleteBtn.style.color = "#888";
        deleteBtn.style.cursor = "pointer";
        deleteBtn.style.padding = "2px 5px";
        deleteBtn.style.fontSize = "1.1em";
        deleteBtn.title = t("web.btn_cue_delete", "Supprimer");
        
        deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.color = "var(--danger)");
        deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.color = "#888");
        
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // Empêcher l'édition du repère
            deleteCue(cue.id);
        };
        
        rightDiv.appendChild(deleteBtn);
        
        li.appendChild(leftDiv);
        li.appendChild(rightDiv);
        list.appendChild(li);
    });
}

function deleteCue(id) {
    const cue = currentCues.find(c => c.id === id);
    const cueName = cue ? (cue.name || t("web.lbl_no_name", "Sans nom")) : "";
    if (confirm(t("web.msg_confirm_delete_cue", 'Supprimer le repère "{value}" ?').replace('{value}', cueName))) {
        currentCues = currentCues.filter(c => c.id !== id);
        if (activeEditCueId === id) {
            activeEditCueId = null;
            openCueModal(); // Reset les champs de la modale en mode Nouveau
        } else {
            renderCuesUI();
            saveLoopsToBackend();
            renderCueList();
        }
    }
}

function editCue(id) {
    const cue = currentCues.find(c => c.id === id);
    if (!cue) return;
    
    activeEditCueId = id;
    pendingCueTime = cue.time;
    
    document.getElementById("cue-modal-timing").innerText = formatTimeCustom(pendingCueTime);
    document.getElementById("cue-modal-name").value = cue.name || "";
    document.getElementById("cue-modal-sound").value = cue.sound || "stick";
    document.getElementById("cue-modal-bpm").value = cue.bpm || 120;
    document.getElementById("cue-modal-measures").value = cue.measures || 1;
    document.getElementById("cue-modal-vol").value = cue.volume !== undefined ? cue.volume : 0.8;
    document.getElementById("cue-modal-offset").value = cue.offset || 0;
    document.getElementById("cue-modal-visual").checked = cue.visual !== false;
    document.getElementById("cue-modal-visual-only").checked = cue.visual_only === true;
    
    document.getElementById("btn-cue-save").innerText = t("web.btn_cue_update", "Mettre à jour");
    renderCueList();
}

function openCueModal() {
    const modal = document.getElementById("modal-edit-cue");
    if (!modal) return;
    
    // Pause players
    if (currentActivePlayer === 'local' || currentActivePlayer === 'waveform') {
        const vid = document.getElementById("html5-player");
        if (vid && !vid.paused) vid.pause();
        if (wavesurfer && wavesurfer.isPlaying()) wavesurfer.pause();
    } else if (currentActivePlayer === 'youtube' && player && typeof player.pauseVideo === "function") {
        player.pauseVideo();
    }

    pendingCueTime = getCurrentPlayerTime();
    activeEditCueId = null; // Default to create mode
    
    document.getElementById("cue-modal-timing").innerText = formatTimeCustom(pendingCueTime);
    document.getElementById("btn-cue-save").innerText = t("web.btn_cue_save_new", "Nouveau (Enregistrer)");
    
    // Pre-fill BPM if available globally
    const globalBpmSpan = document.getElementById("global-video-bpm");
    if (globalBpmSpan && globalBpmSpan.style.display !== "none") {
        const bpmTxt = globalBpmSpan.querySelector(".val").innerText;
        if (!isNaN(parseInt(bpmTxt))) {
            document.getElementById("cue-modal-bpm").value = parseInt(bpmTxt);
        }
    }
    
    document.getElementById("cue-modal-name").value = "";
    document.getElementById("cue-modal-offset").value = 0;
    document.getElementById("cue-modal-visual-only").checked = false;
    
    renderCueList();
    modal.showModal();
}

function confirmSaveCue() {
    const name = document.getElementById("cue-modal-name").value.trim() || t("web.lbl_no_name", "Sans nom");
    const sound = document.getElementById("cue-modal-sound").value;
    const bpm = parseFloat(document.getElementById("cue-modal-bpm").value) || 120;
    const measures = parseFloat(document.getElementById("cue-modal-measures").value) || 1;
    const vol = parseFloat(document.getElementById("cue-modal-vol").value) || 0.8;
    const offset = parseFloat(document.getElementById("cue-modal-offset").value) || 0;
    const visual = document.getElementById("cue-modal-visual").checked;
    const visualOnly = document.getElementById("cue-modal-visual-only").checked;
    
    if (activeEditCueId) {
        const idx = currentCues.findIndex(c => c.id === activeEditCueId);
        if (idx !== -1) {
            currentCues[idx].name = name;
            currentCues[idx].sound = sound;
            currentCues[idx].bpm = bpm;
            currentCues[idx].measures = measures;
            currentCues[idx].volume = vol;
            currentCues[idx].offset = offset;
            currentCues[idx].visual = visual;
            currentCues[idx].visual_only = visualOnly;
        }
    } else {
        const newCue = {
            id: Date.now(),
            name: name,
            time: pendingCueTime,
            sound: sound,
            bpm: bpm,
            measures: measures,
            volume: vol,
            offset: offset,
            visual: visual,
            visual_only: visualOnly
        };
        currentCues.push(newCue);
    }
    
    renderCuesUI();
    saveLoopsToBackend(); 
    document.getElementById("modal-edit-cue").close();
}

const cueAudioCtx = window.AudioContext ? new AudioContext() : (window.webkitAudioContext ? new webkitAudioContext() : null);

function playCueSequence(cue) {
    if (!cueAudioCtx) return;
    if (cueAudioCtx.state === 'suspended') cueAudioCtx.resume();
    
    // Total beats to schedule
    const totalBeats = Math.floor(cue.measures * 4);
    if (totalBeats <= 0) return;
    
    const beatDuration = 60 / cue.bpm;
    const now = cueAudioCtx.currentTime; 
    
    for (let b = 0; b < totalBeats; b++) {
        const timeToPlay = now + (b * beatDuration);
        scheduleCueTick(timeToPlay, cue, b, totalBeats);
    }
}

function scheduleCueTick(time, cue, beatIndex, totalBeats) {
    if (!cueAudioCtx) return;
    
    const shouldPlayAudio = globalCueAudioEnabled && (!cue.visual_only || userForceAudio);
    
    if (shouldPlayAudio) {
        const osc = cueAudioCtx.createOscillator();
        const gain = cueAudioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(cueAudioCtx.destination);
        
        if (cue.sound === 'ping') {
            osc.frequency.value = 880; 
            osc.type = 'sine';
        } else { // stick / click
            osc.frequency.value = (beatIndex === 0 && totalBeats >= 4) ? 1200 : 800; // Accent on first beat
            osc.type = 'square';
        }
        
        const vol = cue.volume !== undefined ? cue.volume : 0.8;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(vol, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        
        osc.start(time);
        osc.stop(time + 0.1);
    }
    
    const shouldShowVisual = globalCueVisualEnabled && (cue.visual || userForceVisual);
    
    if (shouldShowVisual) {
        const delayMs = Math.max(0, (time - cueAudioCtx.currentTime) * 1000);
        setTimeout(() => {
            triggerCueHud(totalBeats - beatIndex); // counting down
        }, delayMs);
    }
}

function triggerCueHud(number) {
    const hud = document.getElementById("cue-hud-overlay");
    if (!hud) return;
    hud.innerText = number;
    hud.style.display = "block";
    hud.style.opacity = "1";
    hud.style.transform = "translate(-50%, -50%) scale(1.5)";
    
    setTimeout(() => {
        hud.style.transform = "translate(-50%, -50%) scale(1)";
        hud.style.opacity = "0";
    }, 150);
}

function checkCues(time) {
    if (!globalCueAudioEnabled && !globalCueVisualEnabled) return;
    if (!currentCues || currentCues.length === 0) return;
    
    const isPlaying = (currentActivePlayer === 'local' && !document.getElementById('html5-player').paused) || 
                      (currentActivePlayer === 'waveform' && wavesurfer && typeof wavesurfer.isPlaying === 'function' && wavesurfer.isPlaying()) || 
                      (currentActivePlayer === 'youtube' && player && typeof player.getPlayerState === 'function' && player.getPlayerState() === 1) ||
                      (currentActivePlayer === 'multitrack' && window.multitrack && window.multitrack.wavesurfers && window.multitrack.wavesurfers[0] && typeof window.multitrack.wavesurfers[0].isPlaying === 'function' && window.multitrack.wavesurfers[0].isPlaying());
    
    
    if (!isPlaying) return;

    currentCues.forEach(cue => {
        const totalBeats = Math.floor(cue.measures * 4);
        if (totalBeats <= 0) return;
        
        const preRollTime = totalBeats * (60 / cue.bpm);
        const offsetSec = (cue.offset || 0) / 1000.0;
        const triggerTime = cue.time - preRollTime + offsetSec;
        
        if (time >= triggerTime && time <= triggerTime + 0.150) {
            if (lastPlayedCueId === cue.id && (performance.now() - window.lastCueTriggerRealTime) < 2000) return;
            lastPlayedCueId = cue.id;
            window.lastCueTriggerRealTime = performance.now();
            playCueSequence(cue);
        }
    });
}

function renderCuesUI() {
    document.querySelectorAll('.cue-marker').forEach(e => e.remove());
    updateGlobalCueButtonsState();
    if (!currentCues || currentCues.length === 0) return;

    let timelineBg = null;
    let duration = null;

    if (currentActivePlayer === 'youtube' && player && typeof player.getDuration === "function") {
        timelineBg = document.getElementById("video-loop-bar");
        duration = player.getDuration();
    } else if (currentActivePlayer === 'local') {
        const vid = document.getElementById("html5-player");
        if (vid && !isNaN(vid.duration)) {
            timelineBg = document.getElementById("video-loop-bar");
            duration = vid.duration;
        }
    } else if (currentActivePlayer === 'waveform') {
        timelineBg = document.getElementById("audio-loop-bar");
        if (wavesurfer && !isNaN(wavesurfer.getDuration())) {
            duration = wavesurfer.getDuration();
        }
    } else if (currentActivePlayer === 'multitrack' && window.multitrack) {
         timelineBg = document.getElementById("mt-loop-bar");
         if (window.multitrack.wavesurfers) {
             duration = 0;
             window.multitrack.wavesurfers.forEach(ws => {
                 const wsDur = ws.getDuration();
                 if (wsDur > duration) duration = wsDur;
             });
         }
    }

    if (!timelineBg || !duration || duration <= 0) return;

    currentCues.forEach(cue => {
        const pct = (cue.time / duration) * 100;
        const marker = document.createElement("div");
        marker.className = "cue-marker";
        marker.style.cssText = `position:absolute; bottom:-4px; left:${pct}%; width:2px; height:calc(100% + 8px); background:#f1c40f; z-index:10; cursor:pointer; pointer-events:auto; box-shadow: 0 0 4px rgba(241, 196, 15, 0.8);`;
        marker.title = `${cue.name || "Sans nom"} (${formatTimeCustom(cue.time)})`;
        
        marker.ondblclick = (e) => {
            e.stopPropagation();
            const cueName = cue.name || t("web.lbl_no_name", "Sans nom");
            if (confirm(t("web.msg_confirm_delete_cue", 'Supprimer le repère "{value}" ?').replace('{value}', cueName))) {
                currentCues = currentCues.filter(c => c.id !== cue.id);
                renderCuesUI();
                saveLoopsToBackend();
            }
        };
        
        timelineBg.appendChild(marker);
    });
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
        const hasLoops = currentLoops && currentLoops.length > 0;
        const hasCues = currentCues && currentCues.length > 0;
        if (hasLoops || hasCues) setTimeout(renderLoopsUI, 500);
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
        renderCuesUI();
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

    renderCuesUI();
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
            activeSavedLoopId = activeLoop.id; // Corrected: store the ID of the matched loop
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
    currentCues = trackOrItem.audio_cues || [];
    renderLoopsUI();
    renderCuesUI(); 
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
    // Determine the value to show in modals for this specific item.
    // If undefined in the item, fallback to currentSettings and assign it to the item.
    if (item.autoreplay === undefined) item.autoreplay = (currentSettings.autoreplay || false);
    if (item.autoplay === undefined) item.autoplay = (currentSettings.autoplay || false);

    const isAutoreplay = item.autoreplay;
    const isAutoplay = item.autoplay;

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

    // Multitrack Modal
    const mtAutoreplay = document.getElementById("mt-autoreplay");
    const mtAutoplay = document.getElementById("mt-autoplay");
    if (mtAutoreplay) mtAutoreplay.checked = isAutoreplay;
    if (mtAutoplay) mtAutoplay.checked = isAutoplay;
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

async function saveLocalItemQuiet(index, item) {
    await fetch(`/api/local/${index}`, {
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
    let dragMode = null; // 'CREATE', 'RESIZE_A', 'RESIZE_B', 'POTENTIAL_CREATE'
    let dragStartTime = 0;

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
            isDragging = true;
        } else if (loopB !== null && Math.abs(time - loopB) < thresholdSec) {
            dragMode = 'RESIZE_B';
            isDragging = true;
        } else {
            dragMode = 'POTENTIAL_CREATE';
            dragStartTime = time;
            isDragging = false; // wait for move
        }

        e.preventDefault();
        updateLoopUI();
    };

    const onMouseMove = (e) => {
        const { bar, content } = getTargetElements();
        if (!bar && !content) return;

        // Visual feedback
        if (!isDragging && dragMode !== 'POTENTIAL_CREATE') {
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

        if (dragMode === 'POTENTIAL_CREATE') {
            if (Math.abs(clampedTime - dragStartTime) > 0.1) {
                dragMode = 'CREATE';
                isDragging = true;
                activeSavedLoopId = null;
                loopA = dragStartTime;
                loopB = clampedTime;
                isLoopActive = true;
            } else {
                return; // Hasn't moved enough
            }
        }
        
        if (dragMode === 'CREATE') {
            if (clampedTime > dragStartTime) {
                loopA = dragStartTime;
                loopB = clampedTime;
            } else {
                loopB = dragStartTime;
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
        if (dragMode === 'POTENTIAL_CREATE') {
            seekPlayerTo(dragStartTime); // Just a click to seek
            dragMode = null;
            return;
        }

        if (!isDragging) return;
        isDragging = false;
        
        if (loopA !== null && loopB !== null && Math.abs(loopB - loopA) > 0.1) {
            isLoopActive = true;
            if (dragMode === 'CREATE' || dragMode === 'RESIZE_A') seekPlayerTo(loopA);
        } else if (dragMode === 'CREATE') {
            clearLoop(); // Only clears A-B bounds now, not the saved regions in UI!
        }
        dragMode = null;
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

// --- SIDEBAR ERGONOMICS (HEADER) ---
async function toggleSidebarOption(optName) {
    if (!currentSettings) return;

    // Toggle value
    currentSettings[optName] = !currentSettings[optName];

    // Handle side effects
    if (optName === 'sidebar_hover_trigger' && !currentSettings[optName]) {
        const sidebar = document.querySelector('.sidebar-zone');
        if (sidebar) sidebar.classList.remove('hover-active');
    }

    // Refresh UI
    updateSidebarButtonsUI();

    // Save Immediately
    console.log(`[SETTINGS] Toggling ${optName} to ${currentSettings[optName]}`);
    try {
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentSettings)
        });
    } catch (e) { console.error("Error saving sidebar choice:", e); }
}

function updateSidebarButtonsUI() {
    if (!currentSettings) return;

    const btnAh = document.getElementById("btn-sidebar-autohide");
    const btnDh = document.getElementById("btn-sidebar-default-hidden");
    const btnHt = document.getElementById("btn-sidebar-hover-trigger");
    const btnTh = document.getElementById("btn-toggle-theater");

    if (btnAh) btnAh.classList.toggle('active', currentSettings.sidebar_autohide === true);
    if (btnDh) btnDh.classList.toggle('active', currentSettings.sidebar_default_hidden === true);
    if (btnHt) btnHt.classList.toggle('active', currentSettings.sidebar_hover_trigger === true);
    if (btnTh) btnTh.classList.toggle('active', isTheaterMode === true);
}

/**
 * Centrer le morceau actif dans la liste déroulante (Setlist)
 */
function scrollToActiveTrack() {
    const activeRow = document.querySelector('#setlist-body tr.active');
    if (activeRow) {
        activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Mise à jour rapide des highlights de la setlist sans re-rendu complet
 */
function refreshSetlistHighlights() {
    // Scan ALL rows with data-index attribute (YouTube AND Local)
    const rows = document.querySelectorAll("tr[data-index]");
    
    rows.forEach(row => {
        const idx = parseInt(row.getAttribute("data-index"));
        if (!isNaN(idx)) {
            if (idx === window.currentPlayingIndex) {
                row.classList.add("active");
            } else {
                row.classList.remove("active");
            }
        }
    });

    // Optionnel : Scroll immédiat si besoin
    scrollToActiveTrack();
}

function handlePlayerError(el) {
    // Si on est en train de charger un multipiste, on ignore les erreurs du joueur vidéo résiduel
    if (window.currentActivePlayer === 'multitrack' && el.id === 'html5-player') {
        return; 
    }

    console.warn("Player Error detected on:", el.id);
    if (!el.src || el.src === "" || el.src.includes('undefined')) return;
    
    if (window.currentPlayingIndex !== null) {
        const track = findTrackInLibraryOrSetlist(window.currentPlayingIndex, window.currentSource);
        if (track && !track.url?.startsWith('http') && !track.path?.startsWith('http')) {
            // Empêcher le marquage si on vient juste de réparer le fichier (debounce)
            if (track._just_relocated) return;

            // Marquer comme manquant pour l'affichage (grisé), 
            // MAIS ne pas ouvrir la modale automatiquement pour éviter de "tourner en rond"
            track.is_missing = true;
            console.error("Fichier marqué comme manquant suite à une erreur de lecture.");
            
            // On rafraîchit les indicateurs visuels sans forcer la modale
            loadSetlist();
            loadLocalFiles();
        }
    }
}

function findTrackInLibraryOrSetlist(index, forceSource = null) {
    // 1. Force Source if known
    if (forceSource === 'setlist') {
        const t = currentTrackList.find(t => t.originalIndex === index);
        if (t) return t;
    } else if (forceSource === 'library') {
        const t = localFiles[index];
        if (t) { t.originalIndex = index; return t; }
    }

    // 2. Fallback detection if source unknown
    let track = currentTrackList.find(t => t.originalIndex === index);
    if (track) return track;
    
    track = localFiles[index];
    if (track) {
        track.originalIndex = index;
        return track;
    }
    return null;
}

window.currentRelocateInfo = null;

function openMissingFileModal(track, type = null) {
    const dialog = document.getElementById('modal-missing-file');
    if (!dialog) return;
    
    // Explicit type or detection
    let finalType = type;
    if (!finalType) {
        const isSetlistItem = currentTrackList.some(t => t.originalIndex === track.originalIndex && t.title === track.title);
        finalType = isSetlistItem ? 'setlist' : 'library';
    }

    window.currentRelocateInfo = {
        type: finalType,
        index: track.originalIndex,
        track: track
    };
    
    const path = track.url || track.path || "Fichier inconnu";
    const filename = path.split(/[/\\]/).pop();
    document.getElementById('missing-file-name').innerText = filename;
    
    dialog.showModal();
}

async function executeSmartRelocate() {
    if (!window.currentRelocateInfo) return;
    
    const btn = document.getElementById('btn-smart-relocate');
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-circle-notch ph-spin"></i> ${t('web.msg_dl_processing', 'Recherche...')}`;
    
    try {
        const { type, index } = window.currentRelocateInfo;
        console.log(`[SmartRelocate] Attempting FIND for ${type} index ${index}`);
        // Call with apply=false to just get the path
        const res = await fetch(`/api/local/smart_relocate/${type}/${index}?apply=false`, { method: 'POST' });
        const data = await res.json();
        
        if (data.status === 'ok' && data.found_path) {
            showRelocateActions(data.found_path);
        } else {
            console.warn("[SmartRelocate] Not found or error:", data.message);
            alert(data.message || "Fichier non trouvé.");
        }
    } catch (e) {
        console.error(e);
        alert("Erreur lors de la recherche.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
    }
}

async function executeManualRelocate() {
    if (!window.currentRelocateInfo) return;
    const { track } = window.currentRelocateInfo;
    
    try {
        const isMultitrack = track.is_multitrack;
        const pickerType = isMultitrack ? "folder" : "file";
        const pickerRes = await fetch(`/api/local/pick_path?type=${pickerType}`);
        const pickerData = await pickerRes.json();
        
        if (pickerData.status === "ok" && pickerData.path) {
            showRelocateActions(pickerData.path);
        }
    } catch (e) {
        console.error("Manual Relocate Error:", e);
        alert("Erreur lors de la sélection manuelle.");
    }
}

function showRelocateActions(foundPath) {
    if (!window.currentRelocateInfo) return;
    window.currentRelocateInfo.newFoundPath = foundPath;
    
    document.getElementById('missing-file-step-1').style.display = 'none';
    const step2 = document.getElementById('missing-file-step-2');
    step2.style.display = 'block';
    
    document.getElementById('missing-file-found-path').textContent = foundPath;
}

function resetRelocateModal() {
    document.getElementById('missing-file-step-1').style.display = 'block';
    document.getElementById('missing-file-step-2').style.display = 'none';
}

async function applyRelocateAction(action) {
    if (!window.currentRelocateInfo || !window.currentRelocateInfo.newFoundPath) return;
    
    const { type, index, track, newFoundPath } = window.currentRelocateInfo;
    const step2 = document.getElementById('missing-file-step-2');
    const buttons = step2.querySelectorAll('button');
    buttons.forEach(b => b.disabled = true);
    
    try {
        const res = await fetch('/api/local/relocate_apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: action,
                type: type,
                index: index,
                new_path: newFoundPath
            })
        });
        
        const data = await res.json();
        
        if (data.status === 'ok') {
            track.is_missing = false;
            if (type === 'setlist') track.url = data.new_path;
            else track.path = data.new_path;
            
            loadSetlist();
            loadLocalFiles();
            
            setTimeout(() => {
                const modal = document.getElementById('modal-missing-file');
                if (modal) modal.close();
                resetRelocateModal();
                
                alert(t('web.msg_relocate_success', 'Média relocalisé avec succès !'));
                
                track._just_relocated = true;
                setTimeout(() => { track._just_relocated = false; }, 2000);

                setTimeout(() => {
                    if (type === 'setlist') playTrackAt(index);
                    else playLocal(index);
                }, 300);
            }, 300);

        } else {
            alert("Erreur lors de l'application : " + (data.message || "Inconnue"));
            buttons.forEach(b => b.disabled = false);
        }
    } catch (e) {
        console.error(e);
        alert("Erreur réseau.");
        buttons.forEach(b => b.disabled = false);
    }
}

/* ==========================================
   BULK RELOCATE LOGIC
   ========================================== */
let missingItems = []; // Global list of { type, index, title, old_path, found_path, selected }

async function checkMissingItems() {
    try {
        const response = await fetch(`/api/local/missing_items`);
        missingItems = await response.json();
        
        const banner = document.getElementById('bulk-relocate-banner');
        const text = document.getElementById('bulk-relocate-text');
        
        if (missingItems && missingItems.length > 0) {
            console.log(`[RELOCATE] ${missingItems.length} missing items detected.`);
            missingItems.forEach(item => {
                item.selected = true;
                item.found_path = null;
            });
            
            if (banner) {
                banner.style.display = 'flex';
                if (text) text.innerText = t('web.msg_missing_files', '{n} fichiers manquants détectés').replace('{n}', missingItems.length);
            }
        } else {
            console.log("[RELOCATE] No missing items found.");
            if (banner) banner.style.display = 'none';
        }
    } catch (e) {
        console.error("Failed to check missing items:", e);
    }
}

async function openBulkRelocateModal() {
    const modal = document.getElementById('modal-relocate-bulk');
    if (!modal) return;
    
    await loadRelocationFolders();
    updateBulkDestState(); // Initial lock state
    checkMissingItems();
    renderBulkItems();
    updateBulkCountStatus();
    modal.showModal();
}

// Universal loadRelocationFolders is now defined further down (V45)

function updateBulkDestState() {
    const action = document.getElementById('bulk-action-select').value;
    const destSelect = document.getElementById('bulk-dest-select');
    const browseBtn = document.getElementById('btn-browse-dest');
    const label = document.getElementById('lbl-bulk-dest');
    
    const isLink = (action === 'link');
    
    if (destSelect) {
        destSelect.disabled = isLink;
        destSelect.style.background = isLink ? "rgba(0,0,0,0.2)" : "#252525";
        destSelect.style.color = isLink ? "#666" : "white";
        destSelect.style.borderColor = isLink ? "#333" : "#444";
    }
    if (browseBtn) {
        browseBtn.disabled = isLink;
        browseBtn.style.opacity = isLink ? 0.4 : 1;
    }
    if (label) {
        label.style.color = isLink ? "#555" : "#aaa";
    }
}

function closeBulkRelocateModal() {
    const modal = document.getElementById('modal-relocate-bulk');
    if (modal) modal.close();
}

function renderBulkItems() {
    const list = document.getElementById('bulk-items-list');
    if (!list) return;
    
    list.innerHTML = missingItems.map((item, i) => `
        <div class="bulk-item-row ${item.found_path ? 'found' : 'not-found'}">
            <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleBulkItem(${i}, this.checked)">
            <div class="bulk-item-info">
                <span class="bulk-item-title">${item.title}</span>
                <span class="bulk-item-path">${item.old_path}</span>
                ${item.found_path ? `<span class="bulk-item-path" style="color:var(--accent); font-weight:bold;">→ ${item.found_path}</span>` : ''}
            </div>
            <span class="status-badge ${item.found_path ? 'found' : 'missing'}">
                ${item.found_path ? t('web.status_found', 'TROUVÉ') : t('web.status_missing', 'MANQUANT')}
            </span>
        </div>
    `).join('');
    
    // Enable/disable apply button
    const btnApply = document.getElementById('btn-apply-bulk');
    const hasFound = missingItems.some(i => i.selected && i.found_path);
    if (btnApply) btnApply.disabled = !hasFound;
}

function toggleBulkItem(index, checked) {
    missingItems[index].selected = checked;
    updateBulkCountStatus();
    renderBulkItems();
}

function toggleBulkSelectAll(checked) {
    missingItems.forEach(item => item.selected = checked);
    updateBulkCountStatus();
    renderBulkItems();
}

function updateBulkCountStatus() {
    const count = missingItems.filter(i => i.selected).length;
    const status = document.getElementById('bulk-count-status');
    if (status) status.innerText = `${count} / ${missingItems.length} ` + t('web.lbl_selected', 'sélectionné(s)');
}

async function startBulkSmartScan() {
    const selected = missingItems.filter(i => i.selected && !i.found_path);
    if (selected.length === 0) return;
    
    updateBulkProgress(0, selected.length, t('web.msg_scanning', 'Recherche en cours...'));
    
    for(let i=0; i < selected.length; i++) {
        const item = selected[i];
        try {
            const res = await fetch(`/api/local/smart_relocate?index=${item.index}&type=${item.type}&apply=false`);
            const data = await res.json();
            if (data.status === 'ok' && data.found_path) {
                item.found_path = data.found_path;
            }
        } catch(e) {}
        updateBulkProgress(i + 1, selected.length);
    }
    
    renderBulkItems();
}

async function startBulkFolderScan() {
    const folderPath = document.getElementById('bulk-manual-folder').value;
    if (!folderPath) {
        alert(t('web.msg_enter_folder', 'Veuillez coller un chemin de dossier'));
        return;
    }
    
    const selected = missingItems.filter(i => i.selected);
    if (selected.length === 0) return;
    
    updateBulkProgress(0, 100, t('web.msg_folder_scanning', 'Scan récursif du dossier...'));
    
    try {
        const res = await fetch(`/api/local/search_folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_path: folderPath, items: selected })
        });
        const data = await res.json();
        
        if (data.status === 'ok') {
            data.results.forEach(res => {
                // The backend returned mapping to our input list (selected)
                // We need to map back to global list
                const originalItem = selected[res.item_list_index];
                if (originalItem) originalItem.found_path = res.found_path;
            });
            alert(t('web.msg_scan_found', '{n} fichiers trouvés').replace('{n}', data.found_count));
        } else {
            alert(data.message);
        }
    } catch(e) {
        console.error(e);
        alert("Erreur lors du scan.");
    } finally {
        document.getElementById('bulk-progress-container').style.display = 'none';
        renderBulkItems();
    }
}

async function applyBulkRelocation() {
    const action = document.getElementById('bulk-action-select').value;
    const destSelect = document.getElementById('bulk-dest-select');
    const targetFolder = destSelect ? destSelect.value : 'AUTO';
    
    const mappings = missingItems.filter(i => i.selected && i.found_path).map(i => ({
        type: i.type,
        index: i.index,
        new_path: i.found_path,
        is_multitrack: i.is_multitrack
    }));
    
    if (mappings.length === 0) return;
    
    if (!confirm(t('web.confirm_bulk_apply', 'Êtes-vous sûr de vouloir appliquer ces {n} changements ?').replace('{n}', mappings.length))) return;
    
    updateBulkProgress(0, 1, t('web.msg_applying', 'Application des changements...'));
    
    try {
        const res = await fetch(`/api/local/relocate_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, mappings: mappings, target_folder: targetFolder })
        });
        const data = await res.json();
        
        if (data.status === 'ok') {
            let msgKey = 'web.msg_bulk_success_link';
            if (action === 'copy') msgKey = 'web.msg_bulk_success_copy';
            else if (action === 'move') msgKey = 'web.msg_bulk_success_move';
            
            alert(t(msgKey, '{n} fichiers relocalisés !').replace('{n}', data.success_count));
            closeBulkRelocateModal();
            loadSetlist();
            loadLocalFiles();
            checkMissingItems();
        } else {
            alert(t('web.msg_bulk_error', "Erreur lors de l'application groupée : ") + (data.message || "Action impossible"));
            if (data.errors && data.errors.length > 0) {
                console.error("Bulk Relocation Errors:", data.errors);
            }
        }
    } catch(e) {
        console.error(e);
        alert("Erreur réseau.");
    } finally {
        document.getElementById('bulk-progress-container').style.display = 'none';
    }
}

/**
 * Universal function to populate all relocation/destination selectors in the app.
 * Used by: Bulk Relocation, Library Manager, and Single Item Edit modals.
 */
async function loadRelocationFolders() {
    const selects = [
        'bulk-source-select', 
        'bulk-dest-select', 
        'lib-manager-dest-select',
        'relocate-confirm-dest-select'
    ];
    
    let folders = [];
    try {
        const res = await fetch("/api/config/managed_folders");
        const data = await res.json();
        if (data.status === 'ok') {
            folders = data.folders || [];
            console.log("[DEBUG UI] Managed Folders Loaded:", folders.length);
        }
    } catch (e) { 
        console.error("[RELOCATE] Error loading managed folders:", e); 
    }

    const formatPath = (p) => {
        if (!p) return p;
        if (p.includes("${APP_DIR}")) {
            return "📦 [App] \\ " + p.replace("${APP_DIR}", "").replace(/\//g, " \\ ").replace(/^ \\ /, "");
        }
        return "⭐ " + p;
    };

    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        const currentVal = select.value || "AUTO";
        select.innerHTML = '';

        // 1. Create AUTO option
        const optAuto = document.createElement('option');
        optAuto.value = "AUTO";
        optAuto.setAttribute('data-i18n', 'web.opt_auto_artist_dest');
        optAuto.innerText = t('web.opt_auto_artist_dest', '-- Auto-routage par Artiste (Recommandé) --');
        select.appendChild(optAuto);

        // 2. Add Managed Folders
        folders.forEach(f => {
            if (f === "AUTO" || f === "MANUAL") return;
            const opt = document.createElement('option');
            opt.value = f;
            opt.innerText = formatPath(f);
            select.appendChild(opt);
        });

        // 3. Create MANUAL option
        const optManual = document.createElement('option');
        optManual.value = "MANUAL";
        optManual.setAttribute('data-i18n', 'web.opt_manual_dest');
        optManual.innerText = t('web.opt_manual_dest', 'Choisir un dossier spécifique...');
        select.appendChild(optManual);
        
        // Restore selection
        if (currentVal) {
            const exists = Array.from(select.options).some(o => o.value === currentVal);
            if (exists) select.value = currentVal;
            else select.value = "AUTO";
        }
    });
}

// Remove old functions to avoid confusion
async function populateRelocateSelect() { loadRelocationFolders(); }

/**
 * Perform a physical file operation (Copy or Move) for a single item from the edit modal.

/**
 * Perform a physical file operation (Copy or Move) for a single item from the edit modal.
 * Integrated V41: Choice between Auto-routing (Artist based) or Manual destination.
 */
let pendingRelocateAction = null;

/**
 * Universal relocation trigger from Edit Medias Modals.
 * Instead of executing immediately, it prepares data and opens a confirmation modal (V47).
 */
async function relocateFromEdit(action) {
    // Detect context based on which modal is currently open
    const isMT = document.getElementById("modal-multitrack").open;
    const idx = editingLocalIndex;
    
    if (idx === null || idx === undefined || idx === -1) return;
    const item = localFiles[idx];
    
    if (!item || !item.path) {
        alert(t('web.msg_error_path_not_found', "Action impossible : chemin du média introuvable."));
        return;
    }

    // Load folders to ensure the confirm modal select is ready
    await loadRelocationFolders();

    // Save for confirmation (V52)
    pendingRelocateAction = {
        action: action,
        type: isMT ? 'multitrack' : 'library',
        index: idx
    };

     // UI Feedback in Confirmation Modal
    const modal = document.getElementById('modal-relocate-confirm');
    const titleEl = document.getElementById('relocate-confirm-title');
    const headerEl = document.getElementById('relocate-confirm-header');
    const sourceEl = document.getElementById('relocate-confirm-source');
    const confirmSelect = document.getElementById('relocate-confirm-dest-select');
    
    const warnEl = document.getElementById('relocate-confirm-artist-warning'); // Legacy
    const artistInput = document.getElementById('relocate-confirm-artist-input');
    const artistChk = document.getElementById('relocate-confirm-use-artist-chk');
    const artistErr = document.getElementById('relocate-confirm-artist-error');
    const artistMsg = document.getElementById('relocate-confirm-artist-msg');

    if (titleEl) titleEl.innerText = t(action === 'copy' ? 'web.modal_confirm_relocate_title' : 'web.modal_confirm_move_title');
    if (headerEl) headerEl.style.background = (action === 'copy' ? '#2980b9' : '#e67e22'); // Bleu pour copie, Orange pour déplacement
    if (sourceEl) sourceEl.innerText = item.path;
    
    // Default to AUTO for smart routing
    if (confirmSelect) {
        confirmSelect.value = "AUTO";
    }
    
    if (warnEl) warnEl.style.display = 'none';

    // Artist Assistant Prep
    if (artistInput) {
        artistInput.value = item.artist || "";
        artistInput.oninput = (e) => {
            clearTimeout(artistCheckTimeout);
            artistCheckTimeout = setTimeout(() => checkArtistFolderMatch(e.target.value), 400);
        };
        // Initial check
        checkArtistFolderMatch(item.artist || "");
    }

    if (artistChk) artistChk.checked = (item.artist && item.artist.trim() !== "");
    if (artistErr && artistMsg) {
        if (!item.artist || item.artist.trim() === "") {
            artistErr.style.display = "flex";
            artistMsg.innerText = "Attention: Artiste manquant !";
            artistInput.style.borderColor = "#ff9800";
        } else {
            artistErr.style.display = "none";
            artistInput.style.borderColor = "#444";
        }
    }

    if (modal) modal.showModal();
}

let artistCheckTimeout = null;

/**
 * Searches for existing artist folders across all managed roots.
 * Suggests the best destination to avoid duplicates (V50).
 */
async function checkArtistFolderMatch(name) {
    const zone = document.getElementById('relocate-confirm-artist-match-zone');
    const pathEl = document.getElementById('relocate-confirm-match-path');
    const btn = document.getElementById('btn-use-detected-folder');
    
    if (!name || name.trim() === "" || name.trim() === "Divers") {
        if (zone) zone.style.display = 'none';
        return;
    }
    
    try {
        const res = await fetch(`/api/local/find_artist_folder?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        
        if (data.status === 'ok' && data.matches && data.matches.length > 0) {
            const match = data.matches[0];
            if (zone) zone.style.display = 'block';
            
            // Format complete path for display (V51)
            let displayPath = match.full_path;
            if (displayPath.includes("${APP_DIR}")) {
                displayPath = displayPath.replace("${APP_DIR}", "APP").replace(/\//g, " \\ ").replace(/^ \\ /, "");
            } else {
                displayPath = "⭐ " + displayPath;
            }
            
            if (pathEl) pathEl.innerText = displayPath; 
            
            if (btn) {
                btn.onclick = () => {
                    const select = document.getElementById('relocate-confirm-dest-select');
                    const artistChk = document.getElementById('relocate-confirm-use-artist-chk');
                    if (select) {
                        select.value = match.root;
                        // Success Feedback
                        select.style.borderColor = "#4caf50";
                        select.style.boxShadow = "0 0 10px rgba(76, 175, 80, 0.4)";
                        setTimeout(() => { 
                            select.style.borderColor = "#444"; 
                            select.style.boxShadow = "none";
                        }, 2000);
                    }
                    if (artistChk) artistChk.checked = true;
                };
            }
        } else {
            if (zone) zone.style.display = 'none';
        }
    } catch (e) {
        if (zone) zone.style.display = 'none';
    }
}

/**
 * Final execution after user confirmation in modal-relocate-confirm.
 */
async function confirmRelocateUnitary() {
    if (!pendingRelocateAction) return;
    
    // Final values from confirmation modal
    const confirmSelect = document.getElementById('relocate-confirm-dest-select');
    const finalDest = (confirmSelect && confirmSelect.value !== "AUTO") ? confirmSelect.value : null;
    
    const useArtist = document.getElementById('relocate-confirm-use-artist-chk').checked;
    const updatedArtist = document.getElementById('relocate-confirm-artist-input').value.trim();

    const { action, type, index } = pendingRelocateAction;
    
    document.getElementById('modal-relocate-confirm').close();
    
    try {
        console.log(`[Relocate] Confirming Unitary: ${action} to ${finalDest || 'AUTO'} (Artist: ${updatedArtist})`);

        const res = await fetch('/api/local/relocate_apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: action,
                type: type,
                index: index,
                target_folder: finalDest,
                create_artist_folder: useArtist,
                updated_artist: updatedArtist
            })
        });

        const data = await res.json();
        if (data.status === 'ok') {
            // Update the item in memory
            if (localFiles && localFiles[index]) {
                localFiles[index].path = data.new_path;
                if (updatedArtist) localFiles[index].artist = updatedArtist;
            }
            
            // Update UI displays
            const lp = document.getElementById("local-path-display");
            const mp = document.getElementById("mt-path-display");
            const mtArtist = document.getElementById("mt-artist");
            const localArtist = document.getElementById("edit-artist");

            if (lp) lp.innerText = data.new_path;
            if (mp) mp.innerText = data.new_path;
            
            // Re-sync artist fields in edit modals if they were changed
            if (updatedArtist) {
                if (mtArtist) mtArtist.value = updatedArtist;
                if (localArtist) localArtist.value = updatedArtist;
            }

            loadLocalFiles(); // Refresh library
            
            const successKey = (action === 'copy') ? 'web.msg_bulk_success_copy' : 'web.msg_bulk_success_move';
            alert(t(successKey, 'Opération réussie !').replace('{n}', 1));
            
        } else {
            alert("Erreur : " + (data.message || "Inconnue"));
        }
    } catch (e) {
        console.error("Relocation Error", e);
        alert("Erreur technique lors de la relocalisation.");
    } finally {
        pendingRelocateAction = null;
    }
}

function updateBulkProgress(current, total, text = null) {
    const container = document.getElementById('bulk-progress-container');
    const fill = document.getElementById('bulk-progress-fill');
    const percentTxt = document.getElementById('bulk-progress-percent');
    const label = document.getElementById('bulk-progress-text');
    
    if (container) container.style.display = 'block';
    const pct = Math.round((current / total) * 100);
    if (fill) fill.style.width = pct + '%';
    if (percentTxt) percentTxt.innerText = pct + '%';
    if (text && label) label.innerText = text;
    
    if (pct >= 100 && total > 0) {
        setTimeout(() => { if (container) container.style.display = 'none'; }, 2000);
    }
}
async function openNativeFolderPicker(targetType = 'source') {
    try {
        const res = await fetch("/api/utils/select_folder");
        const data = await res.json();
        if (data.status === 'ok' && data.path) {
            let selectId = 'bulk-source-select';
            if (targetType === 'dest') selectId = 'bulk-dest-select';
            else if (targetType === 'lib-dest') selectId = 'lib-manager-dest-select';
            else if (targetType === 'confirm-dest') selectId = 'relocate-confirm-dest-select';
            
            const select = document.getElementById(selectId);
            if (select) {
                let exists = false;
                for (let i=0; i<select.options.length; i++) {
                    if (select.options[i].value === data.path) { exists = true; break; }
                }
                if (!exists) {
                    const opt = document.createElement('option');
                    opt.value = data.path;
                    opt.innerText = "⭐ " + data.path;
                    select.appendChild(opt);
                }
                select.value = data.path;
            }
        }
    } catch(e) { console.error("Picker Error", e); }
}

async function startBulkFolderScan() {
    const sourceSelect = document.getElementById('bulk-source-select');
    const sourcePath = sourceSelect ? sourceSelect.value : 'AUTO';
    
    const selected = missingItems.filter(i => i.selected);
    if (selected.length === 0) return;

    updateBulkProgress(0, 100, t('web.msg_scanning', 'Recherche en cours...'));
    
    try {
        if (sourcePath === 'AUTO') {
            await scanManagedFolders(); 
        } else {
            const res = await fetch(`/api/local/search_folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_path: sourcePath, items: selected })
            });
            const data = await res.json();
            if (data.status === 'ok') {
                data.results.forEach(r => {
                    const originalItem = selected[r.item_list_index];
                    if (originalItem) originalItem.found_path = r.found_path;
                });
                alert(t('web.msg_scan_found', '{n} fichiers trouvés').replace('{n}', data.found_count));
            } else { alert(data.message); }
        }
    } catch(e) {
        console.error(e);
        alert("Erreur lors du scan.");
    } finally {
        document.getElementById('bulk-progress-container').style.display = 'none';
        renderBulkItems();
    }
}
async function scanManagedFolders() {
    try {
        updateBulkProgress(0, 100, t('web.msg_fetching_config', 'Récupération de la configuration...'));
        const resConfig = await fetch("/api/config/managed_folders");
        const configData = await resConfig.json();
        const folders = configData.folders || [];
        
        const selected = missingItems.filter(i => i.selected);
        if (selected.length === 0) return;

        let totalFound = 0;
        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];
            updateBulkProgress(i, folders.length, t('web.msg_scanning_managed', 'Scan du dossier {n}/{total}').replace('{n}', i+1).replace('{total}', folders.length));
            
            const scanRes = await fetch(`/api/local/search_folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_path: folder, items: selected })
            });
            const scanData = await scanRes.json();
            if (scanData.status === 'ok') {
                scanData.results.forEach(r => {
                    const originalItem = selected[r.item_list_index];
                    if (originalItem) originalItem.found_path = r.found_path;
                });
                totalFound += scanData.found_count;
            }
        }
        alert(t('web.msg_managed_scan_done', 'Scan terminé. {n} correspondances trouvées.').replace('{n}', totalFound));
    } catch(e) { 
        console.error("Managed Scan Error", e); 
        alert("Erreur lors du scan automatique.");
    } finally {
        document.getElementById('bulk-progress-container').style.display = 'none';
        renderBulkItems();
    }
}

/* ==========================================
   LIBRARY MANAGER LOGIC (V40)
   ========================================== */
let libManagerSelectedIndices = new Set();

function openLibraryManagerModal() {
    libManagerSelectedIndices.clear();
    const searchInput = document.getElementById("lib-manager-search");
    if (searchInput) searchInput.value = "";
    
    const destSelect = document.getElementById("lib-manager-dest-select");
    if (destSelect) {
        destSelect.value = "AUTO";
        loadRelocationFolders(); // UNIFIED V45 - Load folders for library manager
    }
    
    const progContainer = document.getElementById("lib-manager-progress-container");
    if (progContainer) progContainer.style.display = "none";
    
    const selAll = document.getElementById("lib-manager-select-all");
    if (selAll) selAll.checked = false;
    
    renderLibraryManagerItems();
    const modal = document.getElementById("modal-library-manager");
    if (modal) modal.showModal();
}

function closeLibraryManagerModal() {
    const modal = document.getElementById("modal-library-manager");
    if (modal) modal.close();
}

function renderLibraryManagerItems() {
    const list = document.getElementById("lib-manager-items-list");
    const searchEl = document.getElementById("lib-manager-search");
    const search = searchEl ? searchEl.value.toLowerCase() : "";
    
    if (!list) return;
    list.innerHTML = "";

    const filtered = localFiles.filter(item => {
        const match = (item.title || "").toLowerCase().includes(search) || (item.artist || "").toLowerCase().includes(search);
        return match;
    });

    filtered.forEach((item) => {
        const originalIndex = localFiles.indexOf(item);
        const isSelected = libManagerSelectedIndices.has(originalIndex);
        
        const div = document.createElement("div");
        div.className = "bulk-item-row";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.padding = "8px";
        div.style.borderBottom = "1px solid #222";
        div.style.gap = "10px";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = isSelected;
        chk.onchange = (e) => {
            if (e.target.checked) libManagerSelectedIndices.add(originalIndex);
            else libManagerSelectedIndices.delete(originalIndex);
            updateLibManagerStatus();
        }

        const info = document.createElement("div");
        info.style.flex = "1";
        info.innerHTML = `<div style="font-weight:bold; font-size:0.9em;">${item.title}</div>
                          <div style="font-size:0.75em; color:#888;">${item.artist || "---"}</div>
                          <div style="font-size:0.75em; color:#555; word-break:break-all;">${item.path}</div>`;

        div.appendChild(chk);
        div.appendChild(info);
        list.appendChild(div);
    });

    updateLibManagerStatus();
}

function updateLibManagerStatus() {
    const statusTxt = document.getElementById("lib-manager-count-status");
    if (statusTxt) {
        statusTxt.innerText = `${libManagerSelectedIndices.size} / ${localFiles.length} sélectionné(s)`;
    }
}

function toggleLibManagerSelectAll(checked) {
    const searchEl = document.getElementById("lib-manager-search");
    const search = searchEl ? searchEl.value.toLowerCase() : "";
    
    localFiles.forEach((item, idx) => {
        const match = (item.title || "").toLowerCase().includes(search) || (item.artist || "").toLowerCase().includes(search);
        if (match) {
            if (checked) libManagerSelectedIndices.add(idx);
            else libManagerSelectedIndices.delete(idx);
        }
    });
    renderLibraryManagerItems();
}

function updateLibManagerDestState() {
    // Optional UI updates based on action choice
}

async function applyLibraryManagerActions() {
    if (libManagerSelectedIndices.size === 0) {
        alert("Veuillez sélectionner au moins un média.");
        return;
    }

    const action = document.getElementById("lib-manager-action-select").value;
    const dest = document.getElementById("lib-manager-dest-select").value;
    const selectedArray = Array.from(libManagerSelectedIndices);
    
    if (!confirm(t('web.confirm_bulk_apply', 'Appliquer ces {n} changements ?').replace('{n}', selectedArray.length))) return;

    const progressContainer = document.getElementById("lib-manager-progress-container");
    const progressFill = document.getElementById("lib-manager-progress-fill");
    const progressText = document.getElementById("lib-manager-progress-text");
    const progressPercent = document.getElementById("lib-manager-progress-percent");

    if (progressContainer) progressContainer.style.display = "block";
    
    let successCount = 0;
    let errors = [];

    for (let i = 0; i < selectedArray.length; i++) {
        const idx = selectedArray[i];
        const item = localFiles[idx];
        
        const pct = Math.round(((i + 1) / selectedArray.length) * 100);
        if (progressFill) progressFill.style.width = pct + "%";
        if (progressPercent) progressPercent.innerText = pct + "%";
        if (progressText) progressText.innerText = `Traitement ${i + 1}/${selectedArray.length} : ${item.title}`;

        try {
            const res = await fetch('/api/local/relocate_apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: action,
                    type: 'library',
                    index: idx,
                    new_path: item.path,
                    target_folder: dest === "AUTO" ? null : dest
                })
            });
            const data = await res.json();
            if (data.status === 'ok') {
                successCount++;
                item.path = data.new_path; // Sync in memory
            } else {
                errors.push(`${item.title}: ${data.message}`);
            }
        } catch (e) {
            errors.push(`${item.title}: Erreur réseau`);
        }
    }

    if (progressContainer) progressContainer.style.display = "none";
    loadLocalFiles();
    
    let msgKey = (action === 'copy') ? 'web.msg_bulk_success_copy' : 'web.msg_bulk_success_move';
    alert(t(msgKey, '{n} fichiers traités !').replace('{n}', successCount));
    
    if (errors.length > 0) {
        console.error("Library Manager Errors:", errors);
    }
    
    renderLibraryManagerItems(); // Refresh modal view
}

// --- SMART MAPPING (MEDIA LINKER) ---
let linkerSourceType = '';
let linkerSourceItem = null;
let currentEditingLinkedIds = [];

function openMediaLinker(sourceType) {
    linkerSourceType = sourceType;
    // Identifier l'item en cours d'édition
    if (sourceType === 'setlist') {
        linkerSourceItem = currentTrackList.find(t => t.originalIndex === editingIndex);
    } else if (sourceType === 'library') {
        linkerSourceItem = localFiles[editingLocalIndex];
    } else if (sourceType === 'web_links') {
        linkerSourceItem = (currentWebLinkIndex === -1) ? { linked_ids: currentEditingLinkedIds } : webLinks[currentWebLinkIndex];
    }

    if (!linkerSourceItem) {
        console.warn("[LINKER] No source item found for:", sourceType, "indices:", editingIndex, editingLocalIndex);
        return;
    }

    currentEditingLinkedIds = linkerSourceItem.linked_ids || [];
    
    // Reset search
    document.getElementById("linker-search-input").value = "";
    renderLinkerResults("");
    renderExistingLinks();

    document.getElementById("modal-media-linker").showModal();
}

function openMediaLinkerFromEdit() {
    if (!lastEditContext) {
        console.warn("[LINKER] No edit context set");
        return;
    }
    openMediaLinker(lastEditContext);
}

function closeMediaLinkerModal() {
    document.getElementById("modal-media-linker").close();
}

function renderLinkerResults(query) {
    const list = document.getElementById("linker-results");
    if (!list) return;
    list.innerHTML = "";

    const q = query.toLowerCase().trim();
    const results = [];

    const currentIdx = (linkerSourceType === 'setlist') ? editingIndex : (linkerSourceType === 'library' ? editingLocalIndex : currentWebLinkIndex);

    // Search across dictionaries
    // 1. YouTube
    currentTrackList.forEach((item, idx) => {
        if (linkerSourceType === 'setlist' && idx === currentIdx) return;
        if (matchQuery(item, q)) results.push({ type: 'setlist', index: idx, item });
    });

    // 2. Local
    localFiles.forEach((item, idx) => {
        if (linkerSourceType === 'library' && idx === currentIdx) return;
        if (matchQuery(item, q)) results.push({ type: 'library', index: idx, item });
    });

    // 3. Web Links
    webLinks.forEach((item, idx) => {
        if (linkerSourceType === 'web_links' && idx === currentIdx) return;
        if (matchQuery(item, q)) results.push({ type: 'web_links', index: idx, item });
    });

    if (results.length === 0) {
        let msg = q ? t('web.lbl_linker_no_results', 'Aucun résultat') : 'Commencez à taper pour rechercher...';
        list.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">${msg}</div>`;
        return;
    }

    results.slice(0, 50).forEach(res => {
        const div = document.createElement("div");
        div.className = "linker-result-item";
        div.style = "display:flex; align-items:center; gap:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:5px; cursor:pointer; transition:background 0.2s; margin-bottom:5px;";
        div.onmouseover = () => div.style.background = "rgba(255,255,255,0.1)";
        div.onmouseout = () => div.style.background = "rgba(255,255,255,0.05)";
        
        const resType = res.type;
        const iconUrl = (resType === 'web_links' || resType === 'web') ? getIcon(res.item.url) : null;
        
        const typeIcon = getTypeIcon(res);
        const uid = `${res.type.substring(0,3)}:${res.index}`;
        const isLinked = currentEditingLinkedIds.includes(uid);

        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                ${iconUrl ? `<img src="${iconUrl}" style="width:20px; height:20px; border-radius:4px;">` : `<i class="${typeIcon}" style="font-size:1.2em; color:var(--accent);"></i>`}
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${res.item.title || res.item.url}</div>
                    <div style="font-size:0.85em; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${res.item.artist || ""}</div>
                </div>
            </div>
            <button class="btn-secondary" style="padding:4px 8px; font-size:0.8em; border-color:${isLinked ? '#ff4444' : '#444'}; color:${isLinked ? '#ff4444' : '#fff'};"
                onclick="event.stopPropagation(); toggleMediaLink('${res.type}', ${res.index})">
                ${isLinked ? translations[currentLang]?.web?.btn_unlink || 'Détacher' : translations[currentLang]?.web?.btn_link || 'Lier'}
            </button>
        `;
        list.appendChild(div);
    });
}

function matchQuery(item, q) {
    if (!q) return false; // Show nothing if empty query? Or show all? The user might want to see all.
    // Let's show all if q is empty for setlist/library? No, better search.
    return (item.title || "").toLowerCase().includes(q) || (item.artist || "").toLowerCase().includes(q);
}

function getTypeIcon(res) {
    if (res.type === 'setlist') return 'ph ph-youtube-logo';
    if (res.type === 'library') {
        const type = getLocalType(res.item);
        if (type === 'video') return 'ph ph-film-strip';
        if (type === 'multitrack') return 'ph ph-stack-simple';
        return 'ph ph-music-notes';
    }
    
    // Web Links
    const type = res.item.type || 'other';
    if (type === 'songsterr') return 'ph ph-guitar';
    if (type === 'moises') return 'ph ph-scissors';
    if (type === 'spotify') return 'ph ph-spotify-logo';
    if (type === 'lesson') return 'ph ph-graduation-cap';
    
    const url = (res.item.url || "").toLowerCase();
    if (url.includes("songsterr")) return 'ph ph-guitar';
    if (url.includes("spotify")) return 'ph ph-spotify-logo';
    if (url.includes("youtube") || url.includes("youtu.be")) return 'ph ph-youtube-logo';
    
    return 'ph ph-globe';
}

function renderExistingLinks() {
    const container = document.getElementById("linker-existing-links");
    if (!container) return;
    container.innerHTML = "";

    if (currentEditingLinkedIds.length === 0) {
        container.innerHTML = `<span style="color:#555; font-size:0.9em;">Aucun lien manuel.</span>`;
        return;
    }

    currentEditingLinkedIds.forEach(uid => {
        const item = getLinkedItem(uid);
        if (!item) return;

        const prefix = uid.substring(0, 3).toUpperCase();
        const [typeCode, idx] = uid.split(':');

        const badge = document.createElement("div");
        badge.style = "background:rgba(255,255,255,0.05); border:1px solid #444; padding:2px 8px; border-radius:12px; font-size:0.8em; display:flex; align-items:center; gap:5px;";
        
        const favIcon = typeCode === 'web' ? getIcon(item.url) : null;
        const iconHtml = favIcon ? `<img src="${favIcon}" style="width:14px; height:14px; border-radius:2px;">` : `<span style="font-weight:bold; color:var(--accent); font-size:0.7em;">${prefix}</span>`;

        badge.innerHTML = `
            ${iconHtml}
            <span style="max-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title}</span>
            <span style="cursor:pointer; font-weight:bold; color:#ff4444; margin-left:5px;" onclick="toggleMediaLink('${typeCode === 'set' ? 'setlist' : (typeCode === 'lib' ? 'library' : 'web_links')}', ${idx})">×</span>
        `;
        container.appendChild(badge);
    });
}

async function toggleMediaLink(targetType, targetIndex) {
    const targetPrefix = targetType.substring(0, 3);
    const targetUid = `${targetPrefix}:${targetIndex}`;
    
    const sourcePrefix = linkerSourceType.substring(0, 3);
    const sourceIndex = (linkerSourceType === 'setlist') ? editingIndex : (linkerSourceType === 'library' ? editingLocalIndex : currentWebLinkIndex);
    const sourceUid = `${sourcePrefix}:${sourceIndex}`;

    // 1. Update source memory
    if (currentEditingLinkedIds.includes(targetUid)) {
        currentEditingLinkedIds = currentEditingLinkedIds.filter(id => id !== targetUid);
    } else {
        currentEditingLinkedIds.push(targetUid);
    }
    
    // Update the item being edited directly
    linkerSourceItem.linked_ids = currentEditingLinkedIds;

    // 2. Update target (Backend call for immediate bidirectional link)
    const isNowLinked = currentEditingLinkedIds.includes(targetUid);
    try {
        await fetch('/api/media/link_bidirectional', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_type: linkerSourceType,
                source_index: sourceIndex,
                target_type: targetType,
                target_index: targetIndex,
                action: isNowLinked ? 'link' : 'unlink'
            })
        });

        // 3. AUTO-SYNC METADATA (V53)
        // If we are linking (not unlinking) and we have a source/target, try to fill missing gaps
        if (isNowLinked) {
            const targetItem = getLinkedItem(targetUid);
            if (targetItem && linkerSourceItem) {
                const fields = ['title', 'artist', 'bpm', 'key', 'scale', 'tuning', 'category', 'genre', 'cover'];
                let changedFields = [];
                
                fields.forEach(f => {
                    const sVal = linkerSourceItem[f];
                    const tVal = targetItem[f];
                    
                    // Special for title: Only sync if current is empty or matches url
                    if (f === 'title') {
                        const curTitle = document.getElementById("web-link-title")?.value || "";
                        if (!curTitle || curTitle === linkerSourceItem.url) {
                            linkerSourceItem.title = tVal;
                            changedFields.push('title');
                        }
                    } else if ((!sVal || sVal === "" || sVal === 0) && tVal) {
                        linkerSourceItem[f] = tVal;
                        changedFields.push(f);
                    }
                });
                
                if (changedFields.length > 0) {
                    console.log("[Auto-Sync] Metadata synced from target to source:", changedFields);
                    logToBackend("[Auto-Sync] Implemented fields: " + changedFields.join(', '));
                    // Update UI if a modal is open
                    if (linkerSourceType === 'web_links') {
                        // Refresh Web Modal fields
                        changedFields.forEach(f => {
                            const el = document.getElementById(`web-link-${f}`);
                            if (el) {
                                el.value = linkerSourceItem[f] || "";
                                // Visual Flash Effect
                                el.style.transition = "background 0.2s, box-shadow 0.2s";
                                el.style.background = "rgba(187,134,252,0.3)";
                                el.style.boxShadow = "0 0 10px var(--accent)";
                                setTimeout(() => {
                                    el.style.background = "";
                                    el.style.boxShadow = "";
                                }, 1500);
                            }
                        });
                        
                        if (changedFields.includes('cover') && linkerSourceItem.cover) {
                            window.currentWebLinkCover = linkerSourceItem.cover;
                            const img = document.getElementById("web-link-art-img");
                            img.src = linkerSourceItem.cover.startsWith('http') ? linkerSourceItem.cover : `/api/cover?path=${encodeURIComponent(linkerSourceItem.cover)}`;
                            img.style.display = "block";
                            document.getElementById("web-link-art-placeholder").style.display = "none";
                            document.getElementById("btn-web-link-delete-cover").style.display = "flex"; // Show delete btn
                            img.style.animation = "pulse-glow 1s infinite alternate";
                            setTimeout(() => img.style.animation = "", 3000);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Bidirectional link error:", e);
    }

    renderLinkerResults(document.getElementById("linker-search-input").value);
    renderExistingLinks();

    // 4. Update Header UI immediately if the source is the one currently playing (V53)
    const isPlayingSource = (linkerSourceType === 'setlist' && window.currentSource === 'setlist' && editingIndex === window.currentPlayingIndex) ||
                            (linkerSourceType === 'library' && window.currentSource === 'library' && editingLocalIndex === window.currentPlayingIndex) ||
                            (linkerSourceType === 'web_links' && window.currentSource === 'web_links' && currentWebLinkIndex === window.currentPlayingIndex);

    if (isPlayingSource) {
        updateInterconnectionUI(linkerSourceItem);
    }

    // V55: Force reload of all web links to keep frontend sync with the newly saved JSON (F5/Refresh protection)
    if (linkerSourceType === 'web_links' || targetType === 'web_links') {
        await loadWebLinks(); // This re-renders and re-populates webLinks array
    }

    // V55: Explicitly sync the Web Link Modal session list to prevent overwriting on Save
    if (linkerSourceType === 'web_links') {
        currentEditingLinkedIds = [...linkerSourceItem.linked_ids];
    }
}
