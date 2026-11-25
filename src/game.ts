// The game: a long run to a finish line. Everything the player meets is decided by the level's seed and
// the distance flown (never by luck), so every player gets the same run and can compete on score. It
// gets harder every "minute" of distance: more waves, tougher enemies, new kinds. Points: simple enemies
// little, tough ones more, more again each danger level, a bonus for destroying a whole wave. Every
// 4,000 points the next upgrade in a fixed order. Tunnels are mandatory. Destroyed enemies drop coins,
// spent in the shop (pause) on weapons, add-ons and upgrades for this run; every run starts equal.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { circle, cog, cross, disposeMaterial, lineMaterial, polygon, polylines, star, wire } from "./neon";
import { sfx } from "./audio";
import { Input, Rng, clamp } from "./util";
import type { Theme } from "./world";
import type { MusicStyle } from "./music";
import { TunnelRun } from "./tunnel";
import { DEFAULT_LOADOUT, DUAL_FACTOR, HULLS, type AddonKind, type HullKind, type Loadout } from "./loadout";

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
/** What the gallery can show: the player's ship, an enemy kind or a mini-boss. */
export type DemoKind = "ship" | "weapons" | "hangar" | EnemyKind | BossKind;
/** The gallery shows everything left of centre, clear of its info panel. */
const DEMO_X = -260;
/** A step of the ship and weapon demos: what it shows, for how long, and how. */
interface DemoStep { msg: string; t: number; lvl: number; gun?: PrimaryKind; sec?: SecondaryKind; missiles?: boolean; rate?: number; slow?: boolean; shield?: boolean; hits?: boolean; hold?: boolean; targets?: boolean }
const SHIP_DEMO: DemoStep[] = [
  { msg: "1 GUN", t: 2.5, lvl: 1 }, { msg: "2 GUNS", t: 2.5, lvl: 2 }, { msg: "3 GUNS - SPREAD", t: 2.5, lvl: 3 }, { msg: "4 GUNS", t: 2.5, lvl: 4 }, { msg: "5 GUNS (MAX)", t: 2.5, lvl: 5 },
  { msg: "FASTER FIRE  x2", t: 3, lvl: 5, rate: 2 }, { msg: "PRECISE (SHIFT)", t: 3.5, lvl: 5, rate: 2, slow: true },
  { msg: "SHIELD x4 - TAKES 4 HITS", t: 6, lvl: 5, shield: true, hold: true }, { msg: "HIT CIRCLES (H)", t: 4.5, lvl: 5, hits: true, hold: true },
];
const WEAPON_DEMO: DemoStep[] = ([
  { msg: "PRIMARY: PULSE GUN - FAST STRAIGHT SHOTS", gun: "pulse" },
  { msg: "PRIMARY: LASER - A CONTINUOUS BEAM", gun: "laser" },
  { msg: "PRIMARY: CHAIN LASER - JUMPS, -25% PER JUMP", gun: "chain" },
  { msg: "SECONDARY: LAVA CANNON - BURST + BURNING POOL", sec: "lava" },
  { msg: "SECONDARY: SHOCKWAVE - CLOSER TARGETS TAKE MORE", sec: "shock" },
  { msg: "ADD-ON: HOMING MISSILES - FIRE BY THEMSELVES", missiles: true },
] as Omit<DemoStep, "t" | "lvl">[]).map((s) => ({ t: 7, lvl: 3, targets: true, ...s }));
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

interface Shot { x: number; y: number; vx: number; vy: number; r: number; color: THREE.Color; dmg: number; life: number; kind?: "missile" | "lava"; target?: Target | null; done?: boolean;
  /** Enemies it can still go through, and those it already hit; a missile's blast radius. */
  pierce?: number; hitRefs?: Set<object>; blast?: number }
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

/** The ship's weapons, in three slots. The weapon level (1-5) powers all of them.
 *  Primary (hold fire; Q / E or 1-4 to switch), secondary (its own key, then a cooldown; R or 5-8 to switch),
 *  and the add-on: homing missiles that fire by themselves. */
export type PrimaryKind = "pulse" | "laser" | "chain";
export type SecondaryKind = "lava" | "shock";
export type WeaponKind = PrimaryKind | SecondaryKind | "missile";
export const PRIMARY_ORDER: PrimaryKind[] = ["pulse", "laser", "chain"];
export const SECONDARY_ORDER: SecondaryKind[] = ["lava", "shock"];
/** Seconds between secondary shots (shorter with faster fire). */
export const COOLDOWN: Record<SecondaryKind, number> = { lava: 2.2, shock: 2.6 };
/** Seconds between missile volleys (shorter with faster fire). */
const MISSILE_EVERY = 1.4;
export const WEAPONS: Record<WeaponKind, { name: string; color: number }> = {
  pulse: { name: "PULSE GUN", color: 0x66ddff },
  laser: { name: "LASER", color: 0xff3366 },
  missile: { name: "HOMING MISSILES", color: 0xffaa33 },
  lava: { name: "LAVA CANNON", color: 0xff5511 },
  shock: { name: "SHOCKWAVE", color: 0x55ffdd },
  chain: { name: "CHAIN LASER", color: 0xaa77ff },
};
/** Something the ship's weapons can hit: an enemy or a mini-boss part (shielded parts take no damage yet). */
interface Target { ref: object; readonly x: number; readonly y: number; r: number; shielded: boolean; alive(): boolean; hit(dmg: number, quiet: boolean): void }
interface Zap { obj: LineSegments2; life: number }
/** A shockwave: a half ring growing from where it was fired; it hits each target once, harder near the middle. */
interface Wave { obj: LineSegments2; mat: LineMaterial; x: number; y: number; r: number; max: number; dmg: number; half: number; hit: Set<object> }
/** A coin dropped by a destroyed enemy: fly close and it comes to you. */
interface Coin { x: number; y: number; vx: number; vy: number; v: number; age: number }
/** Coins dropped per enemy kind (splitter fragments drop 5). */
const COIN_VALUE: Record<EnemyKind, number> = { drone: 5, rock: 5, splitter: 10, fighter: 15, burster: 20, blinker: 25, cog: 100 };
const MAX_COINS = 300;
/** Aim assist: shots and the laser lean toward an enemy at most this far off straight ahead. */
const AIM_CONE = (10 * Math.PI) / 180;
/** Coins last this long (blinking for the last 3 s) unless they drift off the bottom first. */
const COIN_LIFE = 16;
interface Pool { obj: LineSegments2; x: number; y: number; r: number; life: number; dps: number }

export type Upgrade = "weapon" | "rapid" | "power" | "shield" | "repair" | "life";
export const UPGRADES: Record<Upgrade, { name: string; color: number }> = {
  weapon: { name: "+1 WEAPON LEVEL", color: 0xff9020 },
  rapid: { name: "FASTER FIRE", color: 0xffe040 },
  power: { name: "+25% DAMAGE", color: 0xff4060 },
  shield: { name: "SHIELD x4", color: 0x30c0ff },
  repair: { name: "REPAIR", color: 0x50ff60 },
  life: { name: "+1 LIFE", color: 0xff60ff },
};
/** The bonuses in the order they are given (then it starts over), the same in every level. */
export const BONUS_ORDER: Upgrade[] = ["weapon", "shield", "rapid", "power", "repair", "weapon", "rapid", "life", "power", "shield", "weapon", "rapid", "power", "repair", "life"];

const MAX_SHOTS = 700, MAX_SPARKS = 1500;
/** Points between bonuses. */
export const BONUS_EVERY = 4000;

export class Game {
  readonly root = new THREE.Group();
  score = 0; lives = 3; hull = 100; weapon = 1; shieldHits = 0;
  /** Metres flown (the run's clock and its result), and seconds played. */
  dist = 0; runTime = 0;
  done = false; over = false; message = ""; messageT = 0;
  bigFight = 0;
  fireRate = 1; damage = 1;
  /** The loadout in use: primaries (fire together), secondary and its cooldown, add-ons, hull. */
  primaries: PrimaryKind[] = ["pulse"];
  secondary: SecondaryKind | null = null;
  /** This run's coins, what has been bought (weapons and add-ons owned; ship upgrade counts), weapon upgrades. */
  coins = 0;
  owned = new Set<string>(["pulse"]);
  bought: Record<string, number> = {};
  /** Stackable weapon / add-on upgrades bought this run: "owner.id" -> count (see shop.ts). */
  mods: Record<string, number> = {};
  private coinDrops: Coin[] = [];
  private coinMesh: THREE.InstancedMesh;
  secCool = 0;
  addons: AddonKind[] = [];
  hullKind: HullKind = "falcon";
  maxHull = 100;
  private speedMul = 1;
  /** The ship's hit circles: small for bullets (the core), wider for bumping into enemies (the wings). */
  private hitR = 16; private ramR = 28;
  private shotColor = new THREE.Color(0.4, 1.6, 2.2);
  private fireTs: Record<string, number> = {};
  private missileT = 1; private regenT = 0; private lastHurt = -99; private wingT = 0;
  private wingman: THREE.Object3D; private wingman2: THREE.Object3D; private wingMat: LineMaterial; private wx = 0; private wx2 = 0; private wy = -330;
  private shipLines: LineSegments2 | null = null;
  private laserBeam: THREE.Group; private laserCore: THREE.Mesh; private laserGlow: THREE.Mesh;
  private zaps: Zap[] = []; private zapMat: LineMaterial;
  private pools: Pool[] = []; private poolMat: LineMaterial;
  private waves: Wave[] = [];
  private quietHitT = 0;
  private laserAim = 0;
  private skill: number;
  private waveRng: Rng;
  private ship: THREE.Group; private shipMat: LineMaterial; private flame: THREE.Mesh;
  private sx = 0; private sy = -330; private vx = 0; private vy = 0; private bank = 0;
  private invuln = 2; private dead = 0;
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
  // Bonuses
  private bonusIndex = 0;
  /** Score at which the next bonus is given. */
  nextBonus = BONUS_EVERY;
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
  // Gallery demo
  demo: DemoKind | null = null;
  private demoT = 0; private demoSpawnT = 0; private demoSpawnedAt = 0; private demoPhase = -1;
  private shieldRing: LineSegments2;
  private hitView = new THREE.Group();

  constructor(readonly level: LevelDef, skill: number, loadout: Loadout = DEFAULT_LOADOUT) {
    this.skill = skill;
    this.waveRng = new Rng(level.seed * 31 + 7);
    this.lives = level.gentle?.endless ? 3 : skill === 0 ? 5 : skill === 2 ? 2 : 3;
    // Ship: a neon outline in the loadout's shape and colour (see applyLoadout).
    this.shipMat = lineMaterial(0xbff8ff, 3, 2.2);
    this.ship = new THREE.Group();
    this.wingMat = lineMaterial(0xbff8ff, 2.5, 2);
    this.wingman = polylines([[[0, 26], [17, -14], [0, -5], [-17, -14]].map(([x, y]) => new THREE.Vector3(x, y, 0)), [[0, 10], [5, -2], [-5, -2]].map(([x, y]) => new THREE.Vector3(x, y, 2))], true, this.wingMat);
    this.wingman.visible = false;
    this.root.add(this.wingman);
    this.wingman2 = this.wingman.clone();
    this.root.add(this.wingman2);
    this.flame = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.15).multiplyScalar(3), toneMapped: false }));
    this.flame.position.set(0, -36, -2);
    this.ship.add(this.flame);
    this.shieldRing = polylines([circle(54, 40)], true, lineMaterial(0x30c0ff, 2.5, 1.6));
    this.shieldRing.visible = false;
    this.ship.add(this.shieldRing);
    // Laser beam: a white core in a red glow, stretched from the nose to what it hits.
    const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.laserGlow = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.12, 0.35), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.laserCore = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.85, 1.1), toneMapped: false }));
    this.laserCore.position.z = 1;
    this.laserBeam = new THREE.Group();
    this.laserBeam.add(this.laserGlow, this.laserCore);
    this.laserBeam.visible = false;
    this.root.add(this.laserBeam);
    this.zapMat = lineMaterial(0xbb88ff, 3, 2.6);
    this.poolMat = lineMaterial(0xff4a10, 3, 2.2);
    this.root.add(this.ship);
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_SHOTS);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color()); this.root.add(m); return m;
    };
    this.shotMesh = mk(new THREE.CircleGeometry(1, 12));
    this.coinMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.4), toneMapped: false }), MAX_COINS);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.coinMesh.count = 0; this.coinMesh.frustumCulled = false;
    this.root.add(this.coinMesh);
    this.eshotMesh = mk(new THREE.CircleGeometry(1, 16));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    sg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    this.sparkPts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 5, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    this.sparkPts.frustumCulled = false;
    this.root.add(this.sparkPts);
    this.root.add(this.hitView);
    this.applyLoadout(loadout, false);
  }

  /** Puts the set-up on the ship: colour (any time), hull (not mid-run). */
  applyLoadout(l: Loadout, midRun: boolean) {
    const c = new THREE.Color(l.color);
    this.shipMat.color.copy(c).multiplyScalar(2.2);
    this.wingMat.color.copy(c).multiplyScalar(2);
    this.shotColor = c.clone().multiplyScalar(2.1);
    if (midRun && this.shipLines) return;
    const h = HULLS[l.hull];
    this.hullKind = l.hull;
    this.maxHull = h.hull; this.hull = h.hull;
    this.speedMul = h.speed; this.hitR = h.hit; this.ramR = h.ram;
    if (this.shipLines) { this.ship.remove(this.shipLines); this.shipLines.geometry.dispose(); }
    this.shipLines = polylines([h.shape.map(([x, y]) => new THREE.Vector3(x, y, 0)), h.canopy.map(([x, y]) => new THREE.Vector3(x, y, 4))], true, this.shipMat);
    this.ship.add(this.shipLines);
  }

  has(a: AddonKind) { return this.addons.includes(a); }
  /** How many of an upgrade have been bought for a weapon / add-on this run. */
  mod(owner: string, id: string) { return this.mods[`${owner}.${id}`] ?? 0; }

  /** Which "minute" of the run this distance is (a minute's worth of flying at the level's speed). */
  get minute() { return Math.floor(this.dist / (this.level.speed * 60)); }
  get difficulty() {
    let d = this.level.startDifficulty + 0.11 * (this.dist / (this.level.speed * 60));
    if (this.skill === 0) d *= 0.6; else if (this.skill === 2) d += 0.3;
    return Math.min(1.6, d);
  }
  /** The first minutes are gentler, so you can get going: 1 at the start, down to 0 after 3 minutes
   *  (half as much on Hard). Fewer waves and shots, slower shots, softer enemies, less damage. */
  get ease() { return clamp(1 - this.dist / (this.level.speed * 60) / 3, 0, 1) * (this.skill === 2 ? 0.5 : 1); }
  /** Minutes flown so far (a minute's worth of distance at the level's speed), not rounded. */
  get minutesIn() { return this.dist / (this.level.speed * 60); }
  get progress() { return clamp(this.dist / this.level.finish, 0, 1); }
  get shipX() { return this.sx; }
  debugShipY() { return this.sy; }

  dispose() {
    if (this.boss) this.removeBoss();
    for (const e of this.enemies) e.mats.forEach(disposeMaterial);
    for (const r of this.rings) disposeMaterial(r.mat);
    disposeMaterial(this.shipMat); disposeMaterial(this.wingMat);
    disposeMaterial(this.shieldRing.material as LineMaterial);
    disposeMaterial(this.zapMat); disposeMaterial(this.poolMat);
    for (const w of this.waves) disposeMaterial(w.mat);
    this.tunnel?.dispose();
    this.portal?.mats.forEach(disposeMaterial);
  }

  private say(m: string, t = 2.2) { this.message = m; this.messageT = t; }

  update(dt: number, input: Input) {
    this.messageT -= dt;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (this.demo) { this.updateDemo(dt); return; }
    if (this.done || this.over) { this.updateEffects(dt); return; }
    this.runTime += dt;
    if (this.tunnel) { this.updateTunnel(dt, input); return; }
    if (!this.boss) this.dist += this.level.speed * dt;  // a boss fight holds the run still
    if (this.minute > this.minuteShown) {
      this.minuteShown = this.minute;
      this.say(`DANGER LEVEL ${this.minute + 1}`);
      sfx("warning", 0, 0.6);
    }
    this.updateShip(dt, input);
    this.updateWaves();
    this.updateOffers();
    this.updatePortal(dt);
    this.updateBoss(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateCoins(dt);
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
    this.laserBeam.visible = false;
    this.wingman.visible = false;
    this.wingman2.visible = false;
    if (this.dead > 0) {
      this.dead -= dt;
      this.ship.visible = false;
      if (this.dead <= 0) { this.ship.visible = true; this.sx = 0; this.sy = -330; this.hull = this.maxHull; this.invuln = 2.5; }
      return;
    }
    const mv = input.move();
    let speed = 760 * this.speedMul;
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
    this.shieldRing.visible = this.shieldHits > 0;
    this.shieldRing.rotation.z += dt * 2;
    this.flame.scale.setScalar(0.8 + 0.3 * Math.random());
    for (const k in this.fireTs) this.fireTs[k] -= dt;
    this.secCool -= dt;
    this.quietHitT -= dt;
    // Primaries (all of them, together) on the fire key.
    // Primaries fire by themselves whenever an enemy is on screen (J / Z fires too, e.g. at nothing).
    const firing = input.fire() || (!this.demo && this.targets().length > 0);
    if (firing) for (const p of this.primaries) this.fireGun(dt, p);
    // Secondary: its own key, then a cooldown.
    if (input.fire2() && this.secondary && this.secCool <= 0) { this.fireGun(dt, this.secondary); this.secCool = this.cooldown(this.secondary); }
    this.updateAddons(dt, firing);
  }

  /** Aim assist: the angle (0 = straight up) toward the nearest enemy within ~10 degrees ahead, else 0. */
  private aimAngle(x: number, y: number): number {
    let best = 0, bestScore = Infinity;
    for (const t of this.targets()) {
      if (t.shielded) continue;
      const dx = t.x - x, dy = t.y - y;
      if (dy < 20 || dy > 1100) continue;
      const a = Math.atan2(dx, dy);
      const slack = Math.atan2(t.r, Math.hypot(dx, dy));  // big targets count from their edge
      const off = Math.max(0, Math.abs(a) - slack);
      if (off > AIM_CONE) continue;
      const score = off * 600 + Math.hypot(dx, dy) * 0.3;  // prefer what's most in line, then nearest
      if (score < bestScore) { bestScore = score; best = clamp(a, -AIM_CONE, AIM_CONE); }
    }
    return best;
  }

  /** The secondary's cooldown, with its upgrades and fire rate. */
  cooldown(s: SecondaryKind) { return (COOLDOWN[s] * 0.85 ** this.mod(s, "cool")) / this.fireRate; }

  // --- Add-ons ---
  private updateAddons(dt: number, firing: boolean) {
    // Homing missiles fire by themselves whenever there is something to hit.
    this.missileT -= dt;
    if (this.has("missiles") && this.missileT <= 0 && this.targets().some((t) => !t.shielded)) { this.fireGun(dt, "missile"); this.missileT = (MISSILE_EVERY * 0.85 ** this.mod("missiles", "reload")) / this.fireRate; }
    // Shield regen: a shield hit every 12 s, up to 2.
    if (this.has("regen") && this.shieldHits < 2 + this.mod("regen", "cap")) {
      this.regenT += dt;
      if (this.regenT >= 12 - 3 * this.mod("regen", "speed")) { this.regenT = 0; this.shieldHits++; sfx("shield", this.sx / HALF_W, 0.3, 1.4); this.burst(this.sx, this.sy, new THREE.Color(0.4, 1.2, 2), 8, 160); }
    } else this.regenT = 0;
    // Repair drone: after 3 s without a hit, the hull mends.
    const rp = this.mod("repair", "speed");
    if (this.has("repair") && this.runTime - this.lastHurt > 3 - rp && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + 5 * (1 + rp) * dt);
      if (Math.random() < 0.15) this.spark(this.sx + (Math.random() - 0.5) * 50, this.sy - 20, 0, 80, 0.4, new THREE.Color(0.4, 2, 0.6));
    }
    // Wingman: a small drone trailing at your right (and a second on the left, if bought) that fires along with you.
    const twin = this.mod("wingman", "twin") > 0;
    this.wingman2.visible = false;
    if (this.has("wingman")) {
      const k = 1 - Math.exp(-dt * 12);
      this.wx += (this.sx + 85 - this.wx) * k; this.wy += (this.sy - 14 - this.wy) * k;
      this.wx2 += (this.sx - 85 - this.wx2) * k;
      this.wingman.visible = this.ship.visible;
      this.wingman.position.set(this.wx, this.wy, 0);
      this.wingman.rotation.z = Math.sin(this.runTime * 3) * 0.15;
      this.wingman2.visible = twin && this.ship.visible;
      this.wingman2.position.set(this.wx2, this.wy, 0);
      this.wingman2.rotation.z = -Math.sin(this.runTime * 3) * 0.15;
      this.wingT -= dt;
      if (firing && this.wingT <= 0) {
        this.wingT = 0.2 / (this.fireRate * 1.2 ** this.mod("wingman", "rate"));
        const d = 0.6 * this.damage * (1 + 0.3 * this.mod("wingman", "dmg"));
        const shoot = (x: number) => { const a = this.aimAngle(x, this.wy + 22); this.shots.push({ x, y: this.wy + 22, vx: Math.sin(a) * 1800, vy: Math.cos(a) * 1800, r: 4.5, color: this.shotColor, dmg: d, life: 1 }); };
        shoot(this.wx);
        if (twin) shoot(this.wx2);
      }
    } else { this.wx = this.sx; this.wx2 = this.sx; this.wy = this.sy; }
  }

  private fireGun(dt: number, kind: WeaponKind) {
    const lvl = this.weapon, nx = this.sx, ny = this.sy + 40, pan = this.sx / HALF_W;
    const rate = this.fireRate;
    // Two primaries share the work.
    const dmg = this.damage * ((kind === "pulse" || kind === "laser" || kind === "chain") && this.primaries.length > 1 ? DUAL_FACTOR : 1);
    switch (kind) {
      case "pulse": {
        if ((this.fireTs.pulse ?? 0) > 0) return;
        this.fireTs.pulse = 0.09 / (rate * 1.15 ** this.mod("pulse", "rate"));
        // Guns side by side (weapon level + bought guns); a slight fan from 3 guns, wider with upgrades.
        const guns = Math.min(8, lvl + this.mod("pulse", "guns"));
        const spread = (guns >= 3 ? 5 : 0) + (guns >= 2 ? 4 * this.mod("pulse", "spread") : 0);
        const d = dmg * (1 + 0.2 * this.mod("pulse", "dmg")), pierce = this.mod("pulse", "pierce");
        const aim = this.aimAngle(nx, ny);  // aim assist: the volley leans toward the nearest enemy ahead
        for (let i = 0; i < guns; i++) {
          const off = i - (guns - 1) / 2;
          const ang = aim + off * spread * (Math.PI / 180);
          this.shots.push({ x: nx + off * 14, y: ny, vx: Math.sin(ang) * 1900, vy: Math.cos(ang) * 1900, r: 6, color: this.shotColor, dmg: d, life: 1, pierce });
        }
        sfx("playerShot", pan, 0.6);
        return;
      }
      case "laser": {
        // A continuous beam ahead (leaning toward the nearest enemy, smoothly): it stops at the first thing
        // in its way and burns it (with pierce upgrades it burns through to the next ones too).
        this.laserAim += (this.aimAngle(nx, ny) - this.laserAim) * (1 - Math.exp(-dt * 12));
        const a = this.laserAim, sa = Math.sin(a), ca = Math.cos(a);
        const half = (4 + 2.5 * lvl) * (1 + 0.3 * this.mod("laser", "width"));
        const inBeam: { t: Target; d: number }[] = [];
        for (const t of this.targets()) {
          const rx = t.x - nx, ry = t.y - ny;
          const along = rx * sa + ry * ca, across = rx * ca - ry * sa;  // in the beam's own frame
          if (along < -t.r || Math.abs(across) > t.r + half) continue;
          inBeam.push({ t, d: Math.max(0, along - Math.sqrt(Math.max(0, (t.r + half) ** 2 - across ** 2)) * 0.8) });
        }
        inBeam.sort((p, q) => p.d - q.d);
        const burned = inBeam.slice(0, 1 + this.mod("laser", "pierce"));
        const full = (HALF_H + 60 - ny) / Math.max(0.3, ca);
        const len = burned.length > this.mod("laser", "pierce") ? burned[burned.length - 1].d : full;
        const hit = burned.length > 0;
        const flick = 0.85 + 0.3 * Math.random();
        this.laserBeam.visible = true;
        this.laserBeam.position.set(nx, ny, 3);
        this.laserBeam.rotation.z = -a;
        this.laserGlow.scale.set(half * 1.6 * flick, len, 1);
        this.laserCore.scale.set(half * 0.4, len, 1);
        if (hit) {
          for (const b of burned) b.t.hit((8 + 3.2 * (lvl - 1)) * (1 + 0.2 * this.mod("laser", "dmg")) * rate * dmg * dt, true);
          if (Math.random() < 0.6) this.spark(nx + sa * burned[0].d, ny + ca * burned[0].d, -sa * 200, -ca * 200, 0.25, new THREE.Color(2.4, 0.6, 1));
        }
        sfx("laser", pan, 0.35, 1.6);
        return;
      }
      case "missile": {
        // A volley of missiles that fan out, then find their own targets.
        const count = Math.min(9, lvl + this.mod("missiles", "count")), md = 3.5 * dmg * (1 + 0.25 * this.mod("missiles", "dmg")), blast = 45 * this.mod("missiles", "blast");
        for (let i = 0; i < count; i++) {
          const off = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
          this.shots.push({ x: nx + off * 20, y: ny - 10, vx: off * 420, vy: 380, r: 5, color: new THREE.Color(2.2, 1.3, 0.4), dmg: md, life: 2.4, kind: "missile", target: null, blast });
        }
        sfx("missile", pan, 0.5);
        return;
      }
      case "lava": {
        // A slow ball of lava that bursts over an area and leaves a burning pool.
        // Upgrades: damage, side balls angled out.
        const ld = (8 + 4 * lvl) * 2.5 * (1 + 0.25 * this.mod("lava", "dmg")) * dmg, balls = this.mod("lava", "balls");
        for (let i = -balls; i <= balls; i++) {
          const a = (i * 13 * Math.PI) / 180;
          this.shots.push({ x: nx, y: ny, vx: Math.sin(a) * 900, vy: Math.cos(a) * 900, r: 13 + 1.5 * lvl, color: new THREE.Color(2.6, 0.7, 0.15), dmg: ld, life: 0.75, kind: "lava" });
        }
        sfx("lava", pan, 0.6);
        return;
      }
      case "shock": {
        // A shockwave rolling out; whatever it reaches takes a hit, harder the closer it is.
        // A half ring ahead; wider-arc upgrades bend it round (two make a full ring around the ship).
        const full = this.mod("shock", "arc") >= 2;
        const half = Math.PI / 2 + (this.mod("shock", "arc") * Math.PI) / 4;
        const mat = lineMaterial(0x55ffdd, 4, 2.4, 0.99);
        const n = full ? 48 : 32 + 8 * this.mod("shock", "arc");
        const arc = Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI / 2 - half + (i / n) * half * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); });
        const obj = polylines([arc, arc.map((v) => v.clone().multiplyScalar(0.94))], full, mat);
        const oy = full ? this.sy : ny - 20;
        obj.position.set(nx, oy, 3);
        obj.scale.setScalar(20);
        this.root.add(obj);
        this.waves.push({ obj, mat, x: nx, y: oy, r: 20, max: (300 + 40 * lvl) * (1 + 0.2 * this.mod("shock", "range")), dmg: (9 + 4 * lvl) * 2.5 * (1 + 0.25 * this.mod("shock", "dmg")) * dmg, half, hit: new Set() });
        sfx("shock", pan, 0.55);
        return;
      }
      case "chain": {
        // A bolt to the nearest enemy ahead that jumps on to 1-3 more nearby (more and longer jumps per level), 25% weaker per jump.
        if ((this.fireTs.chain ?? 0) > 0) return;
        this.fireTs.chain = 0.36 / (rate * 1.15 ** this.mod("chain", "rate"));
        const all = this.targets().filter((t) => !t.shielded);
        let from: [number, number] = [nx, ny];
        const path: THREE.Vector3[] = [new THREE.Vector3(nx, ny, 4)];
        const used = new Set<Target>();
        // The first bolt only reaches enemies in a narrow cone ahead (wider and longer with range upgrades).
        const rm = 1 + 0.25 * this.mod("chain", "reach");
        const cone = ((20 + 6 * this.mod("chain", "reach")) * Math.PI) / 180, first = (420 + 40 * lvl) * rm;
        const hits = 1 + (lvl <= 1 ? 1 : lvl <= 3 ? 2 : 3) + this.mod("chain", "jump"), reach = (160 + 40 * lvl) * rm;
        const keep = 0.75 + 0.08 * this.mod("chain", "falloff"), cd = 3.4 * (1 + 0.2 * this.mod("chain", "dmg"));
        for (let j = 0; j < hits; j++) {
          let best: Target | null = null, bd = j === 0 ? first : reach;
          for (const t of all) {
            if (used.has(t)) continue;
            if (j === 0) {
              const dx = t.x - nx, dy = t.y - ny;
              if (dy < 0 || Math.abs(Math.atan2(dx, dy)) - Math.atan2(t.r, Math.hypot(dx, dy)) > cone) continue;
            }
            const d = Math.hypot(t.x - from[0], t.y - from[1]) - t.r;
            if (d < bd) { bd = d; best = t; }
          }
          if (!best) break;
          used.add(best);
          // A jagged bolt from here to there.
          const [x0, y0] = from, x1 = best.x, y1 = best.y, segs = 6;
          for (let k = 1; k <= segs; k++) {
            const f = k / segs, jit = k === segs ? 0 : 22;
            path.push(new THREE.Vector3(x0 + (x1 - x0) * f + (Math.random() - 0.5) * jit, y0 + (y1 - y0) * f + (Math.random() - 0.5) * jit, 4));
          }
          best.hit(cd * dmg * keep ** j, false);
          this.burst(x1, y1, new THREE.Color(1.6, 1, 2.6), 5, 220);
          from = [x1, y1];
        }
        if (path.length > 1) {
          const obj = polylines([path], false, this.zapMat);
          this.root.add(obj);
          this.zaps.push({ obj, life: 0.12 });
          sfx("lightning", pan, 0.35);
        } else {
          // Nothing in reach: a short fizzle ahead.
          this.spark(nx, ny + 10, 0, 300, 0.15, new THREE.Color(1.4, 1, 2.4));
        }
        return;
      }
    }
  }

  /** Everything the ship's weapons can hit right now (enemies on screen, mini-boss parts). */
  private targets(): Target[] {
    const out: Target[] = [];
    for (const e of this.enemies) {
      if (e.dying > 0 || e.y > HALF_H + e.r * 0.3) continue;
      out.push({ ref: e, get x() { return e.x; }, get y() { return e.y; }, r: e.r, shielded: false, alive: () => e.dying <= 0 && this.enemies.includes(e), hit: (d, q) => this.hitEnemy(e, d, q) });
    }
    const b = this.boss;
    if (b) for (const p of b.parts) {
      if (!p.alive) continue;
      out.push({ ref: p, get x() { return b.x + p.ox; }, get y() { return b.y + p.oy; }, r: p.r, shielded: p.stage > b.stage, alive: () => p.alive && this.boss === b, hit: (d, q) => { if (this.boss === b && p.alive) this.hitPart(p, d, b.x + p.ox, b.y + p.oy, q); } });
    }
    return out;
  }

  /** Area damage: everything within reach of (x, y). */
  private blast(x: number, y: number, r: number, dmg: number, quiet: boolean) {
    for (const t of this.targets()) if (Math.hypot(t.x - x, t.y - y) < r + t.r) t.hit(dmg, quiet);
  }

  private lavaBurst(s: Shot) {
    if (s.done) return;
    s.done = true; s.life = 0;
    const lvl = this.weapon, r = (90 + 15 * lvl) * (1 + 0.2 * this.mod("lava", "radius"));
    this.blast(s.x, s.y, r, s.dmg, false);
    this.explode(s.x, s.y, new THREE.Color(2.6, 0.8, 0.2), 1.1);
    for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, sp = r * (1.5 + Math.random() * 2); this.spark(s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4, new THREE.Color(2.6, 0.5 + Math.random(), 0.1)); }
    // A burning pool that keeps hurting for a while.
    const pr = r * 0.7;
    const obj = polylines([circle(pr, 36), circle(pr * 0.6, 28)], true, this.poolMat);
    obj.position.set(s.x, s.y, 1);
    this.root.add(obj);
    this.pools.push({ obj, x: s.x, y: s.y, r: pr, life: 2 * (1 + 0.5 * this.mod("lava", "pool")), dps: (8 + 3 * lvl) * (1 + 0.25 * this.mod("lava", "dmg")) * this.damage });
  }

  private spark(x: number, y: number, vx: number, vy: number, life: number, color: THREE.Color) {
    if (this.sparks.length >= MAX_SPARKS) return;
    this.sparks.push({ pos: new THREE.Vector3(x, y, 5), vel: new THREE.Vector3(vx, vy, 0), life: 0, max: life, color });
  }

  /** Bolts fade, pools burn out. */
  private updateWeaponFx(dt: number) {
    for (const w of [...this.waves]) {
      w.r += 950 * dt;
      const f = Math.min(1, w.r / w.max);
      w.obj.scale.setScalar(w.r);
      w.mat.opacity = 1 - f * 0.85;
      for (const t of this.targets()) {
        if (w.hit.has(t.ref)) continue;
        const d = Math.hypot(t.x - w.x, t.y - w.y);
        if (d - t.r > w.r) continue;  // not reached yet
        if (w.half < Math.PI && Math.abs(Math.atan2(t.x - w.x, t.y - w.y)) > w.half + Math.atan2(t.r, Math.max(1, d))) continue;  // outside its arc
        w.hit.add(t.ref);
        t.hit(w.dmg * (1 - 0.75 * Math.min(1, d / w.max)), false);  // full strength close by, a quarter at the edge
        this.burst(t.x, t.y, new THREE.Color(0.6, 2, 1.8), 6, 240);
      }
      if (w.r >= w.max) { this.root.remove(w.obj); w.obj.geometry.dispose(); disposeMaterial(w.mat); this.waves.splice(this.waves.indexOf(w), 1); }
    }
    for (const z of [...this.zaps]) {
      z.life -= dt;
      if (z.life <= 0) { this.root.remove(z.obj); z.obj.geometry.dispose(); this.zaps.splice(this.zaps.indexOf(z), 1); }
    }
    for (const p of [...this.pools]) {
      p.life -= dt;
      p.obj.rotation.z += dt * 1.5;
      p.obj.scale.setScalar(0.9 + 0.1 * Math.sin(p.life * 20));
      if (Math.random() < 0.5) { const a = Math.random() * Math.PI * 2, d = Math.random() * p.r; this.spark(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 0, 60, 0.35, new THREE.Color(2.4, 0.6, 0.1)); }
      this.blast(p.x, p.y, p.r, p.dps * dt, true);
      if (p.life <= 0) { this.root.remove(p.obj); p.obj.geometry.dispose(); this.pools.splice(this.pools.indexOf(p), 1); }
    }
  }

  private loseLife() {
    if (this.level.gentle?.endless) return;
    this.lives--;
    if (this.lives <= 0) { this.over = true; this.say(`RUN OVER  -  SCORE ${this.score.toLocaleString("en-US")}`, 7); }
  }

  hurt(dmg: number) {
    if (this.dead > 0 || this.invuln > 0 || this.over) return;
    if (this.shieldHits > 0) { this.shieldHits--; this.invuln = 0.3; sfx("shield", this.sx / HALF_W); this.burst(this.sx, this.sy, new THREE.Color(0.4, 1.2, 2), 10, 260); return; }
    if (this.demo) { this.invuln = 0.4; sfx("hurt", this.sx / HALF_W, 0.5); this.burst(this.sx, this.sy, new THREE.Color(0.5, 0.9, 1.4), 12, 300); return; }  // the gallery ship can't die
    const scale = (this.skill === 0 ? 0.6 : this.skill === 2 ? 1.3 : 1) * (this.level.gentle?.damage ?? 1) * (1 - 0.35 * this.ease);
    this.hull -= dmg * scale;
    this.lastHurt = this.runTime;
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
    const gapSeconds = Math.max(1.2, 3.3 - 1.7 * Math.min(d, 1.2)) * skillWave * (this.level.gentle?.waves ?? 1) * (1 + 0.5 * this.ease);
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
      case "drone": for (let i = 0; i < (this.ease > 0.5 ? 3 : 4) + extra * 2; i++) add("drone", lane, top + i * 140); break;
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
    const fireScale = (this.level.gentle?.fire ?? 1) * Math.max(0.45, 1 - 0.35 * d) * (1 + 0.8 * this.ease);
    // Tougher the further you get: with the difficulty, plus 25% more health per minute flown (your
    // weapons keep getting stronger too). Rocks stay easy.
    if (kind !== "rock") hp *= (1 + 0.8 * d) * (1 + 0.25 * this.minutesIn) * (1 - 0.25 * this.ease);
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
      if (this.dead <= 0 && Math.hypot(e.x - this.sx, e.y - this.sy) < e.r + this.ramR) { this.hurt(e.kind === "cog" ? 40 : 30); if (e.kind !== "cog") this.kill(e, false); continue; }
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
        const wx = this.demo ? DEMO_X + e.rng.range(-300, 300) : e.rng.range(-HALF_W + 150, HALF_W - 150), wy = e.rng.range(0, HALF_H - 120);
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
    speed *= (this.level.gentle?.shotSpeed ?? 1) * (1 + 0.15 * Math.min(this.difficulty, 1.5)) * (1 - 0.25 * this.ease);
    for (let i = 0; i < n; i++) {
      const a = ((i - (n - 1) / 2) * spreadDeg * Math.PI) / 180;
      const vx = dx * Math.cos(a) - dy * Math.sin(a), vy = dx * Math.sin(a) + dy * Math.cos(a);
      this.eshots.push({ x: e.x + vx * e.r, y: e.y + vy * e.r, vx: vx * speed, vy: vy * speed, r, color, dmg: 10, life: 6 });
    }
    sfx("enemyShot", e.x / HALF_W, 0.5, r > 11 ? 0.7 : 1);
  }

  private hitEnemy(e: Enemy, dmg: number, quiet = false) {
    if (e.dying > 0 || e.y > HALF_H + e.r * 0.3) return;  // only once (mostly) on screen
    e.hp -= dmg;
    // Beams and pools hit every frame: flash and click only now and then.
    if (!quiet || this.quietHitT <= 0) {
      if (quiet) this.quietHitT = 0.1;
      e.obj.scale.setScalar(1.12);
      setTimeout(() => e.obj.scale.setScalar(1), 50);
      sfx("hit", e.x / HALF_W, 0.4);
    }
    if (e.hp <= 0) this.kill(e, true);
  }

  private kill(e: Enemy, scored: boolean) {
    if (scored) { this.score += e.score; this.dropCoins(e.x, e.y, e.fragment ? 5 : COIN_VALUE[e.kind]); }
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
    this.dropCoins(x, y, 10);
    this.say(`WAVE CLEARED  +${bonus}`, 1.4);
    this.burst(x, y, new THREE.Color(2, 1.8, 0.6), 24, 380);
  }

  // --- Mini-bosses: parts in order ---
  private spawnBoss(kind: BossKind) {
    // Only the boss: the enemies still around fly off (no score, no penalty) and their shots fade.
    for (const e of [...this.enemies]) {
      if (e.dying <= 0) this.burst(e.x, e.y, e.color.clone().multiplyScalar(0.8), 8, 200);
      e.counted = true;
      this.remove(e);
    }
    this.groups.clear();
    this.eshots = [];
    const rng = new Rng(this.level.seed * 7777 + this.bossIndex * 31);
    const frame = new THREE.Group();
    const frameMat = lineMaterial(kind === "fortress" ? 0x8899ff : 0xff66cc, 3, 1.6);
    const parts: BossPart[] = [];
    const d = this.difficulty, hpScale = (this.demo ? 1 : 5) * (1 + 0.6 * d) * (1 + 0.15 * this.minutesIn) * (this.level.gentle ? 0.5 : 1);
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

  private hitPart(p: BossPart, dmg: number, x: number, y: number, quiet = false) {
    const b = this.boss!;
    const show = !quiet || this.quietHitT <= 0;
    if (show && quiet) this.quietHitT = 0.1;
    if (p.stage > b.stage) { if (show) { this.burst(x, y, new THREE.Color(0.6, 0.8, 2), 4, 200); sfx("shield", x / HALF_W, 0.25, 1.6); } return; }  // shielded: not yet
    p.hp -= dmg;
    if (show) {
      p.obj.scale.setScalar(1.1);
      setTimeout(() => p.obj.scale.setScalar(1), 50);
      sfx("hit", x / HALF_W, 0.4);
    }
    if (p.hp > 0) return;
    p.alive = false;
    p.obj.visible = false;
    this.explode(b.x + p.ox, b.y + p.oy, new THREE.Color(p.mat.color.getHex()).multiplyScalar(1.4), p.kind === "core" ? 3 : 1.3);
    this.score += Math.round(((p.kind === "core" ? 5000 : p.kind === "generator" ? 1200 : 800) * (1 + 0.2 * this.minute)) / 10) * 10;
    this.dropCoins(b.x + p.ox, b.y + p.oy, p.kind === "core" ? 200 : p.kind === "generator" ? 60 : 40);
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
    if (b.age > 150 || (this.level.tunnels[this.tunnelIndex] && this.dist > this.level.tunnels[this.tunnelIndex].at - 150)) b.leaving = true;
    const targetY = b.leaving ? HALF_H + 500 : HALF_H - (this.demo ? 290 : 230);
    b.y += (targetY - b.y) * (1 - Math.exp(-dt * (b.leaving ? 1.2 : 0.8)));
    b.x = this.demo ? DEMO_X + Math.sin(b.age * 0.35) * 110 : Math.sin(b.age * 0.35) * 260;
    b.frame.position.set(b.x, b.y, 0);
    b.frame.rotation.z = Math.sin(b.age * 0.5) * 0.06;
    if (b.leaving && b.y > HALF_H + 420) { this.say("THE MINI-BOSS GOT AWAY"); this.removeBoss(); return; }
    // Bumping into it hurts.
    if (this.dead <= 0 && Math.abs(this.sx - b.x) < 230 && Math.abs(this.sy - b.y) < 200) this.hurt(35);
    if (b.y > HALF_H - 60 || b.leaving) return;
    // Fire from the live parts: turrets aim, engines and generators throw rings, the core spirals.
    const fireScale = 0.6 * (this.level.gentle?.fire ?? 1) * Math.max(0.5, 1 - 0.3 * this.difficulty);  // fires often
    for (const p of b.parts) {
      if (!p.alive) continue;
      p.fireT -= dt;
      if (p.fireT > 0) continue;
      const x = b.x + p.ox, y = b.y + p.oy;
      const dx = this.sx - x, dy = this.sy - y, l = Math.hypot(dx, dy) || 1;
      const fake = { x, y, r: p.r } as Enemy;
      switch (p.kind) {
        case "turret": p.fireT = 1.5 * fireScale; this.fireShots(fake, dx / l, dy / l, p.stage === b.stage ? 3 : 1, 12, 560, new THREE.Color(2, 1.6, 0.3), 9); break;
        case "engine": p.fireT = 2.6 * fireScale; for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 3.5) * 0.3; this.fireShots(fake, Math.cos(a), Math.sin(a), 1, 0, 370, new THREE.Color(0.4, 1.6, 2), 10); } break;
        case "generator": p.fireT = 3 * fireScale; for (let i = 0; i < 10; i++) { const a = b.age + (i / 10) * Math.PI * 2; this.fireShots(fake, Math.cos(a), Math.sin(a), 1, 0, 330, new THREE.Color(0.6, 2, 0.6), 11); } break;
        case "core":
          if (p.stage > b.stage) { p.fireT = 1; break; }
          p.fireT = 0.16 * fireScale;
          b.spiral += 0.45;
          for (let i = 0; i < 4; i++) { const a = b.spiral + (i / 4) * Math.PI * 2; this.fireShots(fake, Math.cos(a), Math.sin(a), 1, 0, 360, new THREE.Color(2, 0.4, 0.6), 10); }
          break;
      }
    }
  }

  // --- Bonuses: every 4,000 points the next upgrade in a fixed order is given straight away ---
  private updateOffers() {
    if (this.portal || this.score < this.nextBonus) return;
    this.nextBonus = (Math.floor(this.score / BONUS_EVERY) + 1) * BONUS_EVERY;
    const kind = this.nextUpgrade;
    this.bonusIndex++;
    this.take(kind);
    this.burst(this.sx, this.sy, new THREE.Color(UPGRADES[kind].color), 30, 320);
  }

  /** The upgrade the next bonus gives. */
  get nextUpgrade(): Upgrade { return BONUS_ORDER[this.bonusIndex % BONUS_ORDER.length]; }

  private take(kind: Upgrade) {
    let extra = "";
    switch (kind) {
      case "weapon": if (this.weapon < 5) this.weapon++; else { this.score += 2000; extra = "  (MAX: +2,000)"; } break;
      case "rapid": this.fireRate = Math.min(2, this.fireRate * 1.18); break;
      case "power": this.damage *= 1.25; break;
      case "shield": this.shieldHits += 4; break;
      case "repair": this.hull = Math.min(this.maxHull, this.hull + 0.6 * this.maxHull); break;
      case "life": this.lives++; break;
    }
    this.say("BONUS!  " + UPGRADES[kind].name + extra, 2);
    sfx("powerUp", this.sx / HALF_W, 0.9);
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
    this.coinDrops = [];
    this.coinMesh.count = 0;
    if (this.dead > 0) { this.dead = 0; this.hull = this.maxHull; }
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
      const bonus = 2000 * this.tunnelIndex, coins = 50 * this.tunnelIndex;
      this.score += bonus;
      this.coins += coins;
      this.say(`TUNNEL CLEARED  +${bonus}   +${coins} COINS`);
      sfx("powerUp", 0, 1);
    }
  }

  // --- Gallery: one enemy (or the ship) at a time, using the real game logic ---
  /** Show this in the gallery: clears the field and starts its demo. */
  setDemo(kind: DemoKind) {
    for (const e of [...this.enemies]) this.remove(e);
    if (this.boss) this.removeBoss();
    this.shots = []; this.eshots = [];
    this.demo = kind;
    this.demoT = 0; this.demoSpawnT = 0.5; this.demoSpawnedAt = 0; this.demoPhase = -1;
    this.weapon = kind === "ship" ? 1 : kind === "fortress" || kind === "dreadnought" ? 4 : 3;
    this.primaries = ["pulse"];
    this.addons = [];
    this.secondary = null;
    this.coinDrops = [];
    for (const p of this.pools) { this.root.remove(p.obj); p.obj.geometry.dispose(); }
    this.pools = [];
    for (const w of this.waves) { this.root.remove(w.obj); w.obj.geometry.dispose(); disposeMaterial(w.mat); }
    this.waves = [];
    this.fireRate = 1; this.damage = 1; this.shieldHits = 0; this.hull = this.maxHull;
    this.sx = DEMO_X; this.sy = -300; this.vx = 0; this.vy = 0; this.invuln = 0;
    this.showHits = false;
    this.messageT = 0;
  }

  private updateDemo(dt: number) {
    const k = this.demo!;
    this.runTime += dt;
    this.demoT += dt;
    const isBoss = k === "fortress" || k === "dreadnought";
    let fire = false, fire2 = false, slow = false;
    let tx = DEMO_X + Math.sin(this.runTime * 0.9) * 170;
    if (k === "hangar") {
      // The hangar preview: the ship flies its loadout against a shower of rocks.
      fire = true; fire2 = true;
      tx = this.demoRocks(dt);
    } else if (k === "ship" || k === "weapons") {
      // Walk through the ship's abilities (or its weapons), one at a time, then start over.
      const steps = k === "ship" ? SHIP_DEMO : WEAPON_DEMO;
      const total = steps.reduce((a, p) => a + p.t, 0);
      let t = this.demoT % total, phase = 0;
      while (t >= steps[phase].t) { t -= steps[phase].t; phase++; }
      const st = steps[phase];
      if (phase !== this.demoPhase) {
        this.demoPhase = phase;
        this.say(st.msg, st.t - 0.2);
        this.weapon = st.lvl;
        this.fireRate = st.rate ?? 1;
        this.primaries = [st.gun ?? "pulse"];
        if (st.sec) this.secondary = st.sec;
        this.secCool = 0;
        this.addons = st.missiles ? ["missiles"] : [];
        this.showHits = !!st.hits;
        if (phase === 0) this.shieldHits = 0;
        if (st.targets || st.hits) { for (const e of [...this.enemies]) this.remove(e); this.demoSpawnT = 0; }
        if (st.shield) {
          this.shieldHits = 4;
          for (let i = 0; i < 3; i++) { const e = this.spawn("drone", DEMO_X + (i - 1) * 150, HALF_H + 40 + i * 90, 1, 0, false, 77 + i); e.fire = 0.2; e.fireMin = 0.5; e.fireMax = 0.7; }
        }
      }
      fire = !st.hold && !st.sec && !st.missiles;
      fire2 = !!st.sec;
      slow = !!st.slow;
      if (slow) tx = DEMO_X + Math.sin(this.runTime * 2.4) * 380;
      if (st.hold) tx = DEMO_X;  // hold still (and let the shield take the hits)
      if (st.targets) tx = this.demoRocks(dt);
    } else {
      // Bring it on, watch it for a moment, then shoot it down; again once it's gone.
      const empty = isBoss ? !this.boss : this.enemies.length === 0;
      if (empty) { this.demoSpawnT -= dt; if (this.demoSpawnT <= 0) { this.demoSpawn(k); this.demoSpawnT = 1.2; } }
      const watch: Record<string, number> = { drone: 2.6, rock: 1.6, splitter: 3, fighter: 3.4, burster: 4.2, blinker: 5, cog: 7, fortress: 5, dreadnought: 5 };
      if (this.demoT - this.demoSpawnedAt > watch[k]) {
        fire = true;
        if (this.boss) {
          const b = this.boss;
          const p = b.parts.find((q) => q.alive && q.stage === b.stage);
          if (p) tx = b.x + p.ox;
        } else {
          const e = this.enemies.find((q) => q.dying <= 0 && q.y < HALF_H);
          if (e) tx = e.x;
        }
      }
    }
    const fake = {
      move: () => ({ x: clamp((tx - this.sx) / 90, -1, 1), y: clamp((-300 - this.sy) / 80, -1, 1) }),
      fire: () => fire,
      fire2: () => fire2,
      down: (...keys: string[]) => slow && keys.includes("ShiftLeft"),
      hit: () => false,
    } as unknown as Input;
    this.updateShip(dt, fake);
    this.updateBoss(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateEffects(dt);
    this.drawHits();
  }

  /** A shower of rocks to try weapons on, again whenever they're nearly gone. Returns where to aim (the nearest). */
  private demoRocks(dt: number): number {
    if (this.enemies.filter((e) => e.dying <= 0).length < 2) {
      this.demoSpawnT -= dt;
      if (this.demoSpawnT <= 0) {
        this.demoSpawnT = 0.8;
        for (let i = 0; i < 5; i++) this.spawn("rock", DEMO_X + (i - 2) * 85, HALF_H + 60 + (i % 2) * 70 + i * 25, i % 2 ? 1 : -1, 25, false, 900 + this.waveIndex++ * 13);
      }
    }
    let best: Enemy | null = null;
    for (const e of this.enemies) if (e.dying <= 0 && e.y < HALF_H && (!best || e.y < best.y)) best = e;
    return best ? best.x : DEMO_X;
  }

  private demoSpawn(k: DemoKind) {
    this.demoSpawnedAt = this.demoT;
    const top = HALF_H + 80, X = DEMO_X;
    const add = (kind: EnemyKind, x: number, y: number, side = 1, param = 0) => this.spawn(kind, x, y, side, param, false, 5000 + this.waveIndex++ * 97);
    switch (k) {
      case "drone": for (let i = 0; i < 3; i++) add("drone", X, top + i * 140); break;
      case "rock": for (let i = 0; i < 4; i++) add("rock", X + (i - 1.5) * 130, top + i * 110, i % 2 ? 1 : -1, 40); break;
      case "fighter": add("fighter", X - 380, top + 40, 1); break;
      case "burster": add("burster", X, top, 1); break;
      case "splitter": add("splitter", X, top, 1); break;
      case "blinker": add("blinker", X, top); break;
      case "cog": add("cog", X, top + 280, 1); break;
      case "fortress": case "dreadnought": this.spawnBoss(k); break;
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
    if (this.dead <= 0) { ring(this.sx, this.sy, this.hitR, 0x00ff00); ring(this.sx, this.sy, this.ramR, 0x008800); }
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
    // Missiles steer towards their target (a new one if it's gone), trailing sparks.
    let targets: Target[] | null = null;
    for (const s of this.shots) {
      if (s.kind !== "missile") continue;
      if (!s.target || !s.target.alive()) {
        targets ??= this.targets().filter((t) => !t.shielded);
        let best: Target | null = null, bd = 1e9;
        for (const t of targets) { const d = Math.hypot(t.x - s.x, t.y - s.y) + (t.y < s.y ? 400 : 0); if (d < bd) { bd = d; best = t; } }
        s.target = best;
      }
      const sp = Math.min(1250, Math.hypot(s.vx, s.vy) + 1800 * dt);
      let ang = Math.atan2(s.vy, s.vx);
      if (s.target) {
        const want = Math.atan2(s.target.y - s.y, s.target.x - s.x);
        let d = want - ang; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        ang += clamp(d, -7 * dt, 7 * dt);
      }
      s.vx = Math.cos(ang) * sp; s.vy = Math.sin(ang) * sp;
      if (Math.random() < 0.7) this.spark(s.x, s.y, -s.vx * 0.1 + (Math.random() - 0.5) * 40, -s.vy * 0.1 + (Math.random() - 0.5) * 40, 0.25, new THREE.Color(2, 0.9, 0.3));
    }
    const move = (list: Shot[]) => { for (const s of list) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; } };
    move(this.shots); move(this.eshots);
    // Swept: does the shot's path this frame pass within reach of the target (fast shots can't skip past)?
    const near = (s: Shot, x: number, y: number, reach: number) => {
      const ax = s.x - s.vx * dt, ay = s.y - s.vy * dt, bx = s.x - ax, by = s.y - ay;
      const t = clamp(((x - ax) * bx + (y - ay) * by) / Math.max(1e-6, bx * bx + by * by), 0, 1);
      return Math.hypot(ax + bx * t - x, ay + by * t - y) < reach;
    };
    for (const s of this.shots) {
      if (!this.boss) break;  // (destroyed by an earlier shot this frame)
      for (const p of this.boss.parts) {
        if (!this.boss) break;
        if (!p.alive || s.life <= 0) continue;
        if (s.hitRefs?.has(p)) continue;
        if (near(s, this.boss.x + p.ox, this.boss.y + p.oy, p.r + s.r)) {
          if (s.kind === "lava") { this.lavaBurst(s); continue; }
          this.hitPart(p, s.dmg, s.x, s.y);
          this.shotSpent(s, p);
        }
      }
    }
    for (const s of this.shots) {
      if (s.life <= 0) continue;
      for (const e of this.enemies) {
        if (e.dying > 0) continue;
        if (s.hitRefs?.has(e)) continue;
        if (near(s, e.x, e.y, e.r + s.r)) {
          if (s.kind === "lava") { this.lavaBurst(s); break; }
          this.hitEnemy(e, s.dmg);
          this.burst(s.x, s.y, s.kind === "missile" ? new THREE.Color(2, 1.2, 0.4) : new THREE.Color(0.5, 1.5, 2), s.kind === "missile" ? 8 : 3, 250);
          this.shotSpent(s, e);
          if (s.life <= 0) break;
        }
      }
    }
    // Lava that reaches the end of its flight bursts where it is.
    for (const s of this.shots) if (s.kind === "lava" && s.life <= 0) this.lavaBurst(s);
    this.updateWeaponFx(dt);
    if (this.dead <= 0) for (const s of this.eshots) if (near(s, this.sx, this.sy, s.r + this.hitR)) { this.hurt(s.dmg); s.life = 0; }
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

  /** A shot hit something: a missile with blast bursts; a piercing shot carries on (once per enemy). */
  private shotSpent(s: Shot, what: object) {
    if (s.blast) { this.blast(s.x, s.y, s.blast, s.dmg * 0.5, true); this.burst(s.x, s.y, new THREE.Color(2.4, 1.2, 0.3), 12, s.blast * 4); }
    if (s.pierce && s.pierce > 0) { s.pierce--; (s.hitRefs ??= new Set()).add(what); return; }
    s.life = 0;
  }

  // --- Coins ---
  /** Scatter coins worth `total` from a destroyed enemy (5s and 25s). */
  private dropCoins(x: number, y: number, total: number) {
    if (this.demo) return;
    while (total > 0 && this.coinDrops.length < MAX_COINS) {
      const v = total >= 25 ? 25 : 5;
      total -= v;
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 110;
      this.coinDrops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 40, v, age: 0 });
    }
  }

  /** Coins drift down and away; close to the ship they're pulled in and collected. */
  private updateCoins(dt: number) {
    const reach = 240;
    for (const c of this.coinDrops) {
      c.age += dt;
      const dx = this.sx - c.x, dy = this.sy - c.y, d = Math.hypot(dx, dy) || 1;
      if (this.dead <= 0 && d < reach) { const sp = 500 + 900 * (1 - d / reach); c.vx = (dx / d) * sp; c.vy = (dy / d) * sp; }
      else { c.vx *= 1 - Math.min(1, dt * 1.5); c.vy += (-55 - c.vy) * (1 - Math.exp(-dt * 1.2)); }  // drift down slowly
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (this.dead <= 0 && d < this.ramR + 16) { this.coins += c.v; c.age = -1; sfx("coin", c.x / HALF_W, c.v > 5 ? 0.5 : 0.3, c.v > 5 ? 0.8 : 1); }
    }
    this.coinDrops = this.coinDrops.filter((c) => c.age >= 0 && c.age < COIN_LIFE && c.y > -HALF_H - 40 && Math.abs(c.x) < HALF_W + 40);
    const n = this.coinDrops.length;
    for (let i = 0; i < n; i++) {
      const c = this.coinDrops[i], blink = c.age > COIN_LIFE - 3 && Math.floor(c.age * 8) % 2 === 0;
      const s = (c.v > 5 ? 15 : 9) * (blink ? 0.001 : 1);
      this.dummy.position.set(c.x, c.y, 4);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s * Math.max(0.2, Math.abs(Math.cos(c.age * 5))), s * 1.3, 1);
      this.dummy.updateMatrix();
      this.coinMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.coinMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;
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
