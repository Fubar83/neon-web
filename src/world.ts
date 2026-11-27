// The neon world under the play field: scenery generated in chunks as the level scrolls, deep below the
// ships (perspective gives the parallax). Each theme has its own shapes, motion and palette; it is kept
// dim so enemies and shots stand out.
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { circle, cog, lineMaterial, polygon, polylines, segments, star, wire, disposeMaterial } from "./neon";
import { Rng } from "./util";

export type Theme = "Clockwork" | "Circuit" | "Synthwave" | "Crystal" | "Space" | "City" | "Ocean" | "Desert" | "Storm" | "Reactor";

const CHUNK = 2400;
const SPREAD = 2300;  // half-width of the scenery (it reaches past the screen at depth)

interface Spinner { obj: THREE.Object3D; rate: number }
interface Chunk { index: number; group: THREE.Group; spinners: Spinner[]; mats: LineMaterial[] }

const PALETTES: Record<Theme, number[]> = {
  Clockwork: [0xffa614, 0xff5905, 0x14f0ff, 0xff1fd9, 0x33ff73, 0x8c40ff],
  Circuit: [0x33ff66, 0xffcc33, 0x1ae6cc, 0x99ff33],
  Synthwave: [0xff33b3, 0x9933ff, 0xff8019, 0x19e6ff],
  Crystal: [0x66e0ff, 0xb388ff, 0xff7af0, 0xa0fff0],
  Space: [0x88aaff, 0xff88cc, 0xffdd88, 0x66ffcc],
  City: [0xff3366, 0x33ddff, 0xffcc33, 0xaa66ff],
  Ocean: [0x22ccff, 0x22ffaa, 0x5577ff, 0xff77dd],
  Desert: [0xffaa33, 0xff6633, 0xffdd66, 0x33ffcc],
  Storm: [0xaabbff, 0x66eeff, 0xffff66, 0xcc66ff],
  Reactor: [0x66ff66, 0xffee33, 0x33ffee, 0xff5533],
};
/** The edge rails' colour per theme. */
const RAILS: Record<Theme, number> = { Clockwork: 0x14f0ff, Circuit: 0xffcc33, Synthwave: 0xff33b3, Crystal: 0x66e0ff, Space: 0x88aaff, City: 0xff3366, Ocean: 0x22ccff, Desert: 0xffaa33, Storm: 0xcc66ff, Reactor: 0x66ff66 };

export class NeonWorld {
  readonly root = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private offset = 0;
  private time = 0;
  private railMats: LineMaterial[] = [];

  constructor(readonly theme: Theme, readonly seed: number, readonly brightness = 0.18) {
    // Edge rails along the play field (fixed on screen).
    const c = RAILS[theme];
    const m = lineMaterial(c, 2, 0.35);
    this.railMats.push(m);
    const pairs: number[] = [];
    for (const x of [-800, 800]) pairs.push(x, -2000, -10, x, 2000, -10);
    this.root.add(segments(pairs, m));
  }

  private mat(color: number, width: number, bright = 1): LineMaterial {
    return lineMaterial(color, width, this.brightness * bright);
  }

  update(dt: number, scroll: number) {
    this.time += dt;
    this.offset += scroll * dt;
    const first = Math.floor((this.offset - 2500) / CHUNK), last = Math.floor((this.offset + 4000) / CHUNK);
    for (let k = first; k <= last; k++) if (!this.chunks.has(k)) this.build(k);
    for (const [k, ch] of this.chunks) {
      if (k < first - 1 || k > last + 1) {
        this.root.remove(ch.group);
        ch.group.traverse((o) => { const l = o as THREE.Mesh; if (l.geometry) l.geometry.dispose(); });
        ch.mats.forEach(disposeMaterial);
        this.chunks.delete(k);
        continue;
      }
      ch.group.position.y = k * CHUNK - this.offset;
      for (const s of ch.spinners) s.obj.rotation.z += s.rate * dt;
    }
  }

  dispose() {
    for (const k of [...this.chunks.keys()]) {
      const ch = this.chunks.get(k)!;
      ch.mats.forEach(disposeMaterial);
    }
    this.railMats.forEach(disposeMaterial);
    this.chunks.clear();
  }

  private build(k: number) {
    const r = new Rng(this.seed * 7919 + k * 104729);
    const group = new THREE.Group();
    const ch: Chunk = { index: k, group, spinners: [], mats: [] };
    const pal = PALETTES[this.theme];
    const mat = (color: number, width: number, bright = 1) => { const m = this.mat(color, width, bright); ch.mats.push(m); return m; };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const add = (o: THREE.Object3D) => { group.add(o); return o; };

    if (this.theme === "Clockwork") {
      // Winding tracks (continuous across chunks: a function of the level position).
      for (let t = 0; t < 2; t++) {
        const color = pal[(t * 3 + 2) % pal.length];
        const z = -500 - t * 300, amp = 500 + t * 200, period = 1500 + t * 500, off = t ? 300 : -350;
        const L: THREE.Vector3[] = [], Rr: THREE.Vector3[] = [], sleepers: number[] = [];
        for (let y = 0; y <= CHUNK; y += 80) {
          const ly = k * CHUNK + y;
          const x = off + amp * Math.sin(ly / period + t * 2);
          const dx = (amp / period) * Math.cos(ly / period + t * 2);
          const n = new THREE.Vector2(1, -dx).normalize();
          L.push(V(x - n.x * 35, y - n.y * 35, z)); Rr.push(V(x + n.x * 35, y + n.y * 35, z));
          if ((y / 80) % 2 === 0) sleepers.push(x - n.x * 55, y - n.y * 55, z, x + n.x * 55, y + n.y * 55, z);
        }
        const m = mat(color, 2.5);
        add(polylines([L, Rr], false, m));
        add(segments(sleepers, mat(color, 1.2, 0.6)));
      }
      // Cogs turning, some in meshing pairs.
      for (let i = 0; i < 4; i++) {
        const rad = r.range(150, 600), teeth = r.int(10, 18);
        const o = add(polylines([cog(teeth, rad, 0.84)], true, mat(r.pick(pal), 2.2)));
        o.position.set(r.range(-SPREAD, SPREAD), r.range(0, CHUNK), r.range(-1400, -600));
        const rate = (r.chance(0.5) ? 1 : -1) * r.range(0.1, 0.4) * (300 / rad);
        ch.spinners.push({ obj: o, rate });
        if (r.chance(0.5)) {
          const rad2 = rad * r.range(0.4, 0.7), a = r.range(0, Math.PI * 2);
          const o2 = add(polylines([cog(10, rad2, 0.8)], true, mat(r.pick(pal), 2)));
          o2.position.set(o.position.x + Math.cos(a) * (rad + rad2) * 0.9, o.position.y + Math.sin(a) * (rad + rad2) * 0.9, o.position.z);
          ch.spinners.push({ obj: o2, rate: (-rate * rad) / rad2 });
        }
      }
      // A gauge and a deep floating solid.
      const g = add(polylines([circle(120), polygon(6, 60)], true, mat(0xff6610, 2)));
      g.position.set(r.range(-SPREAD, SPREAD), r.range(0, CHUNK), -700);
      const solid = new THREE.Group();
      const m = mat(r.pick(pal), 2, 0.8);
      const geo = r.pick([new THREE.OctahedronGeometry(400), new THREE.IcosahedronGeometry(400), new THREE.BoxGeometry(500, 500, 500)]);
      const e = new THREE.EdgesGeometry(geo); geo.dispose();
      const pos = e.getAttribute("position").array as Float32Array;
      solid.add(segments(Array.from(pos), m)); e.dispose();
      solid.position.set(r.range(-SPREAD, SPREAD), r.range(0, CHUNK), -2000);
      add(solid);
      ch.spinners.push({ obj: solid, rate: r.range(-0.2, 0.2) });
    } else if (this.theme === "Circuit") {
      // Traces with 45-degree jogs ending in vias, and chips with pins.
      for (let i = 0; i < 9; i++) {
        const color = r.pick(pal), z = -500 - r.int(0, 2) * 60;
        let x = r.range(-SPREAD, SPREAD), y = r.range(-200, CHUNK);
        const p = [V(x, y, z)];
        for (let s = 0; s < r.int(2, 4); s++) {
          y += r.range(200, 700); p.push(V(x, y, z));
          const j = r.range(-300, 300); x += j; y += Math.abs(j); p.push(V(x, y, z));
        }
        add(polylines([p], false, mat(color, 2.2)));
        for (const v of [p[0], p[p.length - 1]]) { const c = add(polylines([circle(18, 12)], true, mat(color, 1.6))); c.position.copy(v); }
      }
      for (let i = 0; i < 2; i++) {
        const color = r.pick(pal), cx = r.range(-SPREAD * 0.8, SPREAD * 0.8), cy = r.range(0, CHUNK), z = -450;
        const hx = r.range(140, 300), hy = r.range(110, 240);
        const rect = (sx: number, sy: number, zz: number) => [V(cx - sx, cy - sy, zz), V(cx + sx, cy - sy, zz), V(cx + sx, cy + sy, zz), V(cx - sx, cy + sy, zz)];
        add(polylines([rect(hx, hy, z), rect(hx * 0.8, hy * 0.75, z + 5)], true, mat(color, 2.5)));
        const pins: number[] = [];
        for (let y = -hy + 30; y < hy; y += 40) for (const s of [-1, 1]) pins.push(cx + s * hx, cy + y, z, cx + s * (hx + 50), cy + y, z);
        add(segments(pins, mat(color, 1.5, 0.7)));
      }
    } else if (this.theme === "Crystal") {
      // Crystal caverns: jagged cave walls, tall wire gems turning slowly, shard clusters.
      for (const side of [-1, 1]) {
        const wall: THREE.Vector3[] = [];
        for (let y = 0; y <= CHUNK; y += 120) {
          const ly = k * CHUNK + y;
          wall.push(V(side * (1050 + 180 * Math.sin(ly * 0.0021 + side) + ((y / 120) % 2 ? 110 : -40)), y, -450));
        }
        add(polylines([wall], false, mat(pal[side > 0 ? 0 : 1], 2.6)));
      }
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.OctahedronGeometry(r.range(160, 320));
        geo.scale(1, r.range(1.6, 2.4), 1);
        const gem = add(wire(geo, mat(r.pick(pal), 2.2))); geo.dispose();
        gem.position.set(r.range(-SPREAD, SPREAD), r.range(0, CHUNK), r.range(-1600, -700));
        gem.rotation.x = r.range(-0.4, 0.4);
        ch.spinners.push({ obj: gem, rate: r.range(-0.3, 0.3) });
      }
      for (let i = 0; i < 4; i++) {
        const cl = new THREE.Group(), m = mat(r.pick(pal), 1.8, 0.9);
        for (let j = 0; j < r.int(3, 5); j++) {
          const h = r.range(80, 220), w = h * 0.28, a = r.range(-0.9, 0.9);
          const sh = polylines([[V(0, 0, 0), V(w, h * 0.6, 0), V(0, h, 0), V(-w, h * 0.6, 0)]], true, m);
          sh.rotation.z = a; cl.add(sh);
        }
        cl.position.set((r.chance(0.5) ? 1 : -1) * r.range(850, 1500), r.range(0, CHUNK), -420);
        add(cl);
      }
    } else if (this.theme === "Space") {
      // Deep space: star dust far below, ringed planets, orbit lines and a slow spiral nebula.
      const dust: number[] = [];
      for (let i = 0; i < 90; i++) { const x = r.range(-SPREAD * 1.3, SPREAD * 1.3), y = r.range(0, CHUNK), z = r.range(-2600, -1400), s = r.range(4, 10); dust.push(x - s, y, z, x + s, y, z, x, y - s, z, x, y + s, z); }
      add(segments(dust, mat(0xccddff, 1.4, 0.9)));
      if (k % 2 === 0) {
        const pl = new THREE.Group(), rad = r.range(220, 420), c = r.pick(pal);
        pl.add(polylines([circle(rad, 48), circle(rad * 0.7, 40)], true, mat(c, 2.4)));
        const ring = polylines([circle(rad * 1.7, 64)], true, mat(r.pick(pal), 2)); ring.scale.y = 0.32; pl.add(ring);
        pl.position.set((r.chance(0.5) ? 1 : -1) * r.range(900, 1700), r.range(300, CHUNK - 300), -1200);
        pl.rotation.z = r.range(-0.6, 0.6);
        add(pl);
      }
      for (let i = 0; i < 2; i++) {
        const o = polylines([circle(r.range(400, 900), 72)], true, mat(r.pick(pal), 1.4, 0.6)); o.scale.y = r.range(0.35, 0.6);
        o.position.set(r.range(-SPREAD, SPREAD), r.range(0, CHUNK), -900); o.rotation.z = r.range(0, Math.PI);
        add(o); ch.spinners.push({ obj: o, rate: r.range(-0.05, 0.05) });
      }
      if (k % 3 === 1) {
        const arms: THREE.Vector3[][] = [];
        for (let a = 0; a < 3; a++) { const p: THREE.Vector3[] = []; for (let i = 0; i <= 40; i++) { const th = a * (Math.PI * 2 / 3) + i * 0.16, rr = 30 + i * 16; p.push(V(Math.cos(th) * rr, Math.sin(th) * rr, 0)); } arms.push(p); }
        const neb = add(polylines(arms, false, mat(0xff88cc, 2, 0.8)));
        neb.position.set(r.range(-SPREAD * 0.7, SPREAD * 0.7), CHUNK * 0.5, -1700);
        ch.spinners.push({ obj: neb, rate: 0.06 });
      }
    } else if (this.theme === "City") {
      // A neon city from above: an avenue under the play field, blocks of rooftops at different heights.
      const z = -1000, av: number[] = [];
      for (const x of [-420, 420]) av.push(x, 0, z, x, CHUNK, z);
      for (let y = 0; y < CHUNK; y += 160) av.push(0, y, z, 0, y + 80, z);
      add(segments(av, mat(0xffcc33, 2, 0.8)));
      for (const side of [-1, 1]) {
        let y = r.range(0, 120);
        while (y < CHUNK) {
          const h = r.range(160, 420), w = r.range(200, 520), x0 = side * r.range(520, 700), zz = -1000 + r.range(150, 650), c = r.pick(pal);
          const xa = x0, xb = x0 + side * w, rect = (pad: number) => [V(Math.min(xa, xb) + pad, y + pad, zz), V(Math.max(xa, xb) - pad, y + pad, zz), V(Math.max(xa, xb) - pad, y + h - pad, zz), V(Math.min(xa, xb) + pad, y + h - pad, zz)];
          add(polylines([rect(0), rect(28)], true, mat(c, 2.2)));
          if (r.chance(0.4)) { const cx = (xa + xb) / 2, cy = y + h / 2; add(segments([cx - 40, cy, zz + 5, cx + 40, cy, zz + 5, cx, cy - 40, zz + 5, cx, cy + 40, zz + 5], mat(c, 1.6, 1.2))); }
          y += h + r.range(60, 160);
        }
      }
    } else if (this.theme === "Ocean") {
      // The deep ocean: rolling wave lines, kelp swaying up the sides, jellyfish and bubbles.
      for (let y = 0; y < CHUNK; y += 300) {
        const p: THREE.Vector3[] = [];
        for (let x = -SPREAD; x <= SPREAD; x += 100) p.push(V(x, y + 60 * Math.sin(x * 0.004 + (k * CHUNK + y) * 0.002), -1000));
        add(polylines([p], false, mat(0x2277ff, 1.6, 0.7)));
      }
      for (const side of [-1, 1]) for (let j = 0; j < 2; j++) {
        const p: THREE.Vector3[] = [], bx = side * (950 + j * 320);
        for (let y = 0; y <= CHUNK; y += 80) p.push(V(bx + 70 * Math.sin((k * CHUNK + y) * 0.006 + j), y, -500 - j * 150));
        add(polylines([p], false, mat(0x22ffaa, 2.2)));
      }
      for (let i = 0; i < 3; i++) {
        const jf = new THREE.Group(), rad = r.range(70, 140), c = r.pick([0xff77dd, 0x77aaff, 0x22ccff]), m = mat(c, 2);
        const bell: THREE.Vector3[] = []; for (let a = 0; a <= 16; a++) { const th = Math.PI * (a / 16); bell.push(V(Math.cos(th) * rad, Math.sin(th) * rad * 0.8, 0)); }
        const ten: THREE.Vector3[][] = []; for (let t = -2; t <= 2; t++) { const q: THREE.Vector3[] = []; for (let s = 0; s <= 6; s++) q.push(V(t * rad * 0.35 + 18 * Math.sin(s + t), -s * rad * 0.35, 0)); ten.push(q); }
        jf.add(polylines([bell, ...ten], false, m));
        jf.position.set(r.range(-SPREAD * 0.8, SPREAD * 0.8), r.range(0, CHUNK), r.range(-900, -600));
        add(jf); ch.spinners.push({ obj: jf, rate: r.range(-0.15, 0.15) });
      }
      const bub: THREE.Vector3[][] = [];
      for (let i = 0; i < 10; i++) { const c0 = circle(r.range(10, 30), 12); const dx = r.range(-SPREAD, SPREAD), dy = r.range(0, CHUNK); bub.push(c0.map((v) => V(v.x + dx, v.y + dy, -700))); }
      add(polylines(bub, true, mat(0xaaddff, 1.4, 0.8)));
    } else if (this.theme === "Desert") {
      // Neon dunes: sweeping ridge lines, wire pyramids pointing up at you, an oasis now and then.
      for (let d = 0; d < 5; d++) {
        const p: THREE.Vector3[] = [], bx = -SPREAD + d * (SPREAD / 2) + 200;
        for (let y = 0; y <= CHUNK; y += 100) p.push(V(bx + 260 * Math.sin((k * CHUNK + y) * 0.0016 + d * 1.7), y, -1100));
        add(polylines([p], false, mat(d % 2 ? 0xff6633 : 0xffaa33, 2.2, 0.8)));
      }
      for (let i = 0; i < 2; i++) {
        const s = r.range(220, 420), geo = new THREE.ConeGeometry(s, s * 0.9, 4);
        const py = add(wire(geo, mat(r.pick([0xffdd66, 0xffaa33]), 2.4))); geo.dispose();
        py.rotation.x = Math.PI / 2; py.rotation.y = Math.PI / 4;
        py.position.set((r.chance(0.5) ? 1 : -1) * r.range(900, 1800), r.range(0, CHUNK), -900);
        add(py);
      }
      if (k % 3 === 2) {
        const o = add(polylines([circle(180, 40), circle(120, 32)], true, mat(0x33ffcc, 2.2)));
        o.position.set((r.chance(0.5) ? 1 : -1) * r.range(800, 1300), r.range(0, CHUNK), -500);
        for (let j = 0; j < 3; j++) { const p = add(polylines([star(7, 110, 0.2)], true, mat(0x33ffaa, 2))); p.position.set(o.position.x + r.range(-200, 200), o.position.y + r.range(-200, 200), -420); }
      }
    } else if (this.theme === "Storm") {
      // A storm: lightning forks far below, a turning vortex, rings of cloud.
      for (let i = 0; i < 3; i++) {
        const p: THREE.Vector3[] = []; let x = r.range(-SPREAD, SPREAD), y = r.range(-200, CHUNK * 0.5);
        const z = r.range(-1500, -800);
        for (let s = 0; s < 9; s++) { p.push(V(x, y, z)); x += r.range(-220, 220); y += r.range(120, 260); }
        const forks: THREE.Vector3[][] = [p];
        const at = p[r.int(2, 5)]; const f: THREE.Vector3[] = [at.clone()]; let fx = at.x, fy = at.y;
        for (let s = 0; s < 4; s++) { fx += r.range(-260, 260); fy += r.range(80, 200); f.push(V(fx, fy, z)); }
        forks.push(f);
        add(polylines(forks, false, mat(r.chance(0.5) ? 0xffff66 : 0xaabbff, 2.6, 1.1)));
      }
      if (k % 2 === 0) {
        const arms: THREE.Vector3[][] = [];
        for (let a = 0; a < 4; a++) { const p: THREE.Vector3[] = []; for (let i = 0; i <= 30; i++) { const th = a * (Math.PI / 2) + i * 0.2, rr = 40 + i * 22; p.push(V(Math.cos(th) * rr, Math.sin(th) * rr, 0)); } arms.push(p); }
        const vx = add(polylines(arms, false, mat(0x66eeff, 2.2, 0.8)));
        vx.position.set((r.chance(0.5) ? 1 : -1) * r.range(700, 1500), CHUNK * 0.5, -1300);
        ch.spinners.push({ obj: vx, rate: -0.35 });
      }
      for (let i = 0; i < 4; i++) {
        const cl: THREE.Vector3[][] = []; const cx = r.range(-SPREAD, SPREAD), cy = r.range(0, CHUNK);
        for (let j = 0; j < 4; j++) { const c0 = circle(r.range(80, 180), 24); const dx = cx + r.range(-160, 160), dy = cy + r.range(-60, 60); cl.push(c0.map((v) => V(v.x + dx, v.y + dy, -600))); }
        add(polylines(cl, true, mat(0xcc66ff, 1.8, 0.7)));
      }
    } else if (this.theme === "Reactor") {
      // A reactor floor: a hexagon grid, glowing cores with turning stars, atoms with spinning orbits.
      const hex: THREE.Vector3[][] = [], s = 170, z = -1000;
      for (let row = 0; row * s * 1.5 < CHUNK + s; row++) for (let col = -9; col <= 9; col++) {
        const cx = col * s * Math.sqrt(3) + (row % 2 ? (s * Math.sqrt(3)) / 2 : 0), cy = row * s * 1.5;
        hex.push(polygon(6, s * 0.92, Math.PI / 6).map((v) => V(v.x + cx, v.y + cy, z)));
      }
      add(polylines(hex, true, mat(0x33ff66, 1.2, 0.35)));
      if (k % 2 === 1) {
        const core = new THREE.Group(), m = mat(0xffee33, 2.6, 1.1);
        core.add(polylines([circle(260, 48), circle(190, 40), circle(70, 20)], true, m));
        const st = polylines([star(8, 170, 0.35)], true, mat(0xff5533, 2.2)); core.add(st);
        core.position.set((r.chance(0.5) ? 1 : -1) * r.range(800, 1500), CHUNK * 0.5, -800);
        add(core); ch.spinners.push({ obj: st, rate: 0.5 });
      }
      for (let i = 0; i < 2; i++) {
        const atom = new THREE.Group(), c = r.pick(pal), rad = r.range(140, 240);
        for (let j = 0; j < 3; j++) { const o = polylines([circle(rad, 40)], true, mat(c, 1.8)); o.scale.y = 0.32; o.rotation.z = (j * Math.PI) / 3; atom.add(o); }
        atom.add(polylines([circle(rad * 0.14, 12)], true, mat(0xffffff, 2)));
        atom.position.set(r.range(-SPREAD, SPREAD), r.range(0, CHUNK), r.range(-700, -500));
        add(atom); ch.spinners.push({ obj: atom, rate: r.range(0.3, 0.7) * (r.chance(0.5) ? 1 : -1) });
      }
    } else {
      // Synthwave: a grid floor, striped suns out to the sides, wire mountains, palms.
      const grid: number[] = [], z = -900;
      for (let x = -SPREAD; x <= SPREAD; x += 300) grid.push(x, 0, z, x, CHUNK, z);
      for (let y = 0; y < CHUNK; y += 300) grid.push(-SPREAD, y, z, SPREAD, y, z);
      add(segments(grid, mat(0xff33b3, 1.6, 0.8)));
      if (k % 3 === 0) {
        const side = r.chance(0.5) ? 1 : -1, rad = 700;
        const sun = add(polylines([circle(rad, 64)], true, mat(0xff8019, 4, 1.2)));
        const cx = side * 1700, cy = CHUNK * 0.5;
        sun.position.set(cx, cy, -1100);
        const stripes: number[] = [];
        for (let dy = -rad * 0.7; dy < rad * 0.1; dy += rad * 0.14) { const h = Math.sqrt(rad * rad - dy * dy); stripes.push(cx - h, cy + dy, -1095, cx + h, cy + dy, -1095); }
        add(segments(stripes, mat(0xff33a0, 5, 0.9)));
      }
      for (const side of [-1, 1]) {
        const ridge: THREE.Vector3[] = [];
        for (let y = 0; y <= CHUNK; y += 160) ridge.push(V(side * (1000 + (Math.sin((k * CHUNK + y) * 0.004) * 0.5 + 0.5) * 300 + (y % 320 ? 120 : 0)), y, -500 + ((y / 160) % 2) * 200));
        add(polylines([ridge], false, mat(0x9933ff, 3)));
      }
      for (let i = 0; i < 2; i++) {
        const side = r.chance(0.5) ? 1 : -1;
        const p = add(polylines([star(7, 160, 0.2)], true, mat(0x19ffa0, 2.2)));
        p.position.set(side * r.range(900, 1300), r.range(0, CHUNK), -300);
        ch.spinners.push({ obj: p, rate: r.range(-0.1, 0.1) });
      }
    }
    group.position.y = k * CHUNK - this.offset;
    this.root.add(group);
    this.chunks.set(k, ch);
  }
}
