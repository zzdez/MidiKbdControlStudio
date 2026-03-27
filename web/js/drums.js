// DRUM MACHINE ENGINE
// Moteur de boîte à rythmes basé sur des matrices en 16 pas (Doubles croches)

window.DrumMachine = {
    isActive: false,
    isLoaded: false,
    currentPatternId: 'rock_1',
    swing: 0, // 0-100%
    selectedInstrument: 'kick',
    
    currentPatternId: 'rock_1',
    selectedInstrument: 'kick',
    isRecording: false,
    isMultiTrack: false, // Nouveau mode de vue
    lastStepPlayed: 0,
    
    // Paramètres avancés par instrument
    settings: {
        master:  { volume: 1.0, mute: false, solo: false },
        kick:    { volume: 1.0, tune: 0, decay: 0.5, pan: 0, mute: false, solo: false },
        snare:   { volume: 1.0, tune: 0, decay: 0.5, pan: 0, mute: false, solo: false },
        hihat:   { volume: 0.8, tune: 0, decay: 0.2, pan: 0.2, mute: false, solo: false },
        openhat: { volume: 0.7, tune: 0, decay: 0.6, pan: 0.2, mute: false, solo: false },
        clap:    { volume: 0.9, tune: 0, decay: 0.4, pan: -0.2, mute: false, solo: false },
        tom1:    { volume: 0.9, tune: 0, decay: 0.6, pan: -0.3, mute: false, solo: false },
        tom2:    { volume: 0.9, tune: -2, decay: 0.7, pan: 0, mute: false, solo: false },
        tom3:    { volume: 0.9, tune: -4, decay: 0.8, pan: 0.3, mute: false, solo: false },
        cymbal:  { volume: 0.6, tune: 0, decay: 1.5, pan: -0.4, mute: false, solo: false },
        cowbell: { volume: 0.7, tune: 0, decay: 0.3, pan: 0.1, mute: false, solo: false },
        rim:     { volume: 0.8, tune: 0, decay: 0.1, pan: -0.1, mute: false, solo: false }
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
            lastStep: 16,
            tracks: {
                kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                hihat: [1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0],
                rim:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
            }
        },
        custom: {
            lastStep: 16,
            tracks: {}
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

        const step = stepIndex16th % (pattern.lastStep || 16);
        this.lastStepPlayed = step;
        
        // Détection du Solo (si un instrument est en solo, on ne joue que lui)
        const soloActive = Object.values(this.settings).some(s => s.solo);

        Object.keys(pattern.tracks).forEach(inst => {
            const stepValue = pattern.tracks[inst][step];
            const config = this.settings[inst];
            
            if (stepValue > 0 && this.buffers[inst] && config && !config.mute) {
                // Gestion Solo
                if (soloActive && !config.solo) return;

                // Application du Swing sur les doubles croches paires (1, 3...)
                let adjustedTime = time;
                if (step % 2 === 1 && this.swing > 0) {
                    const swingOffset = (60.0 / window.metronome.bpm) / 4.0 * (this.swing / 100.0) * 0.5;
                    adjustedTime += swingOffset;
                }

                const source = audioContext.createBufferSource();
                source.buffer = this.buffers[inst];
                
                // --- DSP: Tune (Pitch) ---
                source.playbackRate.value = Math.pow(2, config.tune / 12);

                const gainNode = audioContext.createGain();
                const panner = audioContext.createStereoPanner();
                
                // --- Gain Calculation (Instrument * Master * Accent) ---
                const velocity = (stepValue === 2) ? 1.5 : 1.0; 
                const masterVol = this.settings.master.volume;
                gainNode.gain.value = config.volume * velocity * masterVol;
                
                // --- DSP: Decay (Envelope) ---
                // On crée un petit fondu pour éviter les clics et gérer la longueur
                const decayTime = Math.max(0.01, config.decay);
                gainNode.gain.setValueAtTime(gainNode.gain.value, adjustedTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, adjustedTime + decayTime);

                panner.pan.value = config.pan;

                source.connect(gainNode);
                gainNode.connect(panner);
                panner.connect(masterGainNode);
                
                source.start(adjustedTime);
                source.stop(adjustedTime + decayTime + 0.1);

                // Visual Feedback
                const delay = (adjustedTime - audioContext.currentTime) * 1000;
                setTimeout(() => {
                    flashVUMeter(inst);
                    flashVUMeter('master');
                    updateSequencerPlayhead(step);
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
        
        renderDrumSequencer();
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
        renderDrumSequencer();
    }
}

function changeDrumKit(kitId) {
    if (window.metronome && window.metronome.audioContext) {
        window.DrumMachine.changeKit(window.metronome.audioContext, kitId);
    } else {
        window.DrumMachine.currentKit = kitId;
    }
}

function updateDrumVolume(track, val) {
    const percent = parseInt(val);
    const config = window.DrumMachine.settings[track];
    if (config) config.volume = percent / 100.0;
    
    const label = document.getElementById(`drum-vol-${track}-pct`);
    if (label) label.innerText = `${percent}%`;
}

function updateDrumSwing(val) {
    window.DrumMachine.swing = parseInt(val);
    const label = document.getElementById("drum-swing-val");
    if (label) label.innerText = `${val}%`;
}

function toggleMute(instId) {
    const config = window.DrumMachine.settings[instId];
    if (config) {
        config.mute = !config.mute;
        renderDrumMixer();
    }
}

function toggleSolo(instId) {
    const config = window.DrumMachine.settings[instId];
    if (config) {
        config.solo = !config.solo;
        renderDrumMixer();
    }
}

function toggleSequencerView() {
    window.DrumMachine.isMultiTrack = !window.DrumMachine.isMultiTrack;
    const label = document.getElementById('sequencer-mode-label');
    if (label) label.innerText = window.DrumMachine.isMultiTrack ? 'ALL TRACKS' : 'SINGLE TRACK';
    renderDrumSequencer();
}

function selectInstrument(instId) {
    window.DrumMachine.selectedInstrument = instId;
    
    // UI Update Mixer
    document.querySelectorAll('.drum-track').forEach(t => t.classList.remove('selected'));
    const trackDiv = document.getElementById(`track-${instId}`);
    if (trackDiv) trackDiv.classList.add('selected');
    
    // UI Update Sequencer Header
    const label = document.getElementById('sequencer-inst-label');
    if (label) label.innerText = instId.toUpperCase();
    
    // Sync Param Sliders (Tune/Decay)
    const config = window.DrumMachine.settings[instId];
    if (config) {
        const tuneSlider = document.getElementById('seq-tune');
        const tuneVal = document.getElementById('seq-tune-val');
        if (tuneSlider) tuneSlider.value = config.tune;
        if (tuneVal) tuneVal.innerText = config.tune > 0 ? `+${config.tune}` : config.tune;
        
        const decaySlider = document.getElementById('seq-decay');
        const decayVal = document.getElementById('seq-decay-val');
        if (decaySlider) decaySlider.value = config.decay;
        if (decayVal) decayVal.innerText = `${config.decay}s`;
    }
    
    renderDrumSequencer();
}

function updateInstParam(param, val) {
    const instId = window.DrumMachine.selectedInstrument;
    const config = window.DrumMachine.settings[instId];
    if (!config) return;
    
    const numVal = parseFloat(val);
    config[param] = numVal;
    
    // UI Update
    const label = document.getElementById(`seq-${param}-val`);
    if (label) {
        if (param === 'tune') label.innerText = numVal > 0 ? `+${numVal}` : numVal;
        if (param === 'decay') label.innerText = `${numVal}s`;
    }
}

// --- SEQUENCER GRID ---

function renderDrumSequencer() {
    const container = document.getElementById("sequencer-grid");
    if (!container) return;
    
    container.innerHTML = "";
    const pattern = window.DrumMachine.patterns[window.DrumMachine.currentPatternId];
    if (!pattern) return;
    
    const isMulti = window.DrumMachine.isMultiTrack;
    const instIds = isMulti 
        ? ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom1', 'tom2', 'tom3', 'cymbal', 'cowbell', 'rim']
        : [window.DrumMachine.selectedInstrument];

    // Layout adjustment
    if (isMulti) {
        container.style.gridTemplateColumns = "40px repeat(16, 1fr)";
        container.style.gap = "4px";
    } else {
        container.style.gridTemplateColumns = "repeat(16, 1fr)";
        container.style.gap = "8px";
    }

    instIds.forEach(id => {
        if (isMulti) {
            const shortName = id.substring(0, 3).toUpperCase();
            const label = document.createElement('div');
            label.innerText = shortName;
            label.style.fontSize = '9px';
            label.style.color = (id === window.DrumMachine.selectedInstrument) ? 'var(--accent)' : '#666';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.fontWeight = 'bold';
            label.style.cursor = 'pointer';
            label.onclick = () => selectInstrument(id);
            container.appendChild(label);
        }

        if (!pattern.tracks[id]) pattern.tracks[id] = new Array(16).fill(0);

        for (let i = 0; i < 16; i++) {
            const stepVal = pattern.tracks[id][i];
            const stepDiv = document.createElement("div");
            stepDiv.className = "seq-step";
            stepDiv.dataset.inst = id;
            stepDiv.dataset.step = i;
            
            if (stepVal === 1) stepDiv.classList.add("active");
            if (stepVal === 2) stepDiv.classList.add("accent");
            
            if (window.metronome.isPlaying && window.DrumMachine.lastStepPlayed === i) {
                stepDiv.classList.add("current-playhead");
            }

            stepDiv.onclick = () => {
                pattern.tracks[id][i] = (pattern.tracks[id][i] + 1) % 3;
                if (pattern.tracks[id][i] > 0) playInstrumentTest(id);
                renderDrumSequencer();
            };
            container.appendChild(stepDiv);
        }
    });
}


function clearCurrentTrack() {
    const instId = window.DrumMachine.selectedInstrument;
    const pattern = window.DrumMachine.patterns[window.DrumMachine.currentPatternId];
    if (pattern.tracks[instId]) {
        pattern.tracks[instId].fill(0);
        renderDrumSequencer();
    }
}

function updateSequencerPlayhead(step) {
    document.querySelectorAll('.seq-step').forEach(s => {
        if (parseInt(s.dataset.step) === step) {
            s.classList.add('current-playhead');
        } else {
            s.classList.remove('current-playhead');
        }
    });
}

// --- INST-REC (Enregistrement Temps Réel) ---
window.DrumMachine.isRecording = false;

function toggleInstRec() {
    window.DrumMachine.isRecording = !window.DrumMachine.isRecording;
    const btn = document.getElementById("btn-seq-rec");
    const modeLabel = document.getElementById("sequencer-mode-label");
    
    if (btn) {
        btn.classList.toggle('active', window.DrumMachine.isRecording);
        btn.style.borderColor = window.DrumMachine.isRecording ? "#ff4444" : "#555";
    }
    if (modeLabel) {
        modeLabel.innerText = window.DrumMachine.isRecording ? "REALTIME REC" : "STEP EDIT";
        modeLabel.style.color = window.DrumMachine.isRecording ? "#ff4444" : "#888";
    }
}

function recordHit(instId) {
    if (!window.DrumMachine.isRecording || !window.metronome.isPlaying) return;
    
    // Calculer le pas le plus proche
    const now = window.metronome.audioContext.currentTime;
    const secondsPerBeat = 60.0 / window.metronome.bpm;
    const stepDuration = secondsPerBeat / 4.0;
    
    // On trouve à quel "step" global on se trouve depuis le début de la mesure
    let elapsed = now - (window.metronome.nextNoteTime);
    // Si on est juste APRES le temps, elapsed est positif. Si on est juste AVANT le prochain temps, nextNoteTime est loin.
    // Le métronome incrémente nextNoteTime EN AVANCE.
    
    // Plus simple : le métronome appelle playStep. On peut aussi stocker le dernier stepIndex16th joué.
    let step = (window.DrumMachine.lastStepPlayed + 1) % 16;
    // Approche simplifiée pour cette V1 : on enregistre sur le pas courant ou le suivant selon la latence
    
    const pattern = window.DrumMachine.patterns[window.DrumMachine.currentPatternId];
    if (!pattern.tracks[instId]) {
        pattern.tracks[instId] = new Array(16).fill(0);
    }
    pattern.tracks[instId][step] = 1;
    renderDrumSequencer();
}

function playInstrumentTest(instId) {
    if (!window.DrumMachine.isLoaded) return;
    const ctx = window.metronome.audioContext;
    const buffer = window.DrumMachine.buffers[instId];
    if (!buffer || !ctx) return;

    const config = window.DrumMachine.settings[instId];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, config.tune / 12);

    const gainNode = ctx.createGain();
    gainNode.gain.value = config.volume;
    
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);

    // Visual feedback
    flashVUMeter(instId);
    
    // Record if enabled
    if (window.DrumMachine.isRecording) {
        recordHit(instId);
    }
}

// Global hook for metronome sync
window.DrumMachine.lastStepPlayed = 0;

function handleTrackClick(instId) {
    selectInstrument(instId);
    playInstrumentTest(instId);
}

// --- AUTO GENERATE MIXER ---
function renderDrumMixer() {
    const container = document.getElementById("drum-mixer-container");
    if (!container) return;
    
    const translate_func = (typeof t === 'function') ? t : (k) => k;

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
    
    container.innerHTML = ""; 
    const soloActive = Object.values(window.DrumMachine.settings).some(s => s.solo);
    
    uiInstruments.forEach(inst => {
        const translatedLabel = translate_func('web.lbl_' + inst.id);
        const config = window.DrumMachine.settings[inst.id] || { volume: inst.default/100, mute: false, solo: false };
        const isSelected = window.DrumMachine.selectedInstrument === inst.id;

        // Si quelqu'un est en solo et que ce n'est pas nous, on grise visuellement (comme un mute forcé)
        const isDimmed = soloActive && !config.solo && inst.id !== 'master';

        container.innerHTML += `
            <div class="drum-track ${isSelected ? 'selected' : ''}" id="track-${inst.id}" onclick="handleTrackClick('${inst.id}')" style="opacity: ${isDimmed ? 0.4 : 1}">
                <span class="slider-label" style="font-size: 0.65em; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: center; color: #aaa;">${translatedLabel}</span>
                <div class="drum-slider-area" onclick="event.stopPropagation()">
                    <input type="range" id="drum-vol-${inst.id}" min="0" max="100" value="${Math.round(config.volume * 100)}" orient="vertical" oninput="updateDrumVolume('${inst.id}', this.value)" style="height: 100px; width: 22px; -webkit-appearance: slider-vertical; appearance: slider-vertical; writing-mode: vertical-lr; direction: rtl; margin: 0; cursor: pointer;">
                    <div class="vu-meter-container">
                        <div id="vu-${inst.id}" class="vu-meter-bar"></div>
                    </div>
                </div>
                <span id="drum-vol-${inst.id}-pct" class="slider-percent" style="font-size: 0.65em; margin-top: 8px; font-family: monospace; color: var(--accent);">${Math.round(config.volume * 100)}%</span>
                
                <div class="drum-track-controls" style="display: flex; gap: 4px; margin-top: 5px;">
                    <button id="btn-mute-${inst.id}" onclick="event.stopPropagation(); toggleMute('${inst.id}')" class="btn-mini-toggle ${config.mute ? 'active' : ''}">M</button>
                    <button id="btn-solo-${inst.id}" onclick="event.stopPropagation(); toggleSolo('${inst.id}')" class="btn-mini-toggle solo ${config.solo ? 'active' : ''}">S</button>
                </div>
            </div>
        `;
    });
}

document.addEventListener("DOMContentLoaded", renderDrumMixer);
