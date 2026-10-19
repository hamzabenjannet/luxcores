import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIND, SPEC_VERSION } from '../src/sim/index.js';
import { creepGroupLabels, entityText, entropyFromText, entropyText, isDay, tickCapFromText, tickCapText } from '../src/client/entity-text.js';
import { abilityStates, actionsFor, canAfford, endsBuildMode, groupActions, heroLuxChoices, heroPickState, immediateCast, immediateUse, itemStates, mixFor, pendingKept, pendingLine, placement, queueLines, resolveTap, secondsText, shopStates } from '../src/client/ui/controls.js';
import { HOLD_AIM_PX, clampZoom, holdAimPhase, holdAimRelease, pinchZoom } from '../src/client/input/gestures.js';
import { leaveCall, leaveNeedsConfirm } from '../src/client/ui/leave.js';
import { matchSummary } from '../src/client/ui/summary.js';
import { ROOT, loadData } from './helpers/load-data.js';

// The Godot client answers the same cases in vone/tests/run_tests.gd. A rule change in
// one client that skips the other fails one of the two runs.
const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'client-parity.json'), 'utf8'));
const { raw, config } = loadData();
const data = { buildings: raw.buildings, balance: raw.balance, mapgen: raw.mapgen, items: raw.items };

test('the fixture uses the sim kind codes and the balance data it names', () => {
  assert.deepEqual(fixture.kinds, KIND);
  assert.deepEqual(fixture.hpFactor, raw.balance.hpFactor);
  assert.equal(fixture.dayNight.dayTicks, raw.balance.dayNight.dayTicks);
  assert.equal(fixture.dayNight.nightTicks, raw.balance.dayNight.nightTicks);
});

test('the fixture names the heroes, abilities and roster of the data files', () => {
  assert.deepEqual(fixture.heroNames, raw.heroes.roster.map((/** @type {any} */ r) => r.name));
  assert.deepEqual(fixture.roster, raw.heroes.roster.map((/** @type {any} */ r) => ({ id: r.id, name: r.name, primary: r.primary })));
  for (const [type, template] of Object.entries(raw.abilities.templates)) assert.equal(fixture.abilities.templates[type].costLux, /** @type {any} */ (template).costLux);
});

test('the fixture names the items of the data file', () => {
  assert.deepEqual(fixture.itemNames, raw.items.list.map((/** @type {any} */ i) => i.name));
  assert.deepEqual(fixture.items, raw.items.list.map((/** @type {any} */ i) => ({ id: i.id, name: i.name, costLux: i.costLux, target: i.target, effect: { kind: i.effect.kind } })));
});

test('entity text cases', () => {
  for (const c of fixture.entityText) assert.equal(entityText(c.entity, fixture.hpFactor, fixture.heroNames, fixture.itemNames), c.expect, JSON.stringify(c.entity));
});

test('creep group label cases', () => {
  for (const c of fixture.creepGroupLabels) assert.deepEqual(creepGroupLabels(c.entities, fixture.hpFactor), c.expect, c.name);
});

test('entropy rate cases', () => {
  for (const c of fixture.entropyFromText) assert.equal(entropyFromText(c.text), c.expect, JSON.stringify(c.text));
  for (const c of fixture.entropyText) assert.equal(entropyText(c.tenths), c.expect, JSON.stringify(c.tenths));
});

test('pending queue rows', () => {
  for (const c of fixture.pendingLine) assert.equal(pendingLine(c.command, fixture.pendingNames.heroNames, fixture.pendingNames.itemNames), c.expect, JSON.stringify(c.command));
  for (const c of fixture.pendingKept) assert.equal(pendingKept(c.base, c.expires, c.realCount, c.now), c.expect, c.name);
});

test('tick limit cases', () => {
  for (const c of fixture.tickCapFromText) assert.equal(tickCapFromText(c.text), c.expect, JSON.stringify(c.text));
  for (const c of fixture.tickCapText) assert.equal(tickCapText(c.maxTicks), c.expect, JSON.stringify(c.maxTicks));
});

test('seconds text cases', () => {
  for (const c of fixture.secondsText) assert.equal(secondsText(c.ticks, c.tickHz), c.expect, JSON.stringify(c));
});

test('ability button cases', () => {
  for (const c of fixture.abilityStates) assert.deepEqual(abilityStates(c.hero, fixture.abilities, c.coreLuxMilli, c.minLeftLux, c.tickHz), c.expect, c.name);
  for (const c of fixture.endsBuildMode) assert.equal(endsBuildMode(c.command), c.expect, JSON.stringify(c));
  for (const c of fixture.immediateCast) assert.deepEqual(immediateCast(c.slot, c.hero), c.expect, JSON.stringify(c));
});

test('hero pick cases', () => {
  for (const c of fixture.heroPickState) {
    assert.deepEqual(heroPickState({ player: c.player ?? undefined, heroAlive: c.heroAlive, heroQueued: c.heroQueued, roster: fixture.roster, tickHz: c.tickHz }), c.expect, c.name);
  }
  for (const c of fixture.heroLuxChoices) assert.deepEqual(heroLuxChoices(c.coreLuxMilli, c.minLeftLux), c.expect, JSON.stringify(c));
});

test('day cases', () => {
  for (const c of fixture.isDay) assert.equal(isDay(c.tick, fixture.dayNight), c.expect, `tick ${c.tick}`);
});

test('affordability cases', () => {
  for (const c of fixture.canAfford) assert.equal(canAfford(c.coreLuxMilli, c.costLux, c.minLeftLux), c.expect, JSON.stringify(c));
});

test('panel action cases', () => {
  for (const c of fixture.actionsFor) {
    const actual = actionsFor(c.entity, data.buildings.tower).map(({ id, label, command, costLux }) => ({ id, label, command, ...(costLux === undefined ? {} : { costLux }) }));
    assert.deepEqual(actual, c.expect, JSON.stringify(c.entity));
  }
});

test('creep order mix cases', () => {
  for (const c of fixture.mixFor) assert.deepEqual(mixFor(c.count, c.type), c.expect, JSON.stringify(c));
});

test('queue line cases', () => {
  for (const c of fixture.queueLines) assert.deepEqual(queueLines(c.orders, c.barracksId, c.tickHz, fixture.heroNames, fixture.itemNames), c.expect);
});

test('end-of-match summary cases', () => {
  for (const c of fixture.matchSummary) assert.deepEqual(matchSummary(c.result, { viewerTeam: c.viewerTeam, spectator: c.spectator, endedTick: c.endedTick, tickHz: c.tickHz }), c.expect, c.name);
});

test('item cases', () => {
  for (const c of fixture.itemStates) assert.deepEqual(itemStates(fixture.items, c.counts, c.funnelLux), c.expect, c.name);
  for (const c of fixture.immediateUse) assert.deepEqual(immediateUse(c.id, fixture.items), c.expect, JSON.stringify(c));
  for (const c of fixture.shopStates) assert.deepEqual(shopStates(fixture.items, c.coreLuxMilli, c.minLeftLux), c.expect, c.name);
});

test('leave cases: which call a Leave needs, and when it asks first', () => {
  for (const c of fixture.leaveCall) assert.equal(leaveCall(c), c.expect, JSON.stringify(c));
  for (const c of fixture.leaveNeedsConfirm) assert.equal(leaveNeedsConfirm(c), c.expect, JSON.stringify(c));
});

test('placement cases', () => {
  for (const c of fixture.placement) {
    const actual = placement({
      tileX: Math.floor(c.ctx.ground[0]),
      tileZ: Math.floor(c.ctx.ground[1]),
      entities: (c.ctx.entities ?? []).map((/** @type {any} */ e) => ({ hp: 1, maxHp: 1, ...e })),
      viewerTeam: c.ctx.viewerTeam,
      building: c.ctx.building,
      attack: c.ctx.attack ?? 'ranged',
      coreLuxMilli: c.ctx.coreLuxMilli ?? 100_000,
      data,
      vents: c.ctx.vents ?? [],
    });
    assert.deepEqual(actual, c.expect, c.name);
  }
});

test('gesture cases: zoom limits, pinch and the hold-to-aim press', () => {
  for (const c of fixture.zoom) assert.equal(clampZoom(c.zoom), c.expect, c.name);
  for (const c of fixture.pinchZoom) assert.equal(pinchZoom(c.startZoom, c.startDistance, c.distance), c.expect, JSON.stringify(c));
  for (const c of fixture.holdAimPhase) assert.equal(holdAimPhase(c.movedPx), c.expect, JSON.stringify(c));
  for (const c of fixture.holdAimRelease) assert.equal(holdAimRelease(c.aiming, c.overButton), c.expect, JSON.stringify(c));
  assert.equal(HOLD_AIM_PX, 14);
});

test('group panel action cases', () => {
  for (const c of fixture.groupActions) assert.deepEqual(groupActions(c.size, c.custom).map((a) => a.id), c.expect, JSON.stringify(c));
});

test('tap cases', () => {
  for (const c of fixture.resolveTap) {
    const actual = resolveTap({
      ground: { x: c.ctx.ground[0], z: c.ctx.ground[1] },
      entities: (c.ctx.entities ?? []).map((/** @type {any} */ e) => ({ hp: 1, maxHp: 1, ...e })),
      viewerTeam: c.ctx.viewerTeam,
      building: c.ctx.building ?? null,
      attack: c.ctx.attack ?? 'ranged',
      coreLuxMilli: c.ctx.coreLuxMilli ?? 100_000,
      data,
      vents: c.ctx.vents ?? [],
      mode: c.ctx.mode ?? null,
      selectedGroup: c.ctx.selectedGroup ?? null,
      pathCount: c.ctx.pathCount ?? 0,
      ability: c.ctx.ability ?? null,
      item: c.ctx.item ?? null,
    });
    assert.deepEqual(actual, c.expect, c.name);
  }
  assert.ok(config); // the data loaded through the same path the sim uses
});

test('the Godot client implements the spec version of the sim', () => {
  const gd = readFileSync(join(ROOT, 'vone', 'scripts', 'game_logic.gd'), 'utf8');
  assert.equal(/const SPEC_VERSION := "([^"]+)"/.exec(gd)?.[1], SPEC_VERSION, 'bump SPEC_VERSION in vone/scripts/game_logic.gd with the sim, after porting the change');
});
