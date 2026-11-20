// Every sound in the game is synthesized with WebAudio: short oscillator and noise
// bleeps for punches, pickups, gunfire and menus, a two-tone siren that loops while
// the police are close, and a low engine hum pitched by the car's speed. Recorded
// effects live in game/audio/ and take over their synth counterparts whenever the
// file is present (see SE_FILES): gun, punch connects and knockouts, swings, the
// brake chirp and screech, the car door and the crash. Anything missing or not
// yet decoded falls back to the synth voice, so the game sounds whole offline,
// on any host, from the first frame.

/**
 * The recorded-effect manifest: logical pool -> files in game/audio/.
 * Pools with several files pick one at random per play, with a slight
 * pitch wobble, so repeated hits never sound stamped out. Provenance and
 * licences for every file: game/audio/SOURCES.md.
 */
const SE_FILES = {
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
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.sirenNodes = null;
    this.engineNodes = null;
    this.fileBuffers = {};
    this.filesStarted = false;
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
      this.seMaster = this.ctx.createGain();
      this.seMaster.gain.value = this.se;
      this.seMaster.connect(this.master);
      this.loadFiles();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * Fetch and decode the recorded effects in the background, ONE file at
   * a time: a burst of seventeen decodes the moment the game unlocks
   * would stall the first frames of play on a slow machine, and the
   * synth voices cover the gap by design. A file that is absent or
   * undecodable simply never lands in its pool — the manifest is an
   * upgrade, never a dependency.
   */
  loadFiles() {
    if (this.filesStarted || !this.ctx) return;
    this.filesStarted = true;
    const jobs = [];
    for (const [pool, files] of Object.entries(SE_FILES)) {
      this.fileBuffers[pool] = [];
      for (const url of files) jobs.push([pool, url]);
    }
    let i = 0;
    const step = () => {
      if (i >= jobs.length) return;
      const [pool, url] = jobs[i];
      i += 1;
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(url))))
        .then((buf) => this.ctx.decodeAudioData(buf))
        .then((decoded) => { this.fileBuffers[pool].push(decoded); })
        .catch(() => { /* synth fallback covers this file */ })
        .finally(() => setTimeout(step, 60));
    };
    step();
  }

  /**
   * Play one recorded effect from a pool through the SE bus. Returns false
   * when nothing in the pool is ready, so the caller runs its synth voice.
   */
  playFile(pool, volume = 0.9) {
    if (!this.ctx || this.muted || !this.seMaster) return false;
    const ready = this.fileBuffers[pool];
    if (!ready || ready.length === 0) return false;
    const buffer = ready[Math.floor(Math.random() * ready.length)];
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.seMaster);
    source.start();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    if (this.seMaster) this.seMaster.gain.value = muted ? 0 : this.se;
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
    gain.connect(this.seMaster);
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
    gain.connect(this.seMaster);
    source.start(t0);
  }

  /** Sound-effect bus volume 0..1 (volume slider; independent of the music). */
  setSeVolume(v) {
    this.se = Math.max(0, Math.min(1, v));
    if (this.seMaster) this.seMaster.gain.value = this.se;
  }

  uiBlip() {
    this.tone('square', 660, 880, 0.07, 0.12);
  }

  confirm() {
    this.tone('square', 520, 780, 0.09, 0.14);
    this.tone('square', 780, 1040, 0.1, 0.12, 0.07);
  }

  punch() {
    if (this.playFile('punch', 0.85)) return;
    this.noise(0.09, 0.3, 700);
    this.tone('sine', 160, 60, 0.09, 0.2);
  }

  /** A knockout-grade connect: the heavy recorded thud, or a deeper synth. */
  punchHeavy() {
    if (this.playFile('heavy', 0.95)) return;
    this.noise(0.14, 0.42, 500);
    this.tone('sine', 120, 45, 0.14, 0.3);
  }

  /**
   * The swing whoosh: fires at punch initiation for EVERY player punch
   * (round #22 — it used to play only on a miss, at landing). Gain
   * stays 0.5: as an every-punch sound it must sit under the connect
   * sounds (punch ~0.9, heavy 0.95), present but never competing.
   */
  swing() {
    if (this.playFile('swing', 0.5)) return;
    this.tone('triangle', 150, 90, 0.05, 0.1);
  }

  hurt() {
    this.tone('sawtooth', 220, 90, 0.14, 0.16);
  }

  shoot() {
    if (this.playFile('gun', 0.85)) return;
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
    if (this.playFile('door', 0.85)) return;
    this.noise(0.06, 0.2, 500);
    this.tone('sine', 120, 70, 0.08, 0.16, 0.03);
  }

  crash(strength = 1) {
    if (this.playFile('crash', Math.min(1, 0.35 + 0.65 * strength))) return;
    this.noise(0.18, 0.3 * strength, 900);
    this.tone('sine', 110, 40, 0.18, 0.22 * strength);
  }

  /**
   * The brake pedal's voice: the short recorded chirp for an ordinary
   * stop, the long screech only for a hard stop from high speed (the
   * callers in vehicles.js pick which, by the speed the stop began at).
   */
  brake(long) {
    if (this.playFile(long ? 'brakeLong' : 'brake', 0.8)) return;
    this.screech(long ? 1 : 0.55);
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
      gain.connect(this.seMaster);
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
      gain.connect(this.seMaster);
      osc.start();
      this.engineNodes = { osc, gain };
    }
    if (this.engineNodes) {
      const { osc, gain } = this.engineNodes;
      if (on) {
        osc.frequency.value = 50 + speedRatio * 130;
        // Level (round #23): the hum used to top out at 0.10 into the
        // 0.5 master — fine when it was the only sound in the game, but
        // once real BGM arrived (round #20, elements playing at up to
        // 0.7 direct) a 50-180 Hz lowpassed hum at 0.025-0.05 at the
        // destination was masked to inaudibility. The wiring was never
        // broken (nodes alive, frequency tracking speed); the voice is
        // now ~3x louder, still a low background note under the music,
        // still routed through seMaster so the SE slider and the mute
        // keep their authority over it.
        gain.gain.value = this.muted ? 0 : 0.16 + speedRatio * 0.14;
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
