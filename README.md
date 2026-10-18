# Luxcores

A mobile strategy game where every unit and building is made of light. Defend your Lumen Core, build collectors and towers, send creep groups down three curved lanes, and lead one hero at a time from a roster of five.

This repo holds the phase 1 MVP: plain HTML and JavaScript with Three.js. Its deterministic simulation is the reference spec for a later Godot port.

## Run

```bash
npm test                 # sim, bot and client-logic tests, no install needed (Node 22+)
npm run headless         # simulate a 10-minute match headless, print the state hash
node tools/run-bots.js   # two bots play a match headless
npm run serve:install    # once: install the backend
npm run serve            # then open http://localhost:3000 (or your LAN IP on a phone)
```

The backend serves the game page and runs every match, so one rule engine serves the web client and the Godot client. The start menu offers a match against a bot, two bots to watch, or a match for two humans. Add `?seed=42` to the URL to choose the map seed, or `?match=new&vsBot=1&autostart=1` to skip the menu.

## Docs

- [Game design](docs/GAME_DESIGN.md)
- [Technical architecture](docs/TECH_ARCHITECTURE.md)
- [Handover and next tasks](docs/HANDOVER.md)
- [Rules for coding agents](CLAUDE.md)

## Credits

Design and code: Hamza BEN JANNET. Game and UI/UX design, 3D models: Hama BEN JANNET.
