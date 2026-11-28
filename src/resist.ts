// Damage types: each enemy kind (and each mini-boss) takes more or less from certain weapons. A number
// below 1 is protection (0.25 = a quarter of the damage), above 1 a weakness. Anything not listed is 1.
import type { BossKind, EnemyKind, WeaponKind } from "./game";

export type Resist = Partial<Record<WeaponKind, number>>;

export const RESIST: Record<EnemyKind, Resist> = {
  drone: { chain: 1.25 },
  rock: { lava: 0.5, chain: 0.4, shock: 1.5 },
  splitter: { chain: 0.5, lava: 1.3 },
  fighter: { laser: 0.6, missile: 1.3 },
  burster: { pulse: 0.65, shock: 1.3 },
  blinker: { chain: 0.25, missile: 0.6, laser: 1.3 },
  cog: { pulse: 0.6, lava: 0.7, chain: 1.5, missile: 1.25 },
  prism: { laser: 0.4, shock: 1.4, lava: 1.2 },
  comet: { missile: 0.5, chain: 1.3 },
  gunship: { pulse: 0.6, lava: 1.3, chain: 1.2 },
  jelly: { shock: 0.5, lava: 0.6, chain: 1.4 },
  worm: { lava: 0.4, shock: 1.3, missile: 1.2 },
  zapper: { chain: 0, lava: 1.3, shock: 1.2 },
  orbiter: { pulse: 0.7, lava: 1.2 },
  node: { laser: 0.5, chain: 1.5 },
};

export const BOSS_RESIST: Record<BossKind, Resist> = {
  fortress: { chain: 0.6, missile: 1.2 },
  dreadnought: { laser: 0.6, lava: 1.2 },
  warden: { lava: 0.6, chain: 1.2 },
};

/** What each damage type is called in messages and the gallery. */
export const DAMAGE_NAME: Record<WeaponKind, string> = { pulse: "pulse shots", laser: "lasers", chain: "lightning", lava: "lava", shock: "shockwaves", missile: "missiles" };

/** Gallery lines: what it shrugs off and what hurts it most. */
export function resistStats(r: Resist): [string, string][] {
  const out: [string, string][] = [];
  const list = Object.entries(r) as [WeaponKind, number][];
  const res = list.filter(([, v]) => v < 1).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${DAMAGE_NAME[k]} (${Math.round(v * 100)}%)`);
  const weak = list.filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${DAMAGE_NAME[k]} (${Math.round(v * 100)}%)`);
  if (res.length) out.push(["Protected vs", res.join(", ")]);
  if (weak.length) out.push(["Weak to", weak.join(", ")]);
  return out;
}
