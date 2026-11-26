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
/** Arrangements of the same song for parts of the game; the music fades between them. */
export type MusicMode = "calm" | "cruise" | "boss" | "tunnel";
export const MODES: MusicMode[] = ["calm", "cruise", "boss", "tunnel"];
/** Tempo change per mode (a fraction of the song's tempo). */
const MODE_TEMPO: Record<MusicMode, number> = { calm: -0.04, cruise: 0, boss: 0.08, tunnel: 0.06 };
/** One mode's mix: its level fades from `from` to `to` (time constant `tau`) from time `t0`. */
interface ModeBus { out: GainNode; duck: GainNode; filt: BiquadFilterNode; from: number; to: number; t0: number; tau: number }
interface StepCtx { t: number; s: number; dur: number; sec: Section; drop: boolean; build: boolean; brk: boolean; intro: boolean; chord: number; lb: number; lastBuildBar: boolean }
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  energy = 0.6;
  tempoBoost = 0;
  /** The arrangement playing (or fading in). */
  mode: MusicMode = "cruise";
  private buses = {} as Record<MusicMode, ModeBus>;
  private bus!: ModeBus;
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
    // One bus per mode (each with its own side-chain and filter); only the playing mode's is open.
    for (const m of MODES) {
      const on = m === this.mode ? 1 : 0;
      const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = m === "calm" ? 2000 : 20000; filt.Q.value = m === "tunnel" ? 2 : 0.7;
      const out = c.createGain(); out.gain.value = on; out.connect(filt); filt.connect(this.out);
      const duck = c.createGain(); duck.connect(out);
      this.buses[m] = { out, duck, filt, from: on, to: on, t0: c.currentTime, tau: 1 };
    }
    this.bus = this.buses[this.mode];
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

  /** Fade to another arrangement of the same song (over about `fade` seconds). */
  setMode(m: MusicMode, fade = 2.5) {
    if (m === this.mode) return;
    this.mode = m;
    if (!ctx || !this.out) return;
    const now = ctx.currentTime, tau = fade / 3;
    for (const n of MODES) {
      const b = this.buses[n];
      b.from = this.mixAt(b, now); b.to = n === m ? 1 : 0; b.t0 = now; b.tau = tau;
      b.out.gain.cancelScheduledValues(now);
      b.out.gain.setValueAtTime(b.from, now);
      b.out.gain.setTargetAtTime(b.to, now, tau);
    }
  }

  private mixAt(b: ModeBus, t: number) { return t <= b.t0 ? b.from : b.to + (b.from - b.to) * Math.exp(-(t - b.t0) / b.tau); }

  stop() {
    window.clearInterval(this.timer);
    if (this.out && ctx) { this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); const o = this.out; setTimeout(() => o.disconnect(), 1500); }
    this.wobbleLfo?.stop();
  }

  private schedule() {
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.curBpm += (this.st.bpm * (1 + this.tempoBoost + MODE_TEMPO[this.mode]) - this.curBpm) * 0.02;
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
    const stepDur = 60 / this.curBpm / 4;
    if (++this.step >= 16) {
      this.step = 0;
      this.bar++;
      // Calm keeps to the quiet sections; boss and tunnel stay in the build / drop part.
      const energy = this.mode === "calm" ? Math.min(this.energy, 0.2) : this.mode === "cruise" ? this.energy : 1;
      let sec = this.sectionFor(this.bar);
      if (energy < 0.3 && (sec === "drop" || sec === "build")) sec = Math.floor(this.bar / 8) % 2 ? "break" : "intro";
      if (energy > 0.85 && (sec === "intro" || sec === "break")) { this.bar = this.bar < 32 ? 8 : 40; sec = "build"; }
      this.section = sec;
      const cut = sec === "drop" ? 18000 : sec === "build" ? 2500 + 15000 * ((this.bar % 8) / 8) : sec === "break" ? 1800 : 4000;
      this.sectionFilter.frequency.setTargetAtTime(cut, t, 0.6);
    }
    const sec = this.section;
    const k: StepCtx = {
      t, s: this.step, dur: stepDur, sec, drop: sec === "drop", build: sec === "build", brk: sec === "break", intro: sec === "intro",
      chord: this.prog[((this.bar % 8) + 8) % 8 % 4], lb: ((this.bar % 8) + 8) % 8,
      lastBuildBar: sec === "build" && this.bar % 8 === 7,
    };
    // Every mode that can be heard plays its own arrangement of the song into its own bus.
    for (const m of MODES) {
      const bus = this.buses[m];
      if (this.mixAt(bus, t) < 0.02) continue;
      this.bus = bus;
      if (m === "cruise") this.stepCruise(k);
      else if (m === "boss") this.stepBoss(k);
      else if (m === "tunnel") this.stepTunnel(k);
      else this.stepCalm(k);
    }
  }

  /** The song as it was written: the run's main arrangement. */
  private stepCruise(k: StepCtx) {
    const st = this.st, { t, s, dur: stepDur, drop, build, brk, intro, chord, lastBuildBar } = k;
    if (s === 0 && st.pad > 0 && !this.padStabs && (!intro || st.pad > 0.8)) this.pad(t, chord, stepDur * 16 - stepDur / 4, false);
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
      const b = k.lb;
      if (this.lead[b][s] >= 0) this.voice(t, this.lead[b][s], Math.max(1, this.leadLen[b][s]) * stepDur - stepDur / 3, st.lead, 0.13, 900 + 1800 * st.bright, 2500 * st.bright, 0.008, 0.25, 0.6, false, true);
    }
  }

  /** Boss: heavier and a little faster - galloping kicks, a driving octave bass, power-chord stabs, the
   *  melody low and doubled a fifth up, a fast arp, snare rolls into every other bar. */
  private stepBoss(k: StepCtx) {
    const st = this.st, { t, s, dur, drop, build, brk, chord, lastBuildBar } = k;
    const root = this.note(chord, -1);
    if (s === 0) this.pad(t, chord, dur * 16 - dur / 4, false, 0.035);
    // Drums
    if (!brk && !(lastBuildBar && s >= 8) && (s % 4 === 0 || s === 3 || s === 11 || (drop && s === 14))) this.kick(t);
    if (s === 4 || s === 12) this.snare(t, 1, false);
    if (drop && this.bar % 2 === 1 && s >= 13) this.snare(t, 0.35 + 0.15 * (s - 13), false);
    if (lastBuildBar && s >= 8) this.snare(t, 0.3 + 0.06 * (s - 8), false);
    this.hat(t, s % 2 === 0 ? 0.75 : 0.35, s % 4 === 2);
    // Bass: an octave gallop (or the wobble, for wobble songs).
    if (st.bass === Bass.Wobble && drop) { if (s === 0 || s === 8) this.bass(t, root, dur * 8, true); }
    else if (!brk && (s % 2 === 0 || s % 4 === 3)) this.bass(t, s % 4 === 3 ? root + 12 : root, dur * 0.8, false, "saw");
    // Power-chord stabs: root and fifth, low and gritty.
    if ((drop || build) && (s === 0 || s === 6 || s === 10)) {
      for (const n of [this.note(chord, 0), this.note(chord, 0) + 7]) this.voice(t, n, dur * 1.5, "saw", 0.07, 500, 2200, 0.003, 0.15, 0.3, true, false);
    }
    // Fast arp, every step, an octave higher every other bar.
    if (!brk) {
      const idx = this.arp[s];
      this.voice(t, this.note(chord + 2 * (idx % 3), 1 + Math.floor(idx / 3) + (this.bar % 2)), dur * 0.5, "square", 0.06, 900 + 1500 * st.bright, 2500, 0.002, 0.07, 0, true, true);
    }
    // The melody: an octave down, doubled a fifth above (in builds too, quieter).
    if (drop || build) {
      const n = this.lead[k.lb][s];
      if (n >= 0) {
        const len = Math.max(1, this.leadLen[k.lb][s]) * dur - dur / 3, v = drop ? 0.12 : 0.06;
        this.voice(t, n - 12, len, "saw", v, 700 + 1400 * st.bright, 2600, 0.006, 0.2, 0.7, false, true);
        this.voice(t, n - 5, len, "square", v * 0.5, 900, 1800, 0.006, 0.2, 0.6, false, false);
      }
    }
  }

  /** Tunnel: a straight, driving run - four on the floor, sixteenth hats, a rolling offbeat bass, a two-
   *  octave arp, the melody in square waves, and a filter that opens over every four bars. */
  private stepTunnel(k: StepCtx) {
    const st = this.st, { t, s, dur, drop, build, chord, lastBuildBar } = k;
    const root = this.note(chord, -1);
    if (s === 0) {
      const f = this.bus.filt.frequency, q = ((this.bar % 4) + 4) % 4;
      f.cancelScheduledValues(t);
      f.setTargetAtTime(1200 * Math.pow(2.4, q), t, dur * 6);
      if (st.pad > 0) this.pad(t, chord, dur * 4, true, 0.04);
    }
    if (s === 8 && st.pad > 0) this.pad(t, chord, dur * 4, true, 0.03);
    // Drums
    if (s % 4 === 0 && !(lastBuildBar && s >= 8)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t, 0.9, true);
    this.hat(t, s % 4 === 2 ? 0.8 : s % 2 ? 0.3 : 0.5, s % 4 === 2);
    if (lastBuildBar && s >= 8) this.snare(t, 0.3 + 0.07 * (s - 8), true);
    // Bass: rolling offbeats, the fifth at the end of each half bar.
    if (s % 4 !== 0) this.bass(t, s % 8 === 7 ? this.note(chord + 4, -1) : root + (s % 4 === 2 ? 12 : 0), dur * 0.85, false, st.bass === Bass.Bounce ? "square" : "saw");
    // Arp across two octaves, every step.
    const idx = this.arp[s];
    this.voice(t, this.note(chord + 2 * (idx % 3), 1 + Math.floor(idx / 3)) + (s % 2 ? 12 : 0), dur * 0.45, "pulse", 0.07, 1200 + 2000 * st.bright, 3500, 0.002, 0.06, 0, true, true);
    // Melody in drops (an octave up on the first beat of each bar), the first half of it in builds.
    if (drop || (build && s < 8)) {
      const n = this.lead[k.lb][s];
      if (n >= 0) this.voice(t, n + (s === 0 ? 12 : 0), Math.max(1, this.leadLen[k.lb][s]) * dur - dur / 3, "square", drop ? 0.1 : 0.06, 1100 + 1500 * st.bright, 2500, 0.005, 0.2, 0.55, false, true);
    }
  }

  /** Calm (menu, shop, game over): no drums but a soft hat, long pads, a held bass, slow bells for the arp
   *  and the melody's main notes, everything behind a soft filter. */
  private stepCalm(k: StepCtx) {
    const st = this.st, { t, s, dur, intro, chord } = k;
    if (s === 0) {
      this.pad(t, chord, dur * 16 - dur / 4, false, 0.05);
      this.bass(t, this.note(chord, -1), dur * 16, false, "sine");
    }
    if (!intro && s % 4 === 2) this.hat(t, 0.2, true);
    if (s % 2 === 0) {
      const idx = this.arp[s];
      this.voice(t, this.note(chord + 2 * (idx % 3), 1 + Math.floor(idx / 3)), dur * 1.5, "bell", 0.05, 1600, 800, 0.003, 0.4, 0, false, true);
    }
    if (s % 4 === 0 && this.bar % 2 === 1) {
      const n = this.lead[k.lb][s];
      if (n >= 0) this.voice(t, n + 12, dur * 3, "bell", 0.07, 2200 + 1000 * st.bright, 800, 0.004, 0.6, 0.2, false, true);
    }
  }

  // --- Instruments ---
  private kick(t: number) {
    const c = ctx!;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(196, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(this.bus.out); o.start(t); o.stop(t + 0.5);
    // Side-chain: everything on the duck bus dips with each kick.
    const duck = this.bus.duck.gain;
    duck.cancelScheduledValues(t);
    duck.setValueAtTime(0.4, t);
    duck.linearRampToValueAtTime(1, t + 0.22);
  }
  private snare(t: number, v: number, clap: boolean) {
    const c = ctx!;
    const n = noiseSource();
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = clap ? 1500 : 2200; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + (clap ? 0.2 : 0.25));
    n.connect(f); f.connect(g); g.connect(this.bus.out); n.start(t); n.stop(t + 0.3);
    if (!clap) {
      const o = c.createOscillator(); o.frequency.value = 185;
      const og = c.createGain(); og.gain.setValueAtTime(0.35 * v, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og); og.connect(this.bus.out); o.start(t); o.stop(t + 0.15);
    }
  }
  private hat(t: number, v: number, open: boolean) {
    const c = ctx!;
    const n = noiseSource();
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500;
    const g = c.createGain(); const d = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(f); f.connect(g); g.connect(this.bus.out); n.start(t); n.stop(t + d + 0.02);
  }
  private osc(type: Wave, f: number): OscillatorNode {
    const o = ctx!.createOscillator();
    if (type === "pulse" && this.pulseWave) o.setPeriodicWave(this.pulseWave);
    else o.type = type === "saw" ? "sawtooth" : type === "square" ? "square" : type === "tri" ? "triangle" : "sine";
    o.frequency.value = f;
    return o;
  }
  private bass(t: number, midi: number, dur: number, wobble = false, waveAs?: Wave) {
    const c = ctx!, st = this.st;
    const f = hz(midi);
    const wave: Wave = waveAs ?? st.bass === Bass.Wobble ? "saw" : st.bass === Bass.Bounce ? "square" : this.sineBass ? "sine" : "saw";
    const o = this.osc(wave, f);
    const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.Q.value = wobble ? 8 : 1.5;
    const base = wobble ? 180 : 260 + 300 * st.bright;
    filt.frequency.setValueAtTime(base + (wobble ? 0 : 1400 * st.bright), t);
    filt.frequency.exponentialRampToValueAtTime(base, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.004); g.gain.setTargetAtTime(0.24, t + 0.01, 0.05);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.02);
    o.connect(filt); filt.connect(g); g.connect(this.bus.duck);
    if (wobble) {
      const lfo = c.createOscillator(); lfo.frequency.value = (this.curBpm / 60) * (this.bar % 4 === 3 ? 3 : 2);
      const lg = c.createGain(); lg.gain.value = 1400;
      lfo.connect(lg); lg.connect(filt.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
      const o2 = this.osc("saw", f * 1.01); o2.connect(filt); o2.start(t); o2.stop(t + dur + 0.1);
    }
    o.start(t); o.stop(t + dur + 0.15);
  }
  private pad(t: number, chord: number, dur: number, stab: boolean, level?: number) {
    const c = ctx!;
    for (let k = 0; k < 3; k++) {
      const f = hz(this.note(chord + 2 * k, 0));
      const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 600 + 900 * this.st.bright;
      const g = c.createGain();
      const peak = level ?? 0.05 * this.st.pad, a = stab ? 0.004 : 0.35, r = stab ? 0.08 : 0.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0.0001, t + dur, r / 3);
      for (const d of [1, 1.009]) { const o = this.osc("saw", f * d); o.connect(filt); o.start(t); o.stop(t + dur + r + 0.2); }
      filt.connect(g); g.connect(this.bus.duck);
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
    g.connect(ducked ? this.bus.duck : this.bus.out);
    if (echo) g.connect(this.delaySend);
  }
}
