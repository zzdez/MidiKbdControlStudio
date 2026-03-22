class MetronomeEngine {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        
        // Settings
        this.bpm = 120;
        this.beatsPerMeasure = 4;
        
        // Scheduling
        this.lookahead = 25; // ms
        this.scheduleAheadTime = 0.1; // seconds
        this.nextNoteTime = 0.0;
        this.currentBeatInMeasure = 0;
        this.timerWorker = null;
        
        // Sounds
        this.soundBuffers = {}; // { claves_high: AudioBuffer, ... }
        this.currentSoundSet = 'digital1'; // Default
        this.availableSoundSets = {}; // From API
        
        // Callbacks
        this.onBeat = null; // function(currentBeat, time)
        
        // Training Mode
        this.isTraining = false;
        this.trainTargetBPM = 160;
        this.trainIncrement = 2; // BPM
        this.trainMeasures = 4; // Increment after X measures
        this.measuresCounted = 0;
        this.onTrainProgress = null; // function(newBpm)
        this.volume = 1.0; // Volume global

        // Décompte (Count-In)
        this.isCountInActive = false;
        this.countInMeasures = 1;
        this.countInVisual = true;
        this.countInSound = true;
        this.isCountingIn = false;
        this.countInBeatsRemaining = 0;
        this.onCountInVisual = null; // function(number)
    }

    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.connect(this.audioContext.destination);
            this.masterGainNode.gain.value = this.volume;
            this.loadSoundSets(); // Load sounds once context is ready
        }
        
        // Create an inline Web Worker for precise timing regardless of main thread load
        if (!this.timerWorker) {
            const blob = new Blob([`
                let timerID = null;
                let interval = 100;
                self.onmessage = function(e) {
                    if (e.data == 'start') {
                        timerID = setInterval(() => self.postMessage('tick'), interval);
                    } else if (e.data == 'stop') {
                        clearInterval(timerID);
                        timerID = null;
                    } else if (e.data.interval) {
                        interval = e.data.interval;
                        if (timerID) {
                            clearInterval(timerID);
                            timerID = setInterval(() => self.postMessage('tick'), interval);
                        }
                    }
                };
            `], { type: 'application/javascript' });
            
            this.timerWorker = new Worker(URL.createObjectURL(blob));
            this.timerWorker.onmessage = (e) => {
                if (e.data === 'tick') {
                    this.scheduler();
                }
            };
            this.timerWorker.postMessage({ 'interval': this.lookahead });
        }
    }

    async loadSoundSets() {
        try {
            const response = await fetch('/api/metronome/sounds');
            this.availableSoundSets = await response.json();
            
            // Trigger UI update if callback exists (will be added in ui_metronome)
            if (this.onSoundsListLoaded) {
                 this.onSoundsListLoaded(this.availableSoundSets);
            }
            
            // Load default
            await this.loadSoundSet(this.currentSoundSet);
        } catch (e) {
            console.error("Failed to load metronome sounds list", e);
        }
    }

    async loadSoundSet(setName) {
        if (!this.availableSoundSets[setName]) return;
        
        this.currentSoundSet = setName;
        const types = this.availableSoundSets[setName];
        
        for (const type of types) {
            const key = `${setName}_${type}`;
            if (this.soundBuffers[key]) continue; // Already loaded
            
            try {
                const url = `/assets/metronome/${key}.mp3`;
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.soundBuffers[key] = audioBuffer;
            } catch (e) {
                console.error(`Failed to load sound sample ${key}`, e);
            }
        }
    }

    nextNote() {
        const secondsPerBeat = 60.0 / this.bpm;
        this.nextNoteTime += secondsPerBeat;
        
        this.currentBeatInMeasure++;
        if (this.currentBeatInMeasure === this.beatsPerMeasure) {
            this.currentBeatInMeasure = 0;
            
            // Training mode logic
            if (this.isTraining) {
                this.measuresCounted++;
                if (this.measuresCounted >= this.trainMeasures) {
                    this.measuresCounted = 0;
                    if (this.bpm < this.trainTargetBPM) {
                        this.bpm = Math.min(this.bpm + this.trainIncrement, this.trainTargetBPM);
                        if (this.onTrainProgress) this.onTrainProgress(this.bpm);
                        if (this.bpm >= this.trainTargetBPM) {
                            // Reached target
                            this.isTraining = false;
                        }
                    }
                }
            }
        }
    }

    scheduleNote(beatNumber, time) {
        // Trigger UI callback
        if (this.onBeat) {
            // We use setTimeout to decouple UI render from audio context timing slightly (UI is okay to lag by ~10ms, audio is not)
            const timeUntilNote = time - this.audioContext.currentTime;
            setTimeout(() => {
                this.onBeat(beatNumber);
            }, Math.max(0, timeUntilNote * 1000));
        }

        // --- PLAY SAMPLE ---
        const bufferKey = beatNumber === 0 ? `${this.currentSoundSet}_high` : `${this.currentSoundSet}_low`;
        const buffer = this.soundBuffers[bufferKey] || this.soundBuffers[`${this.currentSoundSet}_high` /* fallback */];

        if (buffer) {
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 1.0; 
            source.connect(gainNode);
            gainNode.connect(this.masterGainNode || this.audioContext.destination);
            source.start(time);
        } else {
            // FALLBACK TO SYNTHESIZE CLICK
            const osc = this.audioContext.createOscillator();
            const envelope = this.audioContext.createGain();

            osc.connect(envelope);
            envelope.connect(this.masterGainNode || this.audioContext.destination);

            if (beatNumber === 0) {
                osc.frequency.value = 1000.0;
            } else {
                osc.frequency.value = 800.0;
            }

            envelope.gain.value = 1;
            envelope.gain.exponentialRampToValueAtTime(1, time + 0.001);
            envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.05); 

            osc.start(time);
            osc.stop(time + 0.05);
        }
    }

    scheduleCountInNote(time) {
        // Décompte Visuel
        if (this.countInVisual && this.onCountInVisual) {
            const delayMs = Math.max(0, (time - this.audioContext.currentTime) * 1000);
            setTimeout(() => {
                if (this.onCountInVisual) {
                    this.onCountInVisual(this.countInBeatsRemaining + 1);
                }
            }, delayMs);
        }

        // Décompte Sonore
        if (this.countInSound) {
            const buffer = this.soundBuffers[`${this.currentSoundSet}_high`] || Object.values(this.soundBuffers)[0];
            if (buffer) {
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = 1.0; 
                source.connect(gainNode);
                gainNode.connect(this.masterGainNode || this.audioContext.destination);
                source.start(time);
            } else {
                const osc = this.audioContext.createOscillator();
                const envelope = this.audioContext.createGain();

                osc.connect(envelope);
                envelope.connect(this.masterGainNode || this.audioContext.destination);

                const beatOfMeasure = (this.beatsPerMeasure * this.countInMeasures - this.countInBeatsRemaining) % this.beatsPerMeasure;
                if (beatOfMeasure === 0) {
                    osc.frequency.value = 1000.0;
                } else {
                    osc.frequency.value = 800.0;
                }

                envelope.gain.value = 1;
                envelope.gain.exponentialRampToValueAtTime(1, time + 0.001);
                envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.05); 

                osc.start(time);
                osc.stop(time + 0.05);
            }
        }
    }

    scheduler() {
        while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
            if (this.isCountingIn) {
                this.scheduleCountInNote(this.nextNoteTime);
                this.countInBeatsRemaining--;
                if (this.countInBeatsRemaining <= 0) {
                    this.isCountingIn = false;
                    this.currentBeatInMeasure = -1; // Reset à -1 pour démarrer sur le 1er temps (0) après incrément
                }
                this.nextNote();
            } else {
                this.scheduleNote(this.currentBeatInMeasure, this.nextNoteTime);
                this.nextNote();
            }
        }
    }

    start() {
        if (this.isPlaying) return;
        this.init();
        
        // Important: browsers require AudioContext to resume after user interaction
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;
        this.measuresCounted = 0;
        this.nextNoteTime = this.audioContext.currentTime + 0.05;

        if (this.isCountInActive && this.countInMeasures > 0) {
            this.isCountingIn = true;
            this.countInBeatsRemaining = this.beatsPerMeasure * this.countInMeasures;
        } else {
            this.isCountingIn = false;
        }

        this.currentBeatInMeasure = 0; 
        this.timerWorker.postMessage('start');
    }

    stop() {
        this.isPlaying = false;
        if (this.timerWorker) {
            this.timerWorker.postMessage('stop');
        }
    }

    setBpm(newBpm) {
        this.bpm = newBpm;
    }
    
    setVolume(value) {
        this.volume = value;
        if (this.masterGainNode) {
            this.masterGainNode.gain.value = value;
        }
    }

    setSignature(beats) {
        this.beatsPerMeasure = beats;
        // ensure we don't break sequence logic immediately
        if (this.currentBeatInMeasure >= this.beatsPerMeasure) {
            this.currentBeatInMeasure = 0;
        }
    }

    toggle() {
        if (this.isPlaying) this.stop();
        else this.start();
        return this.isPlaying;
    }
    
    // Tap Tempo Calculation
    tap() {
        const now = performance.now();
        if (!this.lastTapTimes) this.lastTapTimes = [];
        
        // Reset if too long since last tap (e.g. 3 seconds)
        if (this.lastTapTimes.length > 0 && now - this.lastTapTimes[this.lastTapTimes.length-1] > 3000) {
            this.lastTapTimes = [];
        }
        
        this.lastTapTimes.push(now);
        if (this.lastTapTimes.length > 4) {
            this.lastTapTimes.shift(); // Keep only last 4 taps
        }
        
        if (this.lastTapTimes.length >= 2) {
            let sumIntervals = 0;
            for (let i = 1; i < this.lastTapTimes.length; i++) {
                sumIntervals += (this.lastTapTimes[i] - this.lastTapTimes[i-1]);
            }
            const avgInterval = sumIntervals / (this.lastTapTimes.length - 1);
            let newBpm = Math.round(60000 / avgInterval);
            
            // Limit bounds
            newBpm = Math.max(30, Math.min(newBpm, 300));
            this.setBpm(newBpm);
            return newBpm;
        }
        return null;
    }
}

// Global Instance
window.metronome = new MetronomeEngine();
