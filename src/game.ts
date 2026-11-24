// The game: a long run to a finish line. Everything the player meets is decided by the level's seed and
// the distance flown (never by luck), so every player gets the same run and can compete on score. It
// gets harder every "minute" of distance: more waves, tougher enemies, new kinds. Points: simple enemies
// little, tough ones more, more again each danger level, a bonus for destroying a whole wave. Every
// 4,000 points three upgrades appear mid-screen: fly into one, the others go. Tunnels are mandatory.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { circle, cog, cross, disposeMaterial, lineMaterial, polygon, polylines, star, wire } from "./neon";
import { sfx } from "./audio";
import { Input, Rng, clamp } from "./util";
import type { Theme } from "./world";
import type { MusicStyle } from "./music";
import { TunnelRun } from "./tunnel";

export const HALF_W = 800, HALF_H = 450;

export type EnemyKind = "drone" | "fighter" | "burster" | "splitter" | "blinker" | "cog" | "rock";

export interface LevelDef {
  id: string; name: string; group: string; theme: Theme; music: MusicStyle; seed: number;
  /** Metres per second outside tunnels, and the finish line (m). */
  speed: number; finish: number;
  /** Starting difficulty; it rises by 0.11 every minute's worth of distance. */
  startDifficulty: number;
  /** New enemy kinds per minute: tiers[0] from the start, tiers[1] from the first minute, ... */
  tiers: EnemyKind[][];
  /** Mandatory tunnels: where (m), how long (tube units, 100 = 1 m), how simple (0..1). */
  tunnels: { at: number; length: number; simplicity: number }[];
  /** Mini-bosses: where (m) and which (their parts must be destroyed in order). */
  bosses: { at: number; kind: BossKind }[];
  gentle?: { waves: number; fire: number; shotSpeed: number; damage: number; endless: boolean };
}

export type BossKind = "fortress" | "dreadnought";
/** Three mini-bosses between the tunnels: two of one kind, one of the other. */
const BOSSES = (a: BossKind, b: BossKind) => [{ at: 4600, kind: a }, { at: 8200, kind: b }, { at: 14800, kind: a }];
const TUNNELS = (simple: number[]) => [2800, 6400, 10000, 13600].map((at, i) => ({ at, length: 120000, simplicity: simple[i] }));

export const LEVELS: LevelDef[] = [
  { id: "kids", name: "Sunny Synth", group: "FOR KIDS", theme: "Synthwave", music: "Bounce", seed: 4242, speed: 18, finish: 10000, startDifficulty: 0,
    tiers: [["drone"], ["rock"], ["splitter"]], tunnels: [2500, 5500, 8500].map((at) => ({ at, length: 60000, simplicity: 1 })), bosses: [{ at: 4000, kind: "fortress" }, { at: 7000, kind: "dreadnought" }],
    gentle: { waves: 1.9, fire: 2.2, shotSpeed: 0.55, damage: 0.5, endless: true } },
  { id: "nt01", name: "1  Clockwork Foundry", group: "NEON THEMES", theme: "Clockwork", music: "House", seed: 101, speed: 22, finish: 16000, startDifficulty: 0,
    tiers: [["drone"], ["splitter"], ["burster"], ["cog"], ["fighter"], ["blinker"]], tunnels: TUNNELS([0.75, 0.6, 0.45, 0.3]), bosses: BOSSES("fortress", "dreadnought") },
  { id: "nt02", name: "2  Circuit Board", group: "NEON THEMES", theme: "Circuit", music: "Chiptune", seed: 202, speed: 22, finish: 16000, startDifficulty: 0.1,
    tiers: [["drone"], ["fighter"], ["splitter"], ["blinker"], ["cog"], ["burster"]], tunnels: TUNNELS([0.65, 0.5, 0.35, 0.2]), bosses: BOSSES("dreadnought", "fortress") },
  { id: "nt03", name: "3  Synthwave Sunset", group: "NEON THEMES", theme: "Synthwave", music: "Synthwave", seed: 303, speed: 23, finish: 16000, startDifficulty: 0.2,
    tiers: [["fighter"], ["drone"], ["burster"], ["blinker"], ["cog"], ["splitter"]], tunnels: TUNNELS([0.55, 0.4, 0.25, 0.1]), bosses: BOSSES("fortress", "dreadnought") },
];

const hitMats = new Map<number, LineMaterial>();
function hitMat(c: number) {
  let m = hitMats.get(c);
  if (!m) { m = lineMaterial(c, 2, 1.2); m.depthTest = false; hitMats.set(c, m); }
  return m;
}

interface Shot { x: number; y: number; vx: number; vy: number; r: number; color: THREE.Color; dmg: number; life: number }
interface Enemy {
  kind: EnemyKind; obj: THREE.Group; mats: LineMaterial[]; color: THREE.Color; rng: Rng;
  x: number; y: number; sx: number; sy: number; age: number; hp: number; maxHp: number; r: number; score: number;
  fire: number; fireMin: number; fireMax: number; burst: number; burstT: number; side: number; param: number; spin: number;
  dying: number; blinkT: number; ox: number; oy: number; fragment: boolean;
  group: number; counted: boolean;
}
/** A wave: destroy every member (fragments too) for a bonus; one getting away spoils it. */
interface WaveGroup { alive: number; value: number; spoiled: boolean }
/** A mini-boss part: destroyed in stages (turrets or engines, then generators or turrets, then the core). */
interface BossPart { kind: "turret" | "engine" | "generator" | "core"; ox: number; oy: number; r: number; hp: number; maxHp: number; stage: number; obj: THREE.Group; mat: LineMaterial; shieldMat: LineMaterial; shield: THREE.Object3D; alive: boolean; fireT: number }
interface Boss { kind: BossKind; name: string; x: number; y: number; sx: number; age: number; parts: BossPart[]; stage: number; frame: THREE.Group; frameMat: LineMaterial; rng: Rng; spiral: number; leaving: boolean }
interface Spark { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; color: THREE.Color }
interface Ring { obj: LineSegments2; mat: LineMaterial; life: number; max: number; scale: number }

export type Upgrade = "weapon" | "rapid" | "power" | "shield" | "repair" | "life";
export const UPGRADES: Record<Upgrade, { name: string; color: number }> = {
  weapon: { name: "+1 GUN", color: 0xff9020 },
  rapid: { name: "FASTER FIRE", color: 0xffe040 },
  power: { name: "+25% DAMAGE", color: 0xff4060 },
  shield: { name: "SHIELD x4", color: 0x30c0ff },
  repair: { name: "REPAIR", color: 0x50ff60 },
  life: { name: "+1 LIFE", color: 0xff60ff },
};
interface Pod { obj: THREE.Group; mat: LineMaterial; x: number; y: number; kind: Upgrade }

const MAX_SHOTS = 700, MAX_SPARKS = 1500;
/** The ship's hit circles: small for bullets (the core), wider for bumping into enemies (the wings). */
const SHIP_HIT = 16, SHIP_RAM = 28;
/** Points between upgrade offers. */
export const BONUS_EVERY = 4000;

export class Game {
  readonly root = new THREE.Group();
  score = 0; lives = 3; hull = 100; weapon = 1; shieldHits = 0;
  /** Metres flown (the run's clock and its result), and seconds played. */
  dist = 0; runTime = 0;
  done = false; over = false; message = ""; messageT = 0;
  bigFight = 0;
  fireRate = 1; damage = 1;
  private skill: number;
  private waveRng: Rng;
  private ship: THREE.Group; private shipMat: LineMaterial; private flame: THREE.Mesh;
  private sx = 0; private sy = -330; private vx = 0; private vy = 0; private bank = 0;
  private fireT = 0; private invuln = 2; private dead = 0;
  private shots: Shot[] = []; private eshots: Shot[] = [];
  private shotMesh: THREE.InstancedMesh; private eshotMesh: THREE.InstancedMesh;
  private enemies: Enemy[] = [];
  private sparks: Spark[] = []; private sparkPts: THREE.Points;
  private rings: Ring[] = [];
  private nextWave = 40; private waveIndex = 0; private lastCog = -1e9;
  private minuteShown = 0;
  private dummy = new THREE.Object3D();
  // Mini-boss
  boss: Boss | null = null;
  private bossIndex = 0;
  // Upgrade offers
  pods: Pod[] = [];
  private offerIndex = 0;
  /** Score at which the next upgrade offer appears. */
  nextBonus = BONUS_EVERY;
  private podTime = 0;
  private groups = new Map<number, WaveGroup>();
  private currentGroup = -1;
  // Tunnels
  tunnel: TunnelRun | null = null;
  flash = 0;
  private tunnelIndex = 0;
  private tunnelStart = 0;
  private portal: { obj: THREE.Group; mats: LineMaterial[]; x: number; y: number } | null = null;
  // Hit-box view (H)
  showHits = false;
  private hitView = new THREE.Group();

  constructor(readonly level: LevelDef, skill: number) {
    this.skill = skill;
    this.waveRng = new Rng(level.seed * 31 + 7);
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
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_SHOTS);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color()); this.root.add(m); return m;
    };
    this.shotMesh = mk(new THREE.CircleGeometry(1, 12));
    this.eshotMesh = mk(new THREE.CircleGeometry(1, 16));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    sg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    this.sparkPts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 5, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    this.sparkPts.frustumCulled = false;
    this.root.add(this.sparkPts);
    this.root.add(this.hitView);
  }

  /** Which "minute" of the run this distance is (a minute's worth of flying at the level's speed). */
  get minute() { return Math.floor(this.dist / (this.level.speed * 60)); }
  get difficulty() {
    let d = this.level.startDifficulty + 0.11 * (this.dist / (this.level.speed * 60));
    if (this.skill === 0) d *= 0.6; else if (this.skill === 2) d += 0.3;
    return Math.min(1.6, d);
  }
  get progress() { return clamp(this.dist / this.level.finish, 0, 1); }
  get shipX() { return this.sx; }
  debugShipY() { return this.sy; }

  dispose() {
    if (this.boss) this.removeBoss();
    for (const e of this.enemies) e.mats.forEach(disposeMaterial);
    for (const p of this.pods) disposeMaterial(p.mat);
    for (const r of this.rings) disposeMaterial(r.mat);
    disposeMaterial(this.shipMat);
    this.tunnel?.dispose();
    this.portal?.mats.forEach(disposeMaterial);
  }

  private say(m: string, t = 2.2) { this.message = m; this.messageT = t; }

  update(dt: number, input: Input) {
    this.messageT -= dt;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (this.done || this.over) { this.updateEffects(dt); return; }
    this.runTime += dt;
    if (this.tunnel) { this.updateTunnel(dt, input); return; }
    this.dist += this.level.speed * dt;
    if (this.minute > this.minuteShown) {
      this.minuteShown = this.minute;
      this.say(`DANGER LEVEL ${this.minute + 1}`);
      sfx("warning", 0, 0.6);
    }
    this.updateShip(dt, input);
    this.updateWaves();
    this.updateOffers(dt);
    this.updatePortal(dt);
    this.updateBoss(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateEffects(dt);
    this.drawHits();
    if (this.dist >= this.level.finish) {
      const bonus = 5000 + (this.level.gentle?.endless ? 0 : this.lives * 5000);
      this.score += bonus;
      this.done = true;
      this.say(`FINISH!  +${bonus}   SCORE ${this.score.toLocaleString("en-US")}`, 7);
      sfx("powerUp", 0, 1);
    }
  }

  // --- Ship ---
  private updateShip(dt: number, input: Input) {
    if (this.dead > 0) {
      this.dead -= dt;
      this.ship.visible = false;
      if (this.dead <= 0) { this.ship.visible = true; this.sx = 0; this.sy = -330; this.hull = 100; this.invuln = 2.5; }
      return;
    }
    const mv = input.move();
    let speed = 760;
    if (input.down("Space")) speed *= 1.6;
    if (input.down("ShiftLeft", "ShiftRight")) speed *= 0.45;
    const a = 1 - Math.exp(-dt / 0.07);
    this.vx += (mv.x * speed - this.vx) * a;
    this.vy += (mv.y * speed - this.vy) * a;
    this.sx = clamp(this.sx + this.vx * dt, -HALF_W + 50, HALF_W - 50);
    this.sy = clamp(this.sy + this.vy * dt, -HALF_H + 50, HALF_H - 60);
    this.bank += (clamp(this.vx / 760, -1, 1) * 0.65 - this.bank) * (1 - Math.exp(-dt * 8));
    this.ship.position.set(this.sx, this.sy, 0);
    this.ship.rotation.set(0, this.bank, 0);
    this.invuln -= dt;
    this.ship.visible = this.invuln <= 0 || Math.floor(this.runTime * 12) % 2 === 0;
    this.flame.scale.setScalar((input.down("Space") ? 1.5 : 1) * (0.8 + 0.3 * Math.random()));
    this.fireT -= dt;
    if (input.fire() && this.fireT <= 0) {
      this.fireT = 0.09 / this.fireRate;
      const n = this.weapon;
      for (let i = 0; i < n; i++) {
        const off = i - (n - 1) / 2;
        const ang = off * (n >= 3 ? 5 : 0) * (Math.PI / 180);
        this.shots.push({ x: this.sx + off * 14, y: this.sy + 40, vx: Math.sin(ang) * 1900, vy: Math.cos(ang) * 1900, r: 6, color: new THREE.Color(0.4, 1.6, 2.2), dmg: this.damage, life: 1 });
      }
      sfx("playerShot", this.sx / HALF_W, 0.6);
    }
  }

  private loseLife() {
    if (this.level.gentle?.endless) return;
    this.lives--;
    if (this.lives <= 0) { this.over = true; this.say(`RUN OVER  -  SCORE ${this.score.toLocaleString("en-US")}`, 7); }
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
      this.loseLife();
    }
  }

  // --- Waves: scheduled by distance, from the level's seed ---
  private updateWaves() {
    if (this.dist < this.nextWave || this.portal || this.boss) return;
    const d = this.difficulty;
    const r = this.waveRng;
    const skillWave = this.skill === 0 ? 1.35 : this.skill === 2 ? 0.85 : 1;
    const gapSeconds = Math.max(1.2, 3.3 - 1.7 * Math.min(d, 1.2)) * skillWave * (this.level.gentle?.waves ?? 1);
    this.nextWave = this.dist + gapSeconds * this.level.speed;
    // The kinds unlocked so far, the newest more likely.
    const tiers = this.level.tiers;
    const unlocked = Math.min(this.minute, tiers.length - 1);
    const pool: EnemyKind[] = [];
    for (let i = 0; i <= unlocked; i++) for (const k of tiers[i]) for (let w = 0; w < (i === unlocked ? 3 : 2); w++) pool.push(k);
    const groups = d > 0.7 && r.chance(Math.min(0.6, (d - 0.7) * 1.2)) ? 2 : 1;  // later: two groups at once
    for (let gI = 0; gI < groups; gI++) {
      let kind = r.pick(pool);
      if (kind === "cog" && this.dist - this.lastCog < this.level.speed * 25) kind = tiers[0][0];
      this.spawnGroup(kind, r, d);
    }
  }

  private spawnGroup(kind: EnemyKind, r: Rng, d: number) {
    this.spawnGroupInner(kind, r, d);
    this.currentGroup = -1;
  }

  private spawnGroupInner(kind: EnemyKind, r: Rng, d: number) {
    const top = HALF_H + 80;
    const lane = r.range(-HALF_W + 220, HALF_W - 220);
    const extra = d > 0.9 ? 1 : 0;  // bigger groups later
    const add = (k: EnemyKind, x: number, y: number, side = 1, param = 0) => this.spawn(k, x, y, side, param, false, this.level.seed * 1000003 + this.waveIndex * 97 + this.enemies.length);
    this.waveIndex++;
    this.currentGroup = this.waveIndex;
    this.groups.set(this.currentGroup, { alive: 0, value: 0, spoiled: false });
    switch (kind) {
      case "drone": for (let i = 0; i < 4 + extra * 2; i++) add("drone", lane, top + i * 140); break;
      case "fighter": add("fighter", -HALF_W + 120, top + 40, 1); add("fighter", HALF_W - 120, top + 150, -1); if (extra) add("fighter", 0, top + 260, r.chance(0.5) ? 1 : -1); break;
      case "burster": { const s = r.chance(0.5) ? 1 : -1; for (let i = 0; i < 3 + extra; i++) add("burster", clamp(lane + (i - 1) * 200, -HALF_W + 120, HALF_W - 120), top + i * 120, i % 2 ? -s : s); break; }
      case "splitter": add("splitter", lane - 130, top, 1); add("splitter", lane + 130, top + 160, -1); if (extra) add("splitter", lane, top + 300, 1); break;
      case "blinker": for (let i = 0; i < 2 + extra; i++) add("blinker", clamp(lane + (i - 0.5) * 280, -HALF_W + 150, HALF_W - 150), top + i * 100); break;
      case "rock": for (let i = 0; i < 5 + extra * 2; i++) add("rock", r.range(-HALF_W + 100, HALF_W - 100), top + i * 120, r.chance(0.5) ? 1 : -1, r.range(0, 60)); break;
      case "cog": this.lastCog = this.dist; add("cog", clamp(lane, -HALF_W + 330, HALF_W - 330), top + 280, r.chance(0.5) ? 1 : -1); break;
    }
  }

  private spawn(kind: EnemyKind, x: number, y: number, side = 1, param = 0, fragment = false, seed = 1): Enemy {
    const rng = new Rng(seed);
    const g = new THREE.Group();
    const mats: LineMaterial[] = [];
    const M = (c: number, w: number, i = 2.4) => { const m = lineMaterial(c, w, i); mats.push(m); return m; };
    let color = 0xff3030, hp = 3, r = 34, score = 100, fireMin = 1.6, fireMax = 2.8, spin = 2.4;
    switch (kind) {
      case "drone": color = 0xff2020; g.add(wire(new THREE.TetrahedronGeometry(42), M(color, 3))); r = 36; score = 50; spin = 2.4; break;
      case "fighter": color = 0x33ff66; g.add(polylines([cross(46, 15)], true, M(color, 3))); r = 42; hp = 8; score = 200; fireMin = 1.1; fireMax = 1.5; spin = 3.5; break;
      case "burster": color = 0xff7390; g.add(polylines([star(5, 56, 0.38), polygon(5, 20)], true, M(color, 3))); hp = 12; score = 250; r = 46; fireMin = 1.4; fireMax = 1.9; spin = 4; break;
      case "splitter": color = 0xbfff33; g.add(wire(new THREE.IcosahedronGeometry(fragment ? 26 : 46), M(color, fragment ? 2 : 3))); hp = fragment ? 3 : 10; r = fragment ? 24 : 42; score = fragment ? 30 : 120; spin = 2.8; break;
      case "blinker": color = 0x99ffff; { const o = wire(new THREE.OctahedronGeometry(36), M(color, 3)); o.scale.set(0.8, 1.4, 0.8); g.add(o); } r = 38; hp = 9; score = 300; fireMin = 99; fireMax = 99; spin = 3.5; break;
      case "rock": color = 0x9966ff; g.add(wire(new THREE.IcosahedronGeometry(48, 0), M(color, 2.5, 1.8))); hp = 6; r = 44; score = 40; fireMin = 99; fireMax = 99; spin = 1.2; break;
      case "cog": color = 0xffa020; g.add(polylines([cog(16, 250, 0.86), circle(150, 48), polygon(6, 60)], true, M(color, 4, 2))); hp = 70; r = 238; score = 1500; fireMin = 2.4; fireMax = 3; spin = 0.4; break;
    }
    const d = this.difficulty;
    const fireScale = (this.level.gentle?.fire ?? 1) * Math.max(0.45, 1 - 0.35 * d);
    if (kind !== "rock") hp *= 1 + 0.8 * d;
    score = Math.round((score * (1 + 0.2 * this.minute)) / 10) * 10;  // worth more each danger level
    const e: Enemy = {
      kind, obj: g, mats, color: new THREE.Color(color), rng, x, y, sx: x, sy: y, age: 0, hp, maxHp: hp, r, score,
      fire: rng.range(fireMin * 0.6, fireMax) * fireScale, fireMin: fireMin * fireScale, fireMax: fireMax * fireScale,
      burst: 0, burstT: 0, side, param, spin: spin * (rng.chance(0.5) ? 1 : -1), dying: 0, blinkT: 1.5, ox: 0, oy: 0, fragment,
      group: this.currentGroup, counted: false,
    };
    const wg = this.groups.get(this.currentGroup);
    if (wg) wg.alive++;
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
      if (this.dead <= 0 && Math.hypot(e.x - this.sx, e.y - this.sy) < e.r + SHIP_RAM) { this.hurt(e.kind === "cog" ? 40 : 30); if (e.kind !== "cog") this.kill(e, false); continue; }
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
        e.blinkT = e.rng.range(1.8, 2.5);
        const wx = e.rng.range(-HALF_W + 150, HALF_W - 150), wy = e.rng.range(0, HALF_H - 120);
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
    e.fire = e.rng.range(e.fireMin, e.fireMax);
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
    speed *= (this.level.gentle?.shotSpeed ?? 1) * (1 + 0.15 * Math.min(this.difficulty, 1.5));
    for (let i = 0; i < n; i++) {
      const a = ((i - (n - 1) / 2) * spreadDeg * Math.PI) / 180;
      const vx = dx * Math.cos(a) - dy * Math.sin(a), vy = dx * Math.sin(a) + dy * Math.cos(a);
      this.eshots.push({ x: e.x + vx * e.r, y: e.y + vy * e.r, vx: vx * speed, vy: vy * speed, r, color, dmg: 10, life: 6 });
    }
    sfx("enemyShot", e.x / HALF_W, 0.5, r > 11 ? 0.7 : 1);
  }

  private hitEnemy(e: Enemy, dmg: number) {
    if (e.dying > 0 || e.y > HALF_H + e.r * 0.3) return;  // only once (mostly) on screen
    e.hp -= dmg;
    e.obj.scale.setScalar(1.12);
    setTimeout(() => e.obj.scale.setScalar(1), 50);
    sfx("hit", e.x / HALF_W, 0.4);
    if (e.hp <= 0) this.kill(e, true);
  }

  private kill(e: Enemy, scored: boolean) {
    if (scored) this.score += e.score;
    e.counted = true;
    const wg = this.groups.get(e.group);
    if (wg) {
      wg.alive--;
      if (scored) wg.value += e.score; else wg.spoiled = true;
    }
    this.explode(e.x, e.y, e.color.clone().multiplyScalar(1.6), e.kind === "cog" ? 2.4 : 1);
    for (const m of e.mats) m.color.setRGB(0.35, 0.36, 0.4);
    e.dying = 0.7;
    if (e.kind === "splitter" && !e.fragment) {
      this.currentGroup = e.group;  // the fragments belong to the same wave
      [-200, 0, 200].forEach((d, i) => this.spawn("splitter", e.x, e.y, 1, d, true, e.rng.int(1, 1e9) + i));
      this.currentGroup = -1;
    }
    this.checkGroup(e.group, e.x, e.y);
  }

  /** A wave fully destroyed: a bonus worth half of it (and at least 100). */
  private checkGroup(id: number, x: number, y: number) {
    const wg = this.groups.get(id);
    if (!wg || wg.alive > 0) return;
    this.groups.delete(id);
    if (wg.spoiled) return;
    const bonus = Math.max(100, Math.round(wg.value / 2 / 10) * 10);
    this.score += bonus;
    this.say(`WAVE CLEARED  +${bonus}`, 1.4);
    this.burst(x, y, new THREE.Color(2, 1.8, 0.6), 24, 380);
  }

  // --- Mini-bosses: parts in order ---
  private spawnBoss(kind: BossKind) {
    const rng = new Rng(this.level.seed * 7777 + this.bossIndex * 31);
    const frame = new THREE.Group();
    const frameMat = lineMaterial(kind === "fortress" ? 0x8899ff : 0xff66cc, 3, 1.6);
    const parts: BossPart[] = [];
    const d = this.difficulty, hpScale = (1 + 0.6 * d) * (this.level.gentle ? 0.5 : 1);
    const addPart = (pk: BossPart["kind"], ox: number, oy: number, r: number, hp: number, stage: number) => {
      const color = pk === "turret" ? 0xffcc33 : pk === "engine" ? 0x33ccff : pk === "generator" ? 0x66ff66 : 0xff3355;
      const mat = lineMaterial(color, 3, 2.4);
      const obj = new THREE.Group();
      const shape = pk === "turret" ? [polygon(8, r), cross(r * 0.7, r * 0.2)] : pk === "engine" ? [polygon(4, r, 0), circle(r * 0.55, 20)] : pk === "generator" ? [circle(r, 32), star(6, r * 0.75, 0.45)] : [polygon(6, r), polygon(6, r * 0.6), circle(r * 0.3, 20)];
      obj.add(polylines(shape, true, mat));
      const shieldMat = lineMaterial(0x6688ff, 2, 0.8);
      const shield = polylines([circle(r + 14, 40)], true, shieldMat);
      obj.add(shield);
      obj.position.set(ox, oy, 1);
      frame.add(obj);
      parts.push({ kind: pk, ox, oy, r, hp: hp * hpScale, maxHp: hp * hpScale, stage, obj, mat, shieldMat, shield, alive: true, fireT: rng.range(0.5, 1.5) });
    };
    const outline: THREE.Vector3[][] = [];
    if (kind === "fortress") {
      // A hexagonal fortress: four corner turrets, two generators, the core in the middle.
      outline.push(polygon(6, 260, 0), polygon(6, 170, 0));
      for (const [x, y] of [[-200, 110], [200, 110], [-200, -110], [200, -110]]) addPart("turret", x, y, 34, 14, 0);
      for (const x of [-110, 110]) addPart("generator", x, 0, 38, 26, 1);
      addPart("core", 0, 0, 52, 60, 2);
    } else {
      // A long dreadnought: engines at the back, turrets along the sides, the core at the bow.
      const hull = [[0, 220], [120, 90], [150, -160], [60, -230], [-60, -230], [-150, -160], [-120, 90]].map(([x, y]) => new THREE.Vector3(x, y, 0));
      outline.push(hull);
      for (const x of [-80, 0, 80]) addPart("engine", x, -200, 30, 16, 0);
      for (const [x, y] of [[-120, -40], [120, -40]]) addPart("turret", x, y, 34, 22, 1);
      addPart("core", 0, 120, 48, 60, 2);
    }
    frame.add(polylines(outline, true, frameMat));
    this.root.add(frame);
    const name = kind === "fortress" ? "MINI-BOSS: FORTRESS" : "MINI-BOSS: DREADNOUGHT";
    this.boss = { kind, name, x: 0, y: HALF_H + 320, sx: 0, age: 0, parts, stage: 0, frame, frameMat, rng, spiral: 0, leaving: false };
    this.refreshShields();
    this.say(name + (kind === "fortress" ? "  -  TURRETS FIRST" : "  -  ENGINES FIRST"), 3);
    sfx("warning", 0, 0.9);
  }

  private refreshShields() {
    const b = this.boss!;
    for (const p of b.parts) {
      p.shield.visible = p.alive && p.stage > b.stage;
      p.mat.opacity = p.stage > b.stage ? 0.35 : 1;
      p.mat.transparent = p.stage > b.stage;
      p.mat.needsUpdate = true;
    }
  }

  private hitPart(p: BossPart, dmg: number, x: number, y: number) {
    const b = this.boss!;
    if (p.stage > b.stage) { this.burst(x, y, new THREE.Color(0.6, 0.8, 2), 4, 200); sfx("shield", x / HALF_W, 0.25, 1.6); return; }  // shielded: not yet
    p.hp -= dmg;
    p.obj.scale.setScalar(1.1);
    setTimeout(() => p.obj.scale.setScalar(1), 50);
    sfx("hit", x / HALF_W, 0.4);
    if (p.hp > 0) return;
    p.alive = false;
    p.obj.visible = false;
    this.explode(b.x + p.ox, b.y + p.oy, new THREE.Color(p.mat.color.getHex()).multiplyScalar(1.4), p.kind === "core" ? 3 : 1.3);
    this.score += Math.round(((p.kind === "core" ? 5000 : p.kind === "generator" ? 1200 : 800) * (1 + 0.2 * this.minute)) / 10) * 10;
    if (b.parts.some((q) => q.alive && q.stage === b.stage)) return;
    // Stage cleared: the next parts lose their shields.
    b.stage++;
    const next = b.parts.filter((q) => q.alive && q.stage === b.stage);
    if (next.length === 0) {
      this.say("MINI-BOSS DESTROYED", 3);
      for (let i = 0; i < 5; i++) this.explode(b.x + b.rng.range(-200, 200), b.y + b.rng.range(-150, 150), new THREE.Color(2, 1.2, 0.5), 1.5);
      this.removeBoss();
      return;
    }
    this.say(next[0].kind === "core" ? "CORE EXPOSED!" : next[0].kind.toUpperCase() + "S EXPOSED");
    this.refreshShields();
  }

  private removeBoss() {
    const b = this.boss!;
    this.root.remove(b.frame);
    b.frame.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    disposeMaterial(b.frameMat);
    for (const p of b.parts) { disposeMaterial(p.mat); disposeMaterial(p.shieldMat); }
    this.boss = null;
  }

  /** Boss health 0..1 (all parts), for the HUD. */
  get bossHealth() {
    if (!this.boss) return 0;
    let hp = 0, max = 0;
    for (const p of this.boss.parts) { hp += Math.max(0, p.alive ? p.hp : 0); max += p.maxHp; }
    return max > 0 ? hp / max : 0;
  }

  private updateBoss(dt: number) {
    const next = this.level.bosses[this.bossIndex];
    if (!this.boss && next && this.dist >= next.at && !this.portal && !this.tunnel) { this.spawnBoss(next.kind); this.bossIndex++; }
    const b = this.boss;
    if (!b) return;
    b.age += dt;
    this.bigFight = 1;
    // In, hover and sway; it leaves after a while (or when a tunnel comes).
    if (b.age > 50 || (this.level.tunnels[this.tunnelIndex] && this.dist > this.level.tunnels[this.tunnelIndex].at - 150)) b.leaving = true;
    const targetY = b.leaving ? HALF_H + 500 : HALF_H - 230;
    b.y += (targetY - b.y) * (1 - Math.exp(-dt * (b.leaving ? 1.2 : 0.8)));
    b.x = Math.sin(b.age * 0.35) * 260;
    b.frame.position.set(b.x, b.y, 0);
    b.frame.rotation.z = Math.sin(b.age * 0.5) * 0.06;
    if (b.leaving && b.y > HALF_H + 420) { this.say("THE MINI-BOSS GOT AWAY"); this.removeBoss(); return; }
    // Bumping into it hurts.
    if (this.dead <= 0 && Math.abs(this.sx - b.x) < 230 && Math.abs(this.sy - b.y) < 200) this.hurt(35);
    if (b.y > HALF_H - 60 || b.leaving) return;
    // Fire from the live parts: turrets aim, engines and generators throw rings, the core spirals.
    const fireScale = (this.level.gentle?.fire ?? 1) * Math.max(0.5, 1 - 0.3 * this.difficulty);
    for (const p of b.parts) {
      if (!p.alive) continue;
      p.fireT -= dt;
      if (p.fireT > 0) continue;
      const x = b.x + p.ox, y = b.y + p.oy;
      const dx = this.sx - x, dy = this.sy - y, l = Math.hypot(dx, dy) || 1;
      const fake = { x, y, r: p.r } as Enemy;
      switch (p.kind) {
        case "turret": p.fireT = 1.5 * fireScale; this.fireShots(fake, dx / l, dy / l, p.stage === b.stage ? 2 : 1, 10, 520, new THREE.Color(2, 1.6, 0.3), 9); break;
        case "engine": p.fireT = 2.6 * fireScale; for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.35; this.fireShots(fake, Math.cos(a), Math.sin(a), 1, 0, 330, new THREE.Color(0.4, 1.6, 2), 10); } break;
        case "generator": p.fireT = 3 * fireScale; for (let i = 0; i < 8; i++) { const a = b.age + (i / 8) * Math.PI * 2; this.fireShots(fake, Math.cos(a), Math.sin(a), 1, 0, 300, new THREE.Color(0.6, 2, 0.6), 11); } break;
        case "core":
          if (p.stage > b.stage) { p.fireT = 1; break; }
          p.fireT = 0.16 * fireScale;
          b.spiral += 0.45;
          for (let i = 0; i < 3; i++) { const a = b.spiral + (i / 3) * Math.PI * 2; this.fireShots(fake, Math.cos(a), Math.sin(a), 1, 0, 330, new THREE.Color(2, 0.4, 0.6), 10); }
          break;
      }
    }
  }

  // --- Upgrade offers: every 4,000 points, three different ones mid-screen; take one ---
  private updateOffers(dt: number) {
    if (this.pods.length === 0 && !this.portal && this.score >= this.nextBonus) {
      this.nextBonus = (Math.floor(this.score / BONUS_EVERY) + 1) * BONUS_EVERY;
      this.podTime = 0;
      const r = new Rng(this.level.seed * 977 + this.offerIndex * 131);
      this.offerIndex++;
      const all: Upgrade[] = ["weapon", "rapid", "power", "shield", "repair", "life"];
      const pick: Upgrade[] = [];
      while (pick.length < 3) { const u = r.pick(all); if (!pick.includes(u)) pick.push(u); }
      pick.forEach((kind, i) => {
        const mat = lineMaterial(UPGRADES[kind].color, 3.5, 2.4);
        const obj = new THREE.Group();
        const icon = kind === "weapon" ? polygon(3, 16) : kind === "rapid" ? star(4, 18, 0.4) : kind === "power" ? star(6, 18, 0.5) : kind === "shield" ? circle(13, 16) : kind === "repair" ? cross(15, 5) : polygon(4, 15, 0);
        obj.add(polylines([polygon(6, 42, 0), icon], true, mat));
        this.root.add(obj);
        this.pods.push({ obj, mat, x: (i - 1) * 420, y: 40, kind });
        this.burst((i - 1) * 420, 40, new THREE.Color(UPGRADES[kind].color), 20, 260);
      });
      this.say("BONUS!  CHOOSE ONE", 1.6);
      sfx("powerUp", 0, 0.6, 1.3);
    }
    if (this.pods.length === 0) return;
    // They hover mid-screen for a few seconds, blinking as they're about to go.
    this.podTime += dt;
    for (const p of [...this.pods]) {
      p.obj.position.set(p.x, p.y + Math.sin(this.podTime * 3 + p.x) * 10, 0);
      p.obj.rotation.z += dt * 1.5;
      p.obj.visible = this.podTime < 5.5 || Math.floor(this.podTime * 8) % 2 === 0;
      if (this.dead <= 0 && Math.hypot(p.x - this.sx, p.y - this.sy) < 42 + SHIP_RAM) { this.take(p.kind); this.clearPods(); return; }
    }
    if (this.podTime > 7) { this.say("BONUS MISSED"); this.clearPods(); }
  }

  private take(kind: Upgrade) {
    switch (kind) {
      case "weapon": if (this.weapon < 5) this.weapon++; else this.score += 2000; break;
      case "rapid": this.fireRate = Math.min(2, this.fireRate * 1.18); break;
      case "power": this.damage *= 1.25; break;
      case "shield": this.shieldHits += 4; break;
      case "repair": this.hull = Math.min(100, this.hull + 60); break;
      case "life": this.lives++; break;
    }
    this.say(UPGRADES[kind].name);
    sfx("powerUp", this.sx / HALF_W, 0.9);
  }

  private clearPods() {
    for (const p of this.pods) { this.burst(p.x, p.y, new THREE.Color(UPGRADES[p.kind].color), 14, 220); this.root.remove(p.obj); disposeMaterial(p.mat); }
    this.pods = [];
  }

  // --- Tunnels: mandatory, at fixed distances ---
  private updatePortal(dt: number) {
    const t = this.level.tunnels[this.tunnelIndex];
    if (!t) return;
    if (!this.portal && this.dist >= t.at) {
      const mats = [lineMaterial(0xff8c1a, 4, 2.4), lineMaterial(0x19e6ff, 2.5, 1.6)];
      const obj = new THREE.Group();
      obj.add(polylines([circle(130, 48)], true, mats[0]));
      obj.add(polylines([circle(95, 40), circle(60, 32), circle(30, 24)], true, mats[1]));
      this.portal = { obj, mats, x: 0, y: HALF_H + 160 };
      obj.position.set(0, this.portal.y, -30);
      this.root.add(obj);
      this.say(`TUNNEL ${this.tunnelIndex + 1} AHEAD`);
    }
    const p = this.portal;
    if (!p) return;
    p.y -= 260 * dt;
    p.obj.position.set(p.x, p.y, -30);
    p.obj.rotation.z += dt * 1.5;
    const s = 1 + 0.08 * Math.sin(this.runTime * 6);
    p.obj.scale.set(s, s, 1);
    if (p.y <= this.sy + 30) this.enterTunnel();
  }

  private enterTunnel() {
    const t = this.level.tunnels[this.tunnelIndex];
    if (this.portal) { this.root.remove(this.portal.obj); this.portal.mats.forEach(disposeMaterial); this.portal = null; }
    sfx("whoosh", 0, 1);
    this.flash = 1;
    this.tunnelStart = this.dist;
    this.tunnel = new TunnelRun(t.length, this.level.seed * 13 + this.tunnelIndex * 101 + 5, t.simplicity, this.skill);
    this.tunnelIndex++;
    this.say("TUNNEL DIVE");
    for (const e of [...this.enemies]) this.remove(e);
    if (this.boss) this.removeBoss();
    this.eshots = [];
    this.clearPods();
    if (this.dead > 0) { this.dead = 0; this.hull = 100; }
  }

  private updateTunnel(dt: number, input: Input) {
    const run = this.tunnel!;
    const res = run.update(dt, input);
    this.dist = this.tunnelStart + run.s / 100;
    if (run.message) this.say(run.message);
    if (res === "running") return;
    // Crash or not, the tunnel counts in full: everyone's run stays in step.
    this.dist = this.tunnelStart + run.length / 100;
    run.dispose();
    this.tunnel = null;
    this.flash = 1;
    this.invuln = 2.5;
    this.sx = 0; this.sy = -300; this.vx = this.vy = 0;
    this.nextWave = this.dist + 60;
    if (res === "crashed") {
      this.say("SHIP LOST - BACK OUTSIDE");
      this.weapon = Math.max(1, this.weapon - 1);
      this.loseLife();
    } else {
      const bonus = 2000 * this.tunnelIndex;
      this.score += bonus;
      this.say(`TUNNEL CLEARED  +${bonus}`);
      sfx("powerUp", 0, 1);
    }
  }

  private drawHits() {
    for (const c of [...this.hitView.children]) { this.hitView.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    if (!this.showHits) return;
    const ring = (x: number, y: number, r: number, color: number) => {
      const pts = Array.from({ length: 32 }, (_, i) => new THREE.Vector3(x + Math.cos((i / 32) * Math.PI * 2) * r, y + Math.sin((i / 32) * Math.PI * 2) * r, 8));
      const l = polylines([pts], true, hitMat(color));
      l.renderOrder = 10;
      this.hitView.add(l);
    };
    for (const e of this.enemies) if (e.dying <= 0) ring(e.x, e.y, e.r, 0xffff00);
    if (this.boss) for (const p of this.boss.parts) if (p.alive) ring(this.boss.x + p.ox, this.boss.y + p.oy, p.r, p.stage === this.boss.stage ? 0xffff00 : 0x6666ff);
    if (this.dead <= 0) { ring(this.sx, this.sy, SHIP_HIT, 0x00ff00); ring(this.sx, this.sy, SHIP_RAM, 0x008800); }
    for (const s of this.eshots) ring(s.x, s.y, s.r, 0xff00ff);
  }

  private remove(e: Enemy) {
    if (!e.counted) {
      // Got away (off screen, or cleared by a tunnel dive): that wave's bonus is gone.
      e.counted = true;
      const wg = this.groups.get(e.group);
      if (wg) { wg.alive--; wg.spoiled = true; if (wg.alive <= 0) this.groups.delete(e.group); }
    }
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
    // Swept: does the shot's path this frame pass within reach of the target (fast shots can't skip past)?
    const near = (s: Shot, x: number, y: number, reach: number) => {
      const ax = s.x - s.vx * dt, ay = s.y - s.vy * dt, bx = s.x - ax, by = s.y - ay;
      const t = clamp(((x - ax) * bx + (y - ay) * by) / Math.max(1e-6, bx * bx + by * by), 0, 1);
      return Math.hypot(ax + bx * t - x, ay + by * t - y) < reach;
    };
    if (this.boss) for (const s of this.shots) {
      for (const p of this.boss.parts) {
        if (!p.alive || s.life <= 0) continue;
        if (near(s, this.boss.x + p.ox, this.boss.y + p.oy, p.r + s.r)) { this.hitPart(p, s.dmg, s.x, s.y); s.life = 0; }
      }
    }
    for (const s of this.shots) {
      if (s.life <= 0) continue;
      for (const e of this.enemies) {
        if (e.dying > 0) continue;
        if (near(s, e.x, e.y, e.r + s.r)) { this.hitEnemy(e, s.dmg); s.life = 0; this.burst(s.x, s.y, new THREE.Color(0.5, 1.5, 2), 3, 250); break; }
      }
    }
    if (this.dead <= 0) for (const s of this.eshots) if (near(s, this.sx, this.sy, s.r + SHIP_HIT)) { this.hurt(s.dmg); s.life = 0; }
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
