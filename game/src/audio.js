// audio.js — the sound-effects engine, with two voices for every effect.
//
// Voice one is recorded: ogg files under game/audio/, dealt from per-effect
// pools. Voice two is a small WebAudio synth (swept oscillators, shaped
// noise) that covers any pool whose files have not landed — or never do —
// so the game is never silent and never waits on audio. The siren and the
// engine hum are synth-only: they must track the game state every frame.
// File provenance and licences: game/audio/SOURCES.md.

// Pool name -> file names, relative to game/. Multi-file pools deal a
// random member per play, pitch-wobbled, so repeats never sound stamped.
const POOL_FILES = {
  gun: ['audio/se_gun.ogg'],
  swing: ['audio/se_swing1.ogg', 'audio/se_swing2.ogg', 'audio/se_swing3.ogg', 'audio/se_swing4.ogg'],
  punch: ['audio/se_punch1.ogg', 'audio/se_punch2.ogg', 'audio/se_punch3.ogg', 'audio/se_punch4.ogg'],
  heavy: ['audio/se_punch_heavy1.ogg', 'audio/se_punch_heavy2.ogg', 'audio/se_punch_heavy3.ogg', 'audio/se_punch_heavy4.ogg'],
  brake: ['audio/se_brake.ogg'],
  brakeLong: ['audio/se_brake_long.ogg'],
  door: ['audio/se_cardoor.ogg'],
  crash: ['audio/se_crash.ogg'],
};

export class SoundFX {
  constructor() {
    this.ctx = null;          // AudioContext, created on first unlock
    this.master = null;       // final gain before the destination
    this.muted = false;
    this.sirenNodes = null;   // { osc, lfo, gain } while the siren sounds
    this.engineNodes = null;  // { osc, gain } while the engine hums
    this.fileBuffers = {};    // pool name -> decoded buffers, as they land
    this.filesStarted = false;
  }

  /** Create the context and buses on first call; wake them afterwards. */
  unlock() {
    if (this.ctx === null) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.seMaster = this.ctx.createGain();
      this.seMaster.gain.value = this.se;
      this.seMaster.connect(this.master);
      this.loadFiles();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * Fetch and decode the recorded files strictly one at a time, 60 ms
   * apart: seventeen decodes in the unlock instant would hitch the first
   * frames on slow hardware. A failed file simply never joins its pool.
   */
  loadFiles() {
    if (this.filesStarted || !this.ctx) return;
    this.filesStarted = true;
    const queue = [];
    for (const [pool, urls] of Object.entries(POOL_FILES)) {
      this.fileBuffers[pool] = [];
      for (const url of urls) queue.push([pool, url]);
    }
    let next = 0;
    const pull = () => {
      if (next >= queue.length) return;
      const [pool, url] = queue[next];
      next += 1;
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(url))))
        .then((bytes) => this.ctx.decodeAudioData(bytes))
        .then((decoded) => { this.fileBuffers[pool].push(decoded); })
        .catch(() => { /* the synth voice covers this file */ })
        .finally(() => setTimeout(pull, 60));
    };
    pull();
  }

  /**
   * Play one recorded file from a pool through the SE bus. Returns false
   * when nothing in the pool has decoded yet, so callers fall back to
   * their synth patch.
   */
  playFile(pool, volume = 0.9) {
    if (!this.ctx || this.muted || !this.seMaster) return false;
    const ready = this.fileBuffers[pool];
    if (!ready || ready.length === 0) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = ready[(Math.random() * ready.length) | 0];
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const out = this.ctx.createGain();
    out.gain.value = volume;
    src.connect(out);
    out.connect(this.seMaster);
    src.start();
    return true;
  }

  /** True when the recorded voice spoke; the synth then stays silent. */
  recorded(pool, volume) {
    return this.playFile(pool, volume);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    if (this.seMaster) this.seMaster.gain.value = muted ? 0 : this.se;
  }

  /** SE bus level 0..1 from the volume slider; music runs separately. */
  setSeVolume(v) {
    this.se = Math.max(0, Math.min(1, v));
    if (this.seMaster) this.seMaster.gain.value = this.se;
  }

  /* -------------------------------------------------------- synth kit */

  /** One oscillator sweeping from `from` Hz to `to` Hz under a decay envelope. */
  tone(type, from, to, seconds, volume = 0.2, delay = 0) {
    if (!this.ctx || this.muted) return;
    const at = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(volume, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    osc.connect(env);
    env.connect(this.seMaster);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  /** A low-passed noise burst whose samples decay linearly to zero. */
  noise(seconds, volume = 0.25, cutoff = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const at = this.ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(volume, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.seMaster);
    src.start(at);
  }

  /** Noise burst with a tone underneath — the base recipe for impacts. */
  thud(noiseSeconds, noiseVolume, cutoff, type, from, to, toneSeconds, toneVolume) {
    this.noise(noiseSeconds, noiseVolume, cutoff);
    this.tone(type, from, to, toneSeconds, toneVolume);
  }

  /* --------------------------------------------------------- one-shots */

  uiBlip() {
    this.tone('square', 660, 880, 0.07, 0.12);
  }

  confirm() {
    this.tone('square', 520, 780, 0.09, 0.14);
    this.tone('square', 780, 1040, 0.1, 0.12, 0.07);
  }

  punch() {
    if (this.recorded('punch', 0.85)) return;
    this.thud(0.09, 0.3, 700, 'sine', 160, 60, 0.09, 0.2);
  }

  /** The knockout-grade connect: lower and heavier than a plain punch. */
  punchHeavy() {
    if (this.recorded('heavy', 0.95)) return;
    this.thud(0.14, 0.42, 500, 'sine', 120, 45, 0.14, 0.3);
  }

  /**
   * The swing whoosh, fired at the START of every player punch, hit or
   * miss. Kept at 0.5 so an every-punch sound sits under the connects.
   */
  swing() {
    if (this.recorded('swing', 0.5)) return;
    this.tone('triangle', 150, 90, 0.05, 0.1);
  }

  hurt() {
    this.tone('sawtooth', 220, 90, 0.14, 0.16);
  }

  shoot() {
    if (this.recorded('gun', 0.85)) return;
    this.thud(0.12, 0.32, 2600, 'square', 320, 70, 0.1, 0.14);
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
    if (this.recorded('door', 0.85)) return;
    this.noise(0.06, 0.2, 500);
    this.tone('sine', 120, 70, 0.08, 0.16, 0.03);
  }

  crash(strength = 1) {
    if (this.recorded('crash', Math.min(1, 0.35 + 0.65 * strength))) return;
    this.thud(0.18, 0.3 * strength, 900, 'sine', 110, 40, 0.18, 0.22 * strength);
  }

  /**
   * Braking sounds: vehicles.js chooses the short chirp for an ordinary
   * stop or the long screech for a hard stop from speed.
   */
  brake(long) {
    if (this.recorded(long ? 'brakeLong' : 'brake', 0.8)) return;
    this.screech(long ? 1 : 0.55);
  }

  /** Handbrake-slide screech: bright noise over a falling whine. */
  screech(strength = 1) {
    this.noise(0.24, 0.12 * strength, 3000);
    this.tone('sawtooth', 1150, 640, 0.22, 0.05 * strength);
  }

  alarm() {
    this.tone('square', 440, 440, 0.12, 0.16);
    this.tone('square', 440, 440, 0.12, 0.16, 0.18);
  }

  /* -------------------------------------------------------------- loops */

  /** Police siren: a triangle carrier whose pitch a square LFO rocks. */
  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenNodes) {
      const carrier = this.ctx.createOscillator();
      carrier.type = 'triangle';
      carrier.frequency.value = 780;
      const rocker = this.ctx.createOscillator();
      rocker.type = 'square';
      rocker.frequency.value = 1.6;
      const depth = this.ctx.createGain();
      depth.gain.value = 160;
      rocker.connect(depth);
      depth.connect(carrier.frequency);
      const out = this.ctx.createGain();
      out.gain.value = this.muted ? 0 : 0.045;
      carrier.connect(out);
      out.connect(this.seMaster);
      carrier.start();
      rocker.start();
      this.sirenNodes = { osc: carrier, lfo: rocker, gain: out };
    } else if (!on && this.sirenNodes) {
      const nodes = this.sirenNodes;
      this.sirenNodes = null;
      try {
        nodes.osc.stop();
        nodes.lfo.stop();
      } catch {
        /* already stopped */
      }
    }
    if (on && this.sirenNodes) this.sirenNodes.gain.gain.value = this.muted ? 0 : 0.045;
  }

  /**
   * Engine hum, pitched by speedRatio (0..1). Level 0.16 + ratio × 0.14
   * into the SE bus, set by measurement: at the old 0.10 ceiling the BGM
   * masked the hum completely even with the wiring sound. Routing stays
   * through seMaster, so the SE slider and the mute keep authority.
   */
  setEngine(on, speedRatio = 0) {
    if (!this.ctx) return;
    if (on && !this.engineNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const muffle = this.ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 320;
      const out = this.ctx.createGain();
      out.gain.value = 0.0;
      osc.connect(muffle);
      muffle.connect(out);
      out.connect(this.seMaster);
      osc.start();
      this.engineNodes = { osc, gain: out };
    }
    if (this.engineNodes) {
      const { osc, gain } = this.engineNodes;
      if (on) {
        osc.frequency.value = 50 + speedRatio * 130;
        gain.gain.value = this.muted ? 0 : 0.16 + speedRatio * 0.14;
      } else {
        gain.gain.value = 0;
      }
    }
    if (!on && this.engineNodes) {
      const nodes = this.engineNodes;
      this.engineNodes = null;
      try {
        nodes.osc.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}
