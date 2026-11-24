// The level music: a sequencer scheduling Web Audio voices a little ahead of time. Same design as the
// Unreal version: styles (tempo, drums, bass, sounds), well-known scales, classic progressions, a seeded
// melody that keeps to chord tones and the pentatonic, and intro / build / drop / break sections that
// energy (0..1) pushes around. A tempo boost eases in for big fights.
import { ctx, musicBus, noiseSource } from "./audio";
import { Rng } from "./util";

export type MusicStyle = "House" | "Chiptune" | "Synthwave" | "Deep" | "Electro" | "Crystal" | "Space" | "Wobble" | "Bounce" | "Breakbeat" | "Menu";

type Wave = "saw" | "square" | "pulse" | "sine" | "bell" | "tri";
const enum Drums { Four, Half, Break, Chip, Rock, Soft }
const enum Bass { Offbeat, Rolling, Wobble, Octave, Sustain, Bounce }
interface StyleDef { bpm: number; root: number; scale: number; drums: Drums; bass: Bass; lead: Wave; arp: Wave; arpEvery: number; swing: number; pad: number; bright: number }

const STYLES: Record<MusicStyle, StyleDef> = {
  House:     { bpm: 126, root: 45, scale: 0, drums: Drums.Four,  bass: Bass.Offbeat, lead: "saw",    arp: "square", arpEvery: 1, swing: 0,    pad: 0.5, bright: 0.8 },
  Chiptune:  { bpm: 140, root: 48, scale: 0, drums: Drums.Chip,  bass: Bass.Bounce,  lead: "square", arp: "pulse",  arpEvery: 1, swing: 0,    pad: 0,   bright: 1 },
  Synthwave: { bpm: 108, root: 50, scale: 0, drums: Drums.Rock,  bass: Bass.Octave,  lead: "saw",    arp: "saw",    arpEvery: 1, swing: 0,    pad: 0.9, bright: 0.6 },
  Deep:      { bpm: 122, root: 41, scale: 2, drums: Drums.Soft,  bass: Bass.Offbeat, lead: "bell",   arp: "bell",   arpEvery: 2, swing: 0.08, pad: 0.6, bright: 0.5 },
  Electro:   { bpm: 130, root: 43, scale: 0, drums: Drums.Four,  bass: Bass.Rolling, lead: "square", arp: "saw",    arpEvery: 1, swing: 0,    pad: 0.3, bright: 0.9 },
  Crystal:   { bpm: 134, root: 49, scale: 0, drums: Drums.Four,  bass: Bass.Offbeat, lead: "bell",   arp: "bell",   arpEvery: 1, swing: 0,    pad: 0.5, bright: 1 },
  Space:     { bpm: 118, root: 38, scale: 2, drums: Drums.Half,  bass: Bass.Sustain, lead: "sine",   arp: "tri",    arpEvery: 2, swing: 0,    pad: 1,   bright: 0.5 },
  Wobble:    { bpm: 140, root: 41, scale: 0, drums: Drums.Half,  bass: Bass.Wobble,  lead: "saw",    arp: "square", arpEvery: 2, swing: 0,    pad: 0.4, bright: 0.8 },
  Bounce:    { bpm: 128, root: 48, scale: 3, drums: Drums.Four,  bass: Bass.Bounce,  lead: "pulse",  arp: "square", arpEvery: 1, swing: 0.1,  pad: 0.4, bright: 0.9 },
  Breakbeat: { bpm: 170, root: 45, scale: 0, drums: Drums.Break, bass: Bass.Rolling, lead: "square", arp: "pulse",  arpEvery: 1, swing: 0,    pad: 0.3, bright: 0.9 },
  Menu:      { bpm: 100, root: 45, scale: 0, drums: Drums.Soft,  bass: Bass.Sustain, lead: "bell",   arp: "bell",   arpEvery: 2, swing: 0,    pad: 1,   bright: 0.4 },
};

const SCALES = [[0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 9, 10], [0, 2, 4, 5, 7, 9, 11]];
const MINOR_PROGS = [[0, 5, 2, 6], [0, 5, 6, 0], [0, 3, 5, 4], [0, 6, 5, 6], [5, 6, 0, 0]];
const DORIAN_PROGS = [[0, 3, 0, 3], [0, 3, 6, 0], [0, 6, 3, 0], [0, 2, 3, 6]];
const MAJOR_PROGS = [[0, 4, 5, 3], [0, 3, 4, 3], [5, 3, 0, 4], [0, 5, 3, 4]];
const ARPS = [[0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3], [0, 2, 1, 3, 0, 2, 1, 4, 0, 2, 1, 3, 5, 4, 3, 2], [0, 0, 3, 0, 1, 1, 4, 1, 2, 2, 5, 2, 1, 1, 4, 3], [3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1, 2]];

type Section = "intro" | "build" | "drop" | "break";
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  energy = 0.6;
  tempoBoost = 0;
  private st: StyleDef;
  private scale: number[];
  private penta: number[];
  private prog: number[];
  private arp: number[];
  private lead: number[][] = [];
  private leadLen: number[][] = [];
  private drumVar: number;
  private leadOct: number;
  private arpEvery: number;
  private padStabs: boolean;
  private bar = -1;
  private step = 15;
  private section: Section = "intro";
  private curBpm: number;
  private nextTime = 0;
  private timer = 0;
  private out!: GainNode;
  private duck!: GainNode;
  private sectionFilter!: BiquadFilterNode;
  private delay!: DelayNode;
  private delaySend!: GainNode;
  private pulseWave?: PeriodicWave;
  private wobbleLfo?: OscillatorNode;
  private sineBass: boolean;

  constructor(style: MusicStyle, seed: number) {
    const r = new Rng(seed);
    this.st = { ...STYLES[style] };
    this.sineBass = style === "Deep";
    this.st.bpm += r.int(-5, 5);
    this.st.root += r.int(-3, 3);
    const sc = this.st.scale;
    this.scale = SCALES[sc];
    this.penta = sc === 3 ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
    this.prog = r.pick(sc === 3 ? MAJOR_PROGS : sc === 2 ? DORIAN_PROGS : MINOR_PROGS);
    this.drumVar = r.int(0, 2);
    this.leadOct = r.chance(0.3) ? 2 : 1;
    this.padStabs = this.st.pad > 0 && this.st.pad < 0.8 && r.chance(0.4);
    this.arpEvery = r.chance(0.3) ? (this.st.arpEvery === 1 ? 2 : 1) : this.st.arpEvery;
    if (r.chance(0.35)) this.st.lead = r.pick(["saw", "square", "pulse", "bell"] as const);
    if (r.chance(0.2) && this.st.swing === 0) this.st.swing = 0.06;
    this.arp = r.pick(ARPS);
    this.curBpm = this.st.bpm;
    this.writeMelody(r);
  }

  private note(degree: number, octave: number): number {
    const n = this.scale.length;
    const o = Math.floor(degree / n);
    return this.st.root + this.scale[degree - o * n] + 12 * (o + octave);
  }

  /** Phrase A over four bars of chords, then A' with a new ending: chord tones on strong beats, the pentatonic between. */
  private writeMelody(r: Rng) {
    for (let b = 0; b < 8; b++) {
      this.lead[b] = new Array(16).fill(-1);
      this.leadLen[b] = new Array(16).fill(0);
      if (b >= 4 && b < 7) { this.lead[b] = [...this.lead[b - 4]]; this.leadLen[b] = [...this.leadLen[b - 4]]; continue; }
      const chord = this.prog[b % 4];
      let last = -1, prev = this.note(chord, this.leadOct);
      for (let s = 0; s < 16; s++) {
        const p = s % 4 === 0 ? 0.7 : s % 2 === 0 ? 0.45 : 0.15;
        if (r.next() < p || (b === 7 && s === 0)) {
          let cands: number[] = [];
          for (let k = 0; k < 3; k++) for (let o = 0; o < 2; o++) cands.push(this.note(chord + 2 * k, this.leadOct + o - (k > 0 ? 1 : 0)));
          if (s % 4 !== 0) for (const pd of this.penta) for (let o = 0; o < 2; o++) cands.push(this.note(pd, this.leadOct + o - 1));
          const home = this.note(0, this.leadOct);
          cands = cands.filter((n) => Math.abs(n - home) <= 14);
          let pick = r.pick(cands);
          if (r.chance(0.65)) {
            cands.sort((a, c) => Math.abs(a - prev) - Math.abs(c - prev));
            pick = cands[Math.min(r.int(1, 3), cands.length - 1)];
          }
          if (b === 7 && s === 0) pick = home;
          this.lead[b][s] = pick;
          prev = pick;
          if (last >= 0) this.leadLen[b][last] = s - last;
          last = s;
        }
      }
      if (last >= 0) this.leadLen[b][last] = 16 - last;
    }
  }

  start() {
    if (!ctx) return;
    const c = ctx;
    this.out = c.createGain(); this.out.gain.value = 0.9;
    this.sectionFilter = c.createBiquadFilter(); this.sectionFilter.type = "lowpass"; this.sectionFilter.frequency.value = 4000; this.sectionFilter.Q.value = 0.7;
    this.out.connect(this.sectionFilter); this.sectionFilter.connect(musicBus);
    this.duck = c.createGain(); this.duck.connect(this.out);
    this.delay = c.createDelay(1); this.delay.delayTime.value = (60 / this.st.bpm / 4) * 3;
    const fb = c.createGain(); fb.gain.value = 0.38;
    this.delaySend = c.createGain(); this.delaySend.gain.value = 0.3;
    const wet = c.createStereoPanner(); wet.pan.value = 0.35;
    this.delaySend.connect(this.delay); this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(wet); wet.connect(this.out);
    // A 25% pulse wave.
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
    this.pulseWave = c.createPeriodicWave(re, im);
    this.nextTime = c.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    window.clearInterval(this.timer);
    if (this.out && ctx) { this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); const o = this.out; setTimeout(() => o.disconnect(), 1500); }
    this.wobbleLfo?.stop();
  }

  private schedule() {
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.curBpm += (this.st.bpm * (1 + this.tempoBoost) - this.curBpm) * 0.02;
      this.nextStep(this.nextTime);
      const stepLen = (60 / this.curBpm / 4) * (this.step % 2 === 0 ? 1 + this.st.swing : 1 - this.st.swing);
      this.nextTime += stepLen;
    }
  }

  private sectionFor(b: number): Section {
    const l = b < 64 ? b : 32 + ((b - 32) % 32);
    if (l < 8) return "intro";
    if (l < 16) return "build";
    if (l < 32) return "drop";
    if (l < 40) return "break";
    if (l < 48) return "build";
    return "drop";
  }

  private nextStep(t: number) {
    const st = this.st;
    const stepDur = 60 / this.curBpm / 4;
    if (++this.step >= 16) {
      this.step = 0;
      this.bar++;
      let s = this.sectionFor(this.bar);
      if (this.energy < 0.3 && (s === "drop" || s === "build")) s = Math.floor(this.bar / 8) % 2 ? "break" : "intro";
      if (this.energy > 0.85 && (s === "intro" || s === "break")) { this.bar = this.bar < 32 ? 8 : 40; s = "build"; }
      this.section = s;
      const cut = s === "drop" ? 18000 : s === "build" ? 2500 + 15000 * ((this.bar % 8) / 8) : s === "break" ? 1800 : 4000;
      this.sectionFilter.frequency.setTargetAtTime(cut, t, 0.6);
      const chord = this.prog[((this.bar % 8) + 8) % 8 % 4];
      if (st.pad > 0 && !this.padStabs && (s !== "intro" || st.pad > 0.8)) this.pad(t, chord, stepDur * 16 - stepDur / 4, false);
    }
    const s = this.step;
    const sec = this.section;
    const drop = sec === "drop", build = sec === "build", brk = sec === "break", intro = sec === "intro";
    const chord = this.prog[((this.bar % 8) + 8) % 8 % 4];
    const lastBuildBar = build && this.bar % 8 === 7;
    if (this.padStabs && !intro && (s === 2 || s === 6 || s === 10 || s === 14 || (this.drumVar === 1 && s === 7))) this.pad(t, chord, stepDur, true);

    // Drums
    const kickOn = !brk && !(lastBuildBar && s >= 8);
    const K = () => this.kick(t), Sn = (v: number, clap = false) => this.snare(t, v, clap), H = (v: number, open = false) => this.hat(t, v, open);
    switch (st.drums) {
      case Drums.Half: if (kickOn && (s === 0 || (drop && (s === 10 || s === 7)))) K(); if (!intro && s === 8) Sn(1); if (s % 2 === 0) H(drop ? 0.8 : 0.5, s === 6 || s === 14); break;
      case Drums.Break: if (kickOn && (s === 0 || s === 10 || (drop && s === 3))) K(); if (!intro && (s === 4 || s === 12)) Sn(1); if (drop && (s === 7 || s === 15)) Sn(0.35); H(s % 4 === 2 ? 0.8 : 0.45, s === 14); break;
      case Drums.Chip: if (kickOn && s % 4 === 0) K(); if (!intro && (s === 4 || s === 12)) Sn(0.9); if (s % 2 === 1) H(0.6); break;
      case Drums.Rock: if (kickOn && (s === 0 || s === 8 || (drop && s === 10))) K(); if (!intro && (s === 4 || s === 12)) Sn(1, true); if (s % 2 === 0) H(0.6); break;
      case Drums.Soft: if (kickOn && s % 4 === 0 && !intro) K(); if (drop && (s === 4 || s === 12)) Sn(0.6, true); if (s % 4 === 2) H(0.5, true); break;
      default: if (kickOn && s % 4 === 0) K(); if (!intro && (s === 4 || s === 12)) Sn(0.9, true); if (s % 4 === 2) H(0.8, true); else if (drop || build) H(0.4); break;
    }
    if (this.drumVar === 1 && drop && s === 14 && st.drums !== Drums.Half) K();
    if (this.drumVar === 2 && (drop || build) && s % 2 === 1 && st.drums !== Drums.Break) H(0.25);
    if (this.drumVar === 0 && drop && this.bar % 4 === 3 && s >= 12) Sn(0.35 + 0.1 * (s - 12));
    if (lastBuildBar && s >= 8) Sn(0.3 + 0.05 * (s - 8));

    // Bass
    const root = this.note(chord, -1);
    if (!brk || st.bass === Bass.Sustain) {
      switch (st.bass) {
        case Bass.Offbeat: if (s % 4 === 2) this.bass(t, root, stepDur * 2); break;
        case Bass.Rolling: if ((s % 4 !== 0 || !drop) && (drop || s % 2 === 0)) this.bass(t, s % 8 === 6 ? this.note(chord + 4, -1) : root + (s % 8 === 7 ? 12 : 0), stepDur * 0.9); break;
        case Bass.Wobble: if (drop) { if (s === 0 || s === 8) this.bass(t, root, stepDur * 8, true); } else if (s === 0) this.bass(t, root + 12, stepDur * 3); break;
        case Bass.Octave: if (s % 2 === 0) this.bass(t, root + ((s / 2) % 2 ? 12 : 0), stepDur * 2); break;
        case Bass.Sustain: if (s === 0) this.bass(t, root, stepDur * 16); break;
        case Bass.Bounce: if (s % 4 === 2 || (drop && s % 8 === 7)) this.bass(t, root + (s % 8 === 7 ? 12 : 0), stepDur); break;
      }
    }
    // Arp
    if (!(intro && this.bar % 8 < 4) && s % this.arpEvery === 0) {
      const idx = this.arp[s];
      this.voice(t, this.note(chord + 2 * (idx % 3), 1 + Math.floor(idx / 3)), (stepDur * this.arpEvery) / 2, st.arp, 0.09, 700 + 2000 * st.bright, 3000 * st.bright, 0.002, 0.09, 0, true, true);
    }
    // Lead (drops)
    if (drop) {
      const b = ((this.bar % 8) + 8) % 8;
      if (this.lead[b][s] >= 0) this.voice(t, this.lead[b][s], Math.max(1, this.leadLen[b][s]) * stepDur - stepDur / 3, st.lead, 0.13, 900 + 1800 * st.bright, 2500 * st.bright, 0.008, 0.25, 0.6, false, true);
    }
  }

  // --- Instruments ---
  private kick(t: number) {
    const c = ctx!;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(196, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.5);
    // Side-chain: everything on the duck bus dips with each kick.
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(0.4, t);
    this.duck.gain.linearRampToValueAtTime(1, t + 0.22);
  }
  private snare(t: number, v: number, clap: boolean) {
    const c = ctx!;
    const n = noiseSource();
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = clap ? 1500 : 2200; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + (clap ? 0.2 : 0.25));
    n.connect(f); f.connect(g); g.connect(this.out); n.start(t); n.stop(t + 0.3);
    if (!clap) {
      const o = c.createOscillator(); o.frequency.value = 185;
      const og = c.createGain(); og.gain.setValueAtTime(0.35 * v, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og); og.connect(this.out); o.start(t); o.stop(t + 0.15);
    }
  }
  private hat(t: number, v: number, open: boolean) {
    const c = ctx!;
    const n = noiseSource();
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500;
    const g = c.createGain(); const d = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(f); f.connect(g); g.connect(this.out); n.start(t); n.stop(t + d + 0.02);
  }
  private osc(type: Wave, f: number): OscillatorNode {
    const o = ctx!.createOscillator();
    if (type === "pulse" && this.pulseWave) o.setPeriodicWave(this.pulseWave);
    else o.type = type === "saw" ? "sawtooth" : type === "square" ? "square" : type === "tri" ? "triangle" : "sine";
    o.frequency.value = f;
    return o;
  }
  private bass(t: number, midi: number, dur: number, wobble = false) {
    const c = ctx!, st = this.st;
    const f = hz(midi);
    const wave: Wave = st.bass === Bass.Wobble ? "saw" : st.bass === Bass.Bounce ? "square" : this.sineBass ? "sine" : "saw";
    const o = this.osc(wave, f);
    const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.Q.value = wobble ? 8 : 1.5;
    const base = wobble ? 180 : 260 + 300 * st.bright;
    filt.frequency.setValueAtTime(base + (wobble ? 0 : 1400 * st.bright), t);
    filt.frequency.exponentialRampToValueAtTime(base, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.004); g.gain.setTargetAtTime(0.24, t + 0.01, 0.05);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.02);
    o.connect(filt); filt.connect(g); g.connect(this.duck);
    if (wobble) {
      const lfo = c.createOscillator(); lfo.frequency.value = (this.curBpm / 60) * (this.bar % 4 === 3 ? 3 : 2);
      const lg = c.createGain(); lg.gain.value = 1400;
      lfo.connect(lg); lg.connect(filt.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
      const o2 = this.osc("saw", f * 1.01); o2.connect(filt); o2.start(t); o2.stop(t + dur + 0.1);
    }
    o.start(t); o.stop(t + dur + 0.15);
  }
  private pad(t: number, chord: number, dur: number, stab: boolean) {
    const c = ctx!;
    for (let k = 0; k < 3; k++) {
      const f = hz(this.note(chord + 2 * k, 0));
      const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 600 + 900 * this.st.bright;
      const g = c.createGain();
      const peak = 0.05 * this.st.pad, a = stab ? 0.004 : 0.35, r = stab ? 0.08 : 0.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0.0001, t + dur, r / 3);
      for (const d of [1, 1.009]) { const o = this.osc("saw", f * d); o.connect(filt); o.start(t); o.stop(t + dur + r + 0.2); }
      filt.connect(g); g.connect(this.duck);
    }
  }
  private voice(t: number, midi: number, dur: number, wave: Wave, peak: number, cutoff: number, envAmt: number, attack: number, decay: number, sustain: number, ducked: boolean, echo: boolean) {
    const c = ctx!;
    const f = hz(midi);
    const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.Q.value = 1;
    filt.frequency.setValueAtTime(cutoff + envAmt, t); filt.frequency.setTargetAtTime(cutoff, t, decay / 3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(Math.max(0.0001, peak * sustain), t + attack, decay / 3);
    g.gain.setTargetAtTime(0.0001, t + Math.max(dur, attack + 0.01), 0.04);
    if (wave === "bell") {
      const o1 = this.osc("sine", f), o2 = this.osc("sine", f * 3);
      const g2 = c.createGain(); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      o1.connect(filt); o2.connect(g2); g2.connect(filt);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.4); o2.stop(t + dur + 0.4);
    } else {
      const o = this.osc(wave, f); o.connect(filt); o.start(t); o.stop(t + dur + 0.4);
      if (wave === "saw") { const o2 = this.osc("saw", f * 1.006); o2.connect(filt); o2.start(t); o2.stop(t + dur + 0.4); }
    }
    filt.connect(g);
    g.connect(ducked ? this.duck : this.out);
    if (echo) g.connect(this.delaySend);
  }
}
