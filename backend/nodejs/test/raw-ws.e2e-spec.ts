import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import {
  ack,
  api,
  connectRaw,
  connectSocket,
  createTestApp,
  guest,
  type RawClient,
  type Session,
  type TestApp,
  waitFor,
} from './helpers/create-app.js';

describe('plain WebSocket at /ws', () => {
  let t: TestApp;
  let halo: Session;
  let prism: Session;
  const raws: RawClient[] = [];
  const sockets: Socket[] = [];

  const raw = async (token?: string, query = false) => {
    const client = await connectRaw(t.url, { token, query });
    raws.push(client);
    return client;
  };

  beforeAll(async () => {
    t = await createTestApp({
      WS_AUTH_TIMEOUT_MS: '400',
      WS_MAX_PAYLOAD_BYTES: '2048',
    });
    halo = await guest(t.url, 'Halo');
    prism = await guest(t.url, 'Prism');
  });

  afterEach(() => {
    for (const c of raws.splice(0)) c.ws.close();
    for (const s of sockets.splice(0)) s.close();
  });

  afterAll(() => t.close());

  it('advertises itself in the game spec', async () => {
    const spec = await api(t.url, '/api/game/spec');
    expect(spec.body.webSocket).toMatchObject({ path: '/ws' });
  });

  describe('authentication', () => {
    it('accepts a bearer header, a query token or an auth frame', async () => {
      const byHeader = await raw(halo.token);
      expect(await byHeader.request('ping')).toMatchObject({
        serverTime: expect.any(String),
      });

      const byQuery = await raw(halo.token, true);
      expect(await byQuery.request('ping')).toMatchObject({
        serverTime: expect.any(String),
      });

      const byFrame = await raw();
      expect(await byFrame.request('ping')).toMatchObject({
        ok: false,
        error: expect.stringMatching(/auth frame/),
      });
      expect(
        await byFrame.request('auth', { token: halo.token }),
      ).toMatchObject({ ok: true, player: { name: 'Halo' } });
      expect(await byFrame.request('ping')).toMatchObject({
        serverTime: expect.any(String),
      });
    });

    it('refuses a bad token at the upgrade and a bad auth frame in its ack', async () => {
      await expect(connectRaw(t.url, { token: 'garbage' })).rejects.toThrow(
        'HTTP 401',
      );
      await expect(
        connectRaw(t.url, { token: 'garbage', query: true }),
      ).rejects.toThrow('HTTP 401');

      const client = await raw();
      expect(await client.request('auth', { token: 'garbage' })).toMatchObject({
        ok: false,
      });
      expect(await client.request('auth', {})).toMatchObject({
        ok: false,
        error: 'auth needs { token }',
      });
    });

    it('closes a socket that stays silent past the auth timeout', async () => {
      const client = await raw();
      expect(await client.closed()).toBe(4401);
    });
  });

  describe('protocol errors', () => {
    it('answers bad frames without dropping the connection', async () => {
      const client = await raw(halo.token);
      client.ws.send('not json');
      expect(
        (await client.next((f) => f.event === 'exception')).data,
      ).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });

      expect(await client.request('match:fly')).toEqual({
        ok: false,
        error: 'Unknown event "match:fly"',
      });
      expect(
        await client.request('match:join', { matchId: 'nope' }),
      ).toMatchObject({ ok: false, error: expect.stringMatching(/matchId/) });
      expect(
        await client.request('match:join', { matchId: 'nope', extra: 1 }),
      ).toMatchObject({ ok: false });
      expect(await client.request('ping')).toMatchObject({
        serverTime: expect.any(String),
      }); // still alive

      client.ws.send(
        JSON.stringify({ event: 'match:join', data: { matchId: 'nope' } }),
      ); // no id: an exception frame
      expect(
        (
          await client.next(
            (f) => f.event === 'exception' && /matchId/.test(f.data.error),
          )
        ).data.ok,
      ).toBe(false);
    });

    it('closes the connection on an oversized frame', async () => {
      const client = await raw(halo.token);
      client.ws.send(
        JSON.stringify({
          event: 'chat:message',
          data: { text: 'x'.repeat(3000) },
        }),
      );
      expect(await client.closed()).toBe(1009);
    });
  });

  it('plays a match next to a Socket.IO client and shares chat across both', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Mixed transports', seed: 1234567 },
    });
    const matchId: string = created.body.id;
    await api(t.url, `/api/matches/${matchId}/join`, {
      method: 'POST',
      token: prism.token,
    });

    const a = await raw(halo.token); // Godot style
    const sio = await connectSocket(t.url, prism.token); // web style
    sockets.push(sio);

    // Membership rules are the same on both transports.
    const stranger = await guest(t.url, 'Stranger');
    const outsider = await raw(stranger.token);
    expect(await outsider.request('match:join', { matchId })).toEqual({
      ok: false,
      error: 'You are not in this match',
    });
    expect(
      await outsider.request('chat:message', { matchId, text: 'hi' }),
    ).toEqual({ ok: false });

    expect(await a.request('match:join', { matchId })).toMatchObject({
      ok: true,
      status: 'lobby',
      snapshot: null,
    });
    expect(await ack(sio, 'match:join', { matchId })).toMatchObject({
      ok: true,
    });

    // A chat line crosses from one transport to the other, in both directions.
    const toSio = waitFor(sio, 'chat:message');
    expect(
      await a.request('chat:message', {
        matchId,
        text: 'from the plain socket',
      }),
    ).toEqual({ ok: true });
    expect(await toSio).toMatchObject({
      from: 'Halo',
      text: 'from the plain socket',
    });
    const toRaw = a.next(
      (f) => f.event === 'chat:message' && f.data.text === 'from socket.io',
    );
    await ack(sio, 'chat:message', { matchId, text: 'from socket.io' });
    expect((await toRaw).data).toMatchObject({ from: 'Prism' });

    // Lobby and match events reach the plain client.
    const started = a.next((f) => f.event === 'match:started');
    const hash20 = a.next(
      (f) =>
        f.event === 'match:snapshot' && f.data.tick === 20 && !!f.data.hash,
    );
    const sioHash20 = waitFor(
      sio,
      'match:snapshot',
      (s) => s.tick === 20 && !!s.hash,
    );
    expect(
      (
        await api(t.url, `/api/matches/${matchId}/start`, {
          method: 'POST',
          token: halo.token,
        })
      ).status,
    ).toBe(200);
    expect((await started).data).toMatchObject({ matchId, tickHz: 20 });

    // Both transports see the same hash, so the plain client can verify the server like the web one.
    expect((await hash20).data.hash).toBe((await sioHash20).hash);

    // Commands: acked with the same shape; seq is counted per player, not per transport.
    expect(
      await a.request('match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'heroMove', x: 1000, z: 2000 },
      }),
    ).toMatchObject({ accepted: true });
    expect(
      await a.request('match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'heroMove', x: 1, z: 1 },
      }),
    ).toMatchObject({ accepted: false });
    expect(
      await a.request('match:command', {
        matchId,
        seq: 1,
        cmd: { t: 'launchNukes' },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/cmd must be/) });

    // After the match, the plain client receives match:ended with the replay.
    const ended = await a.next((f) => f.event === 'match:ended');
    expect(ended.data).toMatchObject({
      matchId,
      result: { reason: 'tick-limit' },
    });
    expect(ended.data.replayId).toEqual(expect.any(String));

    // Leaving the room stops delivery.
    expect(await a.request('match:leave', { matchId })).toEqual({ ok: true });
    expect(
      await a.request('chat:message', { matchId, text: 'after leaving' }),
    ).toEqual({ ok: false });
  }, 30_000);

  it('cleans up rooms when a client disconnects', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Disconnect', vsBot: true },
    });
    const matchId: string = created.body.id;
    const a = await raw(halo.token);
    await a.request('match:join', { matchId });
    const closed = a.closed();
    a.ws.close();
    await closed;
    // The lobby keeps working for others after a member vanished.
    const b = await raw(halo.token);
    expect(await b.request('match:join', { matchId })).toMatchObject({
      ok: true,
    });
    expect(
      (
        await api(t.url, `/api/matches/${matchId}/start`, {
          method: 'POST',
          token: halo.token,
        })
      ).status,
    ).toBe(200);
    await b.next((f) => f.event === 'match:snapshot');
    expect(
      (
        await api(t.url, `/api/matches/${matchId}/stop`, {
          method: 'POST',
          token: halo.token,
        })
      ).status,
    ).toBe(200);
  }, 30_000);
});
