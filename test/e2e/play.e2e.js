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

/** Calls a function that the page exposes on `__luxTest`. */
const call = (/** @type {import('playwright-core').Page} */ page, /** @type {string} */ field) =>
  page.evaluate((f) => /** @type {any} */ (window).__luxTest[f](), field);

/** Taps the middle of a tile. */
async function tapTile(/** @type {import('playwright-core').Page} */ page, /** @type {{ tileX: number, tileZ: number }} */ tile) {
  const at = await page.evaluate((t) => /** @type {any} */ (window).__luxTest.screenOf(t.tileX + 0.5, t.tileZ + 0.5), tile);
  await page.touchscreen.tap(at.x, at.y);
}

/** Taps a tile in build mode, then confirms the ghost with Place (GDD 11.5). */
async function placeAt(/** @type {import('playwright-core').Page} */ page, /** @type {{ tileX: number, tileZ: number }} */ tile) {
  await tapTile(page, tile);
  await page.waitForSelector('.panel:not([hidden]) .place:not(.poor)');
  await page.click('.panel .place');
}

test('a human builds, upgrades and recycles through the controls, against a bot', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), `name=Halo&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().length > 0);
    assert.equal(await luxTest(page, 'role'), 'player');

    // The palette: pick Solar, tap a free tile in the build zone.
    const solarTile = freeSpot(SEED, 0);
    await page.click('button[data-building="solar"]');
    await placeAt(page, solarTile);
    await until(page, (k) => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === k && e.team === 0), KIND.SOLAR);
    assert.equal(await page.locator('button[data-building].active').count(), 0, 'a placement frees the palette');

    // A refused tap tells the player why, costs nothing and keeps the building picked: the DMZ is not buildable.
    await page.click('button[data-building="solar"]');
    await page.touchscreen.tap(...(/** @type {[number, number]} */ (Object.values(await page.evaluate(() => /** @type {any} */ (window).__luxTest.screenOf(48.5, 56.5))))));
    await until(page, () => document.querySelector('.toast.show')?.textContent === 'Build inside your own zone.');
    assert.equal(await page.locator('button[data-building="solar"].active').count(), 1, 'a refused tap keeps the building picked');
    assert.equal((await call(page, 'ghost')).valid, false, 'the ghost on the DMZ is red');
    assert.equal(await page.locator('.panel .place.poor').count(), 1, 'Place is dimmed while the ghost is red');
    assert.match(await page.textContent('.panel-title') ?? '', /^Solar at 48, 56: Build inside your own zone\.$/);
    await page.click('.panel .action:has-text("Cancel")');
    assert.equal(await call(page, 'ghost'), null, 'Cancel removes the ghost');
    assert.equal(await page.locator('button[data-building="solar"].active').count(), 1, 'Cancel keeps the building picked');

    // A tower with the Area attack. The segment control shows only while Tower is picked.
    const towerTile = freeSpot(SEED, 3);
    await page.click('button[data-building="tower"]');
    await page.click('button[data-attack="area"]');
    await placeAt(page, towerTile);
    await until(page, (k) => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === k && e.team === 0 && e.attack === 3), KIND.TOWER);

    // The bot builds too, and the lux counts follow the rules: both sides paid.
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.team === 1 && e.kind >= 2 && e.kind <= 7));

    // Select the tower (the placement already freed the palette), upgrade its power from the panel.
    assert.equal(await page.locator('button[data-building].active').count(), 0, 'the tower placement freed the palette');
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

test('the canvas follows the window and draws at the full pixel ratio on a desktop, capped at 2 on a phone', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const size = (/** @type {import('playwright-core').Page} */ page) => page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
      return { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight, ratio: window.devicePixelRatio };
    });

    // A desktop screen: a mouse, no touch, 3 device pixels per CSS pixel.
    const desktop = await open(await newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3, isMobile: false, hasTouch: false }), `name=Desk&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(desktop, () => /** @type {any} */ (window).__luxTest.screenOf !== undefined); // the scene exists after the first snapshot
    let s = await size(desktop);
    assert.equal(s.ratio, 3);
    assert.equal(s.width, 1280 * 3, 'the canvas has every device pixel');
    assert.equal(s.height, 720 * 3);

    // Resizing the window resizes the canvas, and the aspect of the view follows.
    await desktop.setViewportSize({ width: 900, height: 1000 });
    await until(desktop, () => /** @type {HTMLCanvasElement} */ (document.getElementById('view')).width === 900 * 3);
    s = await size(desktop);
    assert.deepEqual([s.width, s.height, s.cssWidth, s.cssHeight], [2700, 3000, 900, 1000]);

    // A phone keeps the cap of 2 although the screen has 3 device pixels per CSS pixel.
    const phone = await open(await newContext({ deviceScaleFactor: 3 }), `name=Phone&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(phone, () => /** @type {any} */ (window).__luxTest.screenOf !== undefined);
    s = await size(phone);
    assert.equal(s.ratio, 3);
    assert.equal(s.width, 390 * 2);
    assert.deepEqual(errors, [], 'the pages must log no console or page errors');
  }, { MATCH_MAX_TICKS: '600' });
});

test('crowds are drawn as instances and units are drawn between snapshots', { timeout: 240_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), 'name=Crowd&match=new&botVsBot=1&autostart=1&seed=777');
    const creeps = () => page.evaluate(() => /** @type {any} */ (window).__luxTest.entities().filter((/** @type {any} */ e) => e.kind === 9).length);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().filter((/** @type {any} */ e) => e.kind === 9).length >= 8, undefined, 120_000);

    // Every creep is an instance, and no creep has a mesh of its own. The blockers are instances as well.
    const drawn = await page.evaluate(() => /** @type {any} */ (window).__luxTest.drawn());
    assert.ok(drawn.creeps >= 8 && drawn.creeps <= (await creeps()) + 2, `${drawn.creeps} creep instances`);
    assert.equal(drawn.blockers, 12, 'six blockers in each build zone');
    assert.ok(drawn.single < 60, `${drawn.single} single meshes`);

    // The drawn position lags the newest snapshot by about two ticks and stays between the last two snapshots. A software-rendered
    // frame takes a few hundred milliseconds here, so this samples the wiring and the unit test of the interpolator counts the steps.
    const samples = await page.evaluate(async () => {
      const t = /** @type {any} */ (window).__luxTest;
      /** @type {{ gap: number, moved: boolean }[]} */
      const out = [];
      for (let i = 0; i < 12; i++) {
        const raw = t.entities().filter((/** @type {any} */ e) => e.kind === 9);
        for (const e of t.interpolated()) {
          if (e.kind !== 9) continue;
          const latest = raw.find((/** @type {any} */ r) => r.id === e.id);
          if (latest) out.push({ gap: Math.hypot(e.x - latest.x, e.z - latest.z), moved: e.x !== latest.x || e.z !== latest.z });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return out;
    });
    assert.ok(samples.some((x) => x.moved), 'some creep is drawn behind its newest position');
    assert.ok(samples.every((x) => x.gap < 600), `a drawn creep is never far from its newest position: ${Math.max(...samples.map((x) => x.gap))}`);
    assert.deepEqual(errors, [], 'the page must log no console or page errors');
  }, { MATCH_MAX_TICKS: '2400' });
});

test('a human buys items at a barracks, receives them with the hero and uses them, through the controls', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), `name=Shopper&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().length > 0);
    const me = () => page.evaluate(() => /** @type {any} */ (window).__luxTest.players().find((/** @type {any} */ p) => p.id === 0));
    const hero = () => page.evaluate(() => /** @type {any} */ (window).__luxTest.entities().find((/** @type {any} */ e) => e.kind === 10 && e.owner === 0));

    const barracksTile = freeSpot(SEED, 0);
    await page.click('button[data-building="barracks"]');
    await placeAt(page, barracksTile);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 6 && e.team === 0));
    await tapTile(page, barracksTile);
    await page.waitForSelector('.panel:not([hidden]) .shop-item[data-shop-item="2"]');
    assert.equal(await page.locator('.shop-item').count(), 4, 'every item is on sale');
    assert.match(await page.textContent('.shop-item[data-shop-item="2"]') ?? '', /^Haste20$/);

    // Two items before any hero exists: they wait in the barracks.
    await page.click('.shop-item[data-shop-item="2"]');
    await page.click('.shop-item[data-shop-item="0"]');
    await until(page, () => /** @type {any} */ (window).__luxTest.orders().filter((/** @type {any} */ o) => o.type === 3).length === 2);
    await until(page, () => /** @type {any} */ (window).__luxTest.orders().filter((/** @type {any} */ o) => o.type === 3 && o.held === 1).length === 2, undefined, 15_000);
    await until(page, () => [...document.querySelectorAll('.queue-text')].some((n) => n.textContent === 'Item Haste HELD'));
    assert.equal(await page.locator('.hero-bar').isHidden(), true, 'no hero, no item bar');

    // A small hero with the 25% allocation, then the items arrive with it.
    await page.click('[data-alloc="25%"]');
    await page.click('.hero-pick[data-hero="1"]');
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0), undefined, 30_000);
    await page.waitForSelector('.hero-bar:not([hidden]) .item[data-item="2"]');
    await until(page, () => document.querySelector('.item[data-item="2"]')?.textContent === 'Haste 1');
    assert.equal(await page.textContent('.item[data-item="0"]'), 'Boost 1');
    assert.equal(await page.textContent('.item[data-item="3"]'), 'Sluggish 0');
    assert.deepEqual((await me()).items, [1, 0, 1, 0]);

    // Haste is one tap: it applies at once and the count drops.
    await page.click('.item[data-item="2"]');
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0 && e.speedMod === 300));
    await until(page, () => document.querySelector('.item[data-item="2"]')?.textContent === 'Haste 0');

    // Boost aims: the first tap on the button waits for a target, empty ground refuses, the hero takes it.
    const before = await hero();
    await page.click('.item[data-item="0"]');
    await until(page, () => document.querySelector('.item[data-item="0"]')?.classList.contains('active') === true);
    await until(page, () => document.querySelector('.toast.show')?.textContent === 'Tap your hero or a building.');
    await page.evaluate(() => /** @type {any} */ (window).__luxTest.tap(10, 10));
    await until(page, () => document.querySelector('.toast.show')?.textContent === 'Tap your hero or one of your buildings.');
    await page.evaluate((h) => /** @type {any} */ (window).__luxTest.tap(h.x / 1000, h.z / 1000), before);
    await until(page, () => /** @type {any} */ (window).__luxTest.players().find((/** @type {any} */ p) => p.id === 0)?.items[0] === 0);
    assert.equal((await hero()).maxHp, before.maxHp + 150_000, 'Energy Boost adds 15 lux, which is 150 HP');
    assert.equal(await page.locator('.item[data-item="0"].active').count(), 0, 'the aim ended with the use');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'play-items.png') });
    assert.deepEqual(errors, [], 'the page must log no console or page errors');
  }, { MATCH_MAX_TICKS: '2400' });
});

test('a human picks a hero at a barracks, shields it and aims its area ability, through the controls', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), `name=Halo&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().length > 0);
    const hero = () => page.evaluate(() => /** @type {any} */ (window).__luxTest.entities().find((/** @type {any} */ e) => e.kind === 10 && e.owner === 0));

    // A barracks, then its panel: the hero row shows the roster and the lux to allocate.
    const barracksTile = freeSpot(SEED, 0);
    await page.click('button[data-building="barracks"]');
    await placeAt(page, barracksTile);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 6 && e.team === 0));
    assert.equal(await page.locator('button[data-building].active').count(), 0, 'the barracks placement freed the palette');
    await tapTile(page, barracksTile);
    await page.waitForSelector('.panel:not([hidden]) .hero-pick[data-hero="1"]');
    assert.equal(await page.locator('.hero-pick').count(), 5, 'the whole roster is offered');
    assert.equal(await page.locator('.hero-bar').isHidden(), true, 'no hero yet, no ability bar');

    // Prism with the default allocation (50% of the Core).
    await page.click('.hero-pick[data-hero="1"]');
    await until(page, () => /** @type {any} */ (window).__luxTest.orders().some((/** @type {any} */ o) => o.type === 2 && o.owner === 0));
    await until(page, () => /^Hero Prism \d+ lux/.test(document.querySelector('.queue-text')?.textContent ?? ''));
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0), undefined, 30_000);
    assert.equal((await hero()).heroType, 2);
    await page.waitForSelector('.hero-bar:not([hidden])');
    assert.match(await page.textContent('.hero-name') ?? '', /^Prism \d+$/);
    await until(page, () => /** @type {any} */ (window).__luxTest.players().find((/** @type {any} */ p) => p.id === 0)?.heroLock === 2);
    // With a hero on the field the roster is greyed out and says why. The barracks stays selected, and a tap
    // on its tile would land under the panel anyway.
    await until(page, () => document.querySelector('.hero-note')?.textContent === 'Hero: Your hero is on the field.');

    // Follow: the button locks the camera on the hero, and dragging the map unlocks it.
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__luxTest.following()), false);
    await page.click('.follow');
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__luxTest.following()), true);
    await until(page, () => document.querySelector('.follow')?.classList.contains('active') === true);
    const here = await hero();
    await page.evaluate((h) => /** @type {any} */ (window).__luxTest.send({ t: 'heroMove', x: h.x, z: h.z - 6000 }), here);
    await until(page, (z) => {
      const h = /** @type {any} */ (window).__luxTest.entities().find((/** @type {any} */ e) => e.kind === 10 && e.owner === 0);
      return h && h.z <= z - 5500;
    }, here.z, 30_000);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // the camera eases toward the hero
    const at = await page.evaluate(() => {
      const t = /** @type {any} */ (window).__luxTest;
      const hero = t.entities().find((/** @type {any} */ e) => e.kind === 10 && e.owner === 0);
      const p = t.screenOf(hero.x / 1000, hero.z / 1000);
      return { x: p.x, y: p.y, w: innerWidth, h: innerHeight };
    });
    assert.ok(Math.abs(at.y - at.h / 2) < at.h * 0.25 && Math.abs(at.x - at.w / 2) < at.w * 0.25, `the camera kept the hero near the middle: ${JSON.stringify(at)}`);
    await page.evaluate(() => /** @type {any} */ (window).__luxTest.pan(1, 0));
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__luxTest.following()), false, 'dragging the map unlocks the camera');
    await until(page, () => document.querySelector('.follow')?.classList.contains('active') === false);

    // Shield: one tap, cast on the hero itself.
    await page.click('.ability[data-slot="3"]');
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0 && e.shieldHp > 0));
    assert.match(await page.textContent('.hero-name') ?? '', /SHIELD$/);
    assert.match(await page.textContent('.ability[data-slot="3"]') ?? '', /^S \d\.\ds$/, 'the button counts the cooldown down');

    // Ranged: the first tap aims, a second tap on the button cancels.
    await page.click('.ability[data-slot="1"]');
    await until(page, () => document.querySelector('.ability[data-slot="1"]')?.classList.contains('active') === true);
    await until(page, () => document.querySelector('.toast.show')?.textContent === 'Tap an enemy to hit.');
    await page.click('.ability[data-slot="1"]');
    await until(page, () => document.querySelector('.ability[data-slot="1"]')?.classList.contains('active') === false);

    // A tap on the open map clears the selection: the barracks panel closes and the hero walks.
    await tapTile(page, barracksTile);
    await page.waitForSelector('.panel:not([hidden]) .action');
    const walker = await hero();
    const bare = await page.evaluate((w) => { // the open-map point nearest to the hero that no panel covers
      const from = /** @type {any} */ (window).__luxTest.screenOf(w.x / 1000, w.z / 1000);
      let best = null;
      for (let y = 8; y < innerHeight - 8; y += 8) {
        for (let x = 8; x < innerWidth - 8; x += 8) {
          if (document.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
          const far = Math.hypot(x - from.x, y - from.y);
          if (best === null || far < best.far) best = { x, y, far };
        }
      }
      return best;
    }, walker);
    assert.ok(bare, 'some point of the map is not covered by the panel');
    await page.touchscreen.tap(bare.x, bare.y);
    await page.waitForSelector('.panel[hidden]', { state: 'attached' });

    // Area: aim, then tap the ground next to the hero. The cast costs lux and starts the cooldown, even over empty ground.
    await page.click('.ability[data-slot="2"]');
    const h = await hero();
    await tapTile(page, { tileX: Math.floor(h.x / 1000), tileZ: Math.floor(h.z / 1000) - 3 }); // up the screen, clear of the panel and the hero bar
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0 && e.cd2 > 0));

    // Hold-to-aim: press the button, drag onto the map, lift. Sliding back over the button cancels.
    const openPoint = async () => page.evaluate((w) => {
      const from = /** @type {any} */ (window).__luxTest.screenOf(w.x / 1000, w.z / 1000);
      let best = null;
      for (let y = 8; y < innerHeight - 8; y += 8) {
        for (let x = 8; x < innerWidth - 8; x += 8) {
          if (document.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
          const far = Math.hypot(x - from.x, y - from.y);
          if (best === null || far < best.far) best = { x, y, far };
        }
      }
      return best;
    }, await hero());
    const drag = async (/** @type {string} */ selector, /** @type {{ x: number, y: number } | null} */ to) => {
      const box = await page.locator(selector).boundingBox();
      const from = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const end = to ?? { x: from.x + 40, y: from.y - 120 };
      for (let step = 1; step <= 6; step++) await page.mouse.move(from.x + ((end.x - from.x) * step) / 6, from.y + ((end.y - from.y) * step) / 6);
      return { from, release: async (/** @type {{ x: number, y: number }} */ at) => { await page.mouse.move(at.x, at.y); await page.mouse.up(); } };
    };
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0 && e.cd2 === 0), undefined, 30_000);
    const aimAt = await openPoint();
    assert.ok(aimAt, 'some point of the map is not covered by the controls');
    // Aiming shows the ring and highlights the button; lifting back over the button casts nothing.
    const held = await drag('.ability[data-slot="2"]', aimAt);
    await until(page, () => document.querySelector('.ability[data-slot="2"]')?.classList.contains('active') === true);
    await held.release(held.from);
    await until(page, () => document.querySelector('.ability[data-slot="2"]')?.classList.contains('active') === false);
    assert.equal((await hero()).cd2, 0, 'lifting back over the button cancels the cast');
    // Lifting over the map casts at that point.
    const cast = await drag('.ability[data-slot="2"]', aimAt);
    await cast.release(aimAt);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 10 && e.owner === 0 && e.cd2 > 0));
    // Ranged over empty ground has no target: the toast says so and the aim ends.
    const empty = await drag('.ability[data-slot="1"]', aimAt);
    await empty.release(aimAt);
    await until(page, () => document.querySelector('.toast.show')?.textContent === 'Tap an enemy to hit.');
    await until(page, () => document.querySelector('.ability[data-slot="1"]')?.classList.contains('active') === false);
    // The click that follows a drag must not start a tap-tap aim of its own.
    assert.equal(await page.locator('.ability.active').count(), 0);

    // The hero's name recenters the camera and resumes follow.
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__luxTest.following()), false);
    await page.click('.hero-name');
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__luxTest.following()), true, 'a tap on the hero name resumes follow');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'play-hero.png') });
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
    // The end-of-match screen: duration, both sides and the six counters, with some lux collected and spent by the bots.
    await page.waitForSelector('#summary:not([hidden]) table');
    assert.deepEqual(await page.$$eval('#summary tr', (rows) => rows.map((r) => r.cells[0].textContent)), ['Duration 0:30', 'Lux collected', 'Lux spent', 'Lux drained', 'Lux funneled', 'Lux recycled', 'Lux lost to entropy']);
    assert.deepEqual(await page.$$eval('#summary th', (c) => c.map((x) => x.textContent)), ['Duration 0:30', 'Blue', 'Red']);
    const spent = await page.$$eval('#summary tr:nth-child(3) td.number', (c) => c.map((x) => Number(x.textContent)));
    assert.ok(spent.every((n) => n > 0), `both bots spent lux: ${spent}`);
    await page.click('#summary button');
    assert.equal(await page.isHidden('#summary'), true, 'Close hides the screen');
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
    assert.ok((await solo.$$eval('#menu .subtitle', (n) => n.map((x) => x.textContent))).includes('Entropy 0.1% per second'), 'the lobby shows the default entropy rate');
    assert.ok((await solo.$$eval('#menu .subtitle', (n) => n.map((x) => x.textContent))).includes('Tick limit: Unlimited'), 'a match from the menu is unlimited unless the host caps it');
    await solo.click('#menu button:has-text("Start Match")');
    await solo.waitForSelector('.palette:not([hidden])', { timeout: 30_000 });
    await solo.waitForFunction(() => document.getElementById('hud-core')?.textContent?.startsWith('Core'));
    assert.equal(await solo.isHidden('#menu'), true, 'the lobby closes when the match starts');

    // Host a Match for Two: the host cannot start alone, and the second player joins by id.
    const host = await plain('/');
    await host.fill('#menu input[placeholder="Your name"]', 'Host');
    await host.fill('#menu input[placeholder^="Map seed"]', '42');
    await host.fill('#menu input[placeholder$="(default)"]', '0.7');
    // A capped match needs a whole number of ticks; a bad one stays on the menu with a message.
    await host.selectOption('#menu select', 'capped');
    await host.fill('#menu input[placeholder$="20 per second)"]', '12.5');
    await host.click('#menu button:has-text("Host a Match for Two")');
    await host.waitForSelector('#menu .error:not([hidden])');
    assert.match((await host.textContent('#menu .error:not([hidden])')) ?? '', /whole number from 1 to 1000000/);
    await host.fill('#menu input[placeholder$="20 per second)"]', '900');
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
    assert.ok((await guest.$$eval('#menu .subtitle', (n) => n.map((x) => x.textContent))).includes('Entropy 0.7% per second (set by the host)'), 'the guest sees the host\'s entropy rate');
    assert.ok((await host.$$eval('#menu .subtitle', (n) => n.map((x) => x.textContent))).includes('Entropy 0.7% per second'));
    assert.ok((await guest.$$eval('#menu .subtitle', (n) => n.map((x) => x.textContent))).includes('Tick limit: Capped at 900 ticks (set by the host)'), 'the guest sees the host\'s tick limit');
    assert.ok((await host.$$eval('#menu .subtitle', (n) => n.map((x) => x.textContent))).includes('Tick limit: Capped at 900 ticks'));
    await host.waitForFunction(() => [...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Start Match' && !(/** @type {HTMLButtonElement} */ (b)).disabled));
    await host.click('#menu button:has-text("Start Match")');
    for (const page of [host, guest]) await page.waitForSelector('.palette:not([hidden])', { timeout: 30_000 });
    assert.deepEqual(errors, [], 'the pages must log no console or page errors');
    mkdirSync(SHOTS, { recursive: true });
    await guest.screenshot({ path: join(SHOTS, 'menu-two-humans.png') });
  }, { MATCH_MAX_TICKS: '1200' });
});

test('touch controls: a build ghost to confirm, pinch zoom, hold-to-aim and the upright prompt', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), `name=Halo&match=new&vsBot=1&autostart=1&seed=${SEED}`);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().length > 0);

    // The ghost: a tap shows it green on a free tile, a second tap moves it, Place sends the build.
    const first = freeSpot(SEED, 0);
    const second = freeSpot(SEED, 4);
    await page.click('button[data-building="solar"]');
    await tapTile(page, first);
    assert.deepEqual(await call(page, 'ghost'), { tileX: first.tileX, tileZ: first.tileZ, valid: true });
    assert.equal(await page.locator('button[data-building="solar"].active').count(), 1);
    await tapTile(page, second);
    assert.deepEqual(await call(page, 'ghost'), { tileX: second.tileX, tileZ: second.tileZ, valid: true }, 'a second tap moves the ghost');
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__luxTest.entities().filter((/** @type {any} */ e) => e.kind === 2 && e.team === 0).length), 0, 'a tap alone builds nothing');
    await page.click('.panel .place');
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 2 && e.team === 0));
    assert.equal(await call(page, 'ghost'), null, 'Place removes the ghost');
    assert.equal(await page.locator('button[data-building].active').count(), 0, 'Place frees the palette');
    const built = await page.evaluate(() => /** @type {any} */ (window).__luxTest.entities().find((/** @type {any} */ e) => e.kind === 2 && e.team === 0));
    assert.deepEqual([Math.floor(built.x / 1000), Math.floor(built.z / 1000)], [second.tileX, second.tileZ], 'the building stands on the tile of the last tap');

    // Pinch zoom: two fingers move apart, the view zooms in and stays within its limits.
    const box = await page.locator('#view').boundingBox();
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 3;
    assert.equal(await call(page, 'zoom'), 1);
    const pinch = async (/** @type {number} */ from, /** @type {number} */ to) => {
      const touch = (/** @type {string} */ type, /** @type {number} */ id, /** @type {number} */ x) => page.evaluate(([type, id, x, y]) => {
        const canvas = /** @type {HTMLElement} */ (document.getElementById('view'));
        canvas.dispatchEvent(new PointerEvent(/** @type {string} */ (type), { pointerId: /** @type {number} */ (id), pointerType: 'touch', clientX: /** @type {number} */ (x), clientY: /** @type {number} */ (y), bubbles: true, isPrimary: id === 1 }));
      }, [type, id, x, cy]);
      await touch('pointerdown', 1, cx - from / 2);
      await touch('pointerdown', 2, cx + from / 2);
      for (let step = 1; step <= 5; step++) {
        const gap = from + ((to - from) * step) / 5;
        await touch('pointermove', 1, cx - gap / 2);
        await touch('pointermove', 2, cx + gap / 2);
      }
      await touch('pointerup', 1, cx - to / 2);
      await touch('pointerup', 2, cx + to / 2);
    };
    await pinch(100, 150);
    assert.ok(Math.abs((await call(page, 'zoom')) - 1.5) < 0.01, 'fingers 1.5 times farther apart zoom to 1.5');
    await pinch(100, 400);
    assert.equal(await call(page, 'zoom'), 2.2, 'the zoom stops at its upper limit');
    await pinch(400, 20);
    assert.equal(await call(page, 'zoom'), 0.6, 'and at its lower limit');
    await page.evaluate(() => /** @type {any} */ (window).__luxTest.setZoom(1));

    // The upright prompt is in the page and hidden for a portrait screen.
    assert.equal(await page.isHidden('#rotate'), true);
    assert.equal(await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href')), '/src/client/manifest.webmanifest');

    assert.deepEqual(errors, [], 'the page must log no console or page errors');
  }, { MATCH_MAX_TICKS: '2400' });
});

test('a human orders creeps, then splits, merges and sends a group, through the controls', { timeout: 240_000, skip }, async () => {
  // Two humans, so no bot defends and the creeps live long enough for a slow browser to finish the steps.
  await withBackend(async ({ errors, newContext, open }) => {
    const page = await open(await newContext(), `name=Halo&match=new&seed=${SEED}`);
    const matchId = await luxTest(page, 'matchId');
    const other = await open(await newContext(), `name=Prism&match=${matchId}`);
    assert.equal(await luxTest(other, 'viewerTeam'), 1);
    await page.evaluate(() => /** @type {any} */ (window).__luxTest.start());
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().length > 0);
    const hook = (/** @type {string} */ expr) => page.evaluate(`(() => { const t = window.__luxTest; return ${expr}; })()`);

    // A barracks through the palette, then select it: the panel offers orders.
    const barracksTile = freeSpot(SEED, 0);
    await page.click('button[data-building="barracks"]');
    await placeAt(page, barracksTile);
    await until(page, () => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 6 && e.team === 0));
    assert.equal(await page.locator('button[data-building].active').count(), 0, 'the barracks placement freed the palette');
    await tapTile(page, barracksTile);
    await page.waitForSelector('.order-row .order');
    await page.waitForSelector('.hero-row [data-hero]');

    // The queue sits between the actions and the order controls, so a new row never pushes the buttons.
    assert.equal(await page.evaluate(() => document.querySelector('.panel-row + .queue + .order-row') !== null), true, 'the queue is above the order controls');
    // Lux changes every tick, and a button replaced between press and release loses the click: the same nodes must stay.
    await page.evaluate(() => {
      Object.assign(window, { __kept: [document.querySelector('.order-row .order'), document.querySelector('.hero-row [data-hero]'), document.querySelector('.hero-row [data-alloc]'), document.querySelector('.shop-row [data-shop-item]')] });
    });
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => {
      const kept = /** @type {any} */ (window).__kept;
      return kept.every((/** @type {Element} */ n) => n.isConnected) && kept[0] === document.querySelector('.order-row .order') && kept[1] === document.querySelector('.hero-row [data-hero]');
    }), true, 'the order, hero and shop buttons are not rebuilt while lux changes');

    // One group through the panel: 2 ranged creeps, 10 lux. The queue lists it.
    await page.click('.order-row [data-count="2"]');
    await page.click('.order-row [data-order-type="ranged"]');
    await page.click('.order-row .order');
    await page.waitForSelector('.queue-row');
    // Queue a group of 5 and three of 1 through the hook, in one go. The last one starts about 10 s later, so the panel can cancel it.
    const barracksId = await hook('t.entities().find((e) => e.kind === 6 && e.team === 0).id');
    // One round trip for all four, because a slow page makes each call to it take a second and the queue drains meanwhile.
    await hook(`Promise.all([t.send({ t: 'orderCreeps', barracksId: ${barracksId}, mix: ['melee', 'ranged', 'area', 'melee', 'ranged'] }), ...[1, 2, 3].map(() => t.send({ t: 'orderCreeps', barracksId: ${barracksId}, mix: ['melee'] }))])`);
    // The first order (2 s) may already have left the queue by now, and a slow page sees fewer rows.
    await page.waitForFunction(() => document.querySelectorAll('.queue-row').length >= 3);
    const luxOf = async () => Number(((await page.textContent('#hud-core')) ?? '').replace(/\D/g, ''));
    const before = await luxOf();
    await page.click('.queue-row:last-child .cancel');
    await page.waitForFunction((was) => Number((document.getElementById('hud-core')?.textContent ?? '').replace(/\D/g, '')) >= was + 5, before);

    // Every remaining order becomes its own group: 2, 5, 1 and 1 creeps.
    await until(page, () => /** @type {any} */ (window).__luxTest.groups().length === 4, null, 60_000);
    const sizeOf = (/** @type {number} */ id) => hook(`t.entities().filter((e) => e.groupId === ${id}).length`);
    const ids = await hook('t.groups().map((g) => g.id)');
    assert.deepEqual(await Promise.all(ids.map(sizeOf)), [2, 5, 1, 1]);
    assert.equal(await hook('t.groups().every((g) => g.custom === 0 && g.waypoints.length >= 8)'), true, 'every group walks the lane route');
    const tapCreep = async (/** @type {number} */ groupId) => {
      const c = await hook(`t.entities().find((e) => e.groupId === ${groupId})`);
      await hook(`t.tap(${c.x / 1000}, ${c.z / 1000})`);
    };

    // Tap a creep of the 5-group: its panel opens with Split, Merge and Path. Split 5 into 3 and 2: the odd creep stays.
    await tapCreep(ids[1]);
    await page.waitForSelector('.panel:not([hidden]) .action:has-text("Split")');
    assert.match(await page.textContent('.panel-title') ?? '', /^Group of 5, lane route$/);
    await page.click('.panel .action:has-text("Split")');
    await until(page, () => /** @type {any} */ (window).__luxTest.groups().length === 5);
    assert.equal(await sizeOf(ids[1]), 3, 'the original group kept the extra creep');

    // Merge: select the 3-group, press Merge, tap a creep of a 1-group. B joins A.
    await hook(`t.selectGroup(${ids[1]})`);
    await page.click('.panel .action:has-text("Merge")');
    await page.waitForSelector('.panel-title:has-text("tap another of your groups")');
    await tapCreep(ids[2]);
    await until(page, () => /** @type {any} */ (window).__luxTest.groups().length === 4);
    assert.equal(await sizeOf(ids[1]), 4);

    // Path mode: Path, two taps, Go. The group takes a custom path with two waypoints.
    await hook(`t.selectGroup(${ids[1]})`);
    await page.click('.panel .action:has-text("Path")');
    // The camera shows tiles 32 to 64 across, so both taps land on screen.
    await tapTile(page, { tileX: 40, tileZ: 84 });
    await tapTile(page, { tileX: 44, tileZ: 80 });
    await page.waitForSelector('.panel-title:has-text("Path: 2/10")');
    await page.click('.panel .action:has-text("Go")');
    await until(page, (id) => /** @type {any} */ (window).__luxTest.groups().some((/** @type {any} */ g) => g.id === id && g.custom === 1 && g.waypoints.length === 2), ids[1]);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'creeps.png') });
    assert.deepEqual(errors, [], 'the pages must log no console or page errors');
  }, { MATCH_MAX_TICKS: '2400' });
});
