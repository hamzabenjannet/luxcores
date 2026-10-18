import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND } from '../src/sim/index.js';
import { entityText, isDay, luxOf } from '../src/client/entity-text.js';
import { loadData } from './helpers/load-data.js';
import { isDay as simIsDay } from '../src/sim/systems/economy.js';

const { raw } = loadData();
const factor = raw.balance.hpFactor;

test('a building shows its name and lux, with HP divided by the HP factor', () => {
  assert.equal(entityText({ kind: KIND.SOLAR, hp: 200_000 }, factor), 'Solar 20');
  assert.equal(entityText({ kind: KIND.CORE, hp: 94_000 }, factor), 'Lumen Core 94');
});

test('a tower shows its attack type, upgrade levels, stun and recycle marks', () => {
  const tower = { kind: KIND.TOWER, hp: 180_000, attack: 2 };
  assert.equal(entityText(tower, factor), 'Tower R 18');
  assert.equal(entityText({ ...tower, powerLevel: 2, shellLevel: 1 }, factor), 'Tower R P2 S1 18');
  assert.equal(entityText({ ...tower, attack: 3, stunTicks: 4, recycle: 10 }, factor), 'Tower A 18 STUN REC');
});

test('a projectile has no label', () => {
  assert.equal(entityText({ kind: KIND.PROJECTILE, hp: 1 }, factor), null);
});

test('lux rounds to the nearest whole lux', () => {
  assert.equal(luxOf({ kind: KIND.SOLAR, hp: 195_000 }, factor), 20);
  assert.equal(luxOf({ kind: KIND.SOLAR, hp: 194_000 }, factor), 19);
});

test('the day flag follows the cycle in the data', () => {
  const dn = raw.balance.dayNight;
  assert.equal(isDay(0, dn), true);
  assert.equal(isDay(dn.dayTicks - 1, dn), true);
  assert.equal(isDay(dn.dayTicks, dn), false);
  assert.equal(isDay(dn.dayTicks + dn.nightTicks, dn), true);
});

test('the client day flag agrees with the sim on every tick of three cycles', () => {
  const config = loadData().config;
  const dn = raw.balance.dayNight;
  for (let tick = 0; tick < 3 * (dn.dayTicks + dn.nightTicks); tick++) {
    assert.equal(isDay(tick, dn), simIsDay(/** @type {any} */ ({ tick, config })), `tick ${tick}`);
  }
});
