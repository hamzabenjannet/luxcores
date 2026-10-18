// Online play browser tests. They start the real backend and open Chromium
// pages in the Playwright container. Two pages play a server match, and each
// must receive the same state hashes that the repo's own sim computes. That
// checks the loop end to end: REST lobby, Socket.IO room, server-authoritative
// ticks, snapshots, and the web client. A second test checks the device guest:
// a page signs in as the same player on every visit, and a recovery code moves
// the profile to a fresh browser profile.
//
// Run: (cd backend/nodejs && npm install && npm run build)   once
//      npm run test:e2e
//
// The shared set-up and its environment variables live in helpers/backend.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SEED, SHOTS, freeSpot, luxTest, referenceHash, skip, withBackend } from './helpers/backend.js';

test('two browsers play a server match and receive the sim hashes', { timeout: 120_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const context = await newContext();

    // The host opens a lobby, the guest joins it, then the host starts the match.
    const host = await open(context, `name=Halo&match=new&seed=${SEED}`);
    const matchId = await luxTest(host, 'matchId');
    // A second browser profile, like a second phone: pages that share a profile are the same player.
    const guest = await open(await newContext(), `name=Prism&match=${matchId}`);

    assert.equal(await luxTest(host, 'viewerTeam'), 0);
    assert.equal(await luxTest(guest, 'viewerTeam'), 1);

    await host.evaluate(() => /** @type {any} */ (window).__luxTest.start());
    for (const page of [host, guest]) {
      await page.waitForFunction(() => /** @type {any} */ (window).__luxTest.hashes['40'] !== undefined, null, { timeout: 60_000 });
    }

    // A command goes to the server, which stamps and queues it.
    const ack = await host.evaluate(() => /** @type {any} */ (window).__luxTest.send({ t: 'heroMove', x: 48000, z: 80000 }));
    assert.equal(ack.accepted, true, `the server refused the command: ${ack.reason}`);

    // A build command reaches the sim: the host's page soon shows the new collector.
    const spot = freeSpot();
    const built = await host.evaluate((s) => /** @type {any} */ (window).__luxTest.send({ t: 'build', building: 'solar', ...s }), spot);
    assert.equal(built.accepted, true);
    await host.waitForFunction(() => /** @type {any} */ (window).__luxTest.entityKinds().includes(2), null, { timeout: 30_000 }); // KIND.SOLAR
    await guest.waitForFunction(() => /** @type {any} */ (window).__luxTest.entityKinds().includes(2), null, { timeout: 30_000 });

    for (const tick of [20, 40]) {
      const expected = referenceHash(tick);
      for (const [who, page] of [['host', host], ['guest', guest]]) {
        const actual = await page.evaluate((t) => /** @type {any} */ (window).__luxTest.hashes[t], tick);
        assert.equal(actual, expected, `P0: the ${who} page received a different hash at tick ${tick} than the sim computes`);
      }
    }

    mkdirSync(SHOTS, { recursive: true });
    await host.screenshot({ path: join(SHOTS, 'network-host.png') });
    await guest.screenshot({ path: join(SHOTS, 'network-guest.png') });
    assert.deepEqual(errors, [], 'the pages must log no console or page errors');
    console.log(`tick 20 hash ${referenceHash(20)} and tick 40 hash ${referenceHash(40)} reached both browsers; screenshots in ${SHOTS}`);
  });
});

test('a device signs in as the same player, and a recovery code moves the profile', { timeout: 120_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const device = await newContext();

    // First visit creates a guest; the next visit in the same browser profile is the same player.
    const first = await open(device, 'name=Halo&match=new');
    const playerId = await luxTest(first, 'playerId');
    assert.equal(await luxTest(first, 'playerName'), 'Halo');
    const again = await open(device, 'name=SomeoneElse&match=new');
    assert.equal(await luxTest(again, 'playerId'), playerId, 'the stored device secret must sign in as the same player');
    assert.equal(await luxTest(again, 'playerName'), 'Halo', 'the name parameter applies to a new guest only');

    // A recovery code moves the profile to a fresh browser profile.
    const code = await first.evaluate(() => /** @type {any} */ (window).__luxTest.recoveryCode());
    assert.match(code, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
    const phone = await newContext();
    const moved = await open(phone, `recover=${code}&match=new`);
    assert.equal(await luxTest(moved, 'playerId'), playerId, 'the recovery code must open the same profile');
    const nextCode = await luxTest(moved, 'recoveredCode');
    assert.match(nextCode, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
    assert.notEqual(nextCode, code);
    assert.equal(errors.length, 0, `unexpected errors: ${errors.join(' | ')}`);

    // The recovery replaced the old device secret, so the old browser profile starts over as a new guest.
    const stale = await open(device, 'name=Late&match=new');
    assert.notEqual(await luxTest(stale, 'playerId'), playerId);
    assert.equal(await luxTest(stale, 'playerName'), 'Late');
    assert.ok(errors.every((e) => e.includes('401')), `only the expected 401 may be logged: ${errors.join(' | ')}`);

    // The new browser profile keeps working across visits.
    const back = await open(phone, 'match=new');
    assert.equal(await luxTest(back, 'playerId'), playerId);
  });
});
