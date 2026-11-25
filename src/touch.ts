// Touch controls for phones and tablets. Two ways to steer:
// - TILT (the default where the phone has a tilt sensor): tilt the phone like a marble board, relative to
//   how you held it when the run started (RECENTER sets that again). Both thumbs are free: FIRE (left,
//   hold to fire the primary weapons) and SPECIAL (right, the secondary weapon).
// - STICK: touch anywhere on the left half and drag (a stick appears under the thumb); the primaries fire
//   by themselves at enemies; SPECIAL on the right.
// In tunnels the right button brakes. Buttons act as keys on the shared Input. Shown only on touch screens
// (or with ?touch in the address).
import type { Input } from "./util";

export type TouchMode = "play" | "tunnel" | "hidden";
type Steer = "tilt" | "stick";

const DEAD = 2, FULL = 16;  // tilt: degrees ignored around level, and the tilt for full speed

export class TouchControls {
  readonly enabled: boolean;
  private root: HTMLElement;
  private steerZone: HTMLElement;
  private base: HTMLElement; private knob: HTMLElement;
  private fire: HTMLElement; private sec: HTMLElement; private secLabel: HTMLElement;
  private shop: HTMLElement; private recenterBtn: HTMLElement;
  private mode: TouchMode = "hidden";
  private steer: Steer;
  private secKey = "Space";
  // Tilt sensor
  private tiltSeen = false; private tiltFailed = false; private playTime = 0;
  private last: { b: number; g: number } | null = null;
  private neutral: { b: number; g: number } | null = null;

  constructor(private input: Input) {
    // Phones and tablets (a touch-first pointer); a laptop with a touch screen keeps the keyboard controls.
    this.enabled = new URLSearchParams(location.search).has("touch") || matchMedia("(pointer: coarse)").matches;
    this.steer = localStorage.getItem("neon.steer") === "stick" ? "stick" : "tilt";
    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.innerHTML = `
      <div id="steer"><div class="tbase"><div class="tknob"></div></div><div class="thint">STEER</div></div>
      <div id="tfire" class="tbtn big"><span>FIRE</span></div>
      <div id="tsec" class="tbtn big"><span>SPECIAL</span></div>
      <div id="tshop" class="tbtn small"><span>SHOP</span></div>
      <div id="tfs" class="tbtn small" data-fs data-fs-icon="1">&#x26F6;</div>
      <div id="trec" class="tbtn small"><span>RE-<br />CENTER</span></div>`;
    document.getElementById("stage")!.appendChild(this.root);
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.steerZone = $("#steer");
    this.base = $(".tbase"); this.knob = $(".tknob");
    this.fire = $("#tfire"); this.sec = $("#tsec"); this.secLabel = $("#tsec span");
    this.shop = $("#tshop"); this.recenterBtn = $("#trec");
    this.root.style.display = "none";
    if (!this.enabled) { document.querySelectorAll<HTMLElement>("[data-steer]").forEach((b) => (b.style.display = "none")); return; }
    this.steering(this.steerZone);
    this.hold(this.fire, () => "KeyJ");
    this.hold(this.sec, () => this.secKey);
    this.shop.addEventListener("pointerdown", (e) => { e.preventDefault(); this.input.tap("KeyP"); });
    this.recenterBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); this.recenter(); });
    window.addEventListener("deviceorientation", (e) => {
      if (e.beta === null || e.gamma === null) return;
      this.tiltSeen = true;
      this.last = { b: e.beta, g: e.gamma };
      if (!this.neutral) this.neutral = { ...this.last };
      this.applyTilt();
    });
    // The STEERING switch (menu, pause): tap to change; labels kept in step.
    document.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest("[data-steer]")) return;
      this.steer = this.steer === "tilt" ? "stick" : "tilt";
      localStorage.setItem("neon.steer", this.steer);
      this.tiltFailed = false; this.playTime = 0;
      if (this.steer === "tilt") this.requestTilt();
      this.label();
    });
    new MutationObserver(() => this.label()).observe(document.body, { childList: true, subtree: true });
    this.label();
  }

  /** Steering by tilt right now (chosen, and the phone has a tilt sensor that's sending). */
  get tilting() { return this.enabled && this.steer === "tilt" && !this.tiltFailed; }

  /** With tilt steering the primaries fire on the FIRE button instead of by themselves. */
  get manualFire() { return this.tilting; }

  /** iPhones ask permission for the tilt sensor; this must run from a tap. */
  requestTilt() {
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (this.enabled && this.steer === "tilt" && D?.requestPermission) D.requestPermission().catch(() => {});
  }

  /** "Level" is how the phone is held now. */
  recenter() { this.neutral = this.last ? { ...this.last } : null; this.input.stick = this.tilting && this.mode !== "hidden" ? { x: 0, y: 0 } : this.input.stick; }

  /** Tilt as a marble board: lower the right edge to go right, the top edge (away from you) to go up. */
  private applyTilt() {
    if (!this.tilting || this.mode === "hidden" || !this.last || !this.neutral) return;
    const db = this.last.b - this.neutral.b, dg = this.last.g - this.neutral.g;
    const angle = (((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) % 360) + 360) % 360;
    let x = 0, y = 0;
    if (angle === 90) { x = db; y = dg; }
    else if (angle === 270) { x = -db; y = -dg; }
    else if (angle === 180) { x = -dg; y = db; }
    else { x = dg; y = -db; }
    const f = (v: number) => Math.sign(v) * Math.min(1, Math.max(0, (Math.abs(v) - DEAD) / (FULL - DEAD)));
    this.input.stick = { x: f(x), y: f(y) };
  }

  private label() {
    document.querySelectorAll<HTMLElement>("[data-steer]").forEach((b) => {
      const t = this.enabled ? `STEERING: ${this.steer === "tilt" ? (this.tiltFailed ? "TILT (NO SENSOR)" : "TILT") : "STICK"}` : "";
      if (b.textContent !== t) b.textContent = t;
      const show = this.enabled ? "" : "none";
      if (b.style.display !== show) b.style.display = show;
    });
  }

  /** The steering area: the stick's centre is where the thumb lands; dragging steers (full speed at ~70 px). */
  private steering(zone: HTMLElement) {
    let id = -1, ox = 0, oy = 0;
    const r = () => Math.max(50, Math.min(90, innerHeight * 0.16));
    const place = (x: number, y: number) => { this.base.style.left = `${x}px`; this.base.style.top = `${y}px`; };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.input.stick = null;
      this.knob.style.transform = "translate(-50%, -50%)";
      zone.classList.remove("on");
      this.idle();
    };
    zone.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (id !== -1) return;
      id = e.pointerId;
      try { zone.setPointerCapture(id); } catch { /* not a real pointer */ }
      const b = zone.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      place(ox - b.left, oy - b.top);
      zone.classList.add("on");
      this.input.stick = { x: 0, y: 0 };
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - ox) / r(), dy = (e.clientY - oy) / r();
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      const dead = 0.12;
      this.input.stick = Math.hypot(dx, dy) < dead ? { x: 0, y: 0 } : { x: dx, y: -dy };
      this.knob.style.transform = `translate(calc(-50% + ${dx * r()}px), calc(-50% + ${dy * r()}px))`;
    });
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
    this.idle();
  }

  /** Where the stick rests when not touched: low on the left, as a hint. */
  private idle() {
    this.base.style.left = "22%"; this.base.style.top = "72%";
  }

  /** A button that holds a key down while touched. */
  private hold(el: HTMLElement, code: () => string) {
    let id = -1, held = "";
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch { /* not a real pointer */ } el.classList.add("on"); held = code(); this.input.press(held); });
    const up = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; el.classList.remove("on"); this.input.release(held); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  /** What to show: the play controls, the tunnel ones (steer + brake), or nothing (menus, pause). */
  update(mode: TouchMode, secondary: string | null, ready01: number, dt = 1 / 60) {
    if (!this.enabled) return;
    if (mode !== "hidden") this.playTime += dt;
    // Tilt chosen but nothing from the sensor after a moment: fall back to the stick.
    if (this.steer === "tilt" && !this.tiltSeen && !this.tiltFailed && this.playTime > 1.5) { this.tiltFailed = true; this.label(); this.mode = "hidden"; }
    if (mode !== this.mode) {
      const was = this.mode;
      this.mode = mode;
      this.root.style.display = mode === "hidden" ? "none" : "block";
      if (mode === "hidden") { this.input.stick = null; for (const k of ["Space", "ShiftLeft", "KeyJ"]) this.input.release(k); }
      else if (was === "hidden" && this.tilting) this.recenter();  // a run starts or resumes: level is how it's held now
      const tilt = this.tilting;
      this.steerZone.style.display = tilt ? "none" : "block";
      this.fire.style.display = tilt && mode === "play" ? "flex" : "none";
      this.recenterBtn.style.display = tilt ? "flex" : "none";
      this.shop.style.display = mode === "play" ? "flex" : "none";
      this.secKey = mode === "tunnel" ? "ShiftLeft" : "Space";
      this.sec.classList.toggle("brake", mode === "tunnel");
      if (mode === "tunnel") { this.secLabel.textContent = "BRAKE"; this.sec.classList.remove("none", "ready"); this.sec.style.setProperty("--ready", "360deg"); }
    }
    if (mode === "play") {
      this.secLabel.textContent = secondary ?? "NO SPECIAL";
      this.sec.classList.toggle("none", !secondary);
      this.sec.style.setProperty("--ready", `${Math.round(Math.max(0, Math.min(1, ready01)) * 360)}deg`);
      this.sec.classList.toggle("ready", !!secondary && ready01 >= 1);
    }
  }

  /** For tests: pretend the tilt sensor reports this. */
  fakeTilt(b: number, g: number) {
    this.tiltSeen = true;
    this.last = { b, g };
    if (!this.neutral) this.neutral = { ...this.last };
    this.applyTilt();
  }
}
