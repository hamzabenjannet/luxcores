# Claude Code Kickoff Prompt

Paste everything below the line into Claude Code, started at the root of the `luxcores` repo.

---

You are picking up the Luxcores project: a deterministic JavaScript game simulation with a Three.js mobile client. The scaffold is committed and green. Your job in this session is to finish milestone M1 and add a browser smoke test that runs against a remote Playwright server.

## 1. Read Before You Write

Read these files in full, in this order, before you touch code:

1. `CLAUDE.md`: working rules. The simulation rules and the Writing Rules are binding for everything you write, including comments and commit messages.
2. `docs/HANDOVER.md`: current status, the M1 task, and its acceptance criteria.
3. `docs/GAME_DESIGN.md` section 10 (map layout and procedural generation).
4. `docs/TECH_ARCHITECTURE.md` sections 4 to 6 (tick pipeline, determinism rules, physics and pathfinding).
5. `src/sim/` in full, then `data/mapgen.json`, `test/determinism.test.js` and `test/sim-boundary.test.js`.

Then run `npm test` and `npm run headless`, and confirm both match the baseline: 19 pass, 3 todo, 0 fail, and `seed=1234567 ticks=12000` prints a hash. Record that hash; your changes will change it on purpose.

If anything in the docs contradicts itself or the code, stop and ask before you build on it.

## 2. Task A: Finish M1 (Map Generation)

Implement `generateMap(seed, mapgen)` in `src/sim/mapgen.js`, following the 7 requirements in `docs/HANDOVER.md` ("Next task: finish M1"). Points that need care:

- Map generation uses its own RNG derived from the match seed. `state.rng` must produce the same stream with or without map generation.
- The mirror is a point mirror through the map center: tile `(x, z)` maps to `(95 - x, 111 - z)`. Generate team 0 first, then mirror.
- Add `laneWidth: 3` to `data/mapgen.json` and read it from config; do not hard-code it.
- The connectivity check is a flood fill over walkable tiles. Run it in a fixed neighbor order (N, E, S, W) so the result is identical in every runtime.
- Store vents, item spawns, lane polylines and lane tiles on `state.map`. Spawn the two Lumen Cores and the 12 blockers as entities, in a fixed order, so entity ids are stable.
- Any new state field that affects gameplay goes into the hash field lists in `state.js`. `state.map` is derived from the seed; leave it out of the hash and say so in a comment.
- Bump `SPEC_VERSION` in `src/sim/config.js` to `0.10.0`, because the initial state changes.

Replace the 3 `test.todo` entries in `test/determinism.test.js` with real tests:

1. The same seed yields a deep-equal layout.
2. The layout is point-symmetric for both teams.
3. Every lane connects both Cores, checked over 1 000 seeds. Keep the test under 5 seconds; if it is slower, profile the generator before you shrink the seed count.

Add a golden replay: run seed 1234567 for 2 400 ticks, save it to `replays/golden/seed-1234567.json`, and add a test that plays every file in `replays/golden/` and expects `ok: true`.

Render the generated layout in `src/client/render/scene.js` with placeholder shapes: lane tiles as a faint strip, vents as small cyan discs, blockers as grey boxes. The point is to eyeball the generator on a phone, so keep the code small.

Commit Task A in at least three commits: generator with tests, golden replay, rendering.

## 3. Task B: Browser Smoke Test on the Remote Playwright Server

A Playwright server runs in Docker on the owners' Mac:

- Image `mcr.microsoft.com/playwright:v1.58.2-noble`, started with `npx -y playwright@1.58.2 run-server --port 3000 --host 0.0.0.0`.
- Host port 42944 maps to container port 3000, so the endpoint is `ws://localhost:42944/`. The compose file falls back to 42044 when `CONTAINER_SERVICE_PLAYWRIGHT_PORT_00` is unset; check which port is live before you assume.

The owners approve exactly one dev dependency for this: `playwright-core`, pinned to `1.58.2` with no range. Playwright's Docker guide requires the client version to match the server version. Use `playwright-core`, which ships no browsers, because the browser runs in the container.

Build it this way:

1. Add a test hook to `src/client/main.js`. When the URL has `?test=1`, record `hashState(state)` every 20 ticks into `window.__luxTest = { hashes: { [tick]: hash } }`. Production paths must not change behavior without the flag.
2. Write `test/e2e/smoke.e2e.js` (the `.e2e.js` suffix keeps it out of the `npm test` glob). It must:
   - read `PW_WS_ENDPOINT` (default `ws://localhost:42944/`) and `APP_URL` (default `http://host.docker.internal:5173/`);
   - connect with `chromium.connect(PW_WS_ENDPOINT)`;
   - open a 390 × 844 mobile context with touch enabled;
   - load `APP_URL + '?test=1&seed=1234567'` and fail on any console error or page error;
   - wait until `window.__luxTest.hashes['120']` exists, then compare it with the hash Node computes for seed 1234567 at tick 120. A mismatch means the sim diverged between Node and Chromium, which is a P0 bug;
   - save a screenshot to `test/e2e/__screenshots__/smoke.png` (add that folder to `.gitignore`);
   - skip with a clear message, and exit 0, when the endpoint is unreachable. CI and other machines may not have the container.
3. Add `"test:e2e": "node --test test/e2e/"` to `package.json`. Use `node --test`'s own skip support for the unreachable case.
4. Run `npm run serve` in the background, then `npm run test:e2e`. The browser runs inside the container, so `localhost` there is the container itself. On Docker Desktop for Mac, `host.docker.internal` reaches the host. If it does not resolve, report it to the owners and suggest the fix from the Playwright Docker guide: add `extra_hosts: ["hostmachine:host-gateway"]` to the compose service and use `http://hostmachine:5173/`.
5. The page loads Three.js from `cdn.jsdelivr.net`, so the container needs outbound internet. If the load fails, report it; do not vendor Three.js without asking.
6. WebGL in a headless container falls back to SwiftShader (software rendering). Expect a deprecation warning about the automatic fallback; treat warnings as noise and errors as failures. If WebGL is unavailable, report it with the console output.

Look at the screenshot yourself and confirm the map, both Cores, the generated lanes and the HUD are visible. Commit Task B as one commit.

## 4. Constraints

- Do not change balance numbers, game rules or the `three` version.
- Do not add dependencies beyond `playwright-core@1.58.2`.
- Every file in `src/sim/` keeps passing `test/sim-boundary.test.js`. Never weaken that test to make code pass.
- Run `npm run lint:prose -- FILE` on every Markdown file you create or edit. Fix every `deny` hit.
- Commit messages follow the informal profile of the Writing Rules: imperative subject, under 72 characters, a body that says why.

## 5. Definition of Done

- [ ] `npm test`: all tests pass, 0 todo, determinism over 1 000 seeds included.
- [ ] `npm run headless` prints a stable hash across two runs.
- [ ] A golden replay exists and its playback test passes.
- [ ] `npm run test:e2e` passes against the container, or skips cleanly when it is down, and the browser hash matches Node at tick 120.
- [ ] The screenshot shows the generated map.
- [ ] `docs/HANDOVER.md` is updated: status table, M1 marked done, the next task set to M2, and any new interpretations listed.

## 6. Final Report

End the session with a short report:

1. What changed, by commit.
2. Test output: pass, fail and skip counts for `npm test` and `npm run test:e2e`.
3. Hashes: the new headless hash for seed 1234567 at 12 000 ticks, and the tick-120 hash from Node and from Chromium.
4. Decisions you made that the docs did not cover, each with a one-line reason.
5. Open questions for the owners.

Mark anything you could not verify in this session as `[UNVERIFIED]`.
