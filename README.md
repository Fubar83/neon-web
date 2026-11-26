# NEON (browser)

The neon shooter running in a browser, front-end only: TypeScript, Three.js and Web Audio.
Like the Unreal version, nothing is loaded: every shape is generated neon line art, the music is
synthesized live, and the sound effects are made from oscillators and noise.

**Play it:** https://fubar83.github.io/neon-web/ (built and published by GitHub Actions on every push to main).

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/ (host anywhere)
```

## Play

- Level select: Up/Down choose, Left/Right difficulty (Easy / Normal / Hard), Enter start.
- In a level: WASD or arrows move; the primary weapons fire by themselves whenever an enemy is on screen (J / Z fires too), and the pulse gun, laser and wingmen lean toward the nearest enemy within about 10 degrees ahead (aim assist); Space fires the secondary; Shift slows you for precise dodging (not in tunnels); P pauses and opens the shop; M music on/off, H hit circles, Esc leaves the run (it asks first).
- A gamepad works too (left stick, right trigger / A to fire).

## On a phone or tablet

Play sideways (landscape), with two thumbs.

- **Left thumb, steering**: touch anywhere on the left half and drag; a stick appears under your thumb. In tunnels it steers you round the tube.
- **Right thumb, SPECIAL**: the secondary weapon (its ring fills as the cooldown runs). The primary weapons fire by themselves at enemies.
- SHOP (pause) and full screen are small buttons on the right.
- Menus, the hangar, the gallery and the shop are tapped; BACK, NEXT, RESUME and MENU buttons stand in for the keys.
- On a computer, add `?touch` to the address to try the touch controls.

**Full screen**: the FULL SCREEN button (menu, pause, gallery, hangar; the small ⛶ button while playing on a phone) or F on a keyboard. Tapping a level on a phone goes full screen by itself. iPhones don't allow it for web pages: there use Share, then Add to Home Screen, and start NEON from the home screen (it then runs full screen and sideways; Android can install it the same way).

## How a run works

- Each level is a run of about ten minutes to a finish line. Your result is your **score**; your best score per level and difficulty is saved and shown in the menu.
- **The run is the same for everyone**: waves, bonuses, tunnels and bosses all come from the level's seed and the distance flown, never from luck or from what you did. (Different difficulties are different runs.)
- **Harder every minute** (a minute's worth of distance): more waves, tougher and faster-shooting enemies (enemy health also grows 25% per minute, bosses 15%, to keep up with your upgrades), bigger groups, two groups at once later on, and a new enemy kind each minute.
- **A gentle start**: the first 3 minutes ease in (half as much on Hard): at first a third fewer waves, smaller drone lines, enemies shooting about half as often with slower shots, 25% softer, and 35% less damage to you, fading to normal by minute 3.
- **Points**: simple enemies are worth little, tough ones more (and everything more each danger level). Destroy every enemy of a wave (splitter fragments too) for a WAVE CLEARED bonus of half its value; let one escape and it is gone. Boss sections, cleared tunnels and the finish line (plus 5,000 per life left) score too.
- **Bonuses**: every 4,000 points you are given the next upgrade in a fixed order, the same in every level (+1 gun, shield, faster fire, +25% damage, repair, +1 gun, faster fire, +1 life, ...). The top bar shows which one is next. They are earned by fighting, not by flying past enemies.
- **Tunnels** are mandatory, about one every 2.5 minutes, each harder than the last. A crash costs a life (you come back outside); the tunnel counts in full either way, so runs stay in step. The tube has solid walls you can't see through, covered in many thin, dim neon lines in its own colours and pattern, and few, gentle bends so you see far ahead. Obstacles stand out: thick red-hot blocks with a white-hot rim, brighter the closer they are, in twelve shapes (single blocks, pairs, ring gates, slaloms, three-blade gates, spirals, rows of pillars, half walls, crosses, double gates, two-gap rings, staggered pillars), in short groups that sometimes alternate two shapes, more kinds as a tunnel goes on, mixed differently in every tunnel of a run (each run's tunnels are the same every time, so scores compare); and a **gap radar** ring around the view shows the blocks coming up (red, brighter as they get close) and your ship (cyan dot), so you can line up with the gap early. Tunnel speed builds up to a top speed, and there's no braking.
- **Bosses** (three per level, each level in its own order): Fortress, Dreadnought and Warden. Each has three big sections opened one at a time (the others are shielded and stop your shots), each with its own weapons: aimed volleys, sweeping fans, rings with a gap, slow spirals, homing missiles (shoot them down), mines that burst into rings, laser grids (find the free lane), laser sweeps that follow you, and the Dreadnought's ram. One attack at a time: a warning first (its name, the section flashing, red guide lines for lasers), then the attack, then a short rest to hit back. Destroying a section changes the boss's movement and weapons. While a boss is here no new enemies come and the run holds still (the distance doesn't count on); it leaves after 3 minutes.

## Levels

- Sunny Synth (for kids): gentler, endless lives, 10,000 m.
- Clockwork Foundry, Circuit Board, Synthwave Sunset: 16,000 m each.

## Coins, shop and hangar

Every run starts equal: your hull and colour, and the pulse gun. Destroyed enemies drop coins (drone 5 ... cog 100, boss parts 40-200; a cleared wave 10 more; a cleared tunnel 50 per tunnel). They drift down slowly and last about 16 seconds (blinking near the end); fly within reach and they come to you.

**Shop** (P or Tab pauses a run; P, Esc or a tap on the game beside it goes back; it also opens by itself if you switch away or lock the phone): spend the run's coins. Purchases last for that run only. LEAVE RUN in the shop ends the run (it asks first).

One row per weapon and add-on: its base price, then its own stackable upgrades, each a little dearer than the last (the shop shows how many of each you have, e.g. 2/5). Owned weapons and add-ons can be switched on and off.

| | Base | Upgrades (max stacks) |
|---|---|---|
| Pulse gun | owned | +1 gun (3), damage +20% (5), fire rate +15% (4), wider fan +4° (3), pierce +1 (2) |
| Laser | 300 | damage +20% (5), wider beam +30% (3), pierce +1 target (2) |
| Chain laser | 500 | +1 jump (3), range +25% and a 6° wider cone (3), damage +20% (5), less falloff (2), fire rate +15% (3) |
| Lava cannon | 200 | damage +25% (5), blast +20% (3), pool +50% (2), cooldown -15% (3), +1 side ball (2) |
| Shockwave | 350 | damage +25% (5), range +20% (3), wider arc +45° (2, two make a full ring), cooldown -15% (3) |
| Homing missiles | 300 | +1 missile (4), damage +25% (5), reload -15% (3), blast (2) |
| Shield regen | 350 | 3 s faster (2), +1 max (2) |
| Wingman | 450 | +1 wingman (1), damage +30% (3), fire rate +20% (2) |
| Repair drone | 450 | faster repair (2) |
| Ship | | armor +25 (150, then 100 more each, 4x), shield +3 (120), repair (80), extra life (600, 900) |

**Hangar** (EXTRAS > HANGAR, before a run, free and saved): hull and colour; the ship flies it live beside the panel.


**The parts**:

- **Hull**: Falcon (100 hull, balanced), Dart (70 hull, 20% faster, smaller to hit), Bulwark (150 hull, 18% slower, bigger to hit).
- **Primary**, up to 2, both fire by themselves whenever an enemy is on screen (with two, each does 70% damage):
  - **Pulse gun**: fast straight shots; more guns per level, fanning out from 3.
  - **Laser**: a continuous beam that burns the first thing in its way.
  - **Chain laser**: a bolt to an enemy in a narrow cone ahead (20°, not too far) that jumps from enemy to enemy: 1 jump at level 1, 2 at levels 2-3, 3 at levels 4-5, reaching further each level; every jump does 25% less damage.
- **Secondary**, 1, on Space, then a cooldown:
  - **Lava cannon** (2.2 s): a heavy lava ball that bursts over an area and leaves a burning pool.
  - **Shockwave** (2.6 s): a half ring that rolls out ahead and hits everything it reaches; close targets take full damage, those at the edge a quarter.
- **Add-ons**, up to 2, work by themselves: homing missiles (every 1.4 s, one per level), shield regen (a shield hit every 12 s, up to 2), wingman (a drone that fires with you), repair drone (mends the hull after 3 s without a hit).
- **Colour** of the ship and its shots.

The weapon level (1-5, raised by bonuses) powers every weapon, and so do the faster-fire and damage bonuses (faster fire also shortens cooldowns). Shielded boss parts take no damage from any of them.


## Gallery

EXTRAS > GALLERY in the menu shows your ship, its weapons, every enemy and all three bosses live, one at a time, with their points, toughness and what they do (LEFT / RIGHT to browse, H for hit circles, ESC back). It uses the real game logic, so they behave exactly as in a run.

## Code

- `src/main.ts`: renderer, bloom, level selector, loop, HUD.
- `src/game.ts`: ship, enemies, shots, waves, effects, level list.
- `src/loadout.ts`, `src/hangar.ts`, `src/shop.ts`, `src/panel.ts`: hulls, colours, prices and weapon upgrades, the shop and hangar rows, and the side panel.
- `src/gallery.ts`: the gallery entries and their descriptions (the live demos are in game.ts).
- `src/world.ts`: the scrolling neon scenery per theme.
- `src/neon.ts`: thick glowing lines and outline shapes.
- `src/music.ts`, `src/audio.ts`: music sequencer, sound effects, reverb.
