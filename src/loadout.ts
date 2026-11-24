// The ship's set-up before a run: hull and colour (free, chosen in the hangar). Weapons, add-ons and their
// upgrades are bought during the run with the coins you collect (see shop.ts), so every run starts equal.
import type { PrimaryKind, SecondaryKind } from "./game";

export type HullKind = "falcon" | "dart" | "bulwark";
export type AddonKind = "missiles" | "regen" | "wingman" | "repair";
export interface Loadout { hull: HullKind; color: number }

export interface HullDef {
  name: string; desc: string;
  /** Hull points, speed factor, hit circles (bullets, ramming). */
  hull: number; speed: number; hit: number; ram: number;
  /** Outline (x, y) and canopy. */
  shape: number[][]; canopy: number[][];
}

export const HULLS: Record<HullKind, HullDef> = {
  falcon: {
    name: "FALCON", desc: "Balanced: 100 hull, normal speed.", hull: 100, speed: 1, hit: 16, ram: 28,
    shape: [[0, 46], [12, 10], [40, -18], [40, -28], [12, -18], [8, -30], [-8, -30], [-12, -18], [-40, -28], [-40, -18], [-12, 10]],
    canopy: [[0, 28], [5, 10], [0, 4], [-5, 10]],
  },
  dart: {
    name: "DART", desc: "Light and fast: 70 hull, 20% faster, smaller to hit.", hull: 70, speed: 1.2, hit: 13, ram: 23,
    shape: [[0, 56], [7, 18], [24, -22], [24, -32], [7, -22], [4, -34], [-4, -34], [-7, -22], [-24, -32], [-24, -22], [-7, 18]],
    canopy: [[0, 34], [4, 16], [0, 10], [-4, 16]],
  },
  bulwark: {
    name: "BULWARK", desc: "Heavy: 150 hull, 18% slower, bigger to hit.", hull: 150, speed: 0.82, hit: 19, ram: 33,
    shape: [[0, 40], [18, 28], [46, 8], [52, -20], [32, -34], [14, -26], [9, -38], [-9, -38], [-14, -26], [-32, -34], [-52, -20], [-46, 8], [-18, 28]],
    canopy: [[0, 24], [8, 12], [0, 2], [-8, 12]],
  },
};
export const HULL_ORDER: HullKind[] = ["falcon", "dart", "bulwark"];

export const PRIMARY_INFO: Record<PrimaryKind, { desc: string; price: number }> = {
  pulse: { desc: "Fast straight shots; more guns per level.", price: 0 },
  laser: { desc: "A continuous beam that burns the first thing in its way.", price: 300 },
  chain: { desc: "A bolt that jumps from enemy to enemy (1-3 jumps), 25% weaker per jump.", price: 500 },
};
export const SECONDARY_INFO: Record<SecondaryKind, { desc: string; price: number }> = {
  lava: { desc: "SPACE: a heavy lava ball, area burst and a burning pool. 2.2 s cooldown.", price: 200 },
  shock: { desc: "SPACE: a shockwave rolling out; closer targets take more. 2.6 s cooldown.", price: 350 },
};
export const ADDONS: Record<AddonKind, { name: string; desc: string; price: number }> = {
  missiles: { name: "HOMING MISSILES", desc: "Fire by themselves every 1.4 s, one missile per weapon level.", price: 300 },
  regen: { name: "SHIELD REGEN", desc: "Gains a shield hit every 12 s (up to 2).", price: 350 },
  wingman: { name: "WINGMAN", desc: "A small drone at your side that fires along with you.", price: 450 },
  repair: { name: "REPAIR DRONE", desc: "Repairs the hull slowly after 3 s without a hit.", price: 450 },
};
export const ADDON_ORDER: AddonKind[] = ["missiles", "regen", "wingman", "repair"];

export const COLORS: { name: string; color: number }[] = [
  { name: "ICE", color: 0xbff8ff },
  { name: "PINK", color: 0xff66dd },
  { name: "LIME", color: 0x99ff55 },
  { name: "GOLD", color: 0xffd860 },
  { name: "EMBER", color: 0xff7744 },
  { name: "VIOLET", color: 0xb088ff },
];

/** Two primaries share the work: each does this much of its damage. */
export const DUAL_FACTOR = 0.7;

export const DEFAULT_LOADOUT: Loadout = { hull: "falcon", color: 0xbff8ff };

const KEY = "neon.loadout";

/** The saved set-up (anything unknown falls back to the default). */
export function loadLoadout(): Loadout {
  let l: Partial<Loadout> = {};
  try { l = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { /* use the default */ }
  const d = DEFAULT_LOADOUT;
  return {
    hull: l.hull && HULLS[l.hull] ? l.hull : d.hull,
    color: COLORS.some((c) => c.color === l.color) ? l.color! : d.color,
  };
}

export function saveLoadout(l: Loadout) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* not saved */ }
}
