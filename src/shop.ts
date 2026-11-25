// The shop (in a run's pause): spend the coins collected this run. Each weapon and add-on has a base price,
// then its own stackable upgrades (more damage, more bullets, pierce, ...). Everything bought lasts only
// for this run, so every run starts equal.
import { WEAPONS, type Game, type PrimaryKind, type SecondaryKind } from "./game";
import { ADDONS, PRIMARY_INFO, SECONDARY_INFO, type AddonKind } from "./loadout";
import type { PanelItem, PanelRow } from "./panel";

const coins = (n: number) => n.toLocaleString("en-US") + "c";

/** A stackable upgrade for one weapon or add-on: the first costs \`price\`, each next one \`step\` more. */
export interface Mod { id: string; name: string; desc: string; max: number; price: number; step: number }

/** Upgrades per weapon / add-on. The game reads the counts with Game.mod(owner, id). */
export const MODS: Record<string, Mod[]> = {
  pulse: [
    { id: "guns", name: "+1 GUN", desc: "One more gun firing side by side (on top of the weapon level, up to 8).", max: 3, price: 150, step: 100 },
    { id: "dmg", name: "DAMAGE +20%", desc: "Each shot does 20% more damage.", max: 5, price: 120, step: 60 },
    { id: "rate", name: "FIRE RATE +15%", desc: "Fires 15% faster.", max: 4, price: 150, step: 80 },
    { id: "spread", name: "WIDER FAN +4°", desc: "The guns fan out 4 degrees more: covers more of the screen.", max: 3, price: 60, step: 30 },
    { id: "pierce", name: "PIERCE +1", desc: "Each shot goes through one more enemy.", max: 2, price: 300, step: 200 },
  ],
  laser: [
    { id: "dmg", name: "DAMAGE +20%", desc: "The beam burns 20% hotter.", max: 5, price: 150, step: 80 },
    { id: "width", name: "WIDER BEAM +30%", desc: "Easier to keep on target.", max: 3, price: 120, step: 80 },
    { id: "pierce", name: "PIERCE +1", desc: "The beam burns through one more target.", max: 2, price: 350, step: 250 },
  ],
  chain: [
    { id: "jump", name: "+1 JUMP", desc: "The bolt jumps to one more enemy.", max: 3, price: 200, step: 150 },
    { id: "reach", name: "RANGE +25%", desc: "The bolt and its jumps reach 25% further, and it finds its first target in a 6 degrees wider cone.", max: 3, price: 120, step: 80 },
    { id: "dmg", name: "DAMAGE +20%", desc: "Every hit does 20% more damage.", max: 5, price: 150, step: 80 },
    { id: "falloff", name: "LESS FALLOFF", desc: "Each jump loses 8% less damage (25% → 17% → 9%).", max: 2, price: 200, step: 150 },
    { id: "rate", name: "FIRE RATE +15%", desc: "Bolts come 15% more often.", max: 3, price: 150, step: 100 },
  ],
  lava: [
    { id: "dmg", name: "DAMAGE +25%", desc: "The burst and the pool do 25% more damage.", max: 5, price: 120, step: 60 },
    { id: "radius", name: "BLAST +20%", desc: "A 20% bigger burst and pool.", max: 3, price: 120, step: 80 },
    { id: "pool", name: "POOL +50%", desc: "The burning pool lasts 50% longer.", max: 2, price: 100, step: 80 },
    { id: "cool", name: "COOLDOWN -15%", desc: "Ready 15% sooner.", max: 3, price: 150, step: 100 },
    { id: "balls", name: "+1 SIDE BALL", desc: "Fires one more lava ball, angled to the side.", max: 2, price: 300, step: 200 },
  ],
  shock: [
    { id: "dmg", name: "DAMAGE +25%", desc: "The wave hits 25% harder.", max: 5, price: 140, step: 70 },
    { id: "range", name: "RANGE +20%", desc: "The wave rolls 20% further.", max: 3, price: 120, step: 80 },
    { id: "arc", name: "WIDER ARC +45°", desc: "Each side reaches 45 degrees further round; two make a full ring.", max: 2, price: 200, step: 150 },
    { id: "cool", name: "COOLDOWN -15%", desc: "Ready 15% sooner.", max: 3, price: 150, step: 100 },
  ],
  missiles: [
    { id: "count", name: "+1 MISSILE", desc: "One more missile per volley.", max: 4, price: 150, step: 100 },
    { id: "dmg", name: "DAMAGE +25%", desc: "Each missile does 25% more damage.", max: 5, price: 120, step: 60 },
    { id: "reload", name: "RELOAD -15%", desc: "Volleys come 15% more often.", max: 3, price: 150, step: 100 },
    { id: "blast", name: "BLAST", desc: "Missiles burst on impact, hurting what's nearby (bigger per stack).", max: 2, price: 200, step: 150 },
  ],
  regen: [
    { id: "speed", name: "FASTER -3 s", desc: "A shield hit comes 3 s sooner.", max: 2, price: 200, step: 150 },
    { id: "cap", name: "+1 MAX", desc: "It can build up one more shield hit.", max: 2, price: 150, step: 100 },
  ],
  wingman: [
    { id: "twin", name: "+1 WINGMAN", desc: "A second drone on your left.", max: 1, price: 400, step: 0 },
    { id: "dmg", name: "DAMAGE +30%", desc: "The drones' shots do 30% more damage.", max: 3, price: 120, step: 80 },
    { id: "rate", name: "FIRE RATE +20%", desc: "The drones fire 20% faster.", max: 2, price: 150, step: 100 },
  ],
  repair: [
    { id: "speed", name: "FASTER REPAIR", desc: "Mends twice as fast, and starts a second sooner.", max: 2, price: 200, step: 150 },
  ],
};

/** Ship upgrades: repeatable, for this run. */
interface ShipUpgrade { id: string; name: string; desc: string; max: number; price: (n: number) => number; can?: (g: Game) => boolean; apply: (g: Game) => void }
const SHIP: ShipUpgrade[] = [
  { id: "armor", name: "ARMOR +25", desc: "25 more hull (and 25 repaired now).", max: 4, price: (n) => 150 + 100 * n, apply: (g) => { g.maxHull += 25; g.hull += 25; } },
  { id: "shield", name: "SHIELD +3", desc: "The next 3 hits are taken by the shield (up to 9).", max: 99, price: () => 120, can: (g) => g.shieldHits <= 6, apply: (g) => { g.shieldHits += 3; } },
  { id: "repair", name: "REPAIR", desc: "Mends the hull completely.", max: 99, price: () => 80, can: (g) => g.hull < g.maxHull, apply: (g) => { g.hull = g.maxHull; } },
  { id: "life", name: "EXTRA LIFE", desc: "One more life (twice per run).", max: 2, price: (n) => 600 + 300 * n, can: (g) => !g.level.gentle?.endless, apply: (g) => { g.lives++; } },
];

function pay(g: Game, price: number) {
  if (g.coins < price) return false;
  g.coins -= price;
  return true;
}

/** At most \`max\` switched on: adding one more drops the oldest; never fewer than \`min\`. */
function toggle<T>(list: T[], v: T, max: number, min: number) {
  const i = list.indexOf(v);
  if (i >= 0) { if (list.length > min) list.splice(i, 1); else return false; }
  else { list.push(v); if (list.length > max) list.shift(); }
  return true;
}

/** The upgrade chips for one weapon / add-on (usable once it's owned). */
function modItems(g: Game, owner: string): PanelItem[] {
  const owned = g.owned.has(owner);
  return (MODS[owner] ?? []).map((m) => {
    const n = g.mod(owner, m.id), price = m.price + m.step * n, maxed = n >= m.max;
    return {
      name: m.name, desc: m.desc + (owned ? "" : "  Buy the weapon first.") + (maxed ? "  Fully upgraded." : `  ${coins(price)}.`) + `  (${n}/${m.max})`,
      tag: maxed ? `${n}/${m.max} MAX` : `${n}/${m.max} · ${coins(price)}`, selected: n > 0, off: !owned || maxed || g.coins < price,
      pick: () => { if (!owned || maxed || !pay(g, price)) return false; g.mods[`${owner}.${m.id}`] = n + 1; return true; },
    };
  });
}

export function shopRows(g: Game): PanelRow[] {
  const head = (owned: boolean, on: boolean, price: number) => (on ? "ON" : owned ? "OFF" : coins(price));
  const rows: PanelRow[] = [];
  for (const p of ["pulse", "laser", "chain"] as PrimaryKind[]) {
    const owned = g.owned.has(p), on = g.primaries.includes(p), price = PRIMARY_INFO[p].price;
    rows.push({ title: `PRIMARY · ${WEAPONS[p].name}${on ? "  (on)" : ""}`, items: [{
      name: WEAPONS[p].name, desc: PRIMARY_INFO[p].desc + (owned ? "  Pick to switch it on or off (up to 2 primaries on; with two, each does 70% damage)." : `  ${coins(price)}.`),
      tag: head(owned, on, price), selected: on, off: !owned && g.coins < price,
      pick: () => { if (!owned) { if (!pay(g, price)) return false; g.owned.add(p); } return toggle(g.primaries, p, 2, 1); },
    }, ...modItems(g, p)] });
  }
  for (const s of ["lava", "shock"] as SecondaryKind[]) {
    const owned = g.owned.has(s), on = g.secondary === s, price = SECONDARY_INFO[s].price;
    rows.push({ title: `SECONDARY · ${WEAPONS[s].name}${on ? "  (on)" : ""}`, items: [{
      name: WEAPONS[s].name, desc: SECONDARY_INFO[s].desc + (owned ? "  Pick to make it your secondary." : `  ${coins(price)}.`),
      tag: head(owned, on, price), selected: on, off: !owned && g.coins < price,
      pick: () => { if (!owned) { if (!pay(g, price)) return false; g.owned.add(s); } g.secondary = s; g.secCool = 0; return true; },
    }, ...modItems(g, s)] });
  }
  for (const a of ["missiles", "regen", "wingman", "repair"] as AddonKind[]) {
    const owned = g.owned.has(a), on = g.addons.includes(a), price = ADDONS[a].price;
    rows.push({ title: `ADD-ON · ${ADDONS[a].name}${on ? "  (on)" : ""}`, items: [{
      name: ADDONS[a].name, desc: ADDONS[a].desc + (owned ? "  Pick to switch it on or off (up to 2 add-ons on)." : `  ${coins(price)}.`),
      tag: head(owned, on, price), selected: on, off: !owned && g.coins < price,
      pick: () => { if (!owned) { if (!pay(g, price)) return false; g.owned.add(a); } return toggle(g.addons, a, 2, 0); },
    }, ...modItems(g, a)] });
  }
  rows.push({ title: "SHIP", items: SHIP.map((u) => {
    const n = g.bought[u.id] ?? 0, price = u.price(n), maxed = n >= u.max || (u.can && !u.can(g));
    return {
      name: u.name, desc: u.desc + (maxed ? "  Not available now." : `  ${coins(price)}.`) + (n ? `  Bought ${n}x.` : ""),
      tag: maxed ? "MAX" : coins(price), off: maxed || g.coins < price,
      pick: () => { if (maxed || !pay(g, price)) return false; g.bought[u.id] = n + 1; u.apply(g); return true; },
    };
  }) });
  return rows;
}
