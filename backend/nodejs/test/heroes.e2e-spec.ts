import { describe, expect, it } from 'vitest';
import {
  ack,
  api,
  connectSocket,
  createTestApp,
  guest,
  waitFor,
} from './helpers/create-app.js';

interface Entity {
  id: number;
  kind: number;
  team: number;
  owner: number;
  hp: number;
  heroType: number;
  shieldHp: number;
  cd3: number;
}
interface Snapshot {
  tick: number;
  entities: Entity[];
  orders: { type: number; owner: number; mix: number[] }[];
  players: { id: number; heroLock: number; heroCooldown: number }[];
}

describe('heroes over the socket', () => {
  it('lets a human pick a hero at a barracks, cast a shield on it, and see both in the snapshots', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '5000' });
    try {
      const halo = await guest(t.url, 'Halo');
      const created = await api(t.url, '/api/matches', { token: halo.token, body: { name: 'Hero', vsBot: true, seed: 12 } });
      const matchId: string = created.body.id;
      const socket = await connectSocket(t.url, halo.token);
      await ack(socket, 'match:join', { matchId });
      const started = waitFor(socket, 'match:started');
      await api(t.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
      await started;

      let seq = 0;
      const send = (cmd: unknown) => ack(socket, 'match:command', { matchId, seq: seq++, cmd });
      expect(await send({ t: 'build', building: 'barracks', tileX: 44, tileZ: 90 })).toMatchObject({ accepted: true });
      const withBarracks = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === 6 && e.team === 0));
      const barracks = withBarracks.entities.find((e) => e.kind === 6 && e.team === 0) as Entity;

      expect(await send({ t: 'pickHero', heroId: 1, lux: 30, barracksId: barracks.id })).toMatchObject({ accepted: true });
      const ordered = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.orders.some((o) => o.type === 2 && o.owner === 0));
      expect(ordered.orders.find((o) => o.type === 2 && o.owner === 0)?.mix).toEqual([1, 30]);

      const spawned = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === 10 && e.team === 0), 15_000);
      const hero = spawned.entities.find((e) => e.kind === 10 && e.team === 0) as Entity;
      expect(hero).toMatchObject({ heroType: 2, owner: 0 });
      expect(hero.hp).toBe(300_000);
      const me = spawned.players.find((p) => p.id === 0);
      expect(me).toMatchObject({ heroLock: 0b10, heroCooldown: 0 });

      expect(await send({ t: 'pickHero', heroId: 2, lux: 10, barracksId: barracks.id })).toMatchObject({ accepted: true });
      expect((await waitFor<Snapshot>(socket, 'match:snapshot', () => true)).orders.some((o) => o.type === 2 && o.owner === 0)).toBe(false);
      // The server accepts the envelope. The sim refused the command, because a hero is alive.

      expect(await send({ t: 'castAbility', slot: 3, targetId: hero.id })).toMatchObject({ accepted: true });
      const shielded = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => (s.entities.find((e) => e.id === hero.id)?.shieldHp ?? 0) > 0);
      const covered = shielded.entities.find((e) => e.id === hero.id) as Entity;
      expect(covered.shieldHp).toBe(150_000);
      expect(covered.cd3).toBeGreaterThan(0);
      socket.close();
    } finally {
      await t.close();
    }
  }, 60_000);
});
