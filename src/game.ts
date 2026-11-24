// The game: ship, enemies (spinning neon shapes), shots, waves, explosions, power-ups, a level clock.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { circle, cog, cross, disposeMaterial, lineMaterial, polygon, polylines, star, wire } from "./neon";
import { sfx } from "./audio";
import { Input, Rng, clamp } from "./util";
import type { Theme } from "./world";
import type { MusicStyle } from "./music";

export const HALF_W = 800, HALF_H = 450;

export type EnemyKind = "drone" | "fighter" | "burster" | "splitter" | "blinker" | "cog" | "rock";

export interface LevelDef {
  id: string; name: string; group: string; theme: Theme; music: MusicStyle; seed: number;
  enemies: EnemyKind[]; seconds: number; difficulty: [number, number]; scroll: number;
  gentle?: { waves: number; fire: number; shotSpeed: number; damage: number; drops: number; endless: boolean };
}

export const LEVELS: LevelDef[] = [
  { id: "kids", name: "Sunny Synth", group: "FOR KIDS", theme: "Synthwave", music: "Bounce", seed: 4242, enemies: ["drone", "rock", "splitter"], seconds: 120, difficulty: [0, 0.1], scroll: 170,
    gentle: { waves: 1.9, fire: 2.2, shotSpeed: 0.55, damage: 0.5, drops: 2.5, endless: true } },
  { id: "nt01", name: "1  Clockwork Foundry", group: "NEON THEMES", theme: "Clockwork", music: "House", seed: 101, enemies: ["drone", "burster", "splitter", "cog"], seconds: 120, difficulty: [0, 0.35], scroll: 215 },
  { id: "nt02", name: "2  Circuit Board", group: "NEON THEMES", theme: "Circuit", music: "Chiptune", seed: 202, enemies: ["drone", "blinker", "fighter", "splitter"], seconds: 120, difficulty: [0.1, 0.5], scroll: 220 },
  { id: "nt03", name: "3  Synthwave Sunset", group: "NEON THEMES", theme: "Synthwave", music: "Synthwave", seed: 303, enemies: ["fighter", "burster", "blinker", "cog"], seconds: 120, difficulty: [0.2, 0.6], scroll: 225 },
];

interface Shot { x: number; y: number; vx: number; vy: number; r: number; color: THREE.Color; dmg: number; life: number }
interface Enemy {
  kind: EnemyKind; obj: THREE.Group; mats: LineMaterial[]; color: THREE.Color;
  x: number; y: number; sx: number; sy: number; age: number; hp: number; maxHp: number; r: number; score: number;
  fire: number; fireMin: number; fireMax: number; burst: number; burstT: number; side: number; param: number; spin: number;
  dying: number; blinkT: number; ox: number; oy: number; fragment: boolean;
}
interface Spark { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; color: THREE.Color }
interface Ring { obj: LineSegments2; mat: LineMaterial; life: number; max: number; scale: number }
interface Pickup { obj: THREE.Group; mat: LineMaterial; x: number; y: number; kind: "weapon" | "repair" | "shield"; age: number }

const MAX_SHOTS = 700, MAX_SPARKS = 1500;

export class Game {
  readonly root = new THREE.Group();
  score = 0; lives = 3; hull = 100; weapon = 1; shieldHits = 0;
  time = 0; done = false; over = false; message = ""; messageT = 0;
  bigFight = 0;
  private skill: number;
  private r: Rng;
  private ship: THREE.Group; private shipMat: LineMaterial; private flame: THREE.Mesh;
  private sx = 0; private sy = -330; private vx = 0; private vy = 0; private bank = 0;
  private fireT = 0; private invuln = 2; private dead = 0;
  private shots: Shot[] = []; private eshots: Shot[] = [];
  private shotMesh: THREE.InstancedMesh; private eshotMesh: THREE.InstancedMesh;
  private enemies: Enemy[] = [];
  private sparks: Spark[] = []; private sparkPts: THREE.Points;
  private rings: Ring[] = [];
  private pickups: Pickup[] = [];
  private waveT = 2.5; private lastCog = -100;
  private killsSinceDrop = 0;
  private dummy = new THREE.Object3D();

  constructor(readonly level: LevelDef, skill: number) {
    this.skill = skill;
    this.r = new Rng(level.seed * 31 + 7);
    this.lives = level.gentle?.endless ? 3 : skill === 0 ? 5 : skill === 2 ? 2 : 3;
    // Ship: a neon arrow with wings, white-cyan.
    this.shipMat = lineMaterial(0xbff8ff, 3, 2.2);
    const hull = [[0, 46], [12, 10], [40, -18], [40, -28], [12, -18], [8, -30], [-8, -30], [-12, -18], [-40, -28], [-40, -18], [-12, 10]].map(([x, y]) => new THREE.Vector3(x, y, 0));
    const canopy = [[0, 28], [5, 10], [0, 4], [-5, 10]].map(([x, y]) => new THREE.Vector3(x, y, 4));
    this.ship = new THREE.Group();
    this.ship.add(polylines([hull, canopy], true, this.shipMat));
    this.flame = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.15).multiplyScalar(3), toneMapped: false }));
    this.flame.position.set(0, -36, -2);
    this.ship.add(this.flame);
    this.root.add(this.ship);
    // Shots: instanced glowing discs.
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_SHOTS);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color()); this.root.add(m); return m;
    };
    this.shotMesh = mk(new THREE.CircleGeometry(1, 12));
    this.eshotMesh = mk(new THREE.CircleGeometry(1, 16));
    // Sparks: additive points.
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    sg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    this.sparkPts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 5, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    this.sparkPts.frustumCulled = false;
    this.root.add(this.sparkPts);
  }

  get difficulty() {
    const t = clamp(this.time / this.level.seconds, 0, 1);
    let d = this.level.difficulty[0] + (this.level.difficulty[1] - this.level.difficulty[0]) * t;
    if (this.skill === 0) d *= 0.55; else if (this.skill === 2) d = Math.min(1.5, d + 0.35);
    return d;
  }
  get progress() { return clamp(this.time / this.level.seconds, 0, 1); }
  get shipX() { return this.sx; }
  debugShipY() { return this.sy; }

  dispose() {
    for (const e of this.enemies) e.mats.forEach(disposeMaterial);
    for (const p of this.pickups) disposeMaterial(p.mat);
    for (const r of this.rings) disposeMaterial(r.mat);
    disposeMaterial(this.shipMat);
  }

  private say(m: string) { this.message = m; this.messageT = 2.2; }

  update(dt: number, input: Input) {
    this.time += dt;
    this.messageT -= dt;
    this.updateShip(dt, input);
    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);
    if (!this.done && this.time >= this.level.seconds && !this.over) { this.done = true; this.say("LEVEL COMPLETE"); }
  }

  // --- Ship ---
  private updateShip(dt: number, input: Input) {
    if (this.dead > 0) {
      this.dead -= dt;
      this.ship.visible = false;
      if (this.dead <= 0 && !this.over) { this.ship.visible = true; this.sx = 0; this.sy = -330; this.hull = 100; this.invuln = 2.5; }
      return;
    }
    const mv = input.move();
    let speed = 760;
    if (input.down("Space")) speed *= 1.6;
    if (input.down("ShiftLeft", "ShiftRight")) speed *= 0.45;
    const tau = 0.07;
    const a = 1 - Math.exp(-dt / tau);
    this.vx += (mv.x * speed - this.vx) * a;
    this.vy += (mv.y * speed - this.vy) * a;
    this.sx = clamp(this.sx + this.vx * dt, -HALF_W + 50, HALF_W - 50);
    this.sy = clamp(this.sy + this.vy * dt, -HALF_H + 50, HALF_H - 60);
    this.bank += (clamp(this.vx / 760, -1, 1) * 0.65 - this.bank) * (1 - Math.exp(-dt * 8));
    this.ship.position.set(this.sx, this.sy, 0);
    this.ship.rotation.set(0, this.bank, 0);
    this.invuln -= dt;
    this.ship.visible = this.invuln <= 0 || Math.floor(this.time * 12) % 2 === 0;
    this.flame.scale.setScalar((input.down("Space") ? 1.5 : 1) * (0.8 + 0.3 * Math.random()));
    // Fire: more barrels and a wider spread with the weapon level.
    this.fireT -= dt;
    if (input.fire() && this.fireT <= 0) {
      this.fireT = 0.09;
      const n = [1, 2, 3, 4, 5][this.weapon - 1];
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2);
        const ang = off * (this.weapon >= 3 ? 5 : 0) * (Math.PI / 180);
        this.shots.push({ x: this.sx + off * 14, y: this.sy + 40, vx: Math.sin(ang) * 1900, vy: Math.cos(ang) * 1900, r: 6, color: new THREE.Color(0.4, 1.6, 2.2), dmg: 1, life: 1 });
      }
      sfx("playerShot", this.sx / HALF_W, 0.6);
    }
  }

  hurt(dmg: number) {
    if (this.dead > 0 || this.invuln > 0 || this.over) return;
    if (this.shieldHits > 0) { this.shieldHits--; this.invuln = 0.3; sfx("shield", this.sx / HALF_W); return; }
    const scale = (this.skill === 0 ? 0.6 : this.skill === 2 ? 1.3 : 1) * (this.level.gentle?.damage ?? 1);
    this.hull -= dmg * scale;
    this.invuln = 0.4;
    sfx("hurt", this.sx / HALF_W, 0.8);
    this.burst(this.sx, this.sy, new THREE.Color(0.5, 0.9, 1.4), 12, 300);
    if (this.hull <= 0) {
      this.explode(this.sx, this.sy, new THREE.Color(0.6, 1.4, 2), 2.2);
      this.dead = 1.6;
      this.weapon = Math.max(1, this.weapon - 1);
      if (!this.level.gentle?.endless) { this.lives--; if (this.lives <= 0) { this.over = true; this.say("GAME OVER"); } }
    }
  }

  // --- Waves ---
  private updateWaves(dt: number) {
    if (this.done) return;
    this.waveT -= dt;
    if (this.waveT > 0) return;
    const d = this.difficulty;
    const skillWave = this.skill === 0 ? 1.35 : this.skill === 2 ? 0.85 : 1;
    this.waveT = Math.max(1.6, 3.4 - 1.6 * Math.min(d, 1)) * skillWave * (this.level.gentle?.waves ?? 1);
    const roster = this.level.enemies.filter((k) => k !== "cog" || (this.time > 20 && this.time - this.lastCog > 30));
    const kind = this.r.pick(roster);
    const top = HALF_H + 80;
    const lane = this.r.range(-HALF_W + 220, HALF_W - 220);
    const add = (k: EnemyKind, x: number, y: number, side = 1, param = 0) => this.spawn(k, x, y, side, param);
    switch (kind) {
      case "drone": for (let i = 0; i < 4; i++) add("drone", lane, top + i * 140); break;
      case "fighter": add("fighter", -HALF_W + 120, top + 40, 1); add("fighter", HALF_W - 120, top + 150, -1); break;
      case "burster": { const s = this.r.chance(0.5) ? 1 : -1; for (let i = 0; i < 3; i++) add("burster", clamp(lane + (i - 1) * 200, -HALF_W + 120, HALF_W - 120), top + i * 120, i % 2 ? -s : s); break; }
      case "splitter": add("splitter", lane - 130, top, 1); add("splitter", lane + 130, top + 160, -1); break;
      case "blinker": add("blinker", lane - 140, top); add("blinker", lane + 140, top + 100); break;
      case "rock": for (let i = 0; i < 5; i++) add("rock", this.r.range(-HALF_W + 100, HALF_W - 100), top + i * 120, this.r.chance(0.5) ? 1 : -1, this.r.range(0, 60)); break;
      case "cog": this.lastCog = this.time; add("cog", clamp(lane, -HALF_W + 330, HALF_W - 330), top + 280, this.r.chance(0.5) ? 1 : -1); break;
    }
  }

  private spawn(kind: EnemyKind, x: number, y: number, side = 1, param = 0, fragment = false): Enemy {
    const g = new THREE.Group();
    const mats: LineMaterial[] = [];
    const M = (c: number, w: number, i = 2.4) => { const m = lineMaterial(c, w, i); mats.push(m); return m; };
    let color = 0xff3030, hp = 3, r = 34, score = 100, fireMin = 1.6, fireMax = 2.8, spin = 2.4;
    switch (kind) {
      case "drone": color = 0xff2020; g.add(wire(new THREE.TetrahedronGeometry(42), M(color, 3))); spin = 2.4; break;
      case "fighter": color = 0x33ff66; g.add(polylines([cross(46, 15)], true, M(color, 3))); hp = 8; score = 250; fireMin = 1.1; fireMax = 1.5; spin = 3.5; break;
      case "burster": color = 0xff7390; g.add(polylines([star(5, 56, 0.38), polygon(5, 20)], true, M(color, 3))); hp = 12; score = 350; r = 40; fireMin = 1.4; fireMax = 1.9; spin = 4; break;
      case "splitter": color = 0xbfff33; g.add(wire(new THREE.IcosahedronGeometry(fragment ? 26 : 46), M(color, fragment ? 2 : 3))); hp = fragment ? 3 : 10; r = fragment ? 22 : 40; score = fragment ? 100 : 300; spin = 2.8; break;
      case "blinker": color = 0x99ffff; { const o = wire(new THREE.OctahedronGeometry(36), M(color, 3)); o.scale.set(0.8, 1.4, 0.8); g.add(o); } hp = 9; score = 450; fireMin = 99; fireMax = 99; spin = 3.5; break;
      case "rock": color = 0x9966ff; g.add(wire(new THREE.IcosahedronGeometry(48, 0), M(color, 2.5, 1.8))); hp = 6; r = 44; score = 120; fireMin = 99; fireMax = 99; spin = 1.2; break;
      case "cog": color = 0xffa020; g.add(polylines([cog(16, 250, 0.86), circle(150, 48), polygon(6, 60)], true, M(color, 4, 2))); hp = 70; r = 120; score = 3000; fireMin = 2.4; fireMax = 3; spin = 0.4; break;
    }
    const d = this.difficulty;
    const fireScale = (this.level.gentle?.fire ?? 1) * Math.max(0.5, 1 - 0.3 * d);
    if (kind !== "rock") hp *= 1 + 0.7 * d;
    const e: Enemy = {
      kind, obj: g, mats, color: new THREE.Color(color), x, y, sx: x, sy: y, age: 0, hp, maxHp: hp, r, score,
      fire: this.r.range(fireMin * 0.6, fireMax) * fireScale, fireMin: fireMin * fireScale, fireMax: fireMax * fireScale,
      burst: 0, burstT: 0, side, param, spin: spin * (this.r.chance(0.5) ? 1 : -1), dying: 0, blinkT: 1.5, ox: 0, oy: 0, fragment,
    };
    g.position.set(x, y, 0);
    this.root.add(g);
    this.enemies.push(e);
    return e;
  }

  /** Where each kind flies: a function of time from its spawn point (same patterns as the Unreal version, scaled). */
  private path(e: Enemy, t: number): [number, number] {
    const k = 0.47;
    switch (e.kind) {
      case "drone": return [Math.sin(t * 2.2) * 260 * k, -650 * k * t];
      case "fighter": { const late = Math.max(0, t - 5.5) ** 2; return [e.side * (520 * (1 - Math.exp(-0.9 * t)) + 220 * Math.sin(t * 1.3) + 260 * late) * k, (-950 * (1 - Math.exp(-1.6 * t)) + 380 * late) * k]; }
      case "rock": return [e.side * e.param * t, -170 * t];
      case "splitter": if (e.fragment) return [e.param * t, -560 * k * t]; // fall through to hover
      // eslint-disable-next-line no-fallthrough
      case "burster": case "blinker": case "cog": {
        const [In, Hold, Sway, Fall, Freq] = e.kind === "cog" ? [4, 20, 300, 200, 0.3] : e.kind === "burster" ? [2, 8, 600, 420, 0.9] : e.kind === "blinker" ? [3, 10, 0, 330, 0.45] : [2.5, 9, 300, 330, 0.8];
        return [e.side * Sway * k * Math.sin(t * Freq), (-Fall * Math.min(t, In) - 22 * clamp(t - In, 0, Hold) - 420 * Math.max(0, t - In - Hold)) * k];
      }
    }
    return [0, 0];
  }

  private updateEnemies(dt: number) {
    this.bigFight = 0;
    for (const e of [...this.enemies]) {
      if (e.dying > 0) {
        // Shot down: grey, spinning away, fading.
        e.dying -= dt;
        e.obj.rotation.z += dt * 8;
        e.obj.scale.multiplyScalar(1 - dt * 0.8);
        e.obj.position.z -= dt * 300;
        if (e.dying <= 0) this.remove(e);
        continue;
      }
      e.age += dt;
      const [px, py] = this.path(e, e.age);
      e.x = e.sx + px + e.ox; e.y = e.sy + py + e.oy;
      e.obj.position.set(e.x, e.y, 0);
      const T = e.age;
      if (e.kind === "cog") { e.obj.rotation.z += e.spin * dt; this.bigFight = 1; }
      else e.obj.rotation.set(Math.sin(T * 1.7) * 0.5, Math.cos(T * 1.3) * 0.55, T * e.spin);
      if (e.y < -HALF_H - 200 || e.y > HALF_H + 900 || Math.abs(e.x) > HALF_W + 600) { this.remove(e); continue; }
      // Ram the ship.
      if (this.dead <= 0 && Math.hypot(e.x - this.sx, e.y - this.sy) < e.r + 26) { this.hurt(e.kind === "cog" ? 40 : 30); if (e.kind !== "cog") this.kill(e, false); continue; }
      this.enemyFire(e, dt);
    }
  }

  private enemyFire(e: Enemy, dt: number) {
    const onScreen = Math.abs(e.x) < HALF_W - 20 && e.y < HALF_H - 40 && e.y > -HALF_H + 60;
    if (!onScreen) return;
    const aim = (): [number, number] => { const dx = this.sx - e.x, dy = this.sy - e.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    if (e.kind === "blinker") {
      e.blinkT -= dt;
      if (e.blinkT <= 0) {
        e.blinkT = this.r.range(1.8, 2.5);
        const wx = this.r.range(-HALF_W + 150, HALF_W - 150), wy = this.r.range(0, HALF_H - 120);
        this.burst(e.x, e.y, e.color, 10, 200);
        e.ox += wx - e.x; e.oy += wy - e.y;
        this.burst(wx, wy, e.color, 10, 200);
        const [ax, ay] = aim();
        this.fireShots(e, ax, ay, 3, 14, 470, new THREE.Color(0.6, 2, 2), 9);
      }
      return;
    }
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { e.burstT = 0.11; e.burst--; const [ax, ay] = aim(); this.fireShots(e, ax, ay, 1, 0, 640, new THREE.Color(2, 0.8, 0.4), 8); }
      return;
    }
    e.fire -= dt;
    if (e.fire > 0) return;
    e.fire = this.r.range(e.fireMin, e.fireMax);
    const [ax, ay] = aim();
    switch (e.kind) {
      case "drone": this.fireShots(e, ax, ay, 1, 0, 520, new THREE.Color(2, 0.5, 1.3), 9); break;
      case "fighter": if (e.age > 0.6 && e.age < 5.5) { e.burst = 3; e.burstT = 0; } break;
      case "burster": e.burst = 5; e.burstT = 0; break;
      case "splitter": this.fireShots(e, ax, ay, 1, 0, 480, new THREE.Color(1.6, 2, 0.4), 9); break;
      case "cog": { const rot = e.obj.rotation.z; for (let i = 0; i < 10; i++) { const a = rot + (i / 10) * Math.PI * 2; this.fireShots(e, Math.cos(a), Math.sin(a), 1, 0, 260, new THREE.Color(2, 1.3, 0.4), 12); } break; }
    }
  }

  private fireShots(e: Enemy, dx: number, dy: number, n: number, spreadDeg: number, speed: number, color: THREE.Color, r: number) {
    speed *= this.level.gentle?.shotSpeed ?? 1;
    for (let i = 0; i < n; i++) {
      const a = ((i - (n - 1) / 2) * spreadDeg * Math.PI) / 180;
      const vx = dx * Math.cos(a) - dy * Math.sin(a), vy = dx * Math.sin(a) + dy * Math.cos(a);
      this.eshots.push({ x: e.x + vx * e.r, y: e.y + vy * e.r, vx: vx * speed, vy: vy * speed, r, color, dmg: 10, life: 6 });
    }
    sfx("enemyShot", e.x / HALF_W, 0.5, r > 11 ? 0.7 : 1);
  }

  private hitEnemy(e: Enemy, dmg: number) {
    if (e.dying > 0 || e.y > HALF_H - 20) return;  // only once on screen
    e.hp -= dmg;
    e.obj.scale.setScalar(1.12);
    setTimeout(() => e.obj.scale.setScalar(1), 50);
    sfx("hit", e.x / HALF_W, 0.4);
    if (e.hp <= 0) this.kill(e, true);
  }

  private kill(e: Enemy, scored: boolean) {
    if (scored) this.score += e.score;
    this.explode(e.x, e.y, e.color.clone().multiplyScalar(1.6), e.kind === "cog" ? 2.4 : 1);
    // Grey out and spin away.
    for (const m of e.mats) m.color.setRGB(0.35, 0.36, 0.4);
    e.dying = 0.7;
    if (e.kind === "splitter" && !e.fragment) for (const d of [-200, 0, 200]) this.spawn("splitter", e.x, e.y, 1, d, true).sx = e.x;
    // Drops.
    this.killsSinceDrop++;
    const drops = this.level.gentle?.drops ?? 1;
    if (scored && (e.kind === "cog" || this.r.next() < 0.12 * drops || this.killsSinceDrop >= Math.round(10 / drops))) {
      this.killsSinceDrop = 0;
      const kind = this.r.chance(0.5) ? "weapon" : this.r.chance(0.5) ? "repair" : "shield";
      const c = kind === "weapon" ? 0xff9020 : kind === "repair" ? 0x50ff60 : 0x30c0ff;
      const mat = lineMaterial(c, 3, 2.2);
      const obj = new THREE.Group();
      obj.add(polylines([circle(22, 24), kind === "weapon" ? polygon(3, 12) : kind === "repair" ? cross(12, 4) : circle(10, 16)], true, mat));
      obj.position.set(e.x, e.y, 0);
      this.root.add(obj);
      this.pickups.push({ obj, mat, x: e.x, y: e.y, kind, age: 0 });
    }
  }

  private remove(e: Enemy) {
    this.root.remove(e.obj);
    e.obj.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    e.mats.forEach(disposeMaterial);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  // --- Shots ---
  private updateShots(dt: number) {
    const move = (list: Shot[]) => { for (const s of list) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; } };
    move(this.shots); move(this.eshots);
    for (const s of this.shots) {
      for (const e of this.enemies) {
        if (e.dying > 0) continue;
        if (Math.hypot(s.x - e.x, s.y - e.y) < e.r + s.r) { this.hitEnemy(e, s.dmg); s.life = 0; this.burst(s.x, s.y, new THREE.Color(0.5, 1.5, 2), 3, 250); break; }
      }
    }
    if (this.dead <= 0) for (const s of this.eshots) if (Math.hypot(s.x - this.sx, s.y - this.sy) < s.r + 18) { this.hurt(s.dmg); s.life = 0; }
    const alive = (s: Shot) => s.life > 0 && Math.abs(s.x) < HALF_W + 50 && Math.abs(s.y) < HALF_H + 100;
    this.shots = this.shots.filter(alive);
    this.eshots = this.eshots.filter(alive);
    const draw = (mesh: THREE.InstancedMesh, list: Shot[], stretch: number) => {
      const n = Math.min(list.length, MAX_SHOTS);
      for (let i = 0; i < n; i++) {
        const s = list[i];
        this.dummy.position.set(s.x, s.y, 2);
        this.dummy.rotation.set(0, 0, Math.atan2(s.vy, s.vx));
        this.dummy.scale.set(s.r * stretch, s.r, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        mesh.setColorAt(i, s.color);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    draw(this.shotMesh, this.shots, 2.6);
    draw(this.eshotMesh, this.eshots, 1);
  }

  private updatePickups(dt: number) {
    for (const p of [...this.pickups]) {
      p.age += dt;
      p.y -= 70 * dt;
      const dx = this.sx - p.x, dy = this.sy - p.y, d = Math.hypot(dx, dy);
      if (d < 220 && this.dead <= 0) { p.x += (dx / d) * 300 * dt; p.y += (dy / d) * 300 * dt; }
      p.obj.position.set(p.x, p.y, 0);
      p.obj.rotation.z += dt * 2;
      if (d < 40 && this.dead <= 0) {
        if (p.kind === "weapon") { this.weapon = Math.min(5, this.weapon + 1); this.say("WEAPON UP"); }
        else if (p.kind === "repair") { this.hull = Math.min(100, this.hull + 50); this.say("HULL REPAIRED"); }
        else { this.shieldHits = 4; this.say("SHIELD"); }
        sfx("powerUp", this.sx / HALF_W, 0.9);
        p.y = -9999;
      }
      if (p.y < -HALF_H - 60) { this.root.remove(p.obj); disposeMaterial(p.mat); this.pickups.splice(this.pickups.indexOf(p), 1); }
    }
  }

  // --- Effects ---
  burst(x: number, y: number, color: THREE.Color, n: number, speed: number) {
    for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.sparks.push({ pos: new THREE.Vector3(x, y, 5), vel: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, (Math.random() - 0.5) * s), life: 0, max: 0.3 + Math.random() * 0.5, color });
    }
  }
  explode(x: number, y: number, color: THREE.Color, scale: number) {
    this.burst(x, y, color, Math.round(40 * scale), 420 * Math.sqrt(scale));
    this.burst(x, y, new THREE.Color(2, 1.6, 1), Math.round(12 * scale), 250);
    const mat = lineMaterial(color.getHex(), 3, 2);
    const obj = polylines([circle(30, 40)], true, mat);
    obj.position.set(x, y, 3);
    this.root.add(obj);
    this.rings.push({ obj, mat, life: 0, max: 0.45, scale: 3 * scale });
    sfx(scale >= 1.8 ? "boomBig" : "boomSmall", x / HALF_W, Math.min(1.4, 0.5 + scale * 0.3));
  }
  private updateEffects(dt: number) {
    const pos = this.sparkPts.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.sparkPts.geometry.getAttribute("color") as THREE.BufferAttribute;
    this.sparks = this.sparks.filter((s) => (s.life += dt) < s.max);
    this.sparks.forEach((s, i) => {
      s.pos.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(1 - dt * 2.5);
      const f = 1 - s.life / s.max;
      pos.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
      col.setXYZ(i, s.color.r * f, s.color.g * f, s.color.b * f);
    });
    this.sparkPts.geometry.setDrawRange(0, this.sparks.length);
    pos.needsUpdate = true; col.needsUpdate = true;
    for (const r of [...this.rings]) {
      r.life += dt;
      const t = r.life / r.max;
      r.obj.scale.setScalar(1 + t * r.scale);
      r.mat.opacity = 1 - t; r.mat.transparent = true;
      if (t >= 1) { this.root.remove(r.obj); r.obj.geometry.dispose(); disposeMaterial(r.mat); this.rings.splice(this.rings.indexOf(r), 1); }
    }
  }
}
