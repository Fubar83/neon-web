# NEON (browser)

The neon shooter running in a browser, front-end only: TypeScript, Three.js and Web Audio.
Like the Unreal version, nothing is loaded: every shape is generated neon line art, the music is
synthesized live, and the sound effects are made from oscillators and noise.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/ (host anywhere)
```

## Play

- Level select: Up/Down choose, Left/Right difficulty (Easy / Normal / Hard), Enter start.
- In a level: WASD or arrows move, J or Z fire, Space boost, Shift brake, M music on/off, H hit circles, Esc back to the menu.
- A gamepad works too (left stick, right trigger / A to fire).

## How a run works

- Each level is a run of about ten minutes to a finish line. Your result is your **score**; your best score per level and difficulty is saved and shown in the menu.
- **The run is the same for everyone**: waves, upgrade offers, tunnels and mini-bosses all come from the level's seed and the distance flown, never from luck or from what you did. (Different difficulties are different runs.)
- **Harder every minute** (a minute's worth of distance): more waves, tougher and faster-shooting enemies, bigger groups, two groups at once later on, and a new enemy kind each minute.
- **Points**: simple enemies are worth little, tough ones more (and everything more each danger level). Destroy every enemy of a wave (splitter fragments too) for a WAVE CLEARED bonus of half its value; let one escape and it is gone. Mini-boss parts, cleared tunnels and the finish line (plus 5,000 per life left) score too.
- **Bonuses**: every 4,000 points three different upgrades appear mid-screen for about seven seconds; fly into one and the others are gone (+1 gun, faster fire, +25% damage, shield, repair, +1 life). So they are earned by fighting, not by flying past enemies.
- **Tunnels** are mandatory, about one every 2.5 minutes, each harder than the last. A crash costs a life (you come back outside); the tunnel counts in full either way, so runs stay in step.
- **Mini-bosses** (Fortress, Dreadnought) must be taken apart in order: turrets or engines first, then generators or turrets, then the core. Parts not yet up are shielded.

## Levels

- Sunny Synth (for kids): gentler, endless lives, 10,000 m.
- Clockwork Foundry, Circuit Board, Synthwave Sunset: 16,000 m each.

## Code

- `src/main.ts`: renderer, bloom, level selector, loop, HUD.
- `src/game.ts`: ship, enemies, shots, waves, effects, level list.
- `src/world.ts`: the scrolling neon scenery per theme.
- `src/neon.ts`: thick glowing lines and outline shapes.
- `src/music.ts`, `src/audio.ts`: music sequencer, sound effects, reverb.
