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
            const buffer = this.buffers[inst];
            
            if (stepValue > 0 && buffer && config && !config.mute) {
                console.log(`[DRUM] Triggering ${inst} at step ${step} (Value: ${stepValue}, Buffer: ${!!buffer})`);
                
                if (soloActive && !config.solo) return;

                let adjustedTime = time;
                if (step % 2 === 1 && this.swing > 0) {
                    const swingOffset = (60.0 / window.metronome.bpm) / 4.0 * (this.swing / 100.0) * 0.5;
                    adjustedTime += swingOffset;
                }

                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                
                source.playbackRate.value = Math.pow(2, (config.tune || 0) / 12);

                const gainNode = audioContext.createGain();
                const panner = audioContext.createStereoPanner();
                
                const velocity = (stepValue === 2) ? 1.5 : 1.0; 
                const masterVol = (this.settings.master ? this.settings.master.volume : 1.0);
                gainNode.gain.value = (config.volume || 1.0) * velocity * masterVol;
                
                const decayValue = (typeof config.decay === 'number' ? config.decay : 0.5);
                const decayTime = Math.max(0.01, decayValue);
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
        
        // Sync BPM
        const bpmInput = document.getElementById("drum-bpm");
        if (bpmInput && window.metronome) {
            bpmInput.value = window.metronome.bpm;
        }

        renderDrumSequencer();
        modal.showModal();
    }
}

function closeDrumModal() {
    const modal = document.getElementById("modal-drum-machine");
    if (modal) {
        // Désactiver la boîte à rythmes pour ne pas polluer le métronome classique
        window.DrumMachine.isActive = false;
        
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

function updateDrumBPM(val) {
    const bpm = parseInt(val);
    if (!isNaN(bpm) && bpm >= 40 && bpm <= 250) {
        if (window.metronome) {
            window.metronome.bpm = bpm;
            // Update main metronome UI if exists
            const mainBpm = document.getElementById('metronome-bpm');
            if (mainBpm) mainBpm.value = bpm;
            const mainBpmVal = document.getElementById('metronome-bpm-val');
            if (mainBpmVal) mainBpmVal.textContent = bpm;
        }
    }
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

    const pattern = window.DrumMachine.patterns[window.DrumMachine.currentPatternId];
    if (!pattern) return;

    // --- SONG MODE UI ---
    if (pattern.steps > 64) {
        const totalMeasures = Math.ceil(pattern.steps / 16);
        container.innerHTML = `
            <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 180px; width: 100%; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px dashed #444; text-align: center; padding: 20px; box-sizing: border-box;">
                <i class="ph ph-waveform" style="font-size: 3em; color: var(--accent); margin-bottom: 15px;"></i>
                <h3 style="margin: 0; color: #fff; font-size: 1.2em;">MIDI Song Mode</h3>
                <p style="color: #888; font-size: 0.9em; margin: 10px 0;">${pattern.steps} steps (${totalMeasures} measures) detected.</p>
                <p style="color: #aaa; font-size: 0.8em; font-style: italic;">Manual editing disabled for long sequences.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = "";
    
    const isMulti = window.DrumMachine.isMultiTrack;
    const instIds = isMulti 
        ? ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom1', 'tom2', 'tom3', 'cymbal', 'cowbell', 'rim']
        : [window.DrumMachine.selectedInstrument];

    // Layout adjustment
    if (isMulti) {
        container.style.gridTemplateColumns = "40px repeat(16, 1fr)";
        container.style.gap = "2px";
    } else {
        container.style.gridTemplateColumns = "repeat(16, 1fr)";
        container.style.gap = "4px";
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


function importMidiPattern() {
    const input = document.getElementById('midi-import-input');
    if (input) input.click();
}

let currentWizardB64 = null;

async function handleMidiFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const b64 = e.target.result.split(',')[1];
        currentWizardB64 = b64;
        openMidiWizard(b64);
    };
    reader.readAsDataURL(file);
    // Reset input for next time
    event.target.value = "";
}

async function openMidiWizard(b64) {
    console.log("[WIZARD] Opening Wizard...");
    try {
        const response = await fetch('/api/drums/analyze_midi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_b64: b64 })
        });
        
        const data = await response.json();
        console.log("[WIZARD] Analysis data received:", data);
        if (data.status !== 'ok') throw new Error(data.detail);
        
        // Fill tracks
        const tracksContainer = document.getElementById('midi-wizard-tracks');
        if (!tracksContainer) { console.error("[WIZARD] Critical: tracksContainer not found!"); return; }
        
        // Buttons for quick selection
        const btnContainer = document.createElement('div');
        btnContainer.style.display = "flex";
        btnContainer.style.gap = "10px";
        btnContainer.style.marginBottom = "10px";
        btnContainer.innerHTML = `
            <button onclick="document.querySelectorAll('.wizard-track-cb').forEach(cb => cb.checked = true)" class="btn-wizard-small">Tous</button>
            <button onclick="document.querySelectorAll('.wizard-track-cb').forEach(cb => cb.checked = cb.dataset.isdrum === 'true')" class="btn-wizard-small">Drums Uniquement</button>
            <button onclick="document.querySelectorAll('.wizard-track-cb').forEach(cb => cb.checked = false)" class="btn-wizard-small">Aucun</button>
        `;
        tracksContainer.innerHTML = "";
        tracksContainer.appendChild(btnContainer);

        data.tracks.forEach(t => {
            const label = document.createElement('label');
            label.className = 'modern-switch';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.fontSize = '0.85em';
            
            const isDrumChannel = t.channels.includes(10);
            
            label.innerHTML = `
                <input type="checkbox" class="wizard-track-cb" value="${t.index}" data-isdrum="${isDrumChannel}" ${isDrumChannel ? 'checked' : ''}>
                <span class="switch-slider"></span>
                <span style="margin-left:8px; line-height:1.2;">
                    <span style="font-weight:bold;">${t.name}</span><br>
                    <small style="color:#666;">Ch: ${t.channels.join(',')} | ${t.note_count} notes</small>
                </span>
            `;
            tracksContainer.appendChild(label);
        });
        
        // Fill mapping
        const mappingBody = document.getElementById('midi-wizard-mapping-body');
        if (!mappingBody) { console.error("[WIZARD] Critical: mappingBody not found!"); return; }
        mappingBody.innerHTML = "";
        
        const gmNames = {
            35: 'Kick', 36: 'Kick', 38: 'Snare', 40: 'Snare', 42: 'H-Hat (C)', 44: 'H-Hat (P)', 46: 'H-Hat (O)',
            49: 'Crash', 51: 'Ride', 37: 'Rim', 39: 'Clap', 56: 'Cowbell'
        };
        
        const allNotes = new Set();
        data.tracks.forEach(track => track.unique_notes.forEach(n => allNotes.add(n)));
        const sortedNotes = Array.from(allNotes).sort((a, b) => a - b);
        console.log("[WIZARD] Unique notes found:", sortedNotes);
        
        sortedNotes.forEach(note => {
            const tr = document.createElement('tr');
            const gmHint = gmNames[note] || `Note ${note}`;
            
            let bestInst = "ignore";
            if (note === 35 || note === 36) bestInst = "kick";
            else if (note === 38 || note === 40) bestInst = "snare";
            else if (note === 42 || note === 44) bestInst = "hihat";
            else if (note === 46) bestInst = "openhat";
            else if (note === 49 || note === 51 || note === 52 || note === 53 || note === 55 || note === 57) bestInst = "cymbal";
            else if (note === 41 || note === 43 || note === 45 || note === 47 || note === 48 || note === 50) bestInst = "tom1";
            else if (note === 39) bestInst = "clap";
            else if (note === 56) bestInst = "cowbell";
            else if (note === 37) bestInst = "rim";
            
            tr.innerHTML = `
                <td style="padding: 5px; border-bottom: 1px solid #333;">
                    <span style="color:var(--accent); font-weight:bold;">${note}</span> 
                    <small style="color:#666; margin-left:5px;">(${gmHint})</small>
                </td>
                <td style="padding: 5px; border-bottom: 1px solid #333;">
                    <select class="wizard-note-map" data-note="${note}" style="background:#222; color:#eee; border:1px solid #444; font-size:11px; padding:2px; width:100%;">
                        <option value="ignore">Ignorer</option>
                        <option value="kick" ${bestInst === 'kick' ? 'selected' : ''}>Kick</option>
                        <option value="snare" ${bestInst === 'snare' ? 'selected' : ''}>Snare</option>
                        <option value="hihat" ${bestInst === 'hihat' ? 'selected' : ''}>Hi-Hat (Closed)</option>
                        <option value="openhat" ${bestInst === 'openhat' ? 'selected' : ''}>Hi-Hat (Open)</option>
                        <option value="tom1" ${bestInst === 'tom1' ? 'selected' : ''}>Tom High</option>
                        <option value="tom2" ${bestInst === 'tom2' ? 'selected' : ''}>Tom Mid</option>
                        <option value="tom3" ${bestInst === 'tom3' ? 'selected' : ''}>Tom Low</option>
                        <option value="clap" ${bestInst === 'clap' ? 'selected' : ''}>Clap</option>
                        <option value="cymbal" ${bestInst === 'cymbal' ? 'selected' : ''}>Cymbal/Crash</option>
                        <option value="cowbell" ${bestInst === 'cowbell' ? 'selected' : ''}>Cowbell</option>
                        <option value="rim" ${bestInst === 'rim' ? 'selected' : ''}>Rimshot/Stick</option>
                    </select>
                </td>
            `;
            mappingBody.appendChild(tr);
        });
        
        console.log("[WIZARD] Mapping UI rendered. Showing modal.");
        const modal = document.getElementById('modal-midi-wizard');
        if (modal) {
            modal.showModal();
            modal.style.display = 'flex';
        }
        
    } catch (err) {
        console.error("[WIZARD] Analysis failed:", err);
        if (typeof showToast === 'function') showToast("Analysis failed: " + err.message, "error");
    }
}

async function confirmMidiImport() {
    console.log("[WIZARD] confirmMidiImport starting...");
    if (!currentWizardB64) { console.error("[WIZARD] Error: currentWizardB64 is null!"); return; }
    
    // 1. Tracks
    const selectedTracks = Array.from(document.querySelectorAll('.wizard-track-cb:checked')).map(cb => parseInt(cb.value));
    console.log("[WIZARD] Selected tracks:", selectedTracks);
    if (selectedTracks.length === 0) {
        if (typeof showToast === 'function') showToast("Veuillez sélectionner au moins une piste", "warning");
        return;
    }
    
    // 2. Mapping
    const mapping = {};
    document.querySelectorAll('.wizard-note-map').forEach(sel => {
        if (sel.value !== 'ignore') {
            mapping[sel.dataset.note] = sel.value;
        }
    });
    console.log("[WIZARD] Final Mapping:", mapping);

    try {
        console.log("[WIZARD] Sending parse request to backend...");
        const response = await fetch('/api/drums/parse_midi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_b64: currentWizardB64,
                selected_tracks: selectedTracks,
                mapping_override: mapping
            })
        });
        
        const data = await response.json();
        console.log("[WIZARD] Parse result from backend:", data);
        
        if (data.status === 'ok') {
            const patternName = 'imported_' + Date.now();
            window.DrumMachine.patterns[patternName] = data.pattern;
            console.log("[WIZARD] New pattern cached:", patternName);
            
            const select = document.getElementById('drum-pattern-select');
            if (select) {
                const opt = document.createElement('option');
                opt.value = patternName;
                opt.textContent = "MIDI Wiz (" + new Date().toLocaleTimeString() + ")";
                select.appendChild(opt);
                select.value = patternName;
                console.log("[WIZARD] Dropdown updated.");
            }
            
            console.log("[WIZARD] Switching pattern...");
            changeDrumPattern(patternName);
            
            console.log("[WIZARD] Closing modal...");
            const modal = document.getElementById('modal-midi-wizard');
            if (modal) {
                modal.close();
                modal.style.display = 'none';
            }
            
            if (typeof showToast === 'function') showToast("MIDI Song Imported!", "success");
        } else {
            console.error("[WIZARD] Backend returned error status:", data);
            if (typeof showToast === 'function') showToast("Import failed: " + (data.detail || "Unknown error"), "error");
        }
    } catch (err) {
        console.error("[WIZARD] MIDI Import CRITICAL ERROR:", err);
    }
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
