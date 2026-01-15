// --- CONFIG ---
const API_SETLIST = '/api/setlist';
const API_TRIGGER = '/api/trigger';

// --- STATE ---
let player; // YouTube Player
let setlist = [];
let controlMode = 'windows'; // 'windows' or 'web' (for switch) - Visual only for now or logical?
// User asked for "Switch Mode : Web / Windows" to know if buttons control internal player or PC.
// Since the backend handles the mapping, "Web Mode" implies triggering internal commands.
// Actually, with the new "command_callback", backend sends "media_..." commands back to frontend.
// So the switch might just be visual or to disable sending triggers?
// The prompt says: "pour savoir si les boutons contrôlent le lecteur interne ou le PC".
// Implementation:
// - Windows Mode: Buttons send POST /trigger -> Backend -> Keystrokes.
// - Web Mode: Buttons (if mapped to media) -> Backend -> WebSocket -> JS Player.
// Actually, if the mapping is "media_pause", backend sends command back.
// If mapping is "Space", backend presses Space (Windows).
// So the mode switch in UI is likely just for user information OR to filter triggers?
// Let's assume it's just a toggle for now, maybe we can use it to force focus on IFrame?
// For now, I'll just implement the switch UI.

// --- DOM ELEMENTS ---
const statusEl = document.getElementById('status');
const profileNameEl = document.getElementById('profile-name');
const logsEl = document.getElementById('logs-container');
const gridEl = document.getElementById('pedalboard-grid');
const inputUrl = document.getElementById('input-url');
const btnAdd = document.getElementById('btn-add');
const listEl = document.getElementById('setlist-items');
const modeSwitch = document.getElementById('mode-check');

// --- LOGGING ---
function log(msg) {
    const line = document.createElement('div');
    line.textContent = `> ${msg}`;
    logsEl.prepend(line);
}

// --- YOUTUBE API ---
function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

// Global callback for YouTube API
window.onYouTubeIframeAPIReady = function() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '', // Start empty
        playerVars: {
            'playsinline': 1,
            'controls': 1
        },
        events: {
            'onReady': onPlayerReady
        }
    });
};

function onPlayerReady(event) {
    log("YouTube Player Ready");
}

function loadVideo(url) {
    // Extract ID (basic regex)
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    if (match && match[1]) {
        if(player && player.loadVideoById) {
            player.loadVideoById(match[1]);
        }
    } else {
        log("URL Invalide");
    }
}

// --- SETLIST MANAGEMENT ---
async function loadSetlist() {
    try {
        const res = await fetch(API_SETLIST);
        setlist = await res.json();
        renderSetlist();
    } catch (e) { log("Error loading setlist"); }
}

async function saveSetlist() {
    try {
        await fetch(API_SETLIST, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(setlist)
        });
    } catch (e) { log("Error saving setlist"); }
}

function renderSetlist() {
    listEl.innerHTML = '';
    setlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-item';

        li.innerHTML = `
            <span class="track-title">${track.title || track.url}</span>
            <button class="btn-remove">×</button>
        `;

        // Play Click
        li.addEventListener('click', (e) => {
            if(e.target.classList.contains('btn-remove')) return;
            // Highlight
            document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            loadVideo(track.url);
        });

        // Remove Click
        li.querySelector('.btn-remove').addEventListener('click', () => {
            setlist.splice(index, 1);
            saveSetlist();
            renderSetlist();
        });

        listEl.appendChild(li);
    });
}

// Add Handler
btnAdd.addEventListener('click', () => {
    const url = inputUrl.value.trim();
    if (!url) return;

    // Simple title extract (simulated)
    const title = `Track ${setlist.length + 1}`;

    setlist.push({ title, url });
    saveSetlist();
    renderSetlist();
    inputUrl.value = '';
});

// --- COMMAND HANDLING (INTERNAL) ---
function handleCommand(cmd) {
    if (!player) return;
    log(`CMD: ${cmd}`);

    switch(cmd) {
        case 'media_pause':
        case 'media_play_pause': // Common mapping
            const state = player.getPlayerState();
            if (state === 1) player.pauseVideo();
            else player.playVideo();
            break;
        case 'media_play':
            player.playVideo();
            break;
        case 'media_stop':
            player.stopVideo();
            break;
        case 'media_speed_up':
            let rate = player.getPlaybackRate();
            player.setPlaybackRate(rate + 0.25);
            log(`Speed: ${player.getPlaybackRate()}`);
            break;
        case 'media_speed_down':
            let r = player.getPlaybackRate();
            if(r > 0.25) player.setPlaybackRate(r - 0.25);
            break;
        case 'media_rewind':
            let curr = player.getCurrentTime();
            player.seekTo(curr - 10, true);
            break;
        case 'media_forward':
            let c = player.getCurrentTime();
            player.seekTo(c + 10, true);
            break;
    }
}

// --- WEBSOCKET & GRID ---
function renderGrid(profileData) {
    gridEl.innerHTML = '';
    if (!profileData || !profileData.mappings) {
        gridEl.innerHTML = '<div style="color: #555; text-align:center; grid-column: span 2;">Aucun profil actif</div>';
        return;
    }

    profileData.mappings.forEach(m => {
        const btn = document.createElement('div');
        btn.className = 'pedal-btn';
        btn.dataset.cc = m.midi_cc;

        btn.innerHTML = `
            <div class="pedal-name">${m.name || 'Action'}</div>
            <div class="pedal-cc">CC ${m.midi_cc}</div>
        `;

        // Manual Click -> Trigger API
        btn.addEventListener('mousedown', () => {
            triggerAction(m.midi_cc);
            btn.classList.add('active');
        });
        btn.addEventListener('mouseup', () => {
            btn.classList.remove('active');
        });

        gridEl.appendChild(btn);
    });
}

async function triggerAction(cc) {
    try {
        await fetch(API_TRIGGER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cc, value: 127 })
        });
    } catch (e) { console.error(e); }
}

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        statusEl.textContent = 'Online';
        statusEl.className = 'connected';
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "midi") {
                // Flash Button
                if (data.cc !== undefined) {
                    const btn = document.querySelector(`.pedal-btn[data-cc="${data.cc}"]`);
                    if (btn) {
                        btn.classList.add('active');
                        setTimeout(() => btn.classList.remove('active'), 200);
                    }
                }
            } else if (data.type === "profile_update") {
                profileNameEl.textContent = data.data ? data.data.name : "Aucun";
                renderGrid(data.data);
            } else if (data.type === "command") {
                // INTERNAL COMMAND -> PLAYER CONTROL
                handleCommand(data.cmd);
            }
        } catch (e) {}
    };

    socket.onclose = () => {
        statusEl.textContent = 'Offline';
        statusEl.className = 'disconnected';
        setTimeout(connect, 3000);
    };
}

// --- INIT ---
loadYouTubeAPI();
loadSetlist();
connect();
