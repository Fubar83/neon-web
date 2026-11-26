// Audio: one context, a music bus and an effects bus, a room reverb, and synthesized sound effects
// panned by where they happen on screen. Nothing is loaded: every sound is made from oscillators and noise.

export let ctx: AudioContext | null = null;
export let musicBus: GainNode;
export let sfxBus: GainNode;
let reverb: ConvolverNode;
let reverbSend: GainNode;
let noiseBuf: AudioBuffer;

/** Starts audio (browsers need a key press or click first). */
export function initAudio(): AudioContext {
  if (ctx) return ctx;
  // iPhone: play through the silent switch (Web Audio otherwise counts as "ringer" sound and stays mute).
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try { if (nav.audioSession) nav.audioSession.type = "playback"; } catch { /* older browsers */ }
  ctx = new AudioContext({ latencyHint: "interactive" });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(comp);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(comp);
  reverb = ctx.createConvolver();
  reverbSend = ctx.createGain(); reverbSend.gain.value = 0.35;
  reverbSend.connect(reverb); reverb.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  setRoom(1.4, 0.8);
  return ctx;
}

export function noiseSource(): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.loopStart = Math.random();
  return s;
}

/** The room: a generated impulse (decay seconds, brightness 0..1). */
export function setRoom(decay: number, bright: number) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * Math.min(5, decay));
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * (0.15 + 0.85 * bright);  // darker rooms lose the highs
      data[i] = lp * Math.exp((-6.9 * t) / decay) * (t < 0.01 ? t / 0.01 : 1);
    }
  }
  reverb.buffer = ir;
}

// ---------------------------------------------------------------------------------------
// Sound effects

export type Sfx = "playerShot" | "enemyShot" | "hit" | "boomSmall" | "boomBig" | "powerUp" | "hurt" | "shield" | "warning" | "whoosh" | "menuMove" | "menuSelect" | "laser" | "lightning" | "missile" | "shock" | "lava" | "coin";

const minGap: Partial<Record<Sfx, number>> = { playerShot: 0.07, enemyShot: 0.06, hit: 0.05, boomSmall: 0.04, boomBig: 0.15, laser: 0.12, lightning: 0.08, missile: 0.08, shock: 0.1, lava: 0.1, coin: 0.035 };
const last: Partial<Record<Sfx, number>> = {};

/** Plays a sound effect; X (-1 left .. 1 right) pans it to where it happens. */
export function sfx(name: Sfx, x = 0, volume = 1, pitch = 1) {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const gap = minGap[name] ?? 0;
  if (gap && last[name] !== undefined && now - last[name]! < gap) return;
  last[name] = now;
  pitch *= 0.94 + Math.random() * 0.12;
  const out = ctx.createGain();
  out.gain.value = volume;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, x));
  out.connect(pan); pan.connect(sfxBus); pan.connect(reverbSend);
  const t = now;
  const env = (g: GainNode, peak: number, dur: number, attack = 0.002) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };
  const osc = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode = out) => {
    const o = ctx!.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), t + dur);
    const g = ctx!.createGain(); env(g, peak, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  };
  const noise = (type: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, q = 1) => {
    const n = noiseSource();
    const f = ctx!.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx!.createGain(); env(g, peak, dur);
    n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + dur + 0.05);
  };
  switch (name) {
    case "playerShot": osc("square", 2000, 600, 0.07, 0.12); break;
    case "enemyShot": osc("triangle", 860, 260, 0.1, 0.25); break;
    case "hit": noise("bandpass", 3000, 1500, 0.035, 0.3, 2); osc("sine", 1300, 1200, 0.03, 0.15); break;
    case "boomSmall": osc("sine", 145, 50, 0.4, 0.8); noise("lowpass", 4000, 150, 0.5, 0.9); break;
    case "boomBig": osc("sine", 130, 36, 1.2, 0.9); noise("lowpass", 2500, 100, 1.6, 1.0); break;
    case "powerUp": [72, 76, 79, 84].forEach((m, i) => { const f = 440 * 2 ** ((m - 69) / 12); const o = ctx!.createOscillator(); o.type = "square"; o.frequency.value = f * pitch; const g = ctx!.createGain(); const s = t + i * 0.07; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, s + (i === 3 ? 0.3 : 0.1)); o.connect(g); g.connect(out); o.start(s); o.stop(s + 0.35); }); break;
    case "hurt": osc("square", 90, 50, 0.3, 0.3); noise("lowpass", 1800, 400, 0.25, 0.6); break;
    case "shield": osc("sine", 1320, 1320, 0.4, 0.3); osc("sine", 3960, 3960, 0.15, 0.1); break;
    case "warning": for (let i = 0; i < 4; i++) { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = i % 2 ? 495 : 660; const f = ctx.createBiquadFilter(); f.frequency.value = 2500; const g = ctx.createGain(); const s = t + i * 0.16; g.gain.setValueAtTime(0.12, s); g.gain.setValueAtTime(0.0001, s + 0.15); o.connect(f); f.connect(g); g.connect(out); o.start(s); o.stop(s + 0.16); } break;
    case "whoosh": noise("bandpass", 300, 4000, 0.7, 0.6, 0.8); break;
    case "menuMove": osc("square", 1100, 1000, 0.045, 0.08); break;
    case "menuSelect": osc("square", 500, 2000, 0.3, 0.12); osc("sine", 1000, 4000, 0.3, 0.1); break;
    case "laser": osc("sawtooth", 180, 170, 0.3, 0.15); osc("sawtooth", 183, 172, 0.3, 0.15); break;
    case "missile": noise("bandpass", 900, 3200, 0.2, 0.3, 1.5); osc("sine", 500, 1500, 0.15, 0.06); break;
    case "coin": osc("sine", 1800, 1900, 0.06, 0.12); osc("sine", 2700, 2800, 0.12, 0.08); break;
    case "shock": osc("sine", 240, 60, 0.4, 0.35); noise("lowpass", 2200, 180, 0.35, 0.35); break;
    case "lava": osc("square", 130, 55, 0.28, 0.18); noise("lowpass", 1400, 250, 0.3, 0.45); break;
    case "lightning": noise("highpass", 2000, 6000, 0.28, 0.5); osc("sine", 2400, 1700, 0.25, 0.08); break;
  }
}
