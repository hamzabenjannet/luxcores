# CLAUDE.md

Working rules for coding agents in this repo. Read this file in full before you change any code.

## Project

Luxcores is a mobile strategy game where everything is made of light energy (lux). Each player controls one hero at a time, sends creep groups along waypoint paths, builds collectors and towers, and defends a Lumen Core. The map has three curved lanes, and the main mode is 1v1 on a phone in portrait orientation.

This repo is **phase 1**: an HTML and JavaScript MVP. Its simulation doubles as the **executable reference spec** for a later Godot port with a Rust sim core. The design docs are the source of truth:

- `docs/GAME_DESIGN.md`: rules and every number (v0.9).
- `docs/TECH_ARCHITECTURE.md`: sim design, determinism rules, netcode plan, milestones.
- `docs/HANDOVER.md`: current status and the next tasks with acceptance criteria. Start there.

When code disagrees with the GDD, the GDD wins. To change a rule, edit the GDD in the same commit and add a changelog row.

## Commands

```bash
npm test                             # node --test, nothing to install; includes the prose gate
npm run test:e2e                     # Chromium smoke test against the Playwright container (needs npm install)
npm run headless -- <seed> <ticks>   # headless sim run, prints the final hash
npm run lint:prose -- <file>         # writing-rules checker on one file (see Writing Rules)
npm run lint:prose:all               # every Markdown file and every JavaScript comment
npm run gen:sin                      # regenerate src/sim/sin-table.js (rarely)
npm run serve                        # static server on :5173, open from a phone on the LAN
```

The repo needs Node 22 or newer and Python 3 for the prose checker. There is no build step, and `npm test` needs no install. The one approved dependency is `playwright-core` 1.58.2 (dev, pinned) for `npm run test:e2e`; ask the owners before you add another.

## Simulation Rules (`src/sim/`)

These rules keep the sim deterministic across browsers and portable to Rust. `test/sim-boundary.test.js` enforces part of them; the rest depends on review.

1. Import only from `src/sim/`. The sim uses no `three`, no DOM, no Node APIs and no I/O.
2. Use integers only. Lux is stored in milli-lux (1 lux = 1000), positions in units (1 tile = 1000), angles in 4096ths of a turn. Divide with `idiv`, which truncates toward zero like Rust. `hashState` throws on any non-integer.
3. Never call `Math.random`, `Date.now` or `performance.now`. Randomness comes from `state.rng` through `rng.js`.
4. Never call `Math.sin`, `cos`, `atan2`, `exp`, `log` or `pow`, and never use `**`: engines may approximate them differently. Use `isin` and `icos` (lookup table) and `isqrt`.
5. Keep entities in an array sorted by ascending id. Systems iterate in id order, and ties break on the lowest id.
6. Inside the sim, never iterate over object keys, a `Map` or a `Set`. Lookups are fine; iteration order is not portable.
7. Add every gameplay field that changes state to `ENTITY_HASH_FIELDS` or `TEAM_HASH_FIELDS` in `state.js`. Derived caches (visibility, spatial hash) stay out of the hash.
8. The tick pipeline order in `step.js` is part of the spec. A change to the pipeline order, the hash layout, the RNG, or any rule that alters outcomes requires a bump of `SPEC_VERSION` in `config.js`. **Exception while the MVP is built (owners, 2026-10-16):** leave `SPEC_VERSION` at 0.10.0 and re-record the golden replays in the same commit as the change. The bump rule returns when the owners lift this exception.
9. Damage within a tick resolves simultaneously, so two units can kill each other on the same tick.

## Data Conventions (`data/*.json`)

All numbers are integers. Key suffixes drive unit conversion in `config.js`:

| Suffix | Meaning | In sim |
|---|---|---|
| `...Lux` | whole lux | × 1000 (milli-lux) |
| `...Tiles` | whole tiles | × 1000 (units) |
| `...Ticks` | ticks at 20 Hz | as is |
| `...Pct` | integer percent | as is |
| contains `MilliTiles` or `MilliLux` with another ending (such as `...PerSecond`) | already in sim units | as is |

Values marked *(default)* in the GDD are tuning points. Change them in data and keep them out of system code.

## Client Rules (`src/client/`)

- Read game state only through `WorldView` (`world-view.js`). Client code never mutates sim state.
- Every player action becomes a `CommandEnvelope` (`src/sim/commands.js`). The UI may pre-validate for instant feedback; the sim result is final.
- Three.js world units are tiles. Team 0 (player, bottom) is blue `#3d8bff`; team 1 (top) is red `#ff4d4d`.
- The game shows no HP bars and no glow-as-health. Each unit and building shows a small lux count beside it (GDD 13.1); glow is decoration only.
- Mobile comes first: portrait layout, touch input, `devicePixelRatio` capped at 2, bloom at half resolution, instancing for crowds.
- The `index.html` import map pins `three` to 0.170.0. Change that version only on purpose, then test on a phone.

## Testing Expectations

- Every new rule gets a unit test that drives it through commands and `step()`, without reaching into internals.
- Any new system must keep `test/determinism.test.js` green. A hash change in a golden replay in `replays/golden/` fails `npm test`. Re-record the replay on purpose, in the same commit as the rule change (see the `SPEC_VERSION` exception above).
- Before you finish a task, run `npm test` and `npm run headless`.

## Code Style

- Plain JavaScript ES modules, `// @ts-check` at the top of every file, JSDoc types.
- Small pure functions. Sim state holds plain objects and arrays only, with no class instances.
- File names in kebab-case, and one system per file in `src/sim/systems/`.

## Git

- Make small commits with one concern each and an imperative subject line, for example `sim: settle pending lux after 40 ticks`.
- Commit replays only when they are deliberate golden replays.

## Writing Rules

These rules govern every piece of prose in this repo: docs, README sections, code comments, JSDoc, commit messages and pull request descriptions. They also govern prose in replies to the owners. The ruleset is *The Elements of Agent Style* (https://github.com/yzhao062/agent-style, CC BY 4.0), as adapted by Hamza BEN JANNET (fork: https://github.com/hamzabenjannet/agent-style).

Reference files in this repo:

- `docs/writing/rules.md`: the full 21 rules with BAD and GOOD examples, severity and rationale. Read the relevant block when a call is close.
- `docs/writing/review-pass.md`: the self-check and full-review workflows and the scorecard format.
- `tools/check_style.py`: dependency-free checker for RULE-04, 05, 06, 12, B, C, D, G and I. Run `npm run lint:prose -- FILE` (formal) or `python3 tools/check_style.py --register informal FILE`. RULE-04 and RULE-05 hits are `deny`: fix every one. The other rules are `ask`: judge each hit. It reads `.md` files whole and `.js` files through their comments only. `npm run lint:prose:all` covers the whole repo, and `npm test` fails on any `deny` hit (`test/prose.test.js`).

### Scope

Leave these untouched: code, identifiers, commands, file paths, log excerpts, test fixtures, quoted material, and the owners' own reproduced words.

### Precedence

When two instructions conflict, the higher level wins:

1. **Accuracy.** RULE-H (citation discipline) and RULE-08 (claim calibration). Never traded for style.
2. **An explicit instruction from an owner** in the current task.
3. **Hard limits of the active profile** (STE only: 20-word procedural sentences, 25-word descriptive sentences, no semicolons, imperative procedures).
4. **The 21 rules** below.
5. **The escape hatch:** "Break any of these rules sooner than say anything outright barbarous" (Orwell 1946, Rule 6). It applies only to medium and low severity rules at level 4. When a reader would notice the break, add a one-line note naming the rule and the reason.

### Profiles

| Profile | Use for | Changes |
|---|---|---|
| formal (default) | docs, specs, READMEs, runbooks, code comments, JSDoc | none: all 21 rules apply |
| informal | commit messages, release notes, casual chat | RULE-I (contractions) and RULE-G (title case) off |
| STE | maintenance procedures or task cards for translation, or when an owner names STE | ASD-STE100 limits override at level 3 |

Hold one profile through a whole document.

### Workflow

1. **Generate:** follow the rules while drafting, then run the self-check in `docs/writing/review-pass.md`. For a `.md` file, run the checker.
2. **Review:** when asked to review or humanize a draft, follow the full workflow in `docs/writing/review-pass.md` and report the scorecard before rewriting.

### The 21 Rules

Canonical rules (Strunk & White 1959, Orwell 1946, Pinker 2014, Gopen & Swan 1990):

- **RULE-01 Curse of knowledge (critical).** Name the intended reader and write for that reader. Define any term that reader would pause on, or rewrite around it.
- **RULE-02 Passive voice.** Use active voice when the agent is known and worth naming. Passive stays correct for genuinely unknown agents.
- **RULE-03 Concrete language.** Replace "factors", "aspects", "considerations", "issues" and "elements" with the specific items, numbers, files or mechanisms.
- **RULE-04 Needless words.** Cut "in order to", "due to the fact that", "at this point in time", "it is important to note that", "may potentially", "could possibly".
- **RULE-05 Dying metaphors.** Cut "pushes the boundaries", "paradigm shift", "state of the art", "paves the way", "low-hanging fruit", "deep dive", "game changer". If no number or mechanism can replace the phrase, it was hiding an absence.
- **RULE-06 Plain English.** Prefer "use" to "leverage" and "utilize", "method" to "methodology", "feature" to "functionality", "help" to "facilitate". Technical terms with a distinct meaning stay.
- **RULE-07 Positive form.** Prefer "trivial" to "not important". Do not stage a claim against a negated foil ("X, not Y", "not just X, but Y"), unless ruling out a specific alternative informs the reader.
- **RULE-08 Claim calibration.** Match the verb to the evidence: tests show, benchmarks measure, derivations prove. Do not write "proves" for evidence that only suggests, and state recommendations plainly.
- **RULE-09 Parallel structure.** Give coordinate ideas the same grammatical form across a list, a compound predicate or a set of bullets.
- **RULE-10 Related words together.** Keep subject near verb, verb near object, modifier near what it modifies. Split the sentence if more than eight words separate subject from verb.
- **RULE-11 Stress position.** End a sentence on what the reader should remember.
- **RULE-12 Sentence length.** Split any sentence over 30 words, and vary length across a paragraph.

Field-observed rules (maintainer observation of LLM output, 2022 to 2026):

- **RULE-A Bullet overuse.** Keep connected reasoning in paragraphs. Use bullets for genuine enumerations only, and never force a three-item list.
- **RULE-B Dash overuse.** Never use an em dash or an en dash as sentence punctuation. Use a comma, a semicolon, a colon or parentheses. En dashes stay correct in numeric ranges.
- **RULE-C Same-starts.** Never open two consecutive sentences with the same word (common offenders: "This", "The", "We", "It").
- **RULE-D Transitions.** Avoid opening with "Additionally", "Furthermore", "Moreover", "In addition", "What's more" or "Notably"; allow at most one per paragraph, and only when the move needs flagging.
- **RULE-E Summary closers.** Delete any paragraph-closing sentence that only restates the paragraph.
- **RULE-F Term consistency.** Once a term is defined, keep that exact form. Never alternate synonyms for one entity (Lumen Core stays "Lumen Core" or "Core").
- **RULE-G Title case.** Use title case for headings; lowercase articles, coordinating conjunctions and short prepositions.
- **RULE-H Citation discipline (critical).** Back every factual claim with a verifiable source or concrete evidence. A fabricated citation, version number, benchmark or API signature is the worst failure in this ruleset. Mark anything unverified in the session as `[UNVERIFIED]`.
- **RULE-I Contractions.** Write "it is", "does not" and "cannot" under the formal profile. The informal profile allows contractions.

### Verification

RULE-H is the rule with teeth. Version numbers, engine behavior, API shapes and benchmark figures change over time. Verify them against a real source (package registry, official docs, a test run in this repo) before you state them. Say which parts you verified and which you recalled.

## Godot Project (`vone/`)

`vone/` holds the Godot 4.6 project (`vone/project.godot`). It uses the GL Compatibility renderer so one project targets web, mobile and PC. Other agents build the game there from this MVP's logic and from playtest feedback. The GDD and `src/sim/` stay the executable reference for the rules. Do not commit `vone/.godot/`, the editor cache that `vone/.gitignore` excludes.

## People

- **Hamza BEN JANNET:** project owner. Decides rules, scope and architecture.
- **Hama BEN JANNET:** project owner. Game and UI/UX designer; makes the low-poly neon `.glb` models in `assets/` and owns team colors and art direction.

Both owners approve changes to game rules and new dependencies.
