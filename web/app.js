// --- CONFIG ---
const API_SETLIST = '/api/setlist';
const API_TRIGGER = '/api/trigger';

// --- STATE ---
let player; // YouTube Player
let setlist = [];
let controlMode = 'windows'; // 'windows' | 'web'
let currentProfile = null;

// --- DOM ELEMENTS ---
const statusEl = document.getElementById('status');
const profileNameEl = document.getElementById('profile-name');
const logsEl = document.getElementById('logs-container');
const gridEl = document.getElementById('pedalboard-grid');
const inputUrl = document.getElementById('input-url');
const btnAdd = document.getElementById('btn-add');
const listEl = document.getElementById('setlist-items');
const modeCheck = document.getElementById('mode-check');

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

window.onYouTubeIframeAPIReady = function() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: { 'playsinline': 1, 'controls': 1 },
        events: { 'onReady': onPlayerReady }
    });
};

function onPlayerReady(event) {
    log("YouTube Player Ready");
}

function loadVideo(idOrUrl) {
    // If it looks like an ID (11 chars, no special chars), use ID
    // Otherwise extract from URL
    let videoId = idOrUrl;

    // Simple heuristic: URL usually contains dots or slashes
    if (idOrUrl.includes('/') || idOrUrl.includes('.')) {
         const match = idOrUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
         if (match && match[1]) videoId = match[1];
    }

    if (videoId && videoId.length === 11) {
        if(player && player.loadVideoById) {
            player.loadVideoById(videoId);
        }
    } else {
        log("ID/URL Invalide: " + idOrUrl);
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

async function addItem(url) {
    try {
        log("Ajout en cours (Smart Fetch)...");
        const res = await fetch(API_SETLIST, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ url: url }) // Let backend fetch title
        });
        setlist = await res.json();
        renderSetlist();
        log("Ajouté avec succès !");
    } catch (e) { log("Error adding item"); }
}

async function removeItem(index) {
    try {
        const res = await fetch(`${API_SETLIST}/${index}`, { method: 'DELETE' });
        setlist = await res.json();
        renderSetlist();
    } catch (e) { log("Error removing item"); }
}

function renderSetlist() {
    listEl.innerHTML = '';
    setlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-item';

        // Display Title (Backend provided) or fallback to URL
        const displayTitle = track.title || track.url;

        li.innerHTML = `
            <span class="track-title">${displayTitle}</span>
            <button class="btn-remove">×</button>
        `;

        li.addEventListener('click', (e) => {
            if(e.target.classList.contains('btn-remove')) return;
            document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');

            // Prefer ID if available, else URL
            loadVideo(track.id || track.url);
        });

        li.querySelector('.btn-remove').addEventListener('click', () => {
            removeItem(index);
        });

        listEl.appendChild(li);
    });
}

btnAdd.addEventListener('click', () => {
    const url = inputUrl.value.trim();
    if (!url) return;

    addItem(url);
    inputUrl.value = '';
});

// --- COMMAND HANDLING ---
function handleCommand(cmd) {
    if (!player) return;
    log(`CMD (Web): ${cmd}`);

    switch(cmd) {
        case 'media_pause':
        case 'media_play_pause':
            const state = player.getPlayerState();
            if (state === 1) player.pauseVideo();
            else player.playVideo();
            break;
        case 'media_play': player.playVideo(); break;
        case 'media_stop': player.stopVideo(); break;
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

// --- MODE SWITCH ---
modeCheck.addEventListener('change', (e) => {
    controlMode = e.target.checked ? 'web' : 'windows';
    log(`Mode switched to: ${controlMode.toUpperCase()}`);
});

// --- WEBSOCKET & LOGIC ---
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

        // Manual Click -> Simulate MIDI logic
        btn.addEventListener('mousedown', () => {
            processAction(m.midi_cc);
            btn.classList.add('active');
        });
        btn.addEventListener('mouseup', () => {
            btn.classList.remove('active');
        });

        gridEl.appendChild(btn);
    });
}

// Core Logic: Routing
async function processAction(cc) {
    if (!currentProfile || !currentProfile.mappings) return;

    // Find Mapping
    const mapping = currentProfile.mappings.find(m => m.midi_cc == cc);
    if (!mapping) return;

    const actionVal = mapping.action_value || "";
    const isMedia = actionVal.startsWith("media_");

    // Logic Table
    if (controlMode === 'web' && isMedia) {
        handleCommand(actionVal);
    } else {
        triggerAction(cc);
    }
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
                if (data.cc !== undefined) {
                    // Visual Feedback
                    const btn = document.querySelector(`.pedal-btn[data-cc="${data.cc}"]`);
                    if (btn) {
                        btn.classList.add('active');
                        setTimeout(() => btn.classList.remove('active'), 200);
                    }

                    // Trigger Logic
                    processAction(data.cc);
                }
            } else if (data.type === "profile_update") {
                currentProfile = data.data;
                const name = currentProfile ? currentProfile.name : "Global";
                profileNameEl.textContent = name;
                renderGrid(currentProfile);
                log(`Profil: ${name}`);
            } else if (data.type === "command") {
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
