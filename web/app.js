// DOM Elements
const statusEl = document.getElementById('status');
const profileNameEl = document.getElementById('profile-name');
const logsEl = document.getElementById('logs-container');
const gridEl = document.getElementById('pedalboard-grid');

let socket;

// Helper: Log
function log(msg) {
    const line = document.createElement('div');
    line.textContent = `> ${msg}`;
    logsEl.prepend(line);
}

// Helper: Trigger API
async function triggerAction(cc, value = 127) {
    log(`Triggering CC ${cc}...`);
    try {
        await fetch('/api/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cc, value })
        });
    } catch (e) {
        log(`Trigger Error: ${e}`);
    }
}

// Helper: Render Grid
function renderGrid(profileData) {
    gridEl.innerHTML = ''; // Clear

    if (!profileData || !profileData.mappings) {
        gridEl.innerHTML = '<div style="grid-column: span 5; text-align: center; color: #555;">Aucun mapping pour ce profil</div>';
        return;
    }

    const mappings = profileData.mappings;

    // Sort mappings by CC or some other logic?
    // For now just render them.
    // Ideally we might want a fixed 5-slot layout if AIRSTEP has 5 buttons A-E.
    // Assuming AIRSTEP: CC 50, 51, 52, 53, 54 usually.

    mappings.forEach(m => {
        const btn = document.createElement('div');
        btn.className = 'pedal-btn';
        btn.dataset.cc = m.midi_cc; // Store CC for easy lookup

        btn.innerHTML = `
            <div class="pedal-name">${m.name || 'Action'}</div>
            <div class="pedal-cc">CC ${m.midi_cc}</div>
        `;

        // Click to trigger
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

// WebSocket Connection
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        statusEl.textContent = 'Connecté au Serveur Local';
        statusEl.className = 'connected';
        log('WebSocket Connected');
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "midi") {
                // MIDI Event
                const cc = data.cc;
                if (cc !== undefined) {
                    // Find button and animate
                    const btn = document.querySelector(`.pedal-btn[data-cc="${cc}"]`);
                    if (btn) {
                        btn.classList.add('active');
                        setTimeout(() => btn.classList.remove('active'), 200);
                    }
                    log(`MIDI RX: CC ${cc}`);
                }

            } else if (data.type === "profile_update") {
                // Profile Change -> RENDER UI
                const profile = data.data;
                const name = profile ? profile.name : "Global / Aucun";

                profileNameEl.textContent = name;
                renderGrid(profile);

                log(`Profil chargé : ${name}`);
            }

        } catch (e) {
            console.error(e);
        }
    };

    socket.onclose = () => {
        statusEl.textContent = 'Déconnecté - Reconnexion...';
        statusEl.className = 'disconnected';
        setTimeout(connect, 3000);
    };
}

// Start
connect();
