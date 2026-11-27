// The gallery: every enemy, the mini-bosses and the player's ship, with what they do. The game shows
// each one live (Game.setDemo), so what you see is exactly how they behave in a run.
import type { BossKind, DemoKind, EnemyKind, LevelDef } from "./game";
import { BOSS_RESIST, RESIST, resistStats } from "./resist";

export interface GalleryEntry {
  kind: DemoKind;
  name: string;
  color: string;
  /** Short facts: points, toughness, where it shows up. */
  stats: [string, string][];
  /** What it does. */
  abilities: string[];
}

export const GALLERY: GalleryEntry[] = [
  {
    kind: "ship", name: "Your Ship", color: "#bff8ff",
    stats: [["Hulls", "Falcon 100, Dart 70 (fast), Bulwark 150 (slow)"], ["Lives", "Easy 5, Normal 3, Hard 2"], ["Set-up", "hull and colour in the HANGAR"]],
    abilities: [
      "Moves freely in all directions (WASD or arrows); the primary weapons fire by themselves whenever an enemy is on screen",
      "Every run starts with the pulse gun. Destroyed enemies drop coins (tougher ones more); fly close and they come to you",
      "SHOP (P pauses): spend this run's coins on weapons and add-ons, then their own stackable upgrades; also armor, shields, repairs and lives. Purchases last for the run",
      "HANGAR: pick the hull and colour (free) before a run",
      "Weapon level 1-5 powers every weapon; the pulse gun gets more guns, fanning out from 3",
      "PRECISE (Shift, keyboard): less than half speed, for threading between shots",
      "SHIELD: takes the next 4 hits instead of the hull (blue ring). A shot takes 10 hull, ramming 30",
      "Small hit circle for bullets (the cockpit), a wider one for ramming",
      "Losing the hull costs a life and one weapon level, then 2.5 s of safety",
      "Bonuses every 4,000 points, in a fixed order: +1 weapon level, shield, faster fire (+18%, up to x2), +25% damage, repair (+60 hull), +1 life",
      "SECONDARY on Space, when its cooldown is ready",
      "Tunnels: steer left/right round the tube; no braking",
    ],
  },
  {
    kind: "weapons", name: "Ship Weapons", color: "#ffaa33",
    stats: [["Primary", "up to 2, fire by themselves at enemies"], ["Secondary", "1, on Space, then a cooldown"], ["Add-ons", "up to 2, work by themselves"], ["Get them", "in the shop (P) with coins"], ["Upgrades", "per weapon, stackable, in the shop"], ["Level", "1-5 from bonuses; powers them all"]],
    abilities: [
      "PRIMARY PULSE GUN: fast straight shots; more guns per level, fanning out from 3",
      "PRIMARY LASER: a continuous beam that burns the first thing in its way; wider and hotter per level",
      "PRIMARY CHAIN LASER: a bolt to an enemy in a narrow cone ahead (20°, wider and longer with range upgrades) that jumps on: 1 jump at level 1, 2 at levels 2-3, 3 at levels 4-5, longer jumps per level; each jump does 25% less damage",
      "SECONDARY LAVA CANNON (2.2 s cooldown): a heavy lava ball that bursts over an area and leaves a burning pool",
      "SECONDARY SHOCKWAVE (2.6 s cooldown): a half ring rolls out ahead and hits everything it reaches once; full damage close by, a quarter at the edge",
      "ADD-ON HOMING MISSILES: every 1.4 s, whenever there is something to hit, a volley fans out and steers to targets; one missile per level",
      "ADD-ON SHIELD REGEN: a shield hit every 12 s, up to 2.  WINGMAN: a small drone at your side fires with you.  REPAIR DRONE: mends the hull after 3 s without a hit",
      "With two primaries each does 70% of its damage",
      "SHOP UPGRADES per weapon, stackable: pulse +guns / damage / fire rate / wider fan / pierce; laser damage / width / pierce; chain +jumps / range / damage / less falloff / rate; lava damage / blast / pool / cooldown / side balls; shockwave damage / range / wider arc (to a full ring) / cooldown; missiles +missiles / damage / reload / blast; wingman +1 drone / damage / rate",
      "Faster fire shortens the cooldowns too. Shielded mini-boss parts take no damage; missiles and the chain laser skip them",
    ],
  },
  {
    kind: "drone", name: "Drone", color: "#ff3030",
    stats: [["Points", "50"], ["Toughness", "3"], ["Comes", "in lines of 4 to 6"]],
    abilities: ["Weaves side to side on its way down", "Fires single pink shots aimed at you", "The first enemy in most levels"],
  },
  {
    kind: "rock", name: "Rock", color: "#9966ff",
    stats: [["Points", "40"], ["Toughness", "6"], ["Comes", "in showers of 5 to 7"]],
    abilities: ["Drifts slowly down at an angle", "No weapon, but ramming one hurts", "Doesn't get tougher with danger level"],
  },
  {
    kind: "splitter", name: "Splitter", color: "#bfff33",
    stats: [["Points", "120 (+30 per fragment)"], ["Toughness", "10 (fragments 3)"], ["Comes", "in pairs or threes"]],
    abilities: ["Hovers and sways before moving on", "Fires single aimed shots", "Breaks into 3 fragments that fan out downwards: get them too for the wave bonus"],
  },
  {
    kind: "fighter", name: "Fighter", color: "#33ff66",
    stats: [["Points", "200"], ["Toughness", "8"], ["Comes", "from both sides"]],
    abilities: ["Sweeps in from the side of the screen", "Fires quick bursts of 3 aimed shots", "Dives away after about 5 seconds"],
  },
  {
    kind: "burster", name: "Burster", color: "#ff7390",
    stats: [["Points", "250"], ["Toughness", "12"], ["Comes", "in groups of 3"]],
    abilities: ["Sways in wide arcs", "Fires rapid bursts of 5 aimed shots", "Tough: needs focused fire"],
  },
  {
    kind: "blinker", name: "Blinker", color: "#99ffff",
    stats: [["Points", "300"], ["Toughness", "9"], ["Comes", "in pairs"]],
    abilities: ["Teleports about every 2 seconds", "Fires a 3-shot spread at you right after each jump", "Watch for the sparks where it lands"],
  },
  {
    kind: "cog", name: "Giant Cog", color: "#ffa020",
    stats: [["Points", "1,500"], ["Toughness", "70"], ["Comes", "alone, at most every 25 s"]],
    abilities: ["A huge spinning gear that hovers for about 20 seconds", "Fires rings of 10 slow shots that turn with it", "Ramming it costs 40 hull, and it doesn't break"],
  },
  {
    kind: "fortress", name: "Boss: Fortress", color: "#8899ff",
    stats: [["Sections", "gun deck, generators, core"], ["Points", "2,000 / 2,000 / 6,000"], ["Tactic", "read the warnings, dodge, hit back in the rests"]],
    abilities: [
      "Three big sections, opened one at a time: the others are shielded (blue ring, dimmed) and stop your shots", "One attack at a time: a warning (its name, a flashing section, red guide lines for lasers), the attack, then a short rest to hit back", "While a boss is here no new enemies come and the run holds still; it leaves after 3 minutes",
      "GUN DECK: aimed volleys, sweeping fans",
      "GENERATORS (two): homing missiles (shoot them down), rings with a gap, volleys",
      "CORE: laser grid (find the free lane), a slow spiral, missiles",
    ],
  },
  {
    kind: "dreadnought", name: "Boss: Dreadnought", color: "#ff66cc",
    stats: [["Sections", "bow guns, broadsides, reactor"], ["Points", "2,000 / 2,000 / 6,000"], ["Tactic", "keep moving; dodge its ram sideways"]],
    abilities: [
      "Three big sections, opened one at a time: the others are shielded (blue ring, dimmed) and stop your shots", "One attack at a time: a warning (its name, a flashing section, red guide lines for lasers), the attack, then a short rest to hit back", "While a boss is here no new enemies come and the run holds still; it leaves after 3 minutes",
      "BOW GUNS: sweeping fans, mines that burst into rings",
      "BROADSIDES (two): laser sweeps that follow you, volleys, mines",
      "REACTOR: it rams you (sidestep the lunge), missiles, spiral, laser sweeps",
    ],
  },
  {
    kind: "warden", name: "Boss: Warden", color: "#55ffdd",
    stats: [["Sections", "pylons, crown, eye"], ["Points", "2,000 / 2,000 / 6,000"], ["Tactic", "find the gaps and lanes"]],
    abilities: [
      "Three big sections, opened one at a time: the others are shielded (blue ring, dimmed) and stop your shots", "One attack at a time: a warning (its name, a flashing section, red guide lines for lasers), the attack, then a short rest to hit back", "While a boss is here no new enemies come and the run holds still; it leaves after 3 minutes",
      "PYLONS (two): rings with a gap, mines",
      "CROWN (two): laser grids, volleys, rings",
      "EYE: laser sweeps, homing missiles, spiral, laser grids",
    ],
  },
];

// Each enemy and mini-boss lists what it is protected against and weak to (from resist.ts).
for (const g of GALLERY) {
  const r = RESIST[g.kind as EnemyKind] ?? BOSS_RESIST[g.kind as BossKind];
  if (r) g.stats.push(...resistStats(r));
}

/** The stage the gallery is shown on: no waves, tunnels or bosses of its own. */
export const GALLERY_LEVEL: LevelDef = {
  id: "gallery", name: "Gallery", group: "", theme: "Circuit", music: "Menu", seed: 9, speed: 20, finish: 1e9, startDifficulty: 0,
  tiers: [["drone"]], tunnels: [], bosses: [],
};

export const GALLERY_NOTE = "Every enemy is worth 20% more and gets tougher each danger level and as your ship gets stronger. Destroy a whole wave for a bonus.";
