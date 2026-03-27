// DRUM MACHINE ENGINE
// Moteur de boîte à rythmes basé sur des matrices en 16 pas (Doubles croches)

window.DrumMachine = {
    isActive: false,
    currentPatternId: 'rock_1',
    volumes: {
        master: 1.0,
        kick: 1.0,
        snare: 1.0,
        hihat: 1.0,
        openhat: 0.8,
        tom1: 0.9,
        tom2: 0.9,
        tom3: 0.9,
        clap: 1.0,
        cymbal: 0.7,
        cowbell: 0.8,
        rim: 0.8
    },
    buffers: {},
    isLoaded: false,
    
    patterns: {
        rock_1: {
            steps: 16,
            tracks: {
                kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                cymbal:[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
            }
        },
        rock_2: {
            steps: 16,
            tracks: {
                kick:  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
                snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
                hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                openhat:[0,0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
            }
        },
        disco: {
            steps: 16,
            tracks: {
                kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                openhat:[0,0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
            }
        },
        funk: {
            steps: 16,
            tracks: {
                kick:  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0],
                hihat: [1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1],
                cowbell:[0,0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
            }
        },
        shuffle: {
            steps: 16,
            tracks: {
                kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                hihat: [1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0],
                rim:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
            }
        }
    },

    currentKit: 'tr505',
    
    async loadAssets(audioContext) {
        // Optionnel : on empêche le rechargement du MÊME kit
        // if (this.isLoaded) return; 
        
        const instruments = ['kick', 'snare', 'hihat', 'openhat', 'tom1', 'tom2', 'tom3', 'clap', 'cymbal', 'cowbell', 'rim'];
        
        // Flush old buffers
        instruments.forEach(inst => this.buffers[inst] = null);
        
        for (const inst of instruments) {
            try {
                // Modifié pour supporter le format .mp3 et les sous-dossiers par kit
                const response = await fetch(`/assets/drums/${this.currentKit}/${inst}.mp3`);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    this.buffers[inst] = await audioContext.decodeAudioData(arrayBuffer);
                }
            } catch (e) {
                console.warn(`Drum asset ${this.currentKit}/${inst}.mp3 not found yet.`, e);
            }
        }
        this.isLoaded = true;
    },

    async changeKit(audioContext, kitId) {
        this.currentKit = kitId;
        this.isLoaded = false;
        await this.loadAssets(audioContext);
    },

    playStep(audioContext, masterGainNode, time, stepIndex16th) {
        if (!this.isActive || !this.isLoaded) return;

        const pattern = this.patterns[this.currentPatternId];
        if (!pattern) return;

        // Wrap to the total steps (16)
        const step = stepIndex16th % pattern.steps;

        Object.keys(pattern.tracks).forEach(inst => {
            if (pattern.tracks[inst][step] === 1 && this.buffers[inst]) {
                const source = audioContext.createBufferSource();
                source.buffer = this.buffers[inst];
                
                const gainNode = audioContext.createGain();
                // Volume = Master * InstVol * Boost multiplier to hit sufficiently loud
                gainNode.gain.value = this.volumes.master * this.volumes[inst] * 1.5;
                
                source.connect(gainNode);
                gainNode.connect(masterGainNode);
                source.start(time);

                // Visual Feedback (VU Meter)
                const delay = (time - audioContext.currentTime) * 1000;
                setTimeout(() => {
                    flashVUMeter(inst);
                    flashVUMeter('master');
                }, Math.max(0, delay));
            }
        });
    }
};

// --- UI FUNCTIONS ---

function flashVUMeter(instId) {
    const bar = document.getElementById(`vu-${instId}`);
    if (bar) {
        bar.classList.remove('peak');
        void bar.offsetWidth; // Force reflow
        bar.classList.add('peak');
        setTimeout(() => bar.classList.remove('peak'), 150);
    }
}

function openDrumModal() {
    const modal = document.getElementById("modal-drum-machine");
    if (modal) {
        // Synchroniser l'icône de lecture avec l'état actuel du métronome
        const drumBtn = document.getElementById("btn-drum-play");
        if (window.metronome && window.metronome.isPlaying) {
             if (drumBtn) drumBtn.innerHTML = '<i class="ph ph-stop-circle ph-fill" style="color:#cf6679;"></i>';
        } else {
             if (drumBtn) drumBtn.innerHTML = '<i class="ph ph-play-circle ph-fill"></i>';
        }

        // Activer automatiquement la boîte à rythmes et couper le son du métronome classique
        if (window.metronome) {
            window.metronome.isMetronomeSoundActive = false;
        }
        window.DrumMachine.isActive = true;

        if (window.metronome && window.metronome.audioContext) {
            window.DrumMachine.loadAssets(window.metronome.audioContext);
        } else if (window.metronome) {
             // Force context creation if metronome hasn't fully started yet
             window.metronome.init();
             window.DrumMachine.loadAssets(window.metronome.audioContext);
        }
        modal.showModal();
    }
}

function closeDrumModal() {
    const modal = document.getElementById("modal-drum-machine");
    if (modal) {
        // Stopper le son complètement à la fermeture définitive
        if (window.metronome) {
            window.metronome.stop();
            window.metronome.isMetronomeSoundActive = true;
        }
        modal.close();
    }
}

function minimizeDrumModal() {
    const modal = document.getElementById("modal-drum-machine");
    if (modal) {
        // On ferme juste la modale, mais on laisse le son (DrumMachine.isActive est déjà true)
        modal.close();
    }
}

function changeDrumPattern(patternId) {
    if (window.DrumMachine.patterns[patternId]) {
        window.DrumMachine.currentPatternId = patternId;
    }
}

function changeDrumKit(kitId) {
    if (window.metronome && window.metronome.audioContext) {
        window.DrumMachine.changeKit(window.metronome.audioContext, kitId);
    } else {
        window.DrumMachine.currentKit = kitId; // Changera au prochain loadAssets
    }
}

function updateDrumVolume(track, val) {
    const percent = parseInt(val);
    window.DrumMachine.volumes[track] = percent / 100.0;
    
    const label = document.getElementById(`drum-vol-${track}-pct`);
    if (label) label.innerText = `${percent}%`;
}

// --- AUTO GENERATE SLIDERS ---
function renderDrumMixer() {
    const container = document.getElementById("drum-mixer-container");
    if (!container) return;
    
    // Check if translation function exists
    const translate = (typeof t === 'function') ? t : (k) => k;

    const uiInstruments = [
        { id: 'master', label: 'Master', default: 100 },
        { id: 'kick', label: 'Kick', default: 100 },
        { id: 'snare', label: 'Snare', default: 100 },
        { id: 'hihat', label: 'Hi-Hat', default: 100 },
        { id: 'openhat', label: 'O.Hat', default: 80 },
        { id: 'clap', label: 'Clap', default: 100 },
        { id: 'tom1', label: 'Hi Tom', default: 90 },
        { id: 'tom2', label: 'Mid Tom', default: 90 },
        { id: 'tom3', label: 'Low Tom', default: 90 },
        { id: 'cymbal', label: 'Crash', default: 70 },
        { id: 'cowbell', label: 'Cowbell', default: 80 },
        { id: 'rim', label: 'Rim', default: 80 }
    ];
    
    container.innerHTML = ""; // Clear existing
    const translate_func = (typeof t === 'function') ? t : (k) => k;
    
    uiInstruments.forEach(inst => {
        const translatedLabel = translate_func('web.lbl_' + inst.id);
        container.innerHTML += `
            <div class="drum-track" id="track-${inst.id}">
                <span class="slider-label" style="font-size: 0.65em; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: center; color: #aaa;">${translatedLabel}</span>
                <div style="display: flex; align-items: center; justify-content: center; gap: 4px; position: relative; width: 100%;">
                    <input type="range" id="drum-vol-${inst.id}" min="0" max="100" value="${inst.default}" orient="vertical" oninput="updateDrumVolume('${inst.id}', this.value)" style="height: 100px; width: 22px; -webkit-appearance: slider-vertical; appearance: slider-vertical; writing-mode: vertical-lr; direction: rtl; margin: 0; cursor: pointer;">
                    <div class="vu-meter-container">
                        <div id="vu-${inst.id}" class="vu-meter-bar"></div>
                    </div>
                </div>
                <span id="drum-vol-${inst.id}-pct" class="slider-percent" style="font-size: 0.65em; margin-top: 8px; font-family: monospace; color: var(--accent);">${inst.default}%</span>
            </div>
        `;
    });
}

// Call it once on load
document.addEventListener("DOMContentLoaded", renderDrumMixer);
