// Playing through the web client's own controls, against a throwaway backend.
//
// 1. A human plays a bot. The test taps the palette and the map, so it covers
//    the real path: tap, ground pick, command, server, snapshot, label. It
//    builds a solar plant and a tower, upgrades the tower from the selection
//    panel and recycles the plant.
// 2. Two bots play while a spectator watches: no controls, a result banner.
//
// Run: (cd backend/nodejs && npm install && npm run build)   once
//      npm run test:e2e

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SEED, SHOTS, freeSpot, luxTest, skip, withBackend } from './helpers/backend.js';

const KIND = { SOLAR: 2, TOWER: 7 };

/** Calls `fn` in the page until it returns something truthy. */
const until = (/** @type {import('playwright-core').Page} */ page, /** @type {() => any} */ fn, /** @type {any} */ arg, ms = 30_000) =>
  page.waitForFunction(fn, arg, { timeout: ms, polling: 200 });

/** Taps the middle of a tile. */
async function tapTile(/** @type {import('playwright-core').Page} */ page, /** @type {{ tileX: number, tileZ: number }} */ tile) {
  const at = await page.evaluate((t) => /** @type {any} */ (window).__luxTest.screenOf(t.tileX + 0.5, t.tileZ + 0.5), tile);
  await page.touchscreen.tap(at.x, at.y);
}

test('a human builds, upgrades and recycles through the controls, against a bot', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), `name=Halo&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().length > 0);
    assert.equal(await luxTest(page, 'role'), 'player');

    // The palette: pick Solar, tap a free tile in the build zone.
    const solarTile = freeSpot(SEED, 0);
    await page.click('button[data-building="solar"]');
    await tapTile(page, solarTile);
    await until(page, (k) => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === k && e.team === 0), KIND.SOLAR);

    // A refused tap tells the player why, and costs nothing: the DMZ is not buildable.
    await page.touchscreen.tap(...(/** @type {[number, number]} */ (Object.values(await page.evaluate(() => /** @type {any} */ (window).__luxTest.screenOf(48.5, 56.5))))));
    await until(page, () => document.querySelector('.toast.show')?.textContent === 'Build inside your own zone.');

    // A tower with the Area attack. The segment control shows only while Tower is picked.
    const towerTile = freeSpot(SEED, 3);
    await page.click('button[data-building="tower"]');
    await page.click('button[data-attack="area"]');
    await tapTile(page, towerTile);
    await until(page, (k) => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === k && e.team === 0 && e.attack === 3), KIND.TOWER);

    // The bot builds too, and the lux counts follow the rules: both sides paid.
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.team === 1 && e.kind >= 2 && e.kind <= 7));

    // Select the tower (palette off), upgrade its power from the panel.
    await page.click('button[data-building="tower"]'); // toggles the palette off
    await tapTile(page, towerTile);
    await page.waitForSelector('.panel:not([hidden]) .action');
    assert.match(await page.textContent('.panel-title') ?? '', /^Tower A \d+ \(Area\)$/);
    await page.click('.panel .action:has-text("Power")');
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 7 && e.team === 0 && e.powerLevel === 1));
    assert.match(await page.textContent('.panel-title') ?? '', /^Tower A P1 \d+ \(Area\)$/);

    // Recycle the solar plant: the channel starts, then the plant is gone.
    await tapTile(page, solarTile);
    await page.click('.panel .action:has-text("Recycle")');
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 2 && e.team === 0 && e.recycle > 0));
    await until(page, () => !(/** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 2 && e.team === 0)));

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'play-vs-bot.png') });
    assert.deepEqual(errors, [], 'the page must log no console or page errors');
  }, { MATCH_MAX_TICKS: '2400' });
});

test('a spectator watches two bots play to the end', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), 'name=Watcher&match=new&botVsBot=1&autostart=1&seed=777');
    assert.equal(await luxTest(page, 'role'), 'spectator');
    await until(page, () => {
      const towers = (/** @type {any} */ (window).__luxTest.entities()).filter((/** @type {any} */ e) => e.kind === 7);
      return [0, 1].every((team) => towers.some((/** @type {any} */ t) => t.team === team));
    });
    assert.equal(await page.isHidden('.palette'), true, 'a spectator has no build palette');
    assert.equal(await page.textContent('#hud-core') !== null && (await page.textContent('#hud-core'))?.startsWith('Blue'), true);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'spectate-bots.png') });

    await page.waitForSelector('#banner:not([hidden])', { timeout: 60_000 });
    assert.match(await page.textContent('#banner') ?? '', /^Draw {2}\(tick-limit\)$/);
    assert.deepEqual(errors, [], 'the page must log no console or page errors');
  }, { MATCH_MAX_TICKS: '600' });
});

test('the menu and lobby work by hand: a bot match, then a match for two humans', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, plain }) => {
    // Play Against Bot: type a name, press the button, press Start Match.
    const solo = await plain('/');
    await solo.fill('#menu input[placeholder="Your name"]', 'Halo');
    await solo.click('#menu button:has-text("Play Against Bot")');
    await solo.waitForSelector('#menu .card .title:has-text("Lobby")');
    assert.deepEqual(await solo.$$eval('#menu .player', (n) => n.map((x) => x.textContent)), ['Halo', 'Bot']);
    await solo.click('#menu button:has-text("Start Match")');
    await solo.waitForSelector('.palette:not([hidden])', { timeout: 30_000 });
    await solo.waitForFunction(() => document.getElementById('hud-core')?.textContent?.startsWith('Core'));
    assert.equal(await solo.isHidden('#menu'), true, 'the lobby closes when the match starts');

    // Host a Match for Two: the host cannot start alone, and the second player joins by id.
    const host = await plain('/');
    await host.fill('#menu input[placeholder="Your name"]', 'Host');
    await host.fill('#menu input[placeholder^="Map seed"]', '42');
    await host.click('#menu button:has-text("Host a Match for Two")');
    await host.waitForSelector('#menu .card .title:has-text("Lobby")');
    assert.equal(await host.isDisabled('#menu button:has-text("Start Match")'), true, 'one human cannot start a match for two');
    assert.match((await host.textContent('#menu .status')) ?? '', /Waiting for a second player/);
    const id = ((await host.textContent('#menu .subtitle')) ?? '').replace('Match ', '').trim();

    const guest = await plain('/');
    await guest.fill('#menu input[placeholder="Your name"]', 'Guest');
    await guest.fill('#menu input[placeholder="Match id to join"]', id);
    await guest.click('#menu button:has-text("Join Match")');
    await guest.waitForSelector('#menu .card .title:has-text("Lobby")');
    assert.equal(await guest.isHidden('#menu button:has-text("Start Match")'), true, 'only the host starts');
    await host.waitForFunction(() => [...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Start Match' && !(/** @type {HTMLButtonElement} */ (b)).disabled));
    await host.click('#menu button:has-text("Start Match")');
    for (const page of [host, guest]) await page.waitForSelector('.palette:not([hidden])', { timeout: 30_000 });
    assert.deepEqual(errors, [], 'the pages must log no console or page errors');
    mkdirSync(SHOTS, { recursive: true });
    await guest.screenshot({ path: join(SHOTS, 'menu-two-humans.png') });
  }, { MATCH_MAX_TICKS: '1200' });
});
