# Luxcores

A mobile strategy game where every unit and building is made of light. Defend your Lumen Core, build collectors and towers, send creep groups down three curved lanes, and lead one hero at a time from a roster of five.

This repo holds the phase 1 MVP: plain HTML and JavaScript with Three.js. Its deterministic simulation is the reference spec for a later Godot port.

## Run

```bash
npm test                 # sim tests, no install needed (Node 22+)
npm run headless         # simulate a 10-minute match headless, print the state hash
npm run serve            # then open http://localhost:5173 (or your LAN IP on a phone)
```

Add `?seed=42` to the URL to change the match seed.

## Docs

- [Game design](docs/GAME_DESIGN.md)
- [Technical architecture](docs/TECH_ARCHITECTURE.md)
- [Handover and next tasks](docs/HANDOVER.md)
- [Rules for coding agents](CLAUDE.md)

## Credits

Design and code: Hamza BEN JANNET. Game and UI/UX design, 3D models: Hama BEN JANNET.
