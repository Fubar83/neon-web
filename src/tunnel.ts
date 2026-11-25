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
/** Wall colours per tunnel (cool tones, so the red obstacles stand out): rings, rings 2 / pattern, strips. */
const PALETTES = [
  [0x19e6ff, 0x3a6bff, 0x9a4dff],
  [0xff3fd8, 0x8a3dff, 0x2fd8ff],
  [0x2fffb0, 0x19c8ff, 0x6dff3a],
  [0x8a6bff, 0xff5fc0, 0x3fb8ff],
];

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
  /** Solid faces on the blocks, so they read as walls and not just outlines. */
  private fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.07, 0.03), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private fillGeos: THREE.BufferGeometry[] = [];
  /** The tube's solid wall (dark, opaque). */
  private wallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.016, 0.035), side: THREE.DoubleSide });
  private wallGeo: THREE.BufferGeometry | null = null;
  /** Each block with its own materials, so the near ones glow and the far ones stay faint. */
  private blocks: { s: number; objs: THREE.Object3D[]; line: LineMaterial; edge: LineMaterial; fill: THREE.MeshBasicMaterial }[] = [];
  private ship: THREE.Group;
  private shipMat: LineMaterial;
  private thetaVel = 0;
  private warned = false;

  constructor(readonly length: number, seed: number, simplicity: number, skill: number) {
    const r = new Rng(seed);
    const ease = clamp(simplicity + (skill === 0 ? 0.35 : skill === 2 ? -0.25 : 0), 0, 1);
    this.buildPath(r, ease);
    this.buildTube(r);
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

  dispose() { this.wallMat.dispose(); this.wallGeo?.dispose(); this.mats.forEach(disposeMaterial); this.fillMat.dispose(); this.fillGeos.forEach((g) => g.dispose()); this.blocks.forEach((b) => b.fill.dispose()); }

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
        const bendNow = dev > 0.4 || r.next() > 0.7 + ease * 0.2;  // few bends
        if (bendNow) {
          secEnd = s + r.range(3000, 5000);
          k = (1 - 0.35 * ease) / r.range(13000, 20000);  // gentle: you see far ahead
          if (dev > 0.25) { const home = new THREE.Vector3(0, 0, -1).addScaledVector(f, f.z).normalize(); phi = Math.atan2(home.dot(u), home.dot(rt)); }
          else phi = r.range(0, Math.PI * 2);
        } else { secEnd = s + r.range(7000, 12000); k = 0; }
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

  /** The tube: lots of thin, dim neon lines on a solid dark wall, in this tunnel's own colours and
   *  pattern (so each tunnel looks different), kept low so the obstacles are what stands out. */
  private buildTube(r: Rng) {
    const pal = PALETTES[r.int(0, PALETTES.length - 1)];
    const style = r.int(0, 2);
    const lines: number[][] = pal.map(() => []);
    const seg = (ci: number, s0: number, t0: number, s1: number, t1: number) => {
      const p0 = this.point(s0, t0, WALL), p1 = this.point(s1, t1, WALL);
      lines[ci].push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    };
    const S0 = -3000, S1 = this.length + 4000, TAU = Math.PI * 2;
    // Rings every 5 m (every other one in the second colour).
    for (let s = Math.ceil(S0 / 500) * 500; s < S1; s += 500) {
      const ci = (s / 500) % 2 === 0 ? 0 : 1;
      for (let k = 0; k < 40; k++) seg(ci, s, (k / 40) * TAU, s, ((k + 1) / 40) * TAU);
    }
    // Twelve strips along the walls.
    for (let j = 0; j < 12; j++) {
      const th = ((j + 0.5) / 12) * TAU;
      for (let s = S0; s < S1; s += 400) seg(2, s, th, s + 400, th);
    }
    // This tunnel's pattern.
    if (style === 0) {
      // Zig-zag bands between the strips, every 30 m.
      for (let s = S0; s < S1; s += 3000) for (let j = 0; j < 12; j++) {
        const t0 = ((j + 0.5) / 12) * TAU, t1 = ((j + 1.5) / 12) * TAU;
        seg(1, s, t0, s + 250, t1); seg(1, s + 250, t1, s + 500, t0);
      }
    } else if (style === 1) {
      // Six helix lines winding along the tube.
      for (let j = 0; j < 6; j++) for (let s = S0; s < S1; s += 300) {
        const t0 = (j / 6) * TAU + s / 4000, t1 = (j / 6) * TAU + (s + 300) / 4000;
        seg(0, s, t0, s + 300, t1);
      }
    } else {
      // Dashed double rings with ladder rungs, every 20 m.
      for (let s = S0; s < S1; s += 2000) for (let k = 0; k < 40; k += 2) {
        seg(1, s, (k / 40) * TAU, s, ((k + 1) / 40) * TAU);
        seg(1, s + 150, (k / 40) * TAU, s + 150, ((k + 1) / 40) * TAU);
        seg(0, s, (k / 40) * TAU, s + 150, (k / 40) * TAU);
      }
    }
    // A solid dark wall just behind the lines, so you can't see through the tube (or round a bend).
    {
      const N = 32, STEP_S = 500, pos: number[] = [], idx: number[] = [];
      let rings = 0;
      for (let s = S0; s <= S1; s += STEP_S, rings++) {
        for (let k = 0; k < N; k++) { const p = this.point(s, (k / N) * TAU, WALL + 12); pos.push(p.x, p.y, p.z); }
      }
      for (let i = 0; i < rings - 1; i++) for (let k = 0; k < N; k++) {
        const a = i * N + k, b = i * N + ((k + 1) % N), c = a + N, d = b + N;
        idx.push(a, b, d, a, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      this.wallGeo = geo;
      const wall = new THREE.Mesh(geo, this.wallMat);
      wall.renderOrder = -2;
      this.scene.add(wall);
    }
    // Dim and thin, below the glow threshold: plenty of neon, little light.
    lines.forEach((pairs, i) => { if (pairs.length) { const m = lineMaterial(pal[i], 1.6, i === 2 ? 0.16 : 0.22); this.mats.push(m); this.scene.add(segments(pairs, m)); } });
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
    const line = lineMaterial(0xff2a10, 6, 3);
    const edge = lineMaterial(0xffe0a0, 3, 2.5);  // a white-hot rim on the face you fly at
    this.mats.push(line, edge);
    const fill = this.fillMat.clone();
    const objs: THREE.Object3D[] = [polylines([f, b], true, line)];
    const pairs: number[] = [];
    for (const i of [0, 10, 11, 21]) pairs.push(f[i].x, f[i].y, f[i].z, b[i].x, b[i].y, b[i].z);
    // An X across the face you approach: "solid, steer around".
    pairs.push(f[0].x, f[0].y, f[0].z, f[21].x, f[21].y, f[21].z, f[10].x, f[10].y, f[10].z, f[11].x, f[11].y, f[11].z);
    objs.push(segments(pairs, line));
    objs.push(polylines([f], true, edge));
    // Filled faces: the face you fly at, and the inner surface along the block.
    const pos: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    for (let k = 0; k < 10; k++) {
      quad(f[k], f[k + 1], f[20 - k], f[21 - k]);  // front: inner edge k..k+1 to the outer edge
      quad(f[k], f[k + 1], b[k + 1], b[k]);        // the inner surface, front to back
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.fillGeos.push(geo);
    const mesh = new THREE.Mesh(geo, fill);
    mesh.renderOrder = -1;
    objs.push(mesh);
    for (const o of objs) { o.visible = false; this.scene.add(o); }
    this.blocks.push({ s, objs, line, edge, fill });
  }

  /** Near blocks glow and pulse; far ones are faint; ones well behind or far ahead aren't drawn. */
  private shadeBlocks() {
    const pulse = 5 + 2 * Math.sin(this.time * 7);
    for (const b of this.blocks) {
      const d = b.s - this.s;
      const show = d > -700 && d < 10000;
      if (b.objs[0].visible !== show) for (const o of b.objs) o.visible = show;
      if (!show) continue;
      const near = 1 - clamp((d - 1500) / 7000, 0, 1);  // 1 within 1500 ahead, 0 at 8500
      const k = 0.3 + 0.7 * near * near;  // even far ones stand out from the dim walls
      b.line.color.setRGB(pulse * k, 0.35 * k, 0.1 * k);
      b.edge.color.setRGB(2.2 * k, 1.7 * k, 1 * k);
      b.fill.opacity = 0.2 + 0.5 * near * near;
    }
  }

  /** The gap radar: a ring around the view with the blocks ahead drawn where they are around the tube
   *  (red, brighter as they come closer) and the ship as a cyan mark, so you see early where to steer. */
  drawRadar(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.clearRect(0, 0, w, h);
    const range = 9000, R = Math.min(w, h) * 0.42, cx = w / 2, cy = h * 0.47;
    const v = new THREE.Vector3();
    const screenAngle = (s: number, th: number) => {
      const c = v.copy(this.point(s, 0, 0)).project(this.camera), x0 = c.x, y0 = c.y;
      const p = v.copy(this.point(s, th, WALL * 0.8)).project(this.camera);
      return Math.atan2((p.y - y0) * h, (p.x - x0) * w);  // (projected y points up, like the ring's angles)
    };
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, R * 0.04);
    ctx.strokeStyle = "rgba(80,230,255,0.12)";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    // Blocks ahead, farthest first so the nearest draw on top.
    const ahead = this.arcs.filter((a) => a.s1 > this.s && a.s0 < this.s + range).sort((a, b) => b.s0 - a.s0);
    for (const a of ahead) {
      const near = 1 - Math.max(0, a.s0 - this.s) / range;
      ctx.strokeStyle = `rgba(255,${Math.round(60 - 40 * near)},40,${0.2 + 0.8 * near * near})`;
      ctx.lineWidth = Math.max(4, R * (0.05 + 0.07 * near));
      ctx.beginPath();
      const n = 10;
      for (let k = 0; k <= n; k++) {
        const ang = screenAngle(Math.max(a.s0, this.s + 400), a.mid - a.half + (2 * a.half * k) / n);
        const x = cx + Math.cos(ang) * R, y = cy - Math.sin(ang) * R;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // The ship's place on the ring.
    const sa = screenAngle(this.s + 400, this.theta);
    const sx = cx + Math.cos(sa) * R, sy = cy - Math.sin(sa) * R;
    ctx.fillStyle = "rgba(150,250,255,0.95)";
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(5, R * 0.05), 0, Math.PI * 2); ctx.fill();
  }

  private buildObstacles(r: Rng, ease: number) {
    const maxSpeed = 9500, steerRate = 2.8;
    let s = this.firstObstacle, safe = 0;
    let left = 0, kind = 0, seed = 1, index = 0, spacing = 4000, step = 0, zig = false;
    const nearBend = (at: number) => this.bendAround(at - 3500, at + 800) > 1 / 40000;
    while (s < this.length - 2500) {
      const T = clamp((s - this.firstObstacle) / Math.max(1, this.length - this.firstObstacle), 0, 1);
      if (nearBend(s)) { s += 500; left = 0; continue; }
      if (left <= 0) {
        // Kinds: 0 block, 1 pair, 2 ring gate, 3 slalom, 4 three blocks, 5 spiral, 6 pillars.
        let pool = T < 0.15 ? [0, 6] : T < 0.35 ? [0, 1, 6, 4] : T < 0.6 ? [0, 1, 2, 4, 6, 5] : [0, 1, 2, 3, 4, 5, 6];
        if (ease >= 0.7) pool = pool.filter((k) => k === 0 || k === 1 || k === 6);
        kind = r.pick(pool);
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
        case 3: { const half = (50 * Math.PI) / 180, side = pr.chance(0.5) ? 1 : -1; this.addBlock(s, safe + side * (half + 0.5), half); this.addBlock(s + 1000, safe - side * (half + 0.5), half); s += 1000; break; }
        case 4: { const half = (30 * Math.PI) / 180; for (const m of [60, 180, 300]) this.addBlock(s, safe + (m * Math.PI) / 180, half); break; }  // three blocks, the gap at the safe line
        case 5: { const dir = pr.chance(0.5) ? 1 : -1, half = (50 * Math.PI) / 180; for (let k = 0; k < 4; k++) this.addBlock(s + k * 700, safe + Math.PI + (k - 1.5) * dir * 0.9, half); s += 2100; break; }  // a spiral of blocks round the far side
        default: { const half = (11 * Math.PI) / 180; for (let k = 0; k < 5; k++) this.addBlock(s, safe + ((50 + k * 65) * Math.PI) / 180, half); break; }  // a row of thin pillars
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
    const base = Math.min(9500, 4200 + this.time * 260);
    this.speed = base;  // no braking
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
    this.camera.fov = 72 + clamp((this.speed - 4200) / 8000, 0, 1) * 20;
    this.camera.updateProjectionMatrix();
    this.shadeBlocks();
    if (this.hits(prev, this.s, this.theta)) { sfx("boomBig", 0, 1.2); return "crashed"; }
    return this.s >= this.length ? "cleared" : "running";
  }

  get progress() { return clamp(this.s / this.length, 0, 1); }
}

function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
