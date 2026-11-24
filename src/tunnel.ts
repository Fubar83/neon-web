// A tunnel dive: a round neon tube seen from right behind the ship, which stays at the bottom centre
// while the tube turns around it. Mostly long straights with a gentle bend now and then; an empty
// warm-up first; obstacles come in groups of the same shape at a steady spacing while the free gap
// moves in a steady pattern; nothing inside or just after a bend. Hitting a block ends the run.
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { disposeMaterial, lineMaterial, polylines, segments } from "./neon";
import { Input, Rng, clamp } from "./util";
import { sfx } from "./audio";

const WALL = 600, SHIP_R = 420, STEP = 100, BLOCK_DEPTH = 300, BLOCK_IN = 380;
const SHIP_HALF = 70 / SHIP_R;  // the ship's half-width as an angle
const COLORS = [0x19e6ff, 0xff1acc, 0x73ff1a, 0xff8c0d];

interface Arc { s0: number; s1: number; mid: number; half: number }
export type TunnelResult = "running" | "cleared" | "crashed";

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class TunnelRun {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 16 / 9, 5, 30000);
  s = 0; theta = 0; speed = 0; time = 0;
  hurt = false;
  readonly firstObstacle: number;
  private pos: THREE.Vector3[] = []; private fwd: THREE.Vector3[] = []; private right: THREE.Vector3[] = []; private up: THREE.Vector3[] = [];
  private bend: number[] = [];
  private arcs: Arc[] = [];
  private mats: LineMaterial[] = [];
  private obstacleMat: LineMaterial;
  private ship: THREE.Group;
  private shipMat: LineMaterial;
  private thetaVel = 0;
  private warned = false;

  constructor(readonly length: number, seed: number, simplicity: number, skill: number) {
    const r = new Rng(seed);
    const ease = clamp(simplicity + (skill === 0 ? 0.35 : skill === 2 ? -0.25 : 0), 0, 1);
    this.buildPath(r, ease);
    this.buildTube();
    this.obstacleMat = lineMaterial(0xff1408, 4, 3);
    this.mats.push(this.obstacleMat);
    this.firstObstacle = Math.min(length * 0.25, 36000);
    this.buildObstacles(r, ease);
    this.shipMat = lineMaterial(0xbff8ff, 3, 2.2);
    this.mats.push(this.shipMat);
    const hull = [[0, 46], [12, 10], [40, -18], [40, -28], [12, -18], [8, -30], [-8, -30], [-12, -18], [-40, -28], [-40, -18], [-12, 10]].map(([x, y]) => new THREE.Vector3(x, y, 0));
    this.ship = new THREE.Group();
    const body = polylines([hull], true, this.shipMat);
    body.rotation.x = -Math.PI / 2 + 0.55;  // nose along the ship's forward, tipped up so the camera behind sees its shape
    body.scale.setScalar(1.5);
    this.ship.add(body);
    this.scene.add(this.ship);
  }

  dispose() { this.mats.forEach(disposeMaterial); }

  // --- The path: a frame every STEP along it ---
  private buildPath(r: Rng, ease: number) {
    const n = Math.ceil((this.length + 9000) / STEP);
    let p = new THREE.Vector3(), f = new THREE.Vector3(0, 0, -1), rt = new THREE.Vector3(1, 0, 0), u = new THREE.Vector3(0, 1, 0);
    let secEnd = 3000, k = 0, phi = 0, secStart = 0;
    for (let i = 0; i < n; i++) {
      const s = (i - 30) * STEP;
      this.pos.push(p.clone()); this.fwd.push(f.clone()); this.right.push(rt.clone()); this.up.push(u.clone());
      if (s >= secEnd && s < this.length) {
        secStart = s;
        // Mostly long straights; a gentle bend now and then (and home toward the main direction).
        const dev = Math.acos(clamp(-f.z, -1, 1));
        const bendNow = dev > 0.4 || r.next() > 0.55 + ease * 0.25;
        if (bendNow) {
          secEnd = s + r.range(2800, 4800);
          k = (1 - 0.45 * ease) / r.range(6500, 10000);
          if (dev > 0.25) { const home = new THREE.Vector3(0, 0, -1).addScaledVector(f, f.z).normalize(); phi = Math.atan2(home.dot(u), home.dot(rt)); }
          else phi = r.range(0, Math.PI * 2);
        } else { secEnd = s + r.range(4500, 9000); k = 0; }
      }
      const ramp = Math.min(smooth(secStart, secStart + 1000, s), 1 - smooth(secEnd - 1000, secEnd, s));
      const kk = k * ramp;
      this.bend.push(kk);
      const nf = f.clone().addScaledVector(rt.clone().multiplyScalar(Math.cos(phi)).addScaledVector(u, Math.sin(phi)), kk * STEP).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(f, nf);
      f = nf; rt.applyQuaternion(q); u.applyQuaternion(q);
      rt.addScaledVector(f, -rt.dot(f)).normalize();
      u = new THREE.Vector3().crossVectors(rt, f).normalize();
      p = p.clone().addScaledVector(f, STEP);
    }
  }

  private idx(s: number) { return clamp(Math.floor(s / STEP) + 30, 0, this.pos.length - 2); }
  private frame(s: number) {
    const i = this.idx(s), t = clamp(s / STEP + 30 - i, 0, 1);
    return {
      p: this.pos[i].clone().lerp(this.pos[i + 1], t),
      f: this.fwd[i].clone().lerp(this.fwd[i + 1], t).normalize(),
      r: this.right[i].clone().lerp(this.right[i + 1], t).normalize(),
      u: this.up[i].clone().lerp(this.up[i + 1], t).normalize(),
    };
  }
  /** A point on the tube: distance S along it, angle around it, distance from its axis. */
  point(s: number, theta: number, rad: number) {
    const fr = this.frame(s);
    return fr.p.addScaledVector(fr.r, Math.cos(theta) * rad).addScaledVector(fr.u, Math.sin(theta) * rad);
  }
  private outward(s: number, theta: number) {
    const fr = this.frame(s);
    return fr.r.multiplyScalar(Math.cos(theta)).addScaledVector(fr.u, Math.sin(theta)).normalize();
  }
  private bendAround(a: number, b: number) {
    let m = 0;
    for (let s = a; s <= b; s += STEP) m = Math.max(m, this.bend[this.idx(s)] ?? 0);
    return m;
  }

  private buildTube() {
    // Rings every 10 m and four strips along the walls, the colour changing every 60 m.
    const perColour: number[][] = COLORS.map(() => []);
    for (let a = -3000; a < this.length + 4000; a += 6000) {
      const ci = Math.floor((a + 3000) / 6000) % COLORS.length;
      const out = perColour[ci];
      for (let s = Math.ceil(a / 1000) * 1000; s < a + 6000; s += 1000) {
        for (let k = 0; k < 40; k++) {
          const p0 = this.point(s, (k / 40) * Math.PI * 2, WALL), p1 = this.point(s, ((k + 1) / 40) * Math.PI * 2, WALL);
          out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
      }
      for (let j = 0; j < 4; j++) {
        const th = (j + 0.5) * Math.PI * 0.5;
        for (let s = a; s < a + 6000; s += 300) {
          const p0 = this.point(s, th, WALL), p1 = this.point(s + 300, th, WALL);
          out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
      }
    }
    perColour.forEach((pairs, i) => { if (pairs.length) { const m = lineMaterial(COLORS[i], 3, 0.9); this.mats.push(m); this.scene.add(segments(pairs, m)); } });
  }

  // --- Obstacles ---
  private addBlock(s: number, mid: number, half: number) {
    this.arcs.push({ s0: s - BLOCK_DEPTH / 2, s1: s + BLOCK_DEPTH / 2, mid, half });
    const loop = (sx: number) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) pts.push(this.point(sx, mid - half + (2 * half * k) / 10, WALL - BLOCK_IN));
      for (let k = 10; k >= 0; k--) pts.push(this.point(sx, mid - half + (2 * half * k) / 10, WALL - 8));
      return pts;
    };
    const f = loop(s - BLOCK_DEPTH / 2), b = loop(s + BLOCK_DEPTH / 2);
    this.scene.add(polylines([f, b], true, this.obstacleMat));
    const pairs: number[] = [];
    for (const i of [0, 10, 11, 21]) pairs.push(f[i].x, f[i].y, f[i].z, b[i].x, b[i].y, b[i].z);
    // An X across the face you approach: "solid, steer around".
    pairs.push(f[0].x, f[0].y, f[0].z, f[21].x, f[21].y, f[21].z, f[10].x, f[10].y, f[10].z, f[11].x, f[11].y, f[11].z);
    this.scene.add(segments(pairs, this.obstacleMat));
  }

  private buildObstacles(r: Rng, ease: number) {
    const maxSpeed = 12500, steerRate = 2.8;
    let s = this.firstObstacle, safe = 0;
    let left = 0, kind = 0, seed = 1, index = 0, spacing = 4000, step = 0, zig = false;
    const nearBend = (at: number) => this.bendAround(at - 3500, at + 800) > 1 / 16000;
    while (s < this.length - 2500) {
      const T = clamp((s - this.firstObstacle) / Math.max(1, this.length - this.firstObstacle), 0, 1);
      if (nearBend(s)) { s += 500; left = 0; continue; }
      if (left <= 0) {
        const maxKind = T < 0.2 ? 0 : T < 0.45 ? 1 : 3;
        kind = r.int(0, ease >= 0.7 ? Math.min(1, maxKind) : maxKind);
        left = r.int(3, 6);
        spacing = (4200 + (2600 - 4200) * T) * (1 + 0.4 * ease) * (1.4 + (1 - 1.4) * clamp(T / 0.3, 0, 1));
        const reach = steerRate * (spacing / maxSpeed) * 0.55;
        const pattern = r.int(0, 2);
        step = pattern === 0 ? 0 : (r.chance(0.5) ? 1 : -1) * reach * 0.8;
        zig = pattern === 2;
        seed = r.int(1, 1 << 30);
        index = 0;
      }
      if (index > 0) { if (zig) step = -step; safe += step; }
      const pr = new Rng(seed);  // the same shape for every obstacle in the group
      switch (kind) {
        case 0: { const half = pr.range(35, 60) * (Math.PI / 180); this.addBlock(s, safe + (pr.chance(0.5) ? 1 : -1) * pr.range(half + 0.45, Math.PI), half); break; }
        case 1: { const half = pr.range(30, 45) * (Math.PI / 180); const mid = safe + Math.PI / 2 + pr.range(-1, 1) * (Math.PI / 2 - half - 0.45); this.addBlock(s, mid, half); this.addBlock(s, mid + Math.PI, half); break; }
        case 2: { const gap = pr.range(80, 110) * (Math.PI / 180); this.addBlock(s, safe + Math.PI, (2 * Math.PI - gap) / 2); break; }
        default: { const half = (50 * Math.PI) / 180, side = pr.chance(0.5) ? 1 : -1; this.addBlock(s, safe + side * (half + 0.5), half); this.addBlock(s + 1000, safe - side * (half + 0.5), half); s += 1000; break; }
      }
      index++;
      s += spacing;
      if (--left === 0) s += spacing * 0.9;
    }
  }

  private hits(s0: number, s1: number, theta: number) {
    for (const a of this.arcs) if (s1 >= a.s0 && s0 <= a.s1 && Math.abs(wrap(theta - a.mid)) < a.half + SHIP_HALF) return true;
    return false;
  }

  /** Message to show this frame, if any. */
  message = "";

  update(dt: number, input: Input): TunnelResult {
    this.time += dt;
    this.message = "";
    const base = Math.min(12500, 5000 + this.time * 380);
    this.speed = base * (input.down("ShiftLeft", "ShiftRight") ? 0.7 : 1);
    const prev = this.s;
    this.s += this.speed * dt;
    // Steering: the ship slides around the tube (the view rolls so it stays at the bottom).
    const mv = input.move();
    const want = mv.x * 3.4;  // right on the stick: the ship slides right around the tube
    this.thetaVel += (want - this.thetaVel) * (1 - Math.exp(-dt / 0.05));
    this.theta = wrap(this.theta + this.thetaVel * dt);
    if (!this.warned && this.s > this.firstObstacle - this.speed * 2) { this.warned = true; this.message = "OBSTACLES AHEAD"; }
    // Ship and camera.
    const ship = this.point(this.s, this.theta, SHIP_R);
    const fr = this.frame(this.s);
    const down = this.outward(this.s, this.theta);
    this.ship.position.copy(ship);
    // Ship basis: its nose (-Z) along the tube, its top (+Y) toward the axis; it banks into the turn.
    const Y = down.clone().negate(), Z = fr.f.clone().negate(), X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    this.ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    this.ship.rotateZ(clamp(this.thetaVel / 3.4, -1, 1) * 0.6);
    this.camera.position.copy(this.point(this.s - 1000, this.theta, SHIP_R * 0.44));
    this.camera.up.copy(down).negate();
    this.camera.lookAt(this.point(this.s + 1600, this.theta, SHIP_R * 0.55));
    this.camera.fov = 72 + clamp((this.speed - 5000) / 11000, 0, 1) * 24;
    this.camera.updateProjectionMatrix();
    this.obstacleMat.color.setRGB(3 + 2 * Math.sin(this.time * 7), 0.2, 0.1);
    if (this.hits(prev, this.s, this.theta)) { sfx("boomBig", 0, 1.2); return "crashed"; }
    return this.s >= this.length ? "cleared" : "running";
  }

  get progress() { return clamp(this.s / this.length, 0, 1); }
}

function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
