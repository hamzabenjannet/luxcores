import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchRunnerService } from '../src/game/match-runner.service.js';
import { EventLog } from '../src/matchlog/event-log.js';
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

const REPO = resolve('../..');
const logPath = (t: TestApp, matchId: string) =>
  join(dirname(t.dbPath), 'events', `${matchId}.ndjson`);
const readLog = async (path: string): Promise<LoggedEvent[]> =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedEvent);

/** A copy of the sim, the bot and the data that a test can edit, as a deploy with new rules would. */
async function editedRules(edit: (root: string) => Promise<void>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'luxcores-rules-'));
  await cp(join(REPO, 'src'), join(root, 'src'), { recursive: true });
  await cp(join(REPO, 'data'), join(root, 'data'), { recursive: true });
  await edit(root);
  return root;
}

async function playUntil(t: TestApp, seed: number, tick: number) {
  const halo = await guest(t.url, 'Halo');
  const created = await api(t.url, '/api/matches', {
    token: halo.token,
    body: { name: 'Resumable', vsBot: true, seed },
  });
  const matchId: string = created.body.id;
  const socket = await connectSocket(t.url, halo.token);
  await ack(socket, 'match:join', { matchId });
  const first = waitFor(socket, 'match:started');
  await api(t.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
  await first;
  expect(
    await ack(socket, 'match:command', {
      matchId,
      seq: 0,
      cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 },
    }),
  ).toMatchObject({ accepted: true });
  await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= tick, 30_000);
  socket.close();
  return { halo, matchId };
}

const EVERY_20 = { MATCH_MAX_TICKS: '5000', CHECKPOINT_EVERY_TICKS: '20' };

describe('resuming matches across a change of rules', () => {
  it('continues from the newest checkpoint when nothing changed', async () => {
    const first = await createTestApp(EVERY_20);
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await playUntil(first, 11, 110);
      await first.shutdown();
      second = await createTestApp({ ...EVERY_20, JSON_DB_PATH: first.dbPath });
      await second.app.get(MatchRunnerService).resumed;
      await second.app.get(EventLog).flush();
      const events = await readLog(logPath(first, matchId));
      expect(events.find((e) => e.type === 'resumed')?.data).toMatchObject({ mode: 'checkpoint' });
      const socket = await connectSocket(second.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined).toMatchObject({ ok: true, nextSeq: 1 });
      expect(joined.snapshot.entities.some((e: { kind: number; team: number }) => e.kind === 2 && e.team === 0)).toBe(true);
      const stopped = await api(second.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      const record = await api(second.url, `/api/replays/${stopped.body.replayId}`, { token: halo.token });
      expect(record.body.reproducible, 'same rules, so the replay still verifies from the seed').toBeUndefined();
      const verify = await api(second.url, `/api/replays/${stopped.body.replayId}/verify`, { method: 'POST', token: halo.token });
      expect(verify.body).toMatchObject({ ok: true });
      socket.close();
    } finally {
      await second?.close();
      await first.close();
    }
  }, 90_000);

  for (const [what, edit] of [
    [
      'a data file',
      async (root: string) => {
        const path = join(root, 'data', 'balance.json');
        await writeFile(path, (await readFile(path, 'utf8')).replace('"costLux": 5,', '"costLux": 6,'));
      },
    ],
    [
      'the bot code',
      async (root: string) => {
        const path = join(root, 'src', 'bot', 'bot.js');
        await writeFile(path, `${await readFile(path, 'utf8')}\n// edited by the test\n`);
      },
    ],
  ] as const) {
    it(`keeps the match running after ${what} changed, and flags its replay`, async () => {
      const first = await createTestApp(EVERY_20);
      const root = await editedRules(edit);
      let second: TestApp | undefined;
      try {
        const { halo, matchId } = await playUntil(first, 12, 110);
        await first.shutdown();
        second = await createTestApp({ ...EVERY_20, JSON_DB_PATH: first.dbPath, LUXCORES_ROOT: root });
        await second.app.get(MatchRunnerService).resumed;
        await second.app.get(EventLog).flush();

        const events = await readLog(logPath(first, matchId));
        const started = events.find((e) => e.type === 'started');
        const resumed = events.find((e) => e.type === 'resumed');
        expect(resumed?.data).toMatchObject({ mode: 'checkpoint-changed' });
        const changed = what === 'a data file' ? 'dataHash' : 'codeHash';
        expect(resumed?.data[changed]).not.toEqual(started?.data[changed]);

        const socket = await connectSocket(second.url, halo.token);
        const joined = await ack(socket, 'match:join', { matchId });
        expect(joined).toMatchObject({ ok: true, status: 'running', nextSeq: 1 });
        expect(
          joined.snapshot.entities.some((e: { kind: number; team: number }) => e.kind === 2 && e.team === 0),
          'the human solar plant is still there',
        ).toBe(true);
        expect(
          await ack(socket, 'match:command', { matchId, seq: 1, cmd: { t: 'build', building: 'wind', tileX: 46, tileZ: 90 } }),
        ).toMatchObject({ accepted: true });
        await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= joined.snapshot.tick + 40, 30_000);

        const stopped = await api(second.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
        const record = await api(second.url, `/api/replays/${stopped.body.replayId}`, { token: halo.token });
        expect(record.body.reproducible).toBe(false);
        socket.close();
      } finally {
        await second?.close();
        await first.close();
        await rm(root, { recursive: true, force: true });
      }
    }, 120_000);
  }

  it('ends the match as a draw when the rules changed and it has no checkpoint', async () => {
    const first = await createTestApp({ MATCH_MAX_TICKS: '5000', CHECKPOINT_EVERY_TICKS: '0' });
    const root = await editedRules(async (r) => {
      const path = join(r, 'data', 'balance.json');
      await writeFile(path, (await readFile(path, 'utf8')).replace('"costLux": 5,', '"costLux": 6,'));
    });
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await playUntil(first, 13, 60);
      await first.shutdown();
      second = await createTestApp({ MATCH_MAX_TICKS: '5000', CHECKPOINT_EVERY_TICKS: '0', JSON_DB_PATH: first.dbPath, LUXCORES_ROOT: root });
      await second.app.get(MatchRunnerService).resumed;
      const match = await api(second.url, `/api/matches/${matchId}`, { token: halo.token });
      expect(match.body).toMatchObject({ status: 'finished', result: { draw: true, reason: 'stopped' } });
    } finally {
      await second?.close();
      await first.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});
