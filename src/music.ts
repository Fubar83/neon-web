// The level music: a sequencer scheduling Web Audio voices a little ahead of time. Same design as the
// Unreal version: styles (tempo, drums, bass, sounds), well-known scales, classic progressions, a seeded
// melody that keeps to chord tones and the pentatonic, and intro / build / drop / break sections that
// energy (0..1) pushes around. A tempo boost eases in for big fights.
// Each song also runs in 8-bar blocks A B A C: B has its own chords, melody, bass line, arp and lead
// sound; C answers A with a new second half, the lead doubled and busier drums. Fills, a percussion
// layer and crashes mark the way.
import { ctx, musicBus, noiseSource } from "./audio";
import { Rng } from "./util";

export type MusicStyle = "House" | "Chiptune" | "Synthwave" | "Deep" | "Electro" | "Crystal" | "Space" | "Wobble" | "Bounce" | "Breakbeat" | "Menu"
  | "Jazz" | "Baroque" | "Orchestral" | "Funk" | "Samba" | "Rock";
/** Styles that aren't electronic: their own band and patterns (stepGenre). */
type Genre = "jazz" | "baroque" | "orchestral" | "funk" | "samba" | "rock";
type Inst = "piano" | "harpsi" | "strings" | "brass" | "guitar" | "flute" | "sax" | "clav" | "upright" | "slap" | "choir" | "timp";

type Wave = "saw" | "square" | "pulse" | "sine" | "bell" | "tri" | "supersaw" | "fm" | "organ";
const enum Drums { Four, Half, Break, Chip, Rock, Soft }
const enum Bass { Offbeat, Rolling, Wobble, Octave, Sustain, Bounce }
interface StyleDef { bpm: number; root: number; scale: number; drums: Drums; bass: Bass; lead: Wave; arp: Wave; arpEvery: number; swing: number; pad: number; bright: number; genre?: Genre }

const STYLES: Record<MusicStyle, StyleDef> = {
  House:     { bpm: 128, root: 45, scale: 0, drums: Drums.Four,  bass: Bass.Offbeat, lead: "saw",    arp: "square", arpEvery: 1, swing: 0,    pad: 0.5, bright: 0.8 },
  Chiptune:  { bpm: 145, root: 48, scale: 0, drums: Drums.Chip,  bass: Bass.Bounce,  lead: "square", arp: "pulse",  arpEvery: 1, swing: 0,    pad: 0,   bright: 1 },
  Synthwave: { bpm: 122, root: 50, scale: 0, drums: Drums.Rock,  bass: Bass.Octave,  lead: "saw",    arp: "saw",    arpEvery: 1, swing: 0,    pad: 0.9, bright: 0.6 },
  Deep:      { bpm: 124, root: 41, scale: 2, drums: Drums.Soft,  bass: Bass.Offbeat, lead: "bell",   arp: "bell",   arpEvery: 2, swing: 0.08, pad: 0.6, bright: 0.5 },
  Electro:   { bpm: 132, root: 43, scale: 0, drums: Drums.Four,  bass: Bass.Rolling, lead: "square", arp: "saw",    arpEvery: 1, swing: 0,    pad: 0.3, bright: 0.9 },
  Crystal:   { bpm: 138, root: 49, scale: 0, drums: Drums.Four,  bass: Bass.Offbeat, lead: "bell",   arp: "bell",   arpEvery: 1, swing: 0,    pad: 0.5, bright: 1 },
  Space:     { bpm: 126, root: 38, scale: 2, drums: Drums.Half,  bass: Bass.Sustain, lead: "sine",   arp: "tri",    arpEvery: 2, swing: 0,    pad: 1,   bright: 0.5 },
  Wobble:    { bpm: 140, root: 41, scale: 0, drums: Drums.Half,  bass: Bass.Wobble,  lead: "saw",    arp: "square", arpEvery: 2, swing: 0,    pad: 0.4, bright: 0.8 },
  Bounce:    { bpm: 132, root: 48, scale: 3, drums: Drums.Four,  bass: Bass.Bounce,  lead: "pulse",  arp: "square", arpEvery: 1, swing: 0.1,  pad: 0.4, bright: 0.9 },
  Breakbeat: { bpm: 172, root: 45, scale: 0, drums: Drums.Break, bass: Bass.Rolling, lead: "square", arp: "pulse",  arpEvery: 1, swing: 0,    pad: 0.3, bright: 0.9 },
  // Jazz counts a 16-step bar as two fast bars (about 185 BPM, swung).
  Jazz:       { bpm: 92,  root: 48, scale: 2, drums: Drums.Soft, bass: Bass.Sustain, lead: "saw", arp: "tri", arpEvery: 2, swing: 0.22, pad: 0, bright: 0.6, genre: "jazz" },
  Baroque:    { bpm: 128, root: 50, scale: 1, drums: Drums.Soft, bass: Bass.Sustain, lead: "saw", arp: "tri", arpEvery: 2, swing: 0, pad: 0, bright: 0.6, genre: "baroque" },
  Orchestral: { bpm: 140, root: 45, scale: 0, drums: Drums.Soft, bass: Bass.Sustain, lead: "saw", arp: "tri", arpEvery: 2, swing: 0, pad: 0, bright: 0.6, genre: "orchestral" },
  Funk:       { bpm: 114, root: 40, scale: 2, drums: Drums.Soft, bass: Bass.Sustain, lead: "saw", arp: "tri", arpEvery: 2, swing: 0.06, pad: 0, bright: 0.6, genre: "funk" },
  Samba:      { bpm: 104, root: 50, scale: 3, drums: Drums.Soft, bass: Bass.Sustain, lead: "saw", arp: "tri", arpEvery: 2, swing: 0, pad: 0, bright: 0.6, genre: "samba" },
  Rock:       { bpm: 148, root: 40, scale: 0, drums: Drums.Soft, bass: Bass.Sustain, lead: "saw", arp: "tri", arpEvery: 2, swing: 0, pad: 0, bright: 0.6, genre: "rock" },
  Menu:      { bpm: 118, root: 45, scale: 0, drums: Drums.Soft,  bass: Bass.Sustain, lead: "bell",   arp: "bell",   arpEvery: 2, swing: 0,    pad: 1,   bright: 0.4 },
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
interface StepCtx { t: number; s: number; dur: number; sec: Section; drop: boolean; build: boolean; brk: boolean; intro: boolean; chord: number; lb: number; lastBuildBar: boolean;
  /** Which block of the song: 0 = A, 1 = B, 2 = C (the order runs A B A C). */
  form: number; arp: number[]; arpWave: Wave; leadWave: Wave; bassKind: Bass }
/** The song's blocks, eight bars each. */
const FORM = [0, 1, 0, 2];
/** Off-beat percussion patterns (rim or cowbell). */
const PERC_HITS = [[3, 6, 11, 14], [2, 7, 10, 15], [3, 7, 10, 13], [6, 14]];
/** Funk slap-bass bars: R root, O octave, F fifth, G ghost note, . rest. */
const FUNK_BASS = ["R..OR.G.R.R.O.GF", "R.GR..O.R..FR.O.", "R..R.OG.R.F.O..G", "R.O.G.R..R.OF.G."];
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
  // The B and C blocks (see the top).
  private prog2: number[];
  private arp2: number[];
  private arpWave2: Wave;
  private leadWave2: Wave;
  private bassAlt: Bass;
  /** Percussion layer: 0 shaker, 1 ride, 2 rim, 3 cowbell; its off-beat pattern. */
  private perc: number;
  private percHits: number[];
  /** Fills at the end of every four bars: 0 toms, 1 snare roll, 2 kick and toms. */
  private fill: number;
  /** An extra kick step for C blocks. */
  private kickExtra: number;
  /** For the genres: a number that varies their patterns per song, and the funk bass bars (A, B). */
  private salt: number;
  private funkBass: string;
  private funkBass2: string;

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
    if (r.chance(0.2) && this.st.swing === 0 && !this.st.genre) this.st.swing = 0.06;
    this.arp = r.pick(ARPS);
    this.curBpm = this.st.bpm;
    this.writeMelody(r);
    // The B block: other chords, a new melody (more off-beat), other arp, bass and lead sound.
    const progs = sc === 3 ? MAJOR_PROGS : sc === 2 ? DORIAN_PROGS : MINOR_PROGS;
    this.prog2 = r.pick(progs.filter((q) => q !== this.prog));
    this.arp2 = r.pick(ARPS.filter((q) => q !== this.arp));
    this.arpWave2 = r.pick((["square", "pulse", "saw", "bell", "fm", "tri"] as Wave[]).filter((w) => w !== this.st.arp));
    this.leadWave2 = r.pick((["saw", "square", "pulse", "bell", "supersaw", "fm", "organ"] as Wave[]).filter((w) => w !== this.st.lead));
    if (r.chance(0.3)) this.st.lead = r.pick(["supersaw", "fm", "organ"] as Wave[]);
    const alts = this.st.bass === Bass.Wobble ? [Bass.Rolling, Bass.Octave] : [Bass.Offbeat, Bass.Rolling, Bass.Octave, Bass.Bounce].filter((b) => b !== this.st.bass);
    this.bassAlt = r.pick(alts);
    this.perc = r.int(0, 3);
    this.percHits = r.pick(PERC_HITS);
    this.fill = r.int(0, 2);
    this.kickExtra = r.pick([6, 10, 7]);
    this.writePhrase(r, this.prog2, 8, (s) => (s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.35 : 0.4), this.leadOct + (r.chance(0.4) ? -1 : 0));
    // The C block: A's first half, then a new, busier second half.
    for (let b = 0; b < 8; b++) { this.lead[16 + b] = [...this.lead[b]]; this.leadLen[16 + b] = [...this.leadLen[b]]; }
    this.writePhrase(r, this.prog, 16, (s) => (s % 4 === 0 ? 0.75 : s % 2 === 0 ? 0.6 : 0.3), this.leadOct, [2, 3, 6, 7]);
    this.salt = r.int(0, 999);
    this.funkBass = r.pick(FUNK_BASS);
    this.funkBass2 = r.pick(FUNK_BASS.filter((b) => b !== this.funkBass));
  }

  /** Writes a phrase of eight bars into the melody from bar `at`: chord tones on strong beats, the
   *  pentatonic between, mostly small steps. `only` limits it to some of the bars. */
  private writePhrase(r: Rng, prog: number[], at: number, prob: (s: number) => number, oct: number, only?: number[]) {
    for (let b = 0; b < 8; b++) {
      if (only && !only.includes(b)) continue;
      const lead = new Array(16).fill(-1), len = new Array(16).fill(0);
      const chord = prog[b % 4];
      let last = -1, prev = this.note(chord, oct);
      for (let s = 0; s < 16; s++) {
        if (r.next() < prob(s) || (b === 7 && s === 0)) {
          let cands: number[] = [];
          for (let k = 0; k < 3; k++) for (let o = 0; o < 2; o++) cands.push(this.note(chord + 2 * k, oct + o - (k > 0 ? 1 : 0)));
          if (s % 4 !== 0) for (const pd of this.penta) for (let o = 0; o < 2; o++) cands.push(this.note(pd, oct + o - 1));
          const home = this.note(0, oct);
          cands = cands.filter((n) => Math.abs(n - home) <= 14);
          let pick = r.pick(cands);
          if (r.chance(0.65)) { cands.sort((a, c) => Math.abs(a - prev) - Math.abs(c - prev)); pick = cands[Math.min(r.int(1, 3), cands.length - 1)]; }
          if (b === 7 && s === 0) pick = home;
          lead[s] = pick; prev = pick;
          if (last >= 0) len[last] = s - last;
          last = s;
        }
      }
      if (last >= 0) len[last] = 16 - last;
      this.lead[at + b] = lead; this.leadLen[at + b] = len;
    }
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
      chord: 0, lb: 0, lastBuildBar: sec === "build" && this.bar % 8 === 7,
      form: 0, arp: this.arp, arpWave: this.st.arp, leadWave: this.st.lead, bassKind: this.st.bass,
    };
    // Which block: A, B or C (eight bars each, in the order A B A C).
    const b8 = ((this.bar % 8) + 8) % 8;
    k.form = FORM[((Math.floor(this.bar / 8) % FORM.length) + FORM.length) % FORM.length];
    k.chord = (k.form === 1 ? this.prog2 : this.prog)[b8 % 4];
    k.lb = k.form * 8 + b8;
    if (k.form === 1) { k.arp = this.arp2; k.arpWave = this.arpWave2; k.leadWave = this.leadWave2; k.bassKind = this.bassAlt; }
    // Every mode that can be heard plays its own arrangement of the song into its own bus.
    for (const m of MODES) {
      const bus = this.buses[m];
      if (this.mixAt(bus, t) < 0.02) continue;
      this.bus = bus;
      if (this.st.genre) this.stepGenre(k, m);
      else if (m === "cruise") this.stepCruise(k);
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
    if (this.drumVar === 0 && drop && k.form === 0 && this.bar % 4 === 3 && s >= 12) Sn(0.35 + 0.1 * (s - 12));
    if (lastBuildBar && s >= 8) Sn(0.3 + 0.05 * (s - 8));
    if (k.form === 2 && kickOn && (drop || build) && s === this.kickExtra) K();
    this.extras(k);

    // Bass
    const root = this.note(chord, -1);
    if (!brk || k.bassKind === Bass.Sustain) {
      switch (k.bassKind) {
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
      const idx = k.arp[s];
      this.voice(t, this.note(chord + 2 * (idx % 3), 1 + Math.floor(idx / 3)), (stepDur * this.arpEvery) / 2, k.arpWave, 0.09, 700 + 2000 * st.bright, 3000 * st.bright, 0.002, 0.09, 0, true, true);
    }
    // Lead (drops)
    if (drop) {
      const b = k.lb;
      if (this.lead[b][s] >= 0) {
        const len = Math.max(1, this.leadLen[b][s]) * stepDur - stepDur / 3;
        this.voice(t, this.lead[b][s], len, k.leadWave, 0.13, 900 + 1800 * st.bright, 2500 * st.bright, 0.008, 0.25, 0.6, false, true);
        // C blocks: the lead doubled an octave up, quietly.
        if (k.form === 2) this.voice(t, this.lead[b][s] + 12, len, "pulse", 0.045, 1500 + 1500 * st.bright, 2000, 0.008, 0.2, 0.5, false, false);
      }
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
    this.extras(k, true);
    // Fast arp, every step, an octave higher every other bar.
    if (!brk) {
      const idx = k.arp[s];
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
    this.extras(k, true);
    // Arp across two octaves, every step.
    const idx = k.arp[s];
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
      const idx = k.arp[s];
      this.voice(t, this.note(chord + 2 * (idx % 3), 1 + Math.floor(idx / 3)), dur * 1.5, "bell", 0.05, 1600, 800, 0.003, 0.4, 0, false, true);
    }
    if (s % 4 === 0 && this.bar % 2 === 1) {
      const n = this.lead[k.lb][s];
      if (n >= 0) this.voice(t, n + 12, dur * 3, "bell", 0.07, 2200 + 1000 * st.bright, 800, 0.004, 0.6, 0.2, false, true);
    }
  }

  /** Fills every four bars, a percussion layer and a crash at the top of each block. `driving`: the boss
   *  and tunnel versions (percussion all the time). */
  private extras(k: StepCtx, driving = false) {
    const { t, s, drop, build, brk, intro, form, lastBuildBar } = k;
    if (brk || intro) return;
    if (drop && s === 0 && this.bar % 8 === 0) this.crash(t);
    // Fills (not where the build's own roll is, nor in A blocks of the plain version, which keep their own).
    if ((drop || build) && !lastBuildBar && this.bar % 4 === 3 && s >= 12 && (driving || form !== 0)) {
      const i = s - 12;
      if (this.fill === 0) this.tom(t, [220, 180, 150, 120][i], 0.8);
      else if (this.fill === 1) this.snare(t, 0.35 + 0.15 * i, false);
      else if (i % 2 === 0) this.kick(t); else this.tom(t, i === 1 ? 190 : 130, 0.8);
    }
    // Percussion: in drops, and builds outside A blocks.
    if (!(drop || (build && (driving || form !== 0)))) return;
    if (this.perc === 0) this.percHit(t, 0, s % 2 === 0 ? 0.5 : 1);
    else if (this.perc === 1) { if (s % 2 === 0) this.percHit(t, 1, s % 4 === 2 ? 1 : 0.55); }
    else if (this.percHits.includes(s)) this.percHit(t, this.perc, 0.8);
  }

  /** A deterministic 0..1 "random" number for this bar and \`x\` (so a song plays the same every time). */
  private rand(x: number): number {
    let h = (this.bar * 73856093) ^ (x * 19349663) ^ (this.salt * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** The other genres (jazz, baroque, orchestral, funk, samba, rock): their own band and patterns. Each
   *  plays all four versions: calm (I 0) stripped back, cruise (1), boss (2) and tunnel (3) driven harder. */
  private stepGenre(k: StepCtx, m: MusicMode) {
    const I = m === "calm" ? 0 : m === "cruise" ? 1 : m === "boss" ? 2 : 3;
    const { t, s, dur, drop, build, brk, intro, chord, form, lastBuildBar } = k;
    const ct = (i: number, o: number) => this.note(chord + 2 * i, o);  // chord tones: 0 root, 1 third, 2 fifth, 3 seventh, 4 ninth
    const lead = this.lead[k.lb][s], len = Math.max(1, this.leadLen[k.lb][s]) * dur - dur / 3;
    const full = I > 0 && (drop || I >= 2);  // the main part
    const quiet = I > 0 && (intro || brk);
    // The boss and tunnel versions: a kick on the beat (sixteenth hats in tunnels); a crash at each block.
    if (I >= 2 && !brk) { if (s % 4 === 0) this.kick(t); if (I === 3) this.hat(t, s % 2 ? 0.3 : 0.55, s % 4 === 2); }
    if (full && s === 0 && this.bar % 8 === 0) this.crash(t);
    if (lastBuildBar && I > 0 && s >= 8) this.snare(t, 0.25 + 0.06 * (s - 8), false);
    const melody = lead >= 0 && (full || (build && s < 8) || (I === 0 && s % 4 === 0));
    switch (this.st.genre) {
      case "jazz": {
        // A 16-step bar is two fast 4/4 bars: ride "spang-a-lang", hi-hat on 2 and 4, walking bass, piano comping.
        if (I > 0 && !intro) { const r4 = s % 4; if (r4 !== 1) this.percHit(t, 1, r4 === 0 ? 1 : r4 === 2 ? 0.7 : 0.45); }
        if ((I === 0 || intro) && s % 2 === 0) this.percHit(t, 0, 0.35);  // brushes
        if (I > 0 && s % 4 === 2) this.hat(t, 0.35, false);
        if (full && s % 2 === 1 && this.rand(s) < 0.14) this.snare(t, 0.22, false);  // ghost notes
        if (I >= 2 && s % 8 === 4) this.snare(t, 0.6, false);
        if (s % 2 === 0 && (I > 0 ? !brk : s % 8 === 0)) {
          const j = s / 2, b8 = k.lb % 8, nextRoot = this.note((form === 1 ? this.prog2 : this.prog)[(b8 + 1) % 4], -1);
          const n = j === 0 ? ct(0, -1) : j === 7 ? nextRoot + (this.rand(j) < 0.5 ? -1 : 1)
            : [ct(0, -1), ct(1, -1), ct(2, -1), ct(3, -1), this.note(chord + 1, -1), this.note(chord + 5, -1)][Math.floor(this.rand(j + 20) * 6)];
          this.inst(t, n, I === 0 ? dur * 7 : dur * 1.8, "upright", 0.8);
        }
        const comp = [[0, 6, 10], [3, 8, 14], [2, 7, 12], [0, 5, 11, 14]][(this.bar + this.salt) % 4];
        if (I === 0 ? s === 0 : !intro && comp.includes(s)) for (const n of [ct(1, 0), ct(3, 0), ct(4, 0)]) this.inst(t, n, I === 0 ? dur * 14 : dur * 1.2, "piano", 0.45);
        if (melody) this.inst(t, lead, len, I === 0 || form === 1 ? "piano" : form === 2 ? "flute" : "sax", I === 0 ? 0.6 : 1, true);
        break;
      }
      case "baroque": {
        // Harpsichord over broken chords, a cello line, strings, timpani on the main part.
        if (s % 2 === 0 && (I === 0 || !brk)) this.inst(t, [ct(0, 0), ct(2, 0), ct(1, 0), ct(2, 0)][(s / 2) % 4], dur * 1.8, "harpsi", I === 0 ? 0.5 : 0.75);
        if (s % 4 === 0 && (I > 0 || s % 8 === 0)) this.inst(t, s % 8 === 4 ? ct(2, -1) : ct(0, -1), dur * 3.5, "upright", 0.8);
        if (s === 0 && (I === 0 || !intro)) for (const i of [0, 1, 2]) this.inst(t, ct(i, 0), dur * 15, "strings", 0.7);
        if (I >= 2 || (full && form === 2)) this.inst(t, s % 4 === 2 ? ct(2, 0) : ct(0, 0), dur * 0.7, "strings", 0.5);  // spiccato
        if (full && (s === 0 || s === 8)) this.inst(t, s ? ct(2, -2) : ct(0, -1), dur * 3, "timp", 1);
        if (full && form === 2) this.inst(t, this.note(chord + k.arp[s], 1), dur * 0.9, "harpsi", 0.45);  // running sixteenths
        if (melody) this.inst(t, lead + (form === 2 ? 12 : 0), len, I === 0 || form === 0 ? "harpsi" : form === 1 ? "flute" : "strings", form === 2 ? 1.2 : 1, true);
        break;
      }
      case "orchestral": {
        // Strings ostinato, low strings, choir, brass melody, taiko and timpani.
        const ost = [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 0, 7, 0, 12];
        if (I === 0 ? s % 4 === 0 : !intro || s % 4 === 0) this.inst(t, ct(0, 0) + ost[s], I === 0 ? dur * 3.5 : dur * 0.7, "strings", I === 0 ? 0.4 : 0.55);
        if (s === 0) this.inst(t, ct(0, -1), dur * 15, "strings", 0.9);
        if (s === 0 && (I === 0 || build || full)) for (const i of [0, 1, 2]) this.inst(t, ct(i, 1), dur * 15, "choir", 0.8);
        if (build && s === 0) for (const i of [0, 1, 2]) this.inst(t, ct(i, 0), dur * 15, "brass", 0.5);
        if (full) {
          if ([0, 3, 6, 10, 12].includes(s) || (I >= 2 && s >= 14)) this.tom(t, 95, 0.9);  // taiko
          if (s === 0) this.inst(t, ct(0, -1), dur * 4, "timp", 1);
          if (this.bar % 4 === 3 && s >= 8) this.snare(t, 0.2 + 0.06 * (s - 8), false);
        }
        if (I === 0 && s % 2 === 0) this.inst(t, this.note(chord + k.arp[s], 1), dur * 2, "piano", 0.35);  // harp-like
        if (melody) {
          if (I === 0) this.inst(t, lead, len, "flute", 0.8, true);
          else if (form === 1) this.inst(t, lead + 12, len, "strings", 1.3, true);
          else { this.inst(t, lead, len, "brass", 1, true); if (form === 2) this.inst(t, lead + 12, len, "choir", 1); }
        }
        break;
      }
      case "funk": {
        // Tight drums with ghost notes, slap bass, clav chops, horn stabs.
        if (I > 0 && !intro) {
          if (!brk && (s === 0 || s === 10 || (s === 7 && this.salt % 2 === 1))) this.kick(t);
          if (s === 4 || s === 12) this.snare(t, 1, false);
          if (full && (s === 7 || s === 9 || s === 15)) this.snare(t, 0.22, false);
          this.hat(t, s % 2 ? 0.35 : 0.6, form === 2 ? s % 4 === 2 : s === 14);
        } else if (s % 2 === 0) this.hat(t, 0.3, false);
        if (I > 0 && !brk) {
          const c = (form === 1 ? this.funkBass2 : this.funkBass)[s];
          if (c !== ".") this.inst(t, c === "O" ? ct(0, -1) + 12 : c === "F" ? ct(2, -1) : ct(0, -1), dur * (c === "G" ? 0.4 : 0.9), "slap", c === "G" ? 0.4 : 1);
        } else if (s === 0 || s === 8) this.inst(t, ct(0, -1), dur * 7, "upright", 0.8);
        const clav = form === 1 ? "x..x..x.x..x..x." : "..x.x..x..x.x..x";
        if (I > 0 && !intro && clav[s] === "x") for (const n of [ct(1, 0), ct(3, 0)]) this.inst(t, n, dur * 0.5, "clav", 0.7);
        if (full && (form !== 0 || I >= 2) && (s === 6 || s === 14)) for (const i of [0, 1, 2]) this.inst(t, ct(i, 1), dur * 1.2, "brass", 0.55);
        if ((I === 0 || intro) && s === 0) for (const i of [1, 3, 4]) this.voice(t, ct(i, 0), dur * 14, "fm", 0.05, 2000, 500, 0.005, 1, 0.3, false, true);  // electric piano
        if (melody) {
          if (form === 2 && I > 0) this.voice(t, lead, len, "pulse", 0.11, 1500, 2000, 0.01, 0.2, 0.6, false, true);
          else this.inst(t, lead, len, form === 1 && I > 0 ? "brass" : "sax", I === 0 ? 0.6 : 1, true);
        }
        break;
      }
      case "samba": {
        // Surdo, tamborim, shaker, agogo; dotted bass; piano montuno; flute.
        if (I > 0 && !intro) {
          if (s % 8 === 4) this.tom(t, 75, 1); else if (s % 8 === 0) this.tom(t, 85, 0.45);
          if ([0, 3, 6, 8, 10, 13].includes(s)) this.percHit(t, 2, 0.7);
          this.percHit(t, 0, s % 4 === 3 ? 1 : 0.45);
          if (form === 1 && [0, 2, 5, 7, 10, 12].includes(s)) this.percHit(t, 3, 0.6);
        } else if (s % 2 === 0) this.percHit(t, 0, 0.3);
        if ([0, 6, 8, 14].includes(s) && (I === 0 || !brk)) this.inst(t, s % 8 === 6 ? ct(2, -1) : ct(0, -1), dur * 1.8, "upright", 0.9);
        const mont = form === 1 ? [0, 3, 6, 8, 11, 14] : [3, 6, 10, 13];
        if (I > 0 && !intro && mont.includes(s)) for (const i of [0, 1, 2]) this.inst(t, ct(i, 1), dur * 0.9, "piano", 0.42);
        if ((I === 0 || intro) && [0, 6, 10].includes(s)) for (const i of [0, 1, 3]) this.inst(t, ct(i, 0), dur * 2, "piano", 0.35);  // bossa chords
        if (melody) this.inst(t, lead + (form === 2 ? 12 : 0), len, form === 1 && I > 0 ? "brass" : "flute", 1, true);
        break;
      }
      default: {  // rock
        // Backbeat drums and tom fills, power chords (palm-muted eighths; held in B), root eighths, lead guitar.
        if (I > 0 && !intro) {
          if (!brk && (s === 0 || s === 8 || (full && (s === 10 || s === 3)))) this.kick(t);
          if (!brk && (s === 4 || s === 12)) this.snare(t, 1, false);
          if (form === 1) { if (s % 2 === 0) this.percHit(t, 1, s % 4 === 0 ? 1 : 0.6); } else if (s % 2 === 0) this.hat(t, 0.6, false);
          if (full && this.bar % 4 === 3 && s >= 12) this.tom(t, [200, 170, 140, 110][s - 12], 0.9);
        }
        const r0 = ct(0, 0), pw = [r0, r0 + 7, r0 + 12];
        if (I === 0 || quiet) { if (s % 2 === 0) this.inst(t, [ct(0, 0), ct(2, 0), ct(1, 1), ct(2, 0)][(s / 2) % 4], dur * 2, "piano", 0.65); if (s === 0) this.inst(t, ct(0, -1), dur * 15, "upright", 0.8); }
        else if (form === 1 ? s === 0 || s === 8 : s % 2 === 0) for (const n of pw) this.inst(t, n, form === 1 ? dur * 7.5 : dur * 0.8, "guitar", form === 1 ? 0.8 : 0.7);
        if (I > 0 && !quiet && s % 2 === 0) this.bass(t, ct(0, -1), dur * 0.9, false, "saw");
        if (melody) this.inst(t, lead, len, I === 0 ? "piano" : "guitar", I === 0 ? 0.6 : 1.1, true);
        break;
      }
    }
  }

  /** The genre instruments: piano, harpsichord, strings, brass, distorted guitar, flute, sax, clavinet,
   *  upright bass, slap bass, choir and timpani - each from oscillators, filters and envelopes. */
  private inst(t: number, midi: number, dur: number, kind: Inst, v: number, echo = false) {
    const c = ctx!, f = hz(midi), stop = t + dur + 1.5;
    const g = c.createGain(); g.connect(this.bus.out); if (echo) g.connect(this.delaySend);
    const env = (peak: number, a: number, decay: number, sus: number, rel: number) => {
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.setTargetAtTime(Math.max(0.0001, peak * sus), t + a, decay / 3);
      g.gain.setTargetAtTime(0.0001, t + Math.max(dur, a + 0.01), rel / 3);
    };
    const filt = (type: BiquadFilterType, fr: number, q = 0.7, to: AudioNode = g) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = fr; x.Q.value = q; x.connect(to); return x; };
    const play = (o: OscillatorNode, to: AudioNode, level = 1) => {
      if (level !== 1) { const lg = c.createGain(); lg.gain.value = level; o.connect(lg); lg.connect(to); } else o.connect(to);
      o.start(t); o.stop(stop);
      return o;
    };
    const vib = (o: OscillatorNode, cents: number) => {
      const l = c.createOscillator(); l.frequency.value = 5.2;
      const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(cents, t + 0.35);
      l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(stop);
    };
    switch (kind) {
      case "piano": { const x = filt("lowpass", 3200); play(this.osc("tri", f), x); play(this.osc("sine", f * 2), x, 0.35); env(0.2 * v, 0.004, 1.2, 0.15, 0.25); break; }
      case "harpsi": { const x = filt("highpass", 300, 0.7, filt("lowpass", 6000)); play(this.osc("saw", f), x); play(this.osc("square", f * 2), x, 0.25); env(0.08 * v, 0.002, 0.45, 0.05, 0.15); break; }
      case "strings": {
        const x = filt("lowpass", 2400);
        for (const d of [-9, 0, 9]) { const o = play(this.osc("saw", f), x); o.detune.value = d; vib(o, 12); }
        env(0.045 * v, Math.min(0.12, dur * 0.4), 1, 1, 0.5); break;
      }
      case "brass": {
        const x = filt("lowpass", 400);
        x.frequency.setValueAtTime(400, t); x.frequency.linearRampToValueAtTime(2600, t + 0.07); x.frequency.setTargetAtTime(1500, t + 0.07, 0.1);
        for (const d of [0, 7]) { const o = play(this.osc("saw", f), x); o.detune.value = d; vib(o, 10); }
        env(0.085 * v, 0.03, 0.9, 0.8, 0.3); break;
      }
      case "guitar": {
        const pre = c.createGain(); pre.gain.value = 4;
        const sh = c.createWaveShaper(); sh.curve = this.driveCurve(); sh.oversample = "2x";
        pre.connect(sh); sh.connect(filt("lowpass", 3200));
        play(this.osc("saw", f), pre); play(this.osc("saw", f * 1.003), pre);
        env(0.05 * v, 0.004, 1.5, 0.6, 0.15); break;
      }
      case "flute": {
        const x = filt("lowpass", 3000); vib(play(this.osc("sine", f), x), 15);
        const n = noiseSource(); const bp = filt("bandpass", f * 1.5, 2, x); const ng = c.createGain(); ng.gain.value = 0.15; n.connect(ng); ng.connect(bp); n.start(t); n.stop(stop);
        env(0.13 * v, 0.05, 1.5, 0.85, 0.25); break;
      }
      case "sax": { const x = filt("bandpass", 1300, 0.8, filt("lowpass", 3200)); vib(play(this.osc("saw", f), x), 18); env(0.2 * v, 0.025, 1.2, 0.75, 0.18); break; }
      case "clav": { const x = filt("highpass", 500, 0.7, filt("lowpass", 4500)); play(this.osc("pulse", f), x); env(0.09 * v, 0.002, 0.24, 0.1, 0.09); break; }
      case "upright": { const x = filt("lowpass", 900); play(this.osc("tri", f), x); play(this.osc("sine", f), x); env(0.32 * v, 0.006, 0.75, 0.3, 0.18); break; }
      case "slap": {
        const x = filt("lowpass", 3500, 2); x.frequency.setValueAtTime(3500, t); x.frequency.exponentialRampToValueAtTime(350, t + 0.1);
        play(this.osc("square", f), x); env(0.22 * v, 0.003, 0.45, 0.35, 0.12); break;
      }
      case "choir": { const x = filt("lowpass", 1800); for (const d of [0, 6]) { const o = play(this.osc("sine", f), x); o.detune.value = d; vib(o, 10); } play(this.osc("tri", f * 2), x, 0.25); env(0.05 * v, 0.25, 3, 1, 1.2); break; }
      case "timp": {
        const o = this.osc("sine", f); o.frequency.setValueAtTime(f * 1.12, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        play(o, filt("lowpass", 600)); env(0.5 * v, 0.004, 1.3, 0.0001, 0.9); break;
      }
    }
  }

  private curve?: Float32Array;
  /** A soft-clipping curve for the guitar's overdrive. */
  private driveCurve(): Float32Array {
    if (!this.curve) { const n = 1024; this.curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; this.curve[i] = Math.tanh(x * 3); } }
    return this.curve;
  }

  // --- Instruments ---
  private percHit(t: number, kind: number, v: number) {
    const c = ctx!;
    if (kind === 3) {
      // Cowbell: two square waves, band-passed.
      for (const f of [540, 800]) {
        const o = this.osc("square", f), bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 1.5;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(bp); bp.connect(g); g.connect(this.bus.out); o.start(t); o.stop(t + 0.2);
      }
      return;
    }
    // Shaker, ride or rim: filtered noise.
    const [type, freq, q, dec, lvl]: [BiquadFilterType, number, number, number, number] =
      kind === 0 ? ["bandpass", 6500, 1.2, 0.05, 0.1] : kind === 1 ? ["highpass", 8500, 0.5, 0.4, 0.06] : ["bandpass", 1800, 5, 0.035, 0.4];
    const n = noiseSource(), f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(lvl * v, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    n.connect(f); f.connect(g); g.connect(this.bus.out); n.start(t); n.stop(t + dec + 0.02);
  }
  private tom(t: number, f: number, v: number) {
    const c = ctx!;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(this.bus.out); o.start(t); o.stop(t + 0.35);
  }
  private crash(t: number) {
    const c = ctx!;
    const n = noiseSource(), f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 5000;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(f); f.connect(g); g.connect(this.bus.out); n.start(t); n.stop(t + 1.7);
  }
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
    if (wave === "supersaw") {
      for (const d of [0.992, 1, 1.008]) { const o = this.osc("saw", f * d); o.connect(filt); o.start(t); o.stop(t + dur + 0.4); }
    } else if (wave === "fm") {
      // A sine carrier, its pitch wobbled by a sine an octave up whose depth dies away: an electric-piano bite.
      const car = this.osc("sine", f), mod = this.osc("sine", f * 2), mg = c.createGain();
      mg.gain.setValueAtTime(f * 2.5, t); mg.gain.exponentialRampToValueAtTime(f * 0.2, t + 0.3);
      mod.connect(mg); mg.connect(car.frequency); car.connect(filt);
      car.start(t); mod.start(t); car.stop(t + dur + 0.4); mod.stop(t + dur + 0.4);
    } else if (wave === "organ") {
      for (const [m, v] of [[1, 1], [2, 0.5], [3, 0.3], [4, 0.15]]) {
        const o = this.osc("sine", f * m), og = c.createGain(); og.gain.value = v;
        o.connect(og); og.connect(filt); o.start(t); o.stop(t + dur + 0.4);
      }
    } else if (wave === "bell") {
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
