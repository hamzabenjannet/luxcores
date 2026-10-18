# Handover: Client Alignment Before M4

Describes the state after commit `ccb16a9` plus the menu test commit and the docs commit that follow it. Read `docs/HANDOVER.md` for the live status and this file for what was decided and checked.

## What Changed

- **Bots on the server.** `src/bot/bot.js` is a real test bot (GDD 12.1 rotation, tower upgrades). The match runner thinks for every bot each tick, so bot commands are recorded in the replay. A `botVsBot` lobby has no human slots, and any signed-in player may spectate it. `WorldView` moved to `src/shared/world-view.js` so the server can build views for bots.
- **Protocol.** Snapshots gained `attack`, `recycle`, `stunTicks`, `targetId`, `powerLevel`, `shellLevel`, `roll` and `arrivalTick`. Godot's cancel-recycle button never worked before, because the server did not send `recycle`. `/api/game/spec` lists the entity `kinds`.
- **Web client.** The in-browser sim loop is gone. The page has a menu, a lobby, a build palette, a selection panel, hero orders and a result banner, and it draws the M3 combat state. `determinism.html` keeps the cross-engine hash check, for the bot too.
- **Godot client.** It checks the spec version, loads the server's data files, draws the M3 state and offers the same controls and modes as the web client.
- **Parity.** `test/fixtures/client-parity.json` is run by `test/client-parity.test.js` (JavaScript) and `vone/tests/run_tests.gd` (GDScript).
- **Tests.** The e2e files run one at a time and share `test/e2e/helpers/backend.js`. `godot.e2e.js` runs both Godot tests.

## Verified

Counts are in `docs/HANDOVER.md` (Alignment validation). Highlights:

- Chromium and Node print the same hash for an idle match (`4cefa32c` at tick 120) and for a bot match (`7b822f15` at tick 4000, the golden replay `bots-seed-777`).
- Two bots play 100 seeds for 6 000 ticks twice with equal hashes. Two deliberate mutations of the bot (no lux reserve, ignoring lanes) each failed a bot test.
- The Godot logic passes 44 parity cases, and it fails when I change a rule in it (a day boundary and a label made 3 cases fail). A live Godot run passes 22 checks against a real backend.
- Screenshots of the web client (`test/e2e/__screenshots__/`, untracked) and a Godot fixture render show the labels, tower caps, aim lines, projectile, stun ring and recycle arc.

## Decisions I Made Without Asking

- Bots run on the server only. The web client and Godot never run bot code.
- Spectating is allowed only for `botVsBot` matches. A human match stays closed to strangers, because fog of war would make a spectator a leak.
- Build mode stays on after a placement in both clients, so a player can place several buildings in a row. A second press on the palette entry turns it off.
- The bot keeps 20 lux in the Core and builds one barracks, because a barracks does nothing before M4.
- Godot refuses a server whose spec version differs from `GameLogic.SPEC_VERSION`. The sim stays at 0.10.0 by the owners' exception, so this only fires after a bump.

## Not Verified

- A real phone, with touch input on the web client or the Godot client. `[UNVERIFIED]`
- Godot exports for web, Android and iOS. `[UNVERIFIED]`
- A Godot match between two humans. The covered path is a Godot human against a bot, and a spectator.
- Hero orders in a live match, because no hero exists before M5. They are covered by parity cases only.
- Load: the server ran at most a few matches at once in tests.

## Open for the Owners

- The meltdown balance question and the M2 clarifications are unchanged from the earlier handover.
- `README.md.bak` is tracked in the repo root. Delete it or say why it stays.
- A tap builds at once in both clients. M8 plans a build ghost with confirm. Say whether the MVP needs it sooner.
