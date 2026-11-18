// Every sound in the game is synthesized with WebAudio: short oscillator and noise
// bleeps for punches, pickups, gunfire and menus, a two-tone siren that loops while
// the police are close, and a low engine hum pitched by the car's speed. There are
// no audio files. The context is created lazily on the first user gesture.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.sirenNodes = null;
    this.engineNodes = null;
  }

  /** Create (or resume) the context. Call from a key or mouse handler. */
  unlock() {
    if (this.ctx === null) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /** One oscillator blip: type, start/end frequency, length, volume, delay. */
  tone(type, from, to, seconds, volume = 0.2, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + seconds);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  /** A filtered noise burst, for punches, crashes and gunfire. */
  noise(seconds, volume = 0.25, cutoff = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(t0);
  }

  uiBlip() {
    this.tone('square', 660, 880, 0.07, 0.12);
  }

  confirm() {
    this.tone('square', 520, 780, 0.09, 0.14);
    this.tone('square', 780, 1040, 0.1, 0.12, 0.07);
  }

  punch() {
    this.noise(0.09, 0.3, 700);
    this.tone('sine', 160, 60, 0.09, 0.2);
  }

  hurt() {
    this.tone('sawtooth', 220, 90, 0.14, 0.16);
  }

  shoot() {
    this.noise(0.12, 0.32, 2600);
    this.tone('square', 320, 70, 0.1, 0.14);
  }

  pickup() {
    this.tone('square', 880, 1320, 0.07, 0.14);
    this.tone('square', 1320, 1760, 0.09, 0.12, 0.06);
  }

  cash() {
    this.tone('square', 1040, 1040, 0.06, 0.13);
    this.tone('square', 1310, 1310, 0.06, 0.13, 0.06);
    this.tone('square', 1560, 1560, 0.12, 0.13, 0.12);
  }

  carDoor() {
    this.noise(0.06, 0.2, 500);
    this.tone('sine', 120, 70, 0.08, 0.16, 0.03);
  }

  crash(strength = 1) {
    this.noise(0.18, 0.3 * strength, 900);
    this.tone('sine', 110, 40, 0.18, 0.22 * strength);
  }

  /** Tyre screech for a handbrake slide: bright noise with a falling whine. */
  screech(strength = 1) {
    this.noise(0.24, 0.12 * strength, 3000);
    this.tone('sawtooth', 1150, 640, 0.22, 0.05 * strength);
  }

  alarm() {
    this.tone('square', 440, 440, 0.12, 0.16);
    this.tone('square', 440, 440, 0.12, 0.16, 0.18);
  }

  /** Start or stop the looping two-tone siren (an oscillator whose frequency wobbles). */
  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenNodes) {
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 780;
      lfo.type = 'square';
      lfo.frequency.value = 1.6;
      lfoGain.gain.value = 160;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      gain.gain.value = this.muted ? 0 : 0.045;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      lfo.start();
      this.sirenNodes = { osc, lfo, gain };
    } else if (!on && this.sirenNodes) {
      const { osc, lfo } = this.sirenNodes;
      try {
        osc.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
      this.sirenNodes = null;
    }
    if (on && this.sirenNodes) this.sirenNodes.gain.gain.value = this.muted ? 0 : 0.045;
  }

  /** Start, pitch or stop the engine hum: speedRatio is 0..1 of the car's top speed. */
  setEngine(on, speedRatio = 0) {
    if (!this.ctx) return;
    if (on && !this.engineNodes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      gain.gain.value = 0.0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.engineNodes = { osc, gain };
    }
    if (this.engineNodes) {
      const { osc, gain } = this.engineNodes;
      if (on) {
        osc.frequency.value = 50 + speedRatio * 130;
        gain.gain.value = this.muted ? 0 : 0.05 + speedRatio * 0.05;
      } else {
        gain.gain.value = 0;
      }
    }
    if (!on && this.engineNodes) {
      const { osc } = this.engineNodes;
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      this.engineNodes = null;
    }
  }
}
