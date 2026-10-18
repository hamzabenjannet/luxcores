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
  speedMod: number;
  speedTicks: number;
}
interface Snapshot {
  tick: number;
  entities: Entity[];
  orders: { type: number; owner: number; mix: number[]; held: number }[];
  players: { id: number; funnelLux: number; items: number[] }[];
}

describe('items over the socket', () => {
  it('lets a human buy an item at a barracks, receive it with the hero and use it, and see the inventory in the snapshots', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    try {
      const player = await guest(t.url, 'Haste');
      const created = await api(t.url, '/api/matches', { token: player.token, body: { name: 'Items', vsBot: true, seed: 12 } });
      const matchId: string = created.body.id;
      const socket = await connectSocket(t.url, player.token);
      await ack(socket, 'match:join', { matchId });
      const started = waitFor(socket, 'match:started');
      await api(t.url, `/api/matches/${matchId}/start`, { method: 'POST', token: player.token });
      await started;

      let seq = 0;
      const send = (cmd: unknown) => ack(socket, 'match:command', { matchId, seq: seq++, cmd });
      expect(await send({ t: 'build', building: 'barracks', tileX: 44, tileZ: 90 })).toMatchObject({ accepted: true });
      const withBarracks = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === 6 && e.team === 0));
      const barracks = withBarracks.entities.find((e) => e.kind === 6 && e.team === 0) as Entity;

      // An item bought before the hero exists waits in the barracks.
      expect(await send({ t: 'orderItem', barracksId: barracks.id, itemId: 2 })).toMatchObject({ accepted: true });
      const queued = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.orders.some((o) => o.type === 3 && o.owner === 0));
      expect(queued.orders.find((o) => o.type === 3 && o.owner === 0)?.mix).toEqual([2]);
      const held = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.orders.some((o) => o.type === 3 && o.held === 1), 10_000);
      expect(held.players.find((p) => p.id === 0)?.items).toEqual([0, 0, 0, 0]);

      expect(await send({ t: 'pickHero', heroId: 1, lux: 10, barracksId: barracks.id })).toMatchObject({ accepted: true });
      const delivered = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => (s.players.find((p) => p.id === 0)?.items[2] ?? 0) === 1, 20_000);
      expect(delivered.orders.some((o) => o.type === 3 && o.owner === 0)).toBe(false);

      expect(await send({ t: 'useItem', inventorySlot: 2 })).toMatchObject({ accepted: true });
      const hasted = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === 10 && e.owner === 0 && e.speedMod === 300));
      expect(hasted.players.find((p) => p.id === 0)?.items[2]).toBe(0);
      socket.close();
    } finally {
      await t.close();
    }
  }, 60_000);
});
