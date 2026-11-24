// The neon world under the play field: scenery generated in chunks as the level scrolls, deep below the
// ships (perspective gives the parallax). Each theme has its own shapes, motion and palette; it is kept
// dim so enemies and shots stand out.
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { circle, cog, lineMaterial, polygon, polylines, segments, star, disposeMaterial } from "./neon";
import { Rng } from "./util";

export type Theme = "Clockwork" | "Circuit" | "Synthwave";

const CHUNK = 2400;
const SPREAD = 2300;  // half-width of the scenery (it reaches past the screen at depth)

interface Spinner { obj: THREE.Object3D; rate: number }
interface Chunk { index: number; group: THREE.Group; spinners: Spinner[]; mats: LineMaterial[] }

const PALETTES: Record<Theme, number[]> = {
  Clockwork: [0xffa614, 0xff5905, 0x14f0ff, 0xff1fd9, 0x33ff73, 0x8c40ff],
  Circuit: [0x33ff66, 0xffcc33, 0x1ae6cc, 0x99ff33],
  Synthwave: [0xff33b3, 0x9933ff, 0xff8019, 0x19e6ff],
};

export class NeonWorld {
  readonly root = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private offset = 0;
  private time = 0;
  private railMats: LineMaterial[] = [];

  constructor(readonly theme: Theme, readonly seed: number, readonly brightness = 0.18) {
    // Edge rails along the play field (fixed on screen).
    const c = theme === "Clockwork" ? 0x14f0ff : theme === "Circuit" ? 0xffcc33 : 0xff33b3;
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
