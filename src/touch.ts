// Touch controls for phones and tablets, played with two thumbs: a steering area on the left (touch
// anywhere there and drag: a stick appears under your thumb) and the SPECIAL button on the right (the
// secondary weapon). The primary weapons fire by themselves at enemies. SHOP and full screen are small
// buttons on the right edge. Buttons act as keys on the shared Input. Shown only on touch screens (or with
// ?touch in the address).
import type { Input } from "./util";

export type TouchMode = "play" | "tunnel" | "hidden";

export class TouchControls {
  readonly enabled: boolean;
  private root: HTMLElement;
  private base: HTMLElement; private knob: HTMLElement;
  private sec: HTMLElement; private secLabel: HTMLElement;
  private shop: HTMLElement;
  private mode: TouchMode = "hidden";

  constructor(private input: Input) {
    // Phones and tablets (a touch-first pointer); a laptop with a touch screen keeps the keyboard controls.
    this.enabled = new URLSearchParams(location.search).has("touch") || matchMedia("(pointer: coarse)").matches;
    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.innerHTML = `
      <div id="steer"><div class="tbase"><div class="tknob"></div></div><div class="thint">STEER</div></div>
      <div id="tsec" class="tbtn big"><span>SPECIAL</span></div>
      <div id="tshop" class="tbtn small"><span>SHOP</span></div>
      <div id="tfs" class="tbtn small" data-fs data-fs-icon="1">&#x26F6;</div>`;
    document.getElementById("stage")!.appendChild(this.root);
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.base = $(".tbase"); this.knob = $(".tknob");
    this.sec = $("#tsec"); this.secLabel = $("#tsec span");
    this.shop = $("#tshop");
    this.root.style.display = "none";
    if (!this.enabled) return;
    this.steering($("#steer"));
    this.hold(this.sec, "Space");
    this.shop.addEventListener("pointerdown", (e) => { e.preventDefault(); this.input.tap("KeyP"); });
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
  private hold(el: HTMLElement, code: string) {
    let id = -1;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch { /* not a real pointer */ } el.classList.add("on"); this.input.press(code); });
    const up = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; el.classList.remove("on"); this.input.release(code); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  /** What to show: the play controls, steering only in tunnels, or nothing (menus, pause). */
  update(mode: TouchMode, secondary: string | null, ready01: number) {
    if (!this.enabled) return;
    if (mode !== this.mode) {
      this.mode = mode;
      this.root.style.display = mode === "hidden" ? "none" : "block";
      if (mode === "hidden") { this.input.stick = null; this.input.release("Space"); }
      this.sec.style.display = mode === "play" ? "flex" : "none";
      this.shop.style.display = mode === "play" ? "flex" : "none";
    }
    if (mode === "play") {
      this.secLabel.textContent = secondary ?? "NO SPECIAL";
      this.sec.classList.toggle("none", !secondary);
      this.sec.style.setProperty("--ready", `${Math.round(Math.max(0, Math.min(1, ready01)) * 360)}deg`);
      this.sec.classList.toggle("ready", !!secondary && ready01 >= 1);
    }
  }
}
