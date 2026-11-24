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
- In a level: WASD or arrows move, J or Z fire, Space boost, Shift brake, M music on/off, Esc back to the menu.
- A gamepad works too (left stick, right trigger / A to fire).

## What is in it so far

- Levels: Sunny Synth (for kids), Clockwork Foundry, Circuit Board, Synthwave Sunset; about two minutes each.
- Themes: Clockwork (tracks, meshing cogs, gauges), Circuit (traces, chips, vias), Synthwave (grid, striped suns, mountains, palms).
- Enemies: drone, fighter, burster, splitter (bursts into fragments), blinker (teleports), rock, and a big cog that fires rings.
- Power-ups (weapon up, repair, shield), explosions with sparks and rings, enemies grey out when shot down.
- Music: the same styles, scales, chord progressions, melody rules and sections as the Unreal synth; intensity and tempo rise in big fights.
- Sound effects panned by where they happen, with a per-theme room reverb.

## Code

- `src/main.ts`: renderer, bloom, level selector, loop, HUD.
- `src/game.ts`: ship, enemies, shots, waves, effects, level list.
- `src/world.ts`: the scrolling neon scenery per theme.
- `src/neon.ts`: thick glowing lines and outline shapes.
- `src/music.ts`, `src/audio.ts`: music sequencer, sound effects, reverb.
