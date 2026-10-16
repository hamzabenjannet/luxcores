import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '../src/database/data-store.js';
import { JsonFileStore } from '../src/database/json-file.store.js';

interface Thing extends Doc {
  label: string;
  group: string;
  createdAt: string;
}

const thing = (id: string, group: string, createdAt: string): Thing => ({
  id,
  label: `thing ${id}`,
  group,
  createdAt,
});

describe('JsonFileStore', () => {
  let dir: string;
  let path: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'luxcores-store-'));
    path = join(dir, 'nested', 'db.json');
    store = new JsonFileStore(path);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the file and its folder on the first start', async () => {
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({});
  });

  it('inserts, reads, updates and removes a document', async () => {
    await store.insert('things', thing('a', 'x', '2026-01-01'));
    expect(await store.get<Thing>('things', 'a')).toMatchObject({
      label: 'thing a',
    });

    const updated = await store.update<Thing>('things', 'a', {
      label: 'renamed',
    });
    expect(updated).toMatchObject({ id: 'a', label: 'renamed', group: 'x' });
    expect(
      await store.update<Thing>('things', 'missing', { label: 'no' }),
    ).toBeNull();

    expect(await store.remove('things', 'a')).toBe(true);
    expect(await store.remove('things', 'a')).toBe(false);
    expect(await store.get('things', 'a')).toBeNull();
  });

  it('refuses a duplicate id', async () => {
    await store.insert('things', thing('a', 'x', '2026-01-01'));
    await expect(
      store.insert('things', thing('a', 'y', '2026-01-02')),
    ).rejects.toThrow(/already exists/);
  });

  it('does not let a caller change stored data through a returned object', async () => {
    const stored = await store.insert('things', thing('a', 'x', '2026-01-01'));
    stored.label = 'tampered';
    expect((await store.get<Thing>('things', 'a'))?.label).toBe('thing a');
  });

  it('filters, sorts newest first by default and paginates', async () => {
    await store.insert('things', thing('a', 'x', '2026-01-01'));
    await store.insert('things', thing('b', 'y', '2026-01-02'));
    await store.insert('things', thing('c', 'x', '2026-01-03'));

    expect((await store.find<Thing>('things')).map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(
      (await store.find<Thing>('things', { group: 'x' })).map((t) => t.id),
    ).toEqual(['c', 'a']);
    expect(
      (
        await store.find<Thing>('things', undefined, {
          sortBy: 'createdAt',
          order: 'asc',
          limit: 2,
          offset: 1,
        })
      ).map((t) => t.id),
    ).toEqual(['b', 'c']);
    expect(await store.count<Thing>('things', { group: 'x' })).toBe(2);
    expect(await store.find('nothing')).toEqual([]);
  });

  it('survives a restart', async () => {
    await store.insert('things', thing('a', 'x', '2026-01-01'));
    await store.close();
    const again = new JsonFileStore(path);
    await again.init();
    expect(await again.get('things', 'a')).toMatchObject({ id: 'a' });
  });

  it('keeps every write when many run at once', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.insert(
          'things',
          thing(`id${i}`, 'x', `2026-01-${String(i + 1).padStart(2, '0')}`),
        ),
      ),
    );
    await store.close();
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as {
      things: Record<string, unknown>;
    };
    expect(Object.keys(onDisk.things)).toHaveLength(25);
  });

  it('reports a corrupt file instead of overwriting it', async () => {
    await writeFile(path, '{ not json', 'utf8');
    await expect(new JsonFileStore(path).init()).rejects.toThrow(
      /Cannot read the JSON database/,
    );
    expect(await readFile(path, 'utf8')).toBe('{ not json');
  });
});
