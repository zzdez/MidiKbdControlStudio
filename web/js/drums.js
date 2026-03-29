// DRUM MACHINE ENGINE
// Moteur de boîte à rythmes basé sur des matrices en 16 pas (Doubles croches)

// MIDI Wizard Session State
let currentWizardB64 = null;
let isEditingMidiMapping = false;

window.DrumMachine = {
    isActive: false,
    isLoaded: false,
    selectedInstrument: 'kick',
    isRecording: false,
    isMultiTrack: false, 
    lastStepPlayed: 0,
    currentPatternId: 'rock_1',
    swing: 0,
    settings: {
        master:  { volume: 1.0, mute: false, solo: false },
        kick:    { volume: 1.0, tune: 0, decay: 0.5, pan: 0.0, mute: false, solo: false },
        snare:   { volume: 1.0, tune: 0, decay: 0.5, pan: 0.0, mute: false, solo: false },
        hihat:   { volume: 0.8, tune: 0, decay: 0.2, pan: 0.2, mute: false, solo: false },
        openhat: { volume: 0.7, tune: 0, decay: 0.6, pan: 0.2, mute: false, solo: false },
        clap:    { volume: 0.9, tune: 0, decay: 0.4, pan: -0.2, mute: false, solo: false },
        tom1:    { volume: 0.9, tune: 0, decay: 0.6, pan: -0.3, mute: false, solo: false },
        tom2:    { volume: 0.9, tune: -2, decay: 0.7, pan: 0.0, mute: false, solo: false },
        tom3:    { volume: 0.9, tune: -4, decay: 0.8, pan: 0.3, mute: false, solo: false },
        cymbal:  { volume: 0.6, tune: 0, decay: 1.5, pan: -0.4, mute: false, solo: false },
        cowbell: { volume: 0.7, tune: 0, decay: 0.3, pan: 0.1, mute: false, solo: false },
        rim:     { volume: 0.8, tune: 0, decay: 0.1, pan: -0.1, mute: false, solo: false },
        bass:    { volume: 1.0, tune: 0, decay: 4.0, pan: 0.0, mute: false, solo: false }
    },

    buffers: {},
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
        const instruments = ['kick', 'snare', 'hihat', 'openhat', 'tom1', 'tom2', 'tom3', 'clap', 'cymbal', 'cowbell', 'rim'];
        
        // Flush old buffers
        instruments.forEach(inst => this.buffers[inst] = null);
        
        for (const inst of instruments) {
            try {
                const response = await fetch(`/assets/drums/${this.currentKit}/${inst}.mp3`);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    this.buffers[inst] = await audioContext.decodeAudioData(arrayBuffer);
                } else if (inst === 'hihat') {
                    // Fallback to openhat if closed hihat is missing
                    const fallbackResp = await fetch(`/assets/drums/${this.currentKit}/openhat.mp3`);
                    if (fallbackResp.ok) {
                        const arrayBuffer = await fallbackResp.arrayBuffer();
                        this.buffers[inst] = await audioContext.decodeAudioData(arrayBuffer);
                        console.log(`[DRUM] Fallback Hi-Hat (Open used for Closed) for ${this.currentKit}`);
                    }
                }
            } catch (e) {
                console.warn(`Drum asset ${this.currentKit}/${inst}.mp3 not found yet.`, e);
            }
        }

        this.isLoaded = true;

        this.isLoaded = true;
    },

    async changeKit(audioContext, kitId) {
        this.currentKit = kitId;
        this.isLoaded = false;
        await this.loadAssets(audioContext);
    },

    playStep(audioContext, masterGainNode, time, stepIndex16th) {
        if (!this.isActive || !this.isLoaded) return;

        // Global Mute check
        if (this.settings.master && this.settings.master.mute) return;

        const pattern = this.patterns[this.currentPatternId];
        if (!pattern) return;

        const step = stepIndex16th % (pattern.lastStep || 16);
        this.lastStepPlayed = step;
        
        // Détection du Solo (si un instrument est en solo, on ne joue que lui)
        const soloActive = Object.keys(this.settings).some(k => k !== 'master' && this.settings[k].solo);

        let anyTrackPlayed = false;
        let maxStepGain = 0;

        Object.keys(pattern.tracks).forEach(inst => {
            const stepValue = pattern.tracks[inst][step];
            const config = this.settings[inst];
            
            if (stepValue > 0 && config && !config.mute) {
                if (soloActive && !config.solo) return;

                anyTrackPlayed = true;

                // 1. Audio Nodes Setup
                const gainNode = audioContext.createGain();
                const panner = audioContext.createStereoPanner();
                const filter = audioContext.createBiquadFilter();
                
                let source = null;
                let velocity = 1.0;
                let finalPlaybackRate = Math.pow(2, (config.tune || 0) / 12);
                let adjustedTime = time;

                // --- Swing calculation ---
                if (step % 2 === 1 && this.swing > 0) {
                    const swingOffset = (60.0 / (window.metronome?.bpm || 120)) / 4.0 * (this.swing / 100.0) * 0.5;
                    adjustedTime += swingOffset;
                }
                if (adjustedTime < audioContext.currentTime) adjustedTime = audioContext.currentTime;

                // --- BRANCH A: BASS (SYNTH EXCLUSIVE) ---
                if (inst === 'bass') {
                    const targetNote = Math.floor(stepValue / 128);
                    const midiVelocity = stepValue % 128;
                    velocity = (midiVelocity / 127) * 1.05;
                    
                    const freq = 440 * Math.pow(2, (targetNote - 69) / 12);
                    
                    const oscSub = audioContext.createOscillator();
                    oscSub.type = 'sine';
                    oscSub.frequency.value = freq;
                    
                    const oscTri = audioContext.createOscillator();
                    oscTri.type = 'triangle';
                    oscTri.frequency.value = freq;
                    
                    const mixSub = audioContext.createGain();
                    const mixTri = audioContext.createGain();
                    mixSub.gain.value = 0.7;
                    mixTri.gain.value = 0.3;
                    
                    oscSub.connect(mixSub);
                    oscTri.connect(mixTri);
                    
                    filter.type = 'lowpass';
                    filter.frequency.value = 400 + (velocity * 3000);
                    filter.Q.value = 1.0;
                    
                    mixSub.connect(filter);
                    mixTri.connect(filter);
                    
                    oscSub.start(adjustedTime);
                    oscTri.start(adjustedTime);
                    
                    const decay = (config.decay || 1.5);
                    oscSub.stop(adjustedTime + decay);
                    oscTri.stop(adjustedTime + decay);
                    
                    source = { 
                        stop: (t) => { try { oscSub.stop(t); oscTri.stop(t); } catch(e){} },
                        disconnect: () => { oscSub.disconnect(); oscTri.disconnect(); }
                    };

                    const debugLog = document.getElementById('drum-debug-log');
                    if (debugLog) {
                        debugLog.innerText = `SYNTH: Note ${targetNote} (${freq.toFixed(1)}Hz)`;
                        debugLog.style.color = '#e040fb';
                    }

                    // Enveloppe
                    const settings = window.DrumMachine.settings;
                    const masterVol = settings.master ? settings.master.volume : 1.0;
                    gainNode.gain.setValueAtTime(0, adjustedTime);
                    gainNode.gain.linearRampToValueAtTime((config.volume !== undefined ? config.volume : 1.0) * velocity * masterVol, adjustedTime + 0.01);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, adjustedTime + decay);
                } 
                // --- BRANCH B: DRUMS (SAMPLES) ---
                else {
                    const buffer = this.buffers[inst];
                    if (!buffer) return;
                    
                    const bufSource = audioContext.createBufferSource();
                    bufSource.buffer = buffer;
                    bufSource.playbackRate.value = finalPlaybackRate;
                    
                    // Utiliser la vélocité MIDI (0..127) si disponible, sinon défaut
                    velocity = (stepValue > 2) ? (stepValue / 127) : (stepValue === 2 ? 1.5 : 1.0);
                    filter.type = 'allpass';
                    
                    bufSource.connect(filter);
                    bufSource.start(adjustedTime);
                    source = bufSource;

                    const debugLog = document.getElementById('drum-debug-log');
                    if (debugLog && step % 4 === 0) {
                        debugLog.innerText = `DRUM: ${inst.toUpperCase()}`;
                        debugLog.style.color = '#666';
                    }

                    // Enveloppe
                    const settings = window.DrumMachine.settings;
                    const masterVol = settings.master ? settings.master.volume : 1.0;
                    const decayTime = Math.max(0.01, config.decay || 0.5);
                    gainNode.gain.setValueAtTime((config.volume !== undefined ? config.volume : 1.0) * velocity * masterVol, adjustedTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, adjustedTime + decayTime);
                }

                // Final Routing
                const instGain = (config.volume !== undefined ? config.volume : 1.0) * velocity;
                maxStepGain = Math.max(maxStepGain, instGain);
                
                filter.connect(gainNode);
                gainNode.connect(panner);
                panner.pan.value = config.pan !== undefined ? config.pan : 0;
                
                // CONNECT TO MASTER GAIN NODE (Passed as argument)
                if (masterGainNode) {
                    panner.connect(masterGainNode);
                } else {
                    panner.connect(audioContext.destination);
                }

                // Visual Feedback (Per instrument VU)
                const delay = (adjustedTime - audioContext.currentTime) * 1000;
                setTimeout(() => {
                    flashVUMeter(inst, instGain);
                }, Math.max(0, delay));
            }
        });

        // GLOBAL Visual Feedback (Once per step)
        const delay = (time - audioContext.currentTime) * 1000;
        setTimeout(() => {
            if (anyTrackPlayed) {
                const masterVol = (this.settings.master ? this.settings.master.volume : 1.0);
                flashVUMeter('master', maxStepGain * masterVol);
            }
            updateSequencerPlayhead(step);
            if (this.updateSongTimeline) this.updateSongTimeline(stepIndex16th);
            
            const bpmDisp = document.getElementById('drum-bpm-display');
            if (bpmDisp) bpmDisp.innerText = Math.round(window.metronome?.bpm || 120);
        }, Math.max(0, delay));
    },

    drawSongMiniMap() {
        const canvas = document.getElementById('drum-mini-map');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const pattern = this.patterns[this.currentPatternId];
        if (!pattern) return;

        // Set internal resolution matching display
        canvas.width = canvas.clientWidth * window.devicePixelRatio;
        canvas.height = canvas.clientHeight * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const totalSteps = pattern.steps;
        
        ctx.clearRect(0, 0, w, h);

        // 1. Draw Measures (Grid)
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        for (let s = 0; s < totalSteps; s += 16) {
            const x = (s / totalSteps) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // 2. Draw Hits
        const tracks = Object.keys(pattern.tracks);
        const trackHeight = h / (tracks.length || 1);
        
        tracks.forEach((trackId, tIdx) => {
            const track = pattern.tracks[trackId];
            const y = (tIdx * trackHeight) + (trackHeight / 2);
            
            // Color based on instrument type
            let color = '#555';
            if (trackId === 'kick') color = '#ff5252';
            else if (trackId === 'snare') color = '#448aff';
            else if (trackId === 'hihat' || trackId === 'openhat') color = '#ffd740';
            else if (trackId === 'bass') color = '#e040fb';
            else if (trackId === 'cymbal' || trackId === 'clap') color = '#69f0ae';

            ctx.fillStyle = color;
            
            track.forEach((val, step) => {
                if (val > 0) {
                    const x = (step / totalSteps) * w;
                    // Accent vs Normal
                    const radius = (val === 2) ? 2.5 : 1.5;
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        });
    },

    updateSongTimeline(step) {
        const pattern = this.patterns[this.currentPatternId];
        if (!pattern || pattern.steps <= 64) return;

        const cursor = document.getElementById('drum-progress-cursor');
        const slider = document.getElementById('drum-song-slider');
        const stats = document.getElementById('drum-song-stats');
        const measureDisp = document.getElementById('drum-measure-display');

        if (cursor) {
            const percent = (step / pattern.steps) * 100;
            cursor.style.left = percent + '%';
        }

        if (slider) {
            slider.value = step;
        }

        if (stats) {
            stats.innerText = `Step ${step + 1} / ${pattern.steps}`;
        }

        if (measureDisp) {
            const currentMeasure = Math.floor(step / 16) + 1;
            const totalMeasures = Math.ceil(pattern.steps / 16);
            measureDisp.innerText = `MEASURE ${currentMeasure} / ${totalMeasures}`;
        }
    },

    seekFromTimeline(step) {
        if (!window.metronome) return;
        const stepNum = parseInt(step);
        
        // Synchronise le métronome sur le bon pas
        // currentTotalBeat est en noires, donc 1 beat = 4 steps (16th notes)
        window.metronome.currentTotalBeat = Math.floor(stepNum / 4);
        window.metronome.currentBeatInMeasure = window.metronome.currentTotalBeat % window.metronome.beatsPerMeasure;
        
        // On force la mise à jour visuelle immédiate
        this.updateSongTimeline(stepNum);
        
        console.log(`[DRUM] Seek to Step: ${stepNum} (Beat: ${window.metronome.currentTotalBeat})`);
    },


    drumControl(action) {
        if (!window.metronome) return;
        const m = window.metronome;
        
        switch(action) {
            case 'restart':
                m.currentTotalBeat = 0;
                m.currentBeatInMeasure = 0;
                m.nextNoteTime = m.audioContext.currentTime + 0.05;
                this.updateSongTimeline(0);
                console.log("[DRUM] Transport: Restart");
                break;
            case 'stop':
                m.stop();
                m.currentTotalBeat = 0;
                m.currentBeatInMeasure = 0;
                // Update UI icons via standard toggle logic
                if (typeof metronomeTogglePlay === 'function') {
                    const drumBtn = document.getElementById("btn-drum-play-main");
                    const metroBtn = document.getElementById("btn-metro-play");
                    if (drumBtn) drumBtn.innerHTML = '<i class="ph ph-play-circle ph-fill"></i>';
                    if (metroBtn) metroBtn.innerHTML = '<i class="ph ph-play-circle ph-fill"></i>';
                    if (typeof resetBeatVisualizer === 'function') resetBeatVisualizer();
                }
                this.updateSongTimeline(0);
                console.log("[DRUM] Transport: Stop");
                break;
            case 'seek_back':
                m.currentTotalBeat = Math.max(0, m.currentTotalBeat - m.beatsPerMeasure);
                this.updateSongTimeline(m.currentTotalBeat * 4);
                console.log("[DRUM] Transport: Seek Back (1 Bar)");
                break;
            case 'seek_next':
                m.currentTotalBeat += m.beatsPerMeasure;
                this.updateSongTimeline(m.currentTotalBeat * 4);
                console.log("[DRUM] Transport: Seek Next (1 Bar)");
                break;
            case 'tempo_up':
                m.setBpm(m.bpm + 1);
                this.updateBpmUI();
                break;
            case 'tempo_down':
                m.setBpm(Math.max(30, m.bpm - 1));
                this.updateBpmUI();
                break;
        }
    },

    updateBpmUI() {
        const bpmDisp = document.getElementById('drum-bpm-display');
        if (bpmDisp) bpmDisp.innerText = Math.round(window.metronome?.bpm || 120);
        // Sync main metronome inputs if they exist
        const mainInput = document.getElementById('metro-bpm-input');
        const mainSlider = document.getElementById('metro-bpm-slider');
        if (mainInput) mainInput.value = window.metronome.bpm;
        if (mainSlider) mainSlider.value = window.metronome.bpm;
    }
};

// --- UI FUNCTIONS ---

function flashVUMeter(instId, gain = 1.0) {
    const bar = document.getElementById(`vu-${instId}`);
    if (bar) {
        // Gain normalisé pour l'affichage (0..100%)
        const height = Math.min(100, gain * 100);
        bar.style.height = height + "%";
        
        // Couleur dynamique selon le niveau
        if (height > 90) bar.style.background = "#ff4081"; // Peak
        else if (height > 70) bar.style.background = "#ffb74d"; // High
        else bar.style.background = "var(--accent)"; // Normal

        // Retrait progressif
        if (bar._tm) clearTimeout(bar._tm);
        bar._tm = setTimeout(() => {
            bar.style.height = "0%";
        }, 150);
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
        
        // Show/Hide Edit button if it's an imported MIDI
        const editBtn = document.getElementById('btn-seq-edit-midi');
        if (editBtn) {
            editBtn.style.display = (patternId.startsWith('imported_') && currentWizardB64) ? 'inline-block' : 'none';
        }

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
            <div id="drum-song-visualizer" style="grid-column: 1 / -1; width: 100%; padding: 15px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid #333; box-sizing: border-box;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-waveform" style="color: var(--accent); font-size: 1.4em;"></i>
                        <span style="font-weight: bold; color: #fff; font-size: 0.9em;">MIDI Song Mode</span>
                        <span id="drum-song-stats" style="color: #666; font-size: 0.8em; margin-left: 5px;">Step 0 / ${pattern.steps}</span>
                    </div>
                    <span id="drum-measure-display" style="font-family: monospace; color: var(--accent); font-weight: bold; font-size: 1.1em; background: rgba(187,134,252,0.1); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(187,134,252,0.2);">MEASURE 1 / ${totalMeasures}</span>
                </div>
                
                <div style="position: relative; width: 100%; height: 100px; background: #111; border: 1px solid #222; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                    <canvas id="drum-mini-map" style="width: 100%; height: 100%; display: block;"></canvas>
                    <div id="drum-progress-cursor" style="position: absolute; top: 0; left: 0; width: 2px; height: 100%; background: var(--accent); box-shadow: 0 0 8px var(--accent); pointer-events: none; transition: left 0.1s linear;"></div>
                </div>

                <input type="range" id="drum-song-slider" min="0" max="${pattern.steps - 1}" value="0" 
                    style="width: 100%; height: 6px; -webkit-appearance: none; background: #333; border-radius: 3px; outline: none; cursor: pointer;"
                    oninput="window.DrumMachine.seekFromTimeline(this.value)">
                
                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                    <small style="color: #444; font-size: 9px;">START</small>
                    <small style="color: #444; font-size: 9px;">FINISH</small>
                </div>
            </div>
        `;
        
        // Render the map immediately
        setTimeout(() => window.DrumMachine.drawSongMiniMap(), 50);
        return;
    }

    container.innerHTML = "";
    
    const isMulti = window.DrumMachine.isMultiTrack;
    const instIds = isMulti 
        ? ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom1', 'tom2', 'tom3', 'cymbal', 'cowbell', 'rim', 'bass']
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
            
            if (stepVal > 0) stepDiv.classList.add("active");
            if (stepVal === 2 && id !== 'bass') stepDiv.classList.add("accent");
            
            // Affichage spécial pour la basse (Note MIDI décodée)
            if (id === 'bass' && stepVal > 0) {
                const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
                const noteNum = Math.floor(stepVal / 128);
                const octave = Math.floor(noteNum / 12) - 1;
                const name = noteNames[noteNum % 12];
                stepDiv.innerText = name + octave;
                stepDiv.style.fontSize = '8px';
                stepDiv.style.color = '#fff';
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

async function handleMidiFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const b64 = e.target.result.split(',')[1];
        currentWizardB64 = b64;
        isEditingMidiMapping = false; // Fresh upload
        openMidiWizard(b64);
    };
    reader.readAsDataURL(file);
    // Reset input for next time
    event.target.value = "";
}

function editCurrentMidiMapping() {
    if (!currentWizardB64) {
        if (typeof showToast === 'function') showToast("Aucun fichier MIDI n'est actuellement chargé", "warning");
        return;
    }
    isEditingMidiMapping = true;
    openMidiWizard(currentWizardB64);
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
        window._lastMidiAnalysis = data; // Cache for confirMidiImport
        
        // Fill tracks
        const tracksContainer = document.getElementById('midi-wizard-tracks');
        if (!tracksContainer) { console.error("[WIZARD] Critical: tracksContainer not found!"); return; }
        tracksContainer.style.maxHeight = "400px";
        tracksContainer.style.overflowY = "auto";
        tracksContainer.style.paddingRight = "5px";
        
        // Buttons for quick selection
        const btnContainer = document.createElement('div');
        btnContainer.style.display = "flex";
        btnContainer.style.gap = "10px";
        btnContainer.style.marginBottom = "10px";
        btnContainer.innerHTML = `
            <button onclick="document.querySelectorAll('.wizard-track-cb').forEach(cb => cb.checked = true)" class="btn-wizard-small">Tous</button>
            <button onclick="document.querySelectorAll('.wizard-track-cb').forEach(cb => cb.checked = cb.dataset.isdrum === 'true')" class="btn-wizard-small">Drums</button>
            <button onclick="document.querySelectorAll('.wizard-track-cb').forEach(cb => cb.checked = false); document.querySelectorAll('.wizard-track-inst').forEach(s => s.value = 'none')" class="btn-wizard-small">Reset</button>
        `;
        tracksContainer.innerHTML = "";
        tracksContainer.appendChild(btnContainer);

        data.tracks.forEach(t => {
            const isDrumChannel = t.channels.includes(10);
            const lowerName = t.name.toLowerCase();
            const isBassTrack = lowerName.includes('bass') || lowerName.includes('basse') || (t.avg_note > 0 && t.avg_note < 55 && !isDrumChannel);

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.marginBottom = '2px';
            row.style.background = isBassTrack ? '#2a1a2a' : '#222'; 
            row.style.padding = '3px 8px';
            row.style.borderRadius = '4px';
            row.style.border = isBassTrack ? '1px solid #6a1a6a' : '1px solid #333';
            
            row.innerHTML = `
                <div style="display:flex; align-items:center; flex:1; min-width:0;">
                    <label class="modern-switch" style="margin-bottom:0; transform: scale(0.8); transform-origin: left center;">
                        <input type="checkbox" class="wizard-track-cb" value="${t.index}" data-isdrum="${isDrumChannel}" ${(isDrumChannel || isBassTrack) ? 'checked' : ''}>
                        <span class="switch-slider"></span>
                    </label>
                    <div style="margin-left:5px; line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        <span style="font-weight:bold; font-size:11px;">${t.name}</span><br>
                        <small style="color:#666; font-size:9px;">Ch: ${t.channels.join(',')} | ${t.note_count} n.</small>
                    </div>
                </div>
                <select class="wizard-track-inst" data-track-index="${t.index}" style="background:#111; color:#aaa; border:1px solid #444; font-size:10px; padding:1px; width:75px; height:18px; border-radius:3px;">
                    <option value="none">Auto</option>
                    <option value="kick">Kick</option>
                    <option value="snare">Snare</option>
                    <option value="hihat">Hi-Hat</option>
                    <option value="bass" ${isBassTrack ? 'selected' : ''}>Bass</option>
                </select>
            `;
            tracksContainer.appendChild(row);
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
        data.tracks.forEach(track => {
            const lowerName = track.name.toLowerCase();
            const isBassTrack = lowerName.includes('bass') || lowerName.includes('basse');
            // Si c'est une piste de basse, on ne pollue pas le mapping des percussions à droite
            if (!isBassTrack) {
                track.unique_notes.forEach(n => allNotes.add(n));
            }
        });
        const sortedNotes = Array.from(allNotes).sort((a, b) => a - b);
        console.log("[WIZARD] Unique drum notes found:", sortedNotes);
        
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
            
            const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            const octave = Math.floor(note / 12) - 1;
            const musicalName = noteNames[note % 12] + octave;
            
            tr.innerHTML = `
                <td style="padding: 3px 5px; border-bottom: 1px solid #333;">
                    <span style="color:var(--accent); font-weight:bold; font-size:11px;">${musicalName}</span> 
                    <small style="color:#666; margin-left:3px; font-size:9px;">(${note})</small>
                    <small style="color:#444; margin-left:3px; font-size:9px;">${gmHint}</small>
                </td>
                <td style="padding: 3px 5px; border-bottom: 1px solid #333;">
                    <select class="wizard-note-map" data-note="${note}" style="background:#111; color:#aaa; border:1px solid #444; font-size:10px; padding:1px; width:100%; height:18px; border-radius:3px;">
                        <option value="ignore">ignore</option>
                        <option value="kick" ${bestInst === 'kick' ? 'selected' : ''}>kick</option>
                        <option value="snare" ${bestInst === 'snare' ? 'selected' : ''}>snare</option>
                        <option value="hihat" ${bestInst === 'hihat' ? 'selected' : ''}>hi-hat C</option>
                        <option value="openhat" ${bestInst === 'openhat' ? 'selected' : ''}>hi-hat O</option>
                        <option value="tom1" ${bestInst === 'tom1' ? 'selected' : ''}>tom H</option>
                        <option value="tom2" ${bestInst === 'tom2' ? 'selected' : ''}>tom M</option>
                        <option value="tom3" ${bestInst === 'tom3' ? 'selected' : ''}>tom L</option>
                        <option value="clap" ${bestInst === 'clap' ? 'selected' : ''}>clap</option>
                        <option value="cymbal" ${bestInst === 'cymbal' ? 'selected' : ''}>cymbal</option>
                        <option value="cowbell" ${bestInst === 'cowbell' ? 'selected' : ''}>cowbell</option>
                        <option value="rim" ${bestInst === 'rim' ? 'selected' : ''}>rim</option>
                        <option value="bass">bass</option>
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
    
    // Note-level mapping (base)
    document.querySelectorAll('.wizard-note-map').forEach(sel => {
        if (sel.value !== 'ignore') {
            mapping[sel.dataset.note] = sel.value;
        }
    });

    // Track-level assignments
    const track_instruments = {};
    document.querySelectorAll('.wizard-track-inst').forEach(sel => {
        if (sel.value !== 'none') {
            track_instruments[sel.dataset.trackIndex] = sel.value;
        }
    });

    console.log("[WIZARD] Selected tracks:", selectedTracks);
    console.log("[WIZARD] Track assignments:", track_instruments);
    console.log("[WIZARD] Note mapping overrides:", mapping);

    const transpose = parseInt(document.getElementById('midi-wizard-transpose')?.value || 0);
    console.log("[WIZARD] Sending transpose value:", transpose);

    try {
        console.log("[WIZARD] Sending parse request to backend...");
        const response = await fetch('/api/drums/parse_midi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file_b64: currentWizardB64,
                selected_tracks: selectedTracks,
                track_instruments: track_instruments,
                mapping_override: mapping,
                transpose: transpose
            })
        });
        
        const data = await response.json();
        console.log("[WIZARD] Parse result from backend:", data);
        
        if (data.status === 'ok') {
            const patternName = isEditingMidiMapping ? window.DrumMachine.currentPatternId : ('imported_' + Date.now());
            window.DrumMachine.patterns[patternName] = data.pattern;
            console.log("[WIZARD] Pattern updated/cached:", patternName);
            
            // Show edit button
            const editBtn = document.getElementById('btn-seq-edit-midi');
            if (editBtn) editBtn.style.display = 'inline-block';
            
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
    const masterVol = window.DrumMachine.settings.master ? window.DrumMachine.settings.master.volume : 1.0;
    const instGain = (config.volume !== undefined ? config.volume : 1.0);
    gainNode.gain.value = instGain * masterVol;
    
    source.connect(gainNode);
    
    // Connect to master gain node if available
    if (window.metronome.masterGainNode) {
        gainNode.connect(window.metronome.masterGainNode);
    } else {
        gainNode.connect(ctx.destination);
    }
    
    source.start(0);

    // Visual feedback
    flashVUMeter(instId, instGain);
    
    // Master VU feedback
    flashVUMeter('master', instGain * masterVol);
    
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
        { id: 'rim', label: 'Rim', default: 80 },
        { id: 'bass', label: 'Bass', default: 100 }
    ];
    
    container.innerHTML = ""; 
    const soloActive = Object.keys(window.DrumMachine.settings).some(k => k !== 'master' && window.DrumMachine.settings[k].solo);
    
    uiInstruments.forEach(inst => {
        const translatedLabel = translate_func('web.lbl_' + inst.id);
        const config = window.DrumMachine.settings[inst.id] || { volume: inst.default/100, mute: false, solo: false };
        const isSelected = window.DrumMachine.selectedInstrument === inst.id;

        // Si quelqu'un est en solo et que ce n'est pas nous, on grise visuellement (comme un mute forcé)
        // OU si NOUS sommes mutés
        const isMuted = config.mute === true;
        const isDimmed = (soloActive && !config.solo && inst.id !== 'master') || isMuted;

        container.innerHTML += `
            <div class="drum-track ${isSelected ? 'selected' : ''} ${isMuted ? 'muted' : ''}" id="track-${inst.id}" onclick="handleTrackClick('${inst.id}')" style="opacity: ${isDimmed ? 0.3 : 1}">
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
                    ${inst.id !== 'master' ? `<button id="btn-solo-${inst.id}" onclick="event.stopPropagation(); toggleSolo('${inst.id}')" class="btn-mini-toggle solo ${config.solo ? 'active' : ''}">S</button>` : ''}
                </div>
            </div>
        `;
    });
}

document.addEventListener("DOMContentLoaded", renderDrumMixer);
