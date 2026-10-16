import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataStore, Doc } from '../src/database/data-store.js';
import { JsonFileStore } from '../src/database/json-file.store.js';

/**
 * The same assertions run against every storage adapter, so a service behaves
 * the same on a JSON file, MongoDB and PostgreSQL.
 *
 * The JSON adapter always runs. MongoDB and PostgreSQL run when a URL is set:
 *   TEST_MONGODB_URL=mongodb://localhost:27017
 *   TEST_POSTGRES_URL=postgres://user:pass@localhost:5432/db
 */
interface Item extends Doc {
  label: string;
  group: string;
  createdAt: string;
  n: number;
}

const item = (id: string, group: string, day: number, n = day): Item => ({
  id,
  label: `item ${id}`,
  group,
  createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  n,
});

function contract(
  name: string,
  make: () => Promise<{ store: DataStore; cleanup: () => Promise<void> }>,
  skip = false,
) {
  describe.skipIf(skip)(`DataStore contract: ${name}`, () => {
    let store: DataStore;
    let cleanup: () => Promise<void>;
    const col = `items_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    beforeAll(async () => {
      ({ store, cleanup } = await make());
    });

    afterAll(async () => {
      await cleanup();
    });

    it('stores and reads a document, and reports a missing one as null', async () => {
      await store.insert(col, item('a', 'x', 1));
      expect(await store.get<Item>(col, 'a')).toEqual(item('a', 'x', 1));
      expect(await store.get(col, 'missing')).toBeNull();
    });

    it('rejects a duplicate id', async () => {
      await expect(store.insert(col, item('a', 'y', 2))).rejects.toThrow();
    });

    it('merges an update, keeps the id and reports an unknown id as null', async () => {
      const updated = await store.update<Item>(col, 'a', {
        label: 'renamed',
        n: 99,
      });
      expect(updated).toEqual({
        ...item('a', 'x', 1),
        label: 'renamed',
        n: 99,
      });
      expect(await store.get<Item>(col, 'a')).toEqual(updated);
      expect(
        await store.update<Item>(col, 'missing', { label: 'no' }),
      ).toBeNull();
    });

    it('filters, sorts, paginates and counts', async () => {
      await store.insert(col, item('b', 'y', 2));
      await store.insert(col, item('c', 'x', 3));
      await store.insert(col, item('d', 'y', 4));

      expect((await store.find<Item>(col)).map((d) => d.id)).toEqual([
        'd',
        'c',
        'b',
        'a',
      ]); // newest first
      expect(
        (await store.find<Item>(col, undefined, { order: 'asc' })).map(
          (d) => d.id,
        ),
      ).toEqual(['a', 'b', 'c', 'd']);
      expect(
        (await store.find<Item>(col, { group: 'x' })).map((d) => d.id),
      ).toEqual(['c', 'a']);
      expect(
        (await store.find<Item>(col, { group: 'y', n: 4 })).map((d) => d.id),
      ).toEqual(['d']);
      expect(
        (await store.find<Item>(col, { id: 'b' })).map((d) => d.id),
      ).toEqual(['b']);
      expect(
        (
          await store.find<Item>(col, undefined, {
            order: 'asc',
            limit: 2,
            offset: 1,
          })
        ).map((d) => d.id),
      ).toEqual(['b', 'c']);
      expect(await store.count<Item>(col)).toBe(4);
      expect(await store.count<Item>(col, { group: 'y' })).toBe(2);
      expect(await store.find<Item>(col, { group: 'none' })).toEqual([]);
    });

    it('stores nested objects and arrays untouched', async () => {
      const nested = {
        id: 'n',
        createdAt: '2026-02-01T00:00:00.000Z',
        players: [{ name: 'Halo', team: 0 }],
        result: { winnerTeam: null, draw: true },
      };
      await store.insert(col, nested as unknown as Item);
      expect(await store.get(col, 'n')).toEqual(nested);
    });

    it('removes a document once', async () => {
      expect(await store.remove(col, 'd')).toBe(true);
      expect(await store.remove(col, 'd')).toBe(false);
      expect(await store.get(col, 'd')).toBeNull();
    });
  });
}

contract('json file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxcores-contract-'));
  const store = new JsonFileStore(join(dir, 'db.json'));
  await store.init();
  return {
    store,
    cleanup: async () => (
      await store.close(),
      rm(dir, { recursive: true, force: true })
    ),
  };
});

contract(
  'mongodb',
  async () => {
    const { MongoStore } = await import('../src/database/mongo.store.js');
    const store = new MongoStore(
      process.env.TEST_MONGODB_URL as string,
      `luxcores_test_${Date.now()}`,
    );
    await store.init();
    return { store, cleanup: () => store.close() };
  },
  !process.env.TEST_MONGODB_URL,
);

contract(
  'postgres',
  async () => {
    const { PostgresStore } = await import('../src/database/postgres.store.js');
    const store = new PostgresStore(process.env.TEST_POSTGRES_URL as string);
    await store.init();
    return { store, cleanup: () => store.close() };
  },
  !process.env.TEST_POSTGRES_URL,
);
