import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchRunnerService } from '../src/game/match-runner.service.js';
import {
  ack,
  api,
  connectSocket,
  createTestApp,
  guest,
  type TestApp,
  waitFor,
} from './helpers/create-app.js';

interface Snapshot {
  tick: number;
  entities: { kind: number; team: number }[];
}
interface LoggedEvent {
  type: string;
  seq: number;
  tick: number;
  data: Record<string, unknown>;
}

const logPath = (t: TestApp, matchId: string) =>
  join(dirname(t.dbPath), 'events', `${matchId}.ndjson`);

const readLog = async (path: string): Promise<LoggedEvent[]> =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedEvent);

/** Starts a match against the bot, builds one solar plant for the human, and waits until `tick`. */
async function playUntil(t: TestApp, seed: number, tick: number) {
  const halo = await guest(t.url, 'Halo');
  const created = await api(t.url, '/api/matches', {
    token: halo.token,
    body: { name: 'Resumable', vsBot: true, seed },
  });
  const matchId: string = created.body.id;
  const socket = await connectSocket(t.url, halo.token);
  await ack(socket, 'match:join', { matchId });
  const first = waitFor<{ snapshot: Snapshot }>(socket, 'match:started');
  await api(t.url, `/api/matches/${matchId}/start`, {
    method: 'POST',
    token: halo.token,
  });
  await first;
  expect(
    await ack(socket, 'match:command', {
      matchId,
      seq: 0,
      cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 },
    }),
  ).toMatchObject({ accepted: true });
  const reached = await waitFor<Snapshot>(
    socket,
    'match:snapshot',
    (s) => s.tick >= tick,
    30_000,
  );
  socket.close();
  return { halo, matchId, reached };
}

describe('resuming matches after a restart', () => {
  it('writes the seed, every command and a hash every 20 ticks to a log file', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    try {
      const { matchId } = await playUntil(t, 5, 70);
      await t.app.get(MatchRunnerService).resumed; // nothing to resume here
      await t.shutdown();
      const events = await readLog(logPath(t, matchId));
      expect(events[0]).toMatchObject({ type: 'started', seq: 0, tick: 0 });
      expect(events[0].data).toMatchObject({ seed: 5 });
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
      const commands = events.filter((e) => e.type === 'command');
      expect(
        commands.some((e) => e.data.playerId === 0 && (e.data.cmd as { t: string }).t === 'build'),
      ).toBe(true);
      expect(commands.some((e) => e.data.playerId === 1), 'the bot is logged too').toBe(true);
      expect(events.filter((e) => e.type === 'hash').map((e) => e.tick)).toEqual(
        [20, 40, 60],
      );
    } finally {
      await t.close();
    }
  }, 60_000);

  it('rebuilds a running match at the next start, with every entity, the bot and the command counter', async () => {
    const first = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    let second: TestApp | undefined;
    try {
      const { halo, matchId, reached } = await playUntil(first, 5, 90);
      await first.shutdown(); // a graceful stop keeps the match running for the next start
      const before = await readLog(logPath(first, matchId));
      const lastTick = Math.max(...before.map((e) => e.tick));

      second = await createTestApp({
        MATCH_MAX_TICKS: '6000',
        JSON_DB_PATH: first.dbPath,
      });
      await second.app.get(MatchRunnerService).resumed;
      // The first token is still valid: the profile lives in the shared database and the secret did not change.
      const socket = await connectSocket(second.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined).toMatchObject({ ok: true, role: 'player', status: 'running', nextSeq: 1 });
      expect(joined.snapshot.tick).toBeGreaterThanOrEqual(lastTick - 1);
      expect(joined.snapshot.tick).toBeGreaterThanOrEqual(reached.tick - 25);
      const solar = joined.snapshot.entities.filter((e: { kind: number; team: number }) => e.kind === 2 && e.team === 0);
      expect(solar, 'the human solar plant came back').toHaveLength(1);
      expect(
        joined.snapshot.entities.some((e: { team: number; kind: number }) => e.team === 1 && e.kind >= 2 && e.kind <= 7),
        'and so did the bot buildings',
      ).toBe(true);

      // The match goes on: the next command number is accepted, an old one is refused with the right hint.
      expect(
        await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'wind', tileX: 46, tileZ: 90 } }),
      ).toMatchObject({ accepted: false, nextSeq: 1 });
      expect(
        await ack(socket, 'match:command', { matchId, seq: 1, cmd: { t: 'build', building: 'wind', tileX: 46, tileZ: 90 } }),
      ).toMatchObject({ accepted: true });
      const later = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= joined.snapshot.tick + 40, 30_000);
      expect(later.entities.some((e) => e.kind === 3 && e.team === 0), 'the new wind plant exists').toBe(true);

      // The replay of the whole match, before and after the restart, verifies.
      const stopped = await api(second.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      const verify = await api(second.url, `/api/replays/${stopped.body.replayId}/verify`, { method: 'POST', token: halo.token });
      expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });
      const record = await api(second.url, `/api/replays/${stopped.body.replayId}`, { token: halo.token });
      const builds = (record.body.replay.commands as { playerId: number; cmd: { t: string; building?: string } }[])
        .filter((c) => c.playerId === 0 && c.cmd.t === 'build')
        .map((c) => c.cmd.building);
      expect(builds).toEqual(['solar', 'wind']);
      socket.close();
    } finally {
      await second?.close();
      await first.close();
    }
  }, 120_000);

  it('survives a torn last line, as a crash in the middle of a write leaves it', async () => {
    const first = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await playUntil(first, 6, 70);
      await first.shutdown();
      await appendFile(logPath(first, matchId), '{"matchId":"x","seq":9999,"tick":12,"type":"comm');
      second = await createTestApp({ MATCH_MAX_TICKS: '6000', JSON_DB_PATH: first.dbPath });
      await second.app.get(MatchRunnerService).resumed;
      const socket = await connectSocket(second.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined.snapshot.tick).toBeGreaterThan(0);
      socket.close();
    } finally {
      await second?.close();
      await first.close();
    }
  }, 90_000);

  it('gives up on a match whose log disagrees with the sim, and ends it as a draw', async () => {
    const first = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await playUntil(first, 7, 70);
      await first.shutdown();
      const path = logPath(first, matchId);
      const tampered = (await readFile(path, 'utf8')).replace(/"hash":"[0-9a-f]{8}"/, '"hash":"deadbeef"');
      await writeFile(path, tampered);
      second = await createTestApp({ MATCH_MAX_TICKS: '6000', JSON_DB_PATH: first.dbPath });
      await second.app.get(MatchRunnerService).resumed;
      const match = await api(second.url, `/api/matches/${matchId}`, { token: halo.token });
      expect(match.body).toMatchObject({ status: 'finished', result: { draw: true, reason: 'stopped' } });
      expect(second.app.get(MatchRunnerService).isRunning(matchId)).toBe(false);
    } finally {
      await second?.close();
      await first.close();
    }
  }, 90_000);

  it('ends a running match that has no log at all, instead of leaving it running forever', async () => {
    const first = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await playUntil(first, 8, 50);
      await first.shutdown();
      await writeFile(logPath(first, matchId), '');
      second = await createTestApp({ MATCH_MAX_TICKS: '6000', JSON_DB_PATH: first.dbPath });
      await second.app.get(MatchRunnerService).resumed;
      const match = await api(second.url, `/api/matches/${matchId}`, { token: halo.token });
      expect(match.body).toMatchObject({ status: 'finished', result: { reason: 'stopped' } });
    } finally {
      await second?.close();
      await first.close();
    }
  }, 90_000);

  it('removes the log of a finished match once its replay is saved, unless asked to keep it', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '40' });
    const keep = await createTestApp({ MATCH_MAX_TICKS: '40', EVENT_LOG_KEEP_FINISHED: 'true' });
    try {
      for (const [app, kept] of [[t, false], [keep, true]] as const) {
        const halo = await guest(app.url, 'Halo');
        const created = await api(app.url, '/api/matches', { token: halo.token, body: { name: 'Short', vsBot: true, seed: 3 } });
        const matchId: string = created.body.id;
        const socket = await connectSocket(app.url, halo.token);
        await ack(socket, 'match:join', { matchId });
        const ended = waitFor(socket, 'match:ended');
        await api(app.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
        await ended;
        await new Promise((r) => setTimeout(r, 300));
        const exists = await readFile(logPath(app, matchId), 'utf8').then(() => true, () => false);
        expect(exists).toBe(kept);
        if (kept) {
          expect((await readLog(logPath(app, matchId))).at(-1)).toMatchObject({ type: 'finished' });
        }
        socket.close();
      }
    } finally {
      await keep.close();
      await t.close();
    }
  }, 60_000);
});
