/**
 * Jungle - A time-domain pitch shifter for Web Audio API.
 * Correct implementation with crossfading.
 */
class Jungle {
    constructor(context) {
        this.context = context;
        // Create nodes
        this.input = context.createGain();
        this.output = context.createGain();

        this.delay1 = context.createDelay(1.0);
        this.delay2 = context.createDelay(1.0);

        // Disconnect defaults
        // this.delay1.disconnect(); this.delay2.disconnect();

        this.mod1 = context.createBufferSource();
        this.mod2 = context.createBufferSource();
        this.mod3 = context.createBufferSource();
        this.mod4 = context.createBufferSource();

        this.mod1Gain = context.createGain();
        this.mod2Gain = context.createGain();
        this.mod3Gain = context.createGain();
        this.mod4Gain = context.createGain();

        this.fade1 = context.createGain();
        this.fade2 = context.createGain();

        this.bufferTime = 0.100;
        this.fadeTime = 0.050;

        this.init();
    }

    init() {
        this.createBuffers();
        this.route();
    }

    createBuffers() {
        const length = this.context.sampleRate * this.bufferTime;

        // Delay Modulation Buffer (Sawtooth)
        // Wraps from 0 to 1
        const delayBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
        const delayData = delayBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            delayData[i] = i / length;
        }

        // Gain Modulation Buffer (Windowing)
        // Triangle/Sine window to crossfade
        const fadeBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
        const fadeData = fadeBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            // Triangle window: 0 -> 1 -> 0
            // Actually, we need two windows offset by 50%
            // Phase 0: 0 -> 1 (at 50%) -> 0
            // Optimized typical window for Jungle is:
            // 0 -> 1 for first half, 1 -> 0 for second half?
            // Or sin(PI * x)?
            // Let's use 0.5 - 0.5 * cos(2 * PI * x) (Hann window)
            // But we need them to execute crossfade logic.

            // Standard Jungle window:
            let x = i / length;
            // First half: 0 to 0.5 => Fade IN (0 to 1)
            // Second half: 0.5 to 1.0 => Fade OUT (1 to 0)

            if (x < 0.5) fadeData[i] = x * 2;
            else fadeData[i] = (1 - x) * 2;
        }

        this.mod1.buffer = delayBuffer;
        this.mod2.buffer = delayBuffer;
        this.mod1.loop = true;
        this.mod2.loop = true;

        this.mod3.buffer = fadeBuffer;
        this.mod4.buffer = fadeBuffer;
        this.mod3.loop = true;
        this.mod4.loop = true;
    }

    route() {
        // Input -> Delays
        this.input.connect(this.delay1);
        this.input.connect(this.delay2);

        // Delay Modulation (Sawtooth) -> Delay Time
        // Mod1 -> Mod1Gain -> Delay1.delayTime
        this.mod1.connect(this.mod1Gain);
        this.mod2.connect(this.mod2Gain);
        this.mod1Gain.connect(this.delay1.delayTime);
        this.mod2Gain.connect(this.delay2.delayTime);

        // Fade Modulation (Triangle) -> Fade Gains
        // Mod3 -> Mod3Gain -> Fade1.gain
        this.mod3.connect(this.mod3Gain);
        this.mod4.connect(this.mod4Gain);
        this.mod3Gain.connect(this.fade1.gain);
        this.mod4Gain.connect(this.fade2.gain);

        // Delays -> Fades -> Output
        this.delay1.connect(this.fade1);
        this.delay2.connect(this.fade2);
        this.fade1.connect(this.output);
        this.fade2.connect(this.output);

        // Start times
        const t = this.context.currentTime;
        this.mod1.start(t);
        this.mod2.start(t + this.bufferTime / 2); // Phase offset 180 (0.5)
        this.mod3.start(t);
        this.mod4.start(t + this.bufferTime / 2); // Phase offset 180 (0.5)

        this.setPitch(0);
    }

    setPitch(semitones) {
        if (semitones === 0) {
            this.mod1Gain.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
            this.mod2Gain.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
            return;
        }

        // P = 2^(semitones/12)
        // delayTime change rate = (1 - P)
        // Gain = rate * bufferTime

        const P = Math.pow(2, semitones / 12);
        let delaySlope = (1 - P);

        this.mod1Gain.gain.setTargetAtTime(delaySlope * this.bufferTime, this.context.currentTime, 0.01);
        this.mod2Gain.gain.setTargetAtTime(delaySlope * this.bufferTime, this.context.currentTime, 0.01);

        // Ensure Fades are active (Gain = 1.0)
        this.mod3Gain.gain.value = 1.0;
        this.mod4Gain.gain.value = 1.0;
    }

    disconnect() {
        this.output.disconnect(); // Disconnect output
        this.input.disconnect();
        // Stop nodes to save CPU/Memory?
        try {
            this.mod1.stop(); this.mod2.stop(); this.mod3.stop(); this.mod4.stop();
        } catch (e) { }
    }
}
