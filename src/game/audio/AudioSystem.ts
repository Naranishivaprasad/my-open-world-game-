import { VEHICLE_AUDIO } from '../config/vehicle';
import { sim } from '../core/sim';

/**
 * Vehicle audio, synthesised with the Web Audio API (spec 28).
 *
 * WHY SYNTHESISED, NOT SAMPLED: no engine recording was found that is both
 * freely licensed for redistribution inside a packaged game AND downloadable
 * without an account (see ASSETS.md). Rather than ship an unlicensed sample or
 * claim audio that does not exist, the engine note is generated here. It is
 * driven by the vehicle's real rpm01 and speed, so it responds to actual
 * simulation state rather than being a loop played on top.
 *
 * Browsers refuse to start audio without a user gesture, and suspend it when
 * the tab is hidden; both are handled (spec 28, 35).
 */

interface EngineVoice {
  osc: OscillatorNode;
  gain: GainNode;
  ratio: number;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  private engineVoices: EngineVoice[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private tyreNoise: AudioBufferSourceNode | null = null;
  private tyreGain: GainNode | null = null;

  private hornOsc: OscillatorNode[] = [];
  private hornGain: GainNode | null = null;

  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;

  private started = false;
  private disposed = false;

  /** Volume settings, 0..1. */
  private volumes = { master: 0.8, sfx: 0.9 };

  /**
   * Audio parameters are updated at a fixed low rate, not every render frame.
   *
   * Each setTargetAtTime() call schedules an event on the AudioParam timeline
   * and has to be marshalled to the audio thread. Ten of them per frame at
   * 60 fps measurably cost main-thread time; throttling to ~20 Hz and skipping
   * unchanged values is inaudible and much cheaper.
   */
  private accum = 0;
  private lastTargets = { hz: -1, cutoff: -1, engine: -1, tyre: -1, horn: -1, siren: -1 };
  /** Siren wail phase, advanced in the update rather than by an LFO node. */
  private sirenPhase = 0;

  get isRunning() {
    return this.started && this.ctx?.state === 'running';
  }

  /**
   * Must be called from a user gesture (spec 28). Safe to call repeatedly.
   */
  async start() {
    if (this.disposed) return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // No Web Audio: the game still runs, just silent.
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* the next gesture will try again */
      }
    }
    this.started = true;
  }

  /** Called when the tab is hidden, so a backgrounded game is not audible. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setVolumes(master: number, sfx: number) {
    this.volumes.master = master;
    this.volumes.sfx = sfx;
    if (this.master) this.master.gain.value = master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
  }

  private build() {
    const ctx = this.ctx!;

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    // ---- engine: a stack of harmonics through a low-pass, like an exhaust ----
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 3;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);

    // Harmonic ratios chosen to give a lumpy, slightly uneven note rather than
    // a clean synth tone.
    const harmonics: { ratio: number; level: number; type: OscillatorType }[] = [
      { ratio: 0.5, level: 0.5, type: 'sawtooth' },
      { ratio: 1, level: 1.0, type: 'sawtooth' },
      { ratio: 1.5, level: 0.32, type: 'square' },
      { ratio: 2, level: 0.22, type: 'sawtooth' },
      { ratio: 3.01, level: 0.12, type: 'square' },
    ];
    for (const h of harmonics) {
      const osc = ctx.createOscillator();
      osc.type = h.type;
      osc.frequency.value = VEHICLE_AUDIO.idleHz * h.ratio;
      const gain = ctx.createGain();
      gain.gain.value = h.level;
      osc.connect(gain);
      gain.connect(this.engineFilter);
      osc.start();
      this.engineVoices.push({ osc, gain, ratio: h.ratio });
    }

    // ---- tyre / road noise: filtered white noise, gated on slip ----
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.tyreNoise = ctx.createBufferSource();
    this.tyreNoise.buffer = noiseBuf;
    this.tyreNoise.loop = true;
    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 1800;
    tyreFilter.Q.value = 0.8;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyreNoise.connect(tyreFilter);
    tyreFilter.connect(this.tyreGain);
    this.tyreGain.connect(this.sfxBus);
    this.tyreNoise.start();

    // ---- siren: a single tone whose pitch is swept into a two-tone wail ----
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenGain.connect(this.sfxBus);
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    const sirenShape = ctx.createGain();
    sirenShape.gain.value = 0.22;
    this.sirenOsc.connect(sirenShape);
    sirenShape.connect(this.sirenGain);
    this.sirenOsc.start();

    // ---- horn: two detuned squares, a real car's dual-tone ----
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornGain.connect(this.sfxBus);
    for (const f of [420, 508]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      osc.connect(g);
      g.connect(this.hornGain);
      osc.start();
      this.hornOsc.push(osc);
    }
  }

  /**
   * Per-frame update. Reads the live vehicle state; never allocates.
   * @param inCockpit cockpit audio is more enclosed than the exterior camera (spec 28)
   */
  update(dt: number, inCockpit: boolean) {
    if (!this.ctx || !this.started || this.ctx.state !== 'running') return;

    this.accum += dt;
    if (this.accum < AUDIO_UPDATE_INTERVAL) return;
    this.accum = 0;

    const now = this.ctx.currentTime;
    const v = sim.vehicle;
    const last = this.lastTargets;

    // ---------------------------------------------------------- engine note
    const engineActive = v.occupied && v.engineOn;
    const rpm = engineActive ? v.rpm01 : 0;
    const baseHz =
      VEHICLE_AUDIO.idleHz + (VEHICLE_AUDIO.redlineHz - VEHICLE_AUDIO.idleHz) * rpm;

    if (changed(last.hz, baseHz, 0.4)) {
      last.hz = baseHz;
      for (const voice of this.engineVoices) {
        // setTargetAtTime glides rather than stepping, avoiding zipper noise.
        voice.osc.frequency.setTargetAtTime(baseHz * voice.ratio, now, 0.06);
      }
    }

    if (this.engineFilter) {
      // Opening the filter with load is what makes it sound like it is working.
      const cutoff = inCockpit ? 420 + rpm * 1100 : 700 + rpm * 2600;
      if (changed(last.cutoff, cutoff, 8)) {
        last.cutoff = cutoff;
        this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.09);
      }
    }
    if (this.engineGain) {
      const target = engineActive ? (inCockpit ? 0.1 : 0.15) + rpm * 0.14 : 0;
      if (changed(last.engine, target, 0.004)) {
        last.engine = target;
        this.engineGain.gain.setTargetAtTime(target, now, 0.1);
      }
    }

    // ------------------------------------------------------------ tyre noise
    if (this.tyreGain) {
      const speed = Math.abs(v.forwardSpeed);
      const roll = engineActive ? Math.min(1, speed / 32) * 0.05 : 0;
      const slip = v.slipping ? 0.1 : 0;
      const target = (roll + slip) * (inCockpit ? 0.55 : 1);
      if (changed(last.tyre, target, 0.003)) {
        last.tyre = target;
        this.tyreGain.gain.setTargetAtTime(target, now, 0.12);
      }
    }

    // ----------------------------------------------------------------- siren
    // Audible only while units are actually responding, and only when one is
    // near enough to hear - it follows the real police state (spec 23, 28).
    if (this.sirenGain && this.sirenOsc) {
      const p = sim.police;
      const active =
        p.units > 0 && (p.state === 'responding' || p.state === 'pursuing' || p.state === 'searching');

      let level = 0;
      if (active) {
        const near = Math.hypot(p.lastKnownX - sim.player.position.x, p.lastKnownZ - sim.player.position.z);
        // Rough proximity falloff; a full spatial mix is a later milestone.
        level = p.state === 'pursuing' ? 0.5 : 0.3;
        level *= THREE_CLAMP(1 - near / 220, 0.15, 1);
      }

      this.sirenPhase += AUDIO_UPDATE_INTERVAL * (p.state === 'pursuing' ? 1.5 : 1.0);
      const wail = Math.sin(this.sirenPhase * Math.PI * 2) * 0.5 + 0.5;
      this.sirenOsc.frequency.setTargetAtTime(640 + wail * 420, now, 0.08);

      if (changed(last.siren, level, 0.01)) {
        last.siren = level;
        this.sirenGain.gain.setTargetAtTime(level, now, 0.25);
      }
    }

    // ------------------------------------------------------------------ horn
    if (this.hornGain) {
      const target = engineActive && sim.input.hornHeld ? 0.5 : 0;
      if (last.horn !== target) {
        last.horn = target;
        this.hornGain.gain.setTargetAtTime(target, now, target > 0 ? 0.012 : 0.05);
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const v of this.engineVoices) {
      try {
        v.osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.engineVoices = [];
    try {
      this.sirenOsc?.stop();
    } catch {
      /* already stopped */
    }
    this.sirenOsc = null;
    for (const o of this.hornOsc) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.hornOsc = [];
    try {
      this.tyreNoise?.stop();
    } catch {
      /* already stopped */
    }
    this.tyreNoise = null;
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

/** ~20 Hz is far faster than the ear needs for these envelopes. */
const AUDIO_UPDATE_INTERVAL = 1 / 20;

const THREE_CLAMP = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** True when a target has moved enough to be worth scheduling. */
function changed(prev: number, next: number, epsilon: number) {
  return Math.abs(prev - next) > epsilon;
}

export const audio = new AudioSystem();
