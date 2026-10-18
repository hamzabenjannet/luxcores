import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createTestApp,
  guest,
  type Session,
  type TestApp,
} from './helpers/create-app.js';

describe('REST API', () => {
  let t: TestApp;
  let halo: Session;
  let prism: Session;

  beforeAll(async () => {
    t = await createTestApp();
    halo = await guest(t.url, 'Halo');
    prism = await guest(t.url, 'Prism');
  });

  afterAll(() => t.close());

  describe('auth and players', () => {
    it('signs a guest in and returns a profile', async () => {
      const res = await api(t.url, '/api/auth/guest', {
        body: { name: '  Flare  ' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 43200,
        player: { name: 'Flare', stats: { wins: 0 } },
      });
    });

    it.each([
      { name: 'x' },
      { name: 'a'.repeat(25) },
      { name: 'bad<script>' },
      {},
      { name: 'ok name', admin: true },
    ])('rejects the guest body %j', async (body) => {
      const res = await api(t.url, '/api/auth/guest', { body });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'BAD_REQUEST',
        path: '/api/auth/guest',
      });
    });

    it('protects routes with a bearer token', async () => {
      expect((await api(t.url, '/api/players/me')).status).toBe(401);
      expect(
        (await api(t.url, '/api/players/me', { token: 'garbage' })).status,
      ).toBe(401);
      const me = await api(t.url, '/api/players/me', { token: halo.token });
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(halo.player.id);
    });

    it('renames, lists and looks up players', async () => {
      const renamed = await api(t.url, '/api/players/me', {
        method: 'PATCH',
        token: prism.token,
        body: { name: 'Prism II' },
      });
      expect(renamed.body.name).toBe('Prism II');

      const list = await api(t.url, '/api/players?limit=2', {
        token: halo.token,
      });
      expect(list.body).toMatchObject({ limit: 2, offset: 0 });
      expect(list.body.items.length).toBeLessThanOrEqual(2);
      expect(list.body.total).toBeGreaterThanOrEqual(3);

      expect(
        (
          await api(t.url, `/api/players/${halo.player.id}`, {
            token: halo.token,
          })
        ).status,
      ).toBe(200);
      expect(
        (await api(t.url, '/api/players/not-a-uuid', { token: halo.token }))
          .status,
      ).toBe(400);
      expect(
        (
          await api(
            t.url,
            '/api/players/00000000-0000-4000-8000-000000000000',
            { token: halo.token },
          )
        ).status,
      ).toBe(404);
      expect(
        (await api(t.url, '/api/players?limit=1000', { token: halo.token }))
          .status,
      ).toBe(400);
    });
  });

  describe('lobbies', () => {
    it('runs the lobby rules for a 1v1', async () => {
      const created = await api(t.url, '/api/matches', {
        token: halo.token,
        body: { name: 'Friday duel', seed: 42 },
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        status: 'lobby',
        seed: 42,
        vsBot: false,
        hostId: halo.player.id,
        players: [{ name: 'Halo', team: 0, kind: 'human' }],
      });
      const id: string = created.body.id;

      const joined = await api(t.url, `/api/matches/${id}/join`, {
        method: 'POST',
        token: prism.token,
      });
      expect(joined.status).toBe(200);
      expect(joined.body.players.map((p: { team: number }) => p.team)).toEqual([
        0, 1,
      ]);

      // Joining twice changes nothing; a third player finds the lobby full.
      expect(
        (
          await api(t.url, `/api/matches/${id}/join`, {
            method: 'POST',
            token: prism.token,
          })
        ).body.players,
      ).toHaveLength(2);
      const third = await guest(t.url, 'Third');
      expect(
        (
          await api(t.url, `/api/matches/${id}/join`, {
            method: 'POST',
            token: third.token,
          })
        ).status,
      ).toBe(409);

      // Only the host starts a match; leaving frees the slot.
      expect(
        (
          await api(t.url, `/api/matches/${id}/start`, {
            method: 'POST',
            token: prism.token,
          })
        ).status,
      ).toBe(403);
      const left = await api(t.url, `/api/matches/${id}/leave`, {
        method: 'POST',
        token: prism.token,
      });
      expect(left.body.players).toHaveLength(1);
      expect(
        (
          await api(t.url, `/api/matches/${id}/start`, {
            method: 'POST',
            token: halo.token,
          })
        ).status,
      ).toBe(409); // waits for a second player

      const cancelled = await api(t.url, `/api/matches/${id}/leave`, {
        method: 'POST',
        token: halo.token,
      });
      expect(cancelled.body.status).toBe('cancelled');
      expect(
        (
          await api(t.url, `/api/matches/${id}/join`, {
            method: 'POST',
            token: prism.token,
          })
        ).status,
      ).toBe(409);
    });

    it('refuses a second human in a bot match and filters the list by status', async () => {
      const created = await api(t.url, '/api/matches', {
        token: halo.token,
        body: { name: 'Bot practice', vsBot: true },
      });
      expect(created.body.seed).toBeGreaterThanOrEqual(0);
      expect(
        (
          await api(t.url, `/api/matches/${created.body.id}/join`, {
            method: 'POST',
            token: prism.token,
          })
        ).status,
      ).toBe(409);

      const lobbies = await api(t.url, '/api/matches?status=lobby', {
        token: halo.token,
      });
      expect(
        lobbies.body.items.every(
          (m: { status: string }) => m.status === 'lobby',
        ),
      ).toBe(true);
      expect(
        lobbies.body.items.some(
          (m: { id: string }) => m.id === created.body.id,
        ),
      ).toBe(true);
      expect(
        (await api(t.url, '/api/matches?status=nope', { token: halo.token }))
          .status,
      ).toBe(400);
    });

    it.each([
      { name: 'ab' },
      { name: 'ok name', seed: -1 },
      { name: 'ok name', seed: 4294967296 },
      { name: 'ok name', mode: '5v5' },
      { name: 'ok name', vsBot: 'yes' },
    ])('rejects the match body %j', async (body) => {
      expect(
        (await api(t.url, '/api/matches', { token: halo.token, body })).status,
      ).toBe(400);
    });
  });

  describe('game data', () => {
    it('serves the spec without a token', async () => {
      const res = await api(t.url, '/api/game/spec');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        specVersion: '0.10.0',
        tickHz: 20,
        mapgenVersion: 1,
        socket: { namespace: '/game' },
      });
      expect(res.body.dataHash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        res.body.socket.events.map((e: { name: string }) => e.name),
      ).toContain('match:command');
    });

    it('generates the same map as the sim for a seed', async () => {
      const res = await api(t.url, '/api/game/maps/1234567');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        width: 96,
        height: 112,
        usedSeed: 1234567,
      });
      expect(res.body.lanes).toHaveLength(6);
      expect(res.body.blockers).toHaveLength(12);
      expect(res.body.vents).toHaveLength(4);
      expect(res.body.cores).toEqual([
        { team: 0, tileX: 48, tileZ: 96 },
        { team: 1, tileX: 47, tileZ: 15 },
      ]);
      expect((await api(t.url, '/api/game/maps/1234567')).body).toEqual(
        res.body,
      ); // deterministic
    });

    it.each(['-1', '1.5', 'abc', '4294967296'])(
      'rejects the seed %j',
      async (seed) => {
        expect((await api(t.url, `/api/game/maps/${seed}`)).status).toBe(400);
      },
    );
  });

  describe('replays', () => {
    const replay = {
      version: 1,
      specVersion: '0.10.0',
      dataHash: 'abc',
      mapgenVersion: 1,
      seed: 1234567,
      players: [
        { id: 0, team: 0, kind: 'human' },
        { id: 1, team: 1, kind: 'bot' },
      ],
      ticks: 40,
      commands: [],
      hashes: { '20': 'ffffffff', '40': 'eeeeeeee' },
    };

    it('stores, lists, reads and verifies a replay', async () => {
      const up = await api(t.url, '/api/replays', {
        token: halo.token,
        body: { replay },
      });
      expect(up.status).toBe(201);
      expect(up.body).toMatchObject({
        uploadedBy: halo.player.id,
        seed: 1234567,
        ticks: 40,
      });

      const list = await api(t.url, '/api/replays', { token: halo.token });
      const item = list.body.items.find(
        (r: { id: string }) => r.id === up.body.id,
      );
      expect(item).toBeDefined();
      expect(item.replay).toBeUndefined(); // lists carry no payload

      expect(
        (await api(t.url, `/api/replays/${up.body.id}`, { token: halo.token }))
          .body.replay.hashes,
      ).toEqual(replay.hashes);

      // The recorded hashes are made up, so the re-simulation must flag tick 20.
      const verify = await api(t.url, `/api/replays/${up.body.id}/verify`, {
        method: 'POST',
        token: halo.token,
      });
      expect(verify.status).toBe(200);
      expect(verify.body).toMatchObject({
        ok: false,
        firstMismatchTick: 20,
        specVersion: '0.10.0',
      });
      expect(verify.body.finalHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('rejects malformed uploads', async () => {
      const bad = [
        { replay: { ...replay, seed: -1 } },
        { replay: { ...replay, players: [] } },
        { replay: { ...replay, hashes: { '20': 'not-a-hash' } } },
        { replay: { ...replay, extra: 1 } },
        { replay: undefined },
        { replay, matchId: 'nope' },
      ];
      for (const body of bad)
        expect(
          (await api(t.url, '/api/replays', { token: halo.token, body }))
            .status,
          JSON.stringify(body).slice(0, 60),
        ).toBe(400);
    });

    it('answers 422 for a replay from another spec version', async () => {
      const up = await api(t.url, '/api/replays', {
        token: halo.token,
        body: { replay: { ...replay, specVersion: '0.9.0' } },
      });
      const verify = await api(t.url, `/api/replays/${up.body.id}/verify`, {
        method: 'POST',
        token: halo.token,
      });
      expect(verify.status).toBe(422);
      expect(verify.body.message).toMatch(/specVersion/);
    });
  });

  describe('admin', () => {
    it('needs the API key, not a player token', async () => {
      expect((await api(t.url, '/api/admin/stats')).status).toBe(401);
      expect(
        (await api(t.url, '/api/admin/stats', { token: halo.token })).status,
      ).toBe(401);
      expect(
        (
          await api(t.url, '/api/admin/stats', {
            headers: { 'x-api-key': 'wrong' },
          })
        ).status,
      ).toBe(401);
      const ok = await api(t.url, '/api/admin/stats', {
        headers: { 'x-api-key': 'test-admin-key-with-enough-length' },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.players).toBeGreaterThanOrEqual(3);
    });

    it('deletes a replay', async () => {
      const up = await api(t.url, '/api/replays', {
        token: halo.token,
        body: {
          replay: {
            version: 1,
            specVersion: '0.10.0',
            dataHash: 'x',
            mapgenVersion: 1,
            seed: 1,
            players: [{ id: 0, team: 0, kind: 'human' }],
            ticks: 0,
            commands: [],
            hashes: {},
          },
        },
      });
      const headers = { 'x-api-key': 'test-admin-key-with-enough-length' };
      expect(
        (
          await api(t.url, `/api/admin/replays/${up.body.id}`, {
            method: 'DELETE',
            headers,
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await api(t.url, `/api/admin/replays/${up.body.id}`, {
            method: 'DELETE',
            headers,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('static files, health and docs', () => {
    it('serves the game page and its files, and nothing outside them', async () => {
      const page = await fetch(`${t.url}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<canvas id="view">');
      const determinism = await fetch(`${t.url}/determinism.html`);
      expect(determinism.status).toBe(200);
      expect(await determinism.text()).toContain('src/client/determinism.js');

      expect((await fetch(`${t.url}/src/sim/index.js`)).status).toBe(200);
      const data = await fetch(`${t.url}/data/mapgen.json`);
      expect(data.status).toBe(200);
      expect(((await data.json()) as { width: number }).width).toBe(96);
      expect((await fetch(`${t.url}/public/index.html`)).status).toBe(200);
      expect((await fetch(`${t.url}/favicon.ico`)).status).toBe(204);

      for (const path of [
        '/.git/config',
        '/backend/nodejs/package.json',
        '/CLAUDE.md',
        '/src/nope.js',
        '/data/../CLAUDE.md',
        '/public/../.env',
      ]) {
        expect((await fetch(`${t.url}${path}`)).status, path).toBe(404);
      }
    });

    it('reports health', async () => {
      const res = await api(t.url, '/api/health');
      expect(res.body).toMatchObject({
        status: 'ok',
        database: { driver: 'json', ok: true },
        events: 'local',
        runningMatches: 0,
        specVersion: '0.10.0',
      });
    });

    it('publishes the OpenAPI document with documented schemas', async () => {
      const ui = await fetch(`${t.url}/api/docs`);
      expect(ui.status).toBe(200);
      const doc = (await (await fetch(`${t.url}/api/docs-json`)).json()) as {
        paths: Record<
          string,
          Record<
            string,
            { tags?: string[]; responses: Record<string, unknown> }
          >
        >;
        components: {
          schemas: Record<
            string,
            {
              properties?: Record<
                string,
                { description?: string; example?: unknown }
              >;
            }
          >;
          securitySchemes: Record<string, unknown>;
        };
      };
      expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
        'api-key',
        'bearer',
      ]);
      for (const path of [
        '/api/auth/guest',
        '/api/matches',
        '/api/matches/{id}/start',
        '/api/replays/{id}/verify',
        '/api/game/maps/{seed}',
        '/api/admin/stats',
        '/api/health',
      ]) {
        expect(doc.paths[path], path).toBeDefined();
      }
      for (const name of [
        'GuestLoginDto',
        'CreateMatchDto',
        'MatchDto',
        'PlayerDto',
        'ReplayPayloadDto',
        'GameCommandDto',
        'ErrorResponseDto',
      ]) {
        expect(doc.components.schemas[name], name).toBeDefined();
      }
      // Every operation carries a tag, so the UI groups it.
      for (const [path, ops] of Object.entries(doc.paths))
        for (const [method, op] of Object.entries(ops))
          expect(op.tags?.length, `${method} ${path}`).toBeGreaterThan(0);
    });
  });
});
