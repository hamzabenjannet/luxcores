import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIND, SPEC_VERSION } from '../src/sim/index.js';
import { entityText, isDay } from '../src/client/entity-text.js';
import { actionsFor, canAfford, groupActions, mixFor, queueLines, resolveTap } from '../src/client/ui/controls.js';
import { ROOT, loadData } from './helpers/load-data.js';

// The Godot client answers the same cases in vone/tests/run_tests.gd. A rule change in
// one client that skips the other fails one of the two runs.
const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'client-parity.json'), 'utf8'));
const { raw, config } = loadData();
const data = { buildings: raw.buildings, balance: raw.balance, mapgen: raw.mapgen };

test('the fixture uses the sim kind codes and the balance data it names', () => {
  assert.deepEqual(fixture.kinds, KIND);
  assert.deepEqual(fixture.hpFactor, raw.balance.hpFactor);
  assert.equal(fixture.dayNight.dayTicks, raw.balance.dayNight.dayTicks);
  assert.equal(fixture.dayNight.nightTicks, raw.balance.dayNight.nightTicks);
});

test('entity text cases', () => {
  for (const c of fixture.entityText) assert.equal(entityText(c.entity, fixture.hpFactor), c.expect, JSON.stringify(c.entity));
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
  for (const c of fixture.queueLines) assert.deepEqual(queueLines(c.orders, c.barracksId, c.tickHz), c.expect);
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
    });
    assert.deepEqual(actual, c.expect, c.name);
  }
  assert.ok(config); // the data loaded through the same path the sim uses
});

test('the Godot client implements the spec version of the sim', () => {
  const gd = readFileSync(join(ROOT, 'vone', 'scripts', 'game_logic.gd'), 'utf8');
  assert.equal(/const SPEC_VERSION := "([^"]+)"/.exec(gd)?.[1], SPEC_VERSION, 'bump SPEC_VERSION in vone/scripts/game_logic.gd with the sim, after porting the change');
});
