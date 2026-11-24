// The hangar (before a run): the free set-up - hull and colour. Weapons, add-ons and their upgrades are
// bought during the run in the shop (shop.ts).
import { COLORS, HULLS, HULL_ORDER, type Loadout } from "./loadout";
import type { PanelRow } from "./panel";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export function hangarRows(l: Loadout, set: (l: Loadout) => void): PanelRow[] {
  return [
    { title: "HULL", items: HULL_ORDER.map((h) => ({ name: HULLS[h].name, desc: HULLS[h].desc, selected: l.hull === h, pick: () => { set({ ...l, hull: h }); return true; } })) },
    { title: "COLOUR", items: COLORS.map((c) => ({ name: c.name, desc: "Ship and shot colour.", selected: l.color === c.color, swatch: hex(c.color), pick: () => { set({ ...l, color: c.color }); return true; } })) },
  ];
}
