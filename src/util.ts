// Small helpers: a seeded random stream, keyboard input, maths.

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 1; }
  next(): number {
    // mulberry32
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number) { return this.next() < p; }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Keyboard state (held keys, keys pressed this frame), plus touch: an on-screen stick and buttons act as keys. */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  constructor() {
    window.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) e.preventDefault();
      if (!this.held.has(e.code)) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
  }
  /** The touch stick (-1..1 each way), or null when not touched. */
  stick: { x: number; y: number } | null = null;
  /** Touch buttons: hold a key down, let it go, or tap it for one frame. */
  press(code: string) { if (!this.held.has(code)) this.pressed.add(code); this.held.add(code); }
  release(code: string) { this.held.delete(code); }
  tap(code: string) { this.pressed.add(code); }
  down(...codes: string[]) { return codes.some((c) => this.held.has(c)); }
  hit(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }
  endFrame() { this.pressed.clear(); }
  /** Movement from WASD / arrows (and a gamepad's left stick). */
  move(): { x: number; y: number } {
    let x = (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0);
    let y = (this.down("KeyW", "ArrowUp") ? 1 : 0) - (this.down("KeyS", "ArrowDown") ? 1 : 0);
    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      if (Math.abs(pad.axes[0]) > 0.2) x = pad.axes[0];
      if (Math.abs(pad.axes[1]) > 0.2) y = -pad.axes[1];
    }
    if (this.stick) { x = this.stick.x; y = this.stick.y; }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  fire() {
    const pad = navigator.getGamepads?.()[0];
    return this.down("KeyJ", "KeyZ") || !!(pad && (pad.buttons[7]?.pressed || pad.buttons[0]?.pressed));
  }
  /** The secondary weapon: Space (or K / X; a gamepad's left trigger or B). */
  fire2() {
    const pad = navigator.getGamepads?.()[0];
    return this.down("Space", "KeyK", "KeyX") || !!(pad && (pad.buttons[6]?.pressed || pad.buttons[1]?.pressed));
  }
}
