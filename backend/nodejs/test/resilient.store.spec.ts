import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DatabaseDriver,
  type Doc,
  type FindOptions,
  DataStore,
} from '../src/database/data-store.js';
import { JsonFileStore } from '../src/database/json-file.store.js';
import { isUnavailable, ResilientStore } from '../src/database/resilient.store.js';

interface Item extends Doc {
  label: string;
}

const unreachable = () => Object.assign(new Error('Server selection timed out'), { name: 'MongoServerSelectionError' });

/** A main database that lives in a JSON file of its own and can be switched off, as a Mongo container can. */
class FakeMain extends DataStore {
  readonly driver: DatabaseDriver = 'mongodb';
  down = false;
  initFails = false;
  calls = 0;
  constructor(readonly inner: JsonFileStore) {
    super();
  }
  private ok(): void {
    this.calls++;
    if (this.down) throw unreachable();
  }
  async init() {
    if (this.initFails) throw unreachable();
    await this.inner.init();
  }
  async find<T extends Doc>(c: string, w?: Partial<T>, o?: FindOptions) {
    this.ok();
    return this.inner.find<T>(c, w, o);
  }
  async count<T extends Doc>(c: string, w?: Partial<T>) {
    this.ok();
    return this.inner.count<T>(c, w);
  }
  async get<T extends Doc>(c: string, id: string) {
    this.ok();
    return this.inner.get<T>(c, id);
  }
  async insert<T extends Doc>(c: string, d: T) {
    this.ok();
    return this.inner.insert<T>(c, d);
  }
  async update<T extends Doc>(c: string, id: string, p: Partial<T>) {
    this.ok();
    return this.inner.update<T>(c, id, p);
  }
  async remove(c: string, id: string) {
    this.ok();
    return this.inner.remove(c, id);
  }
  async close() {
    await this.inner.close();
  }
}

describe('ResilientStore', () => {
  let dir: string;
  let mainFile: JsonFileStore;
  let main: FakeMain;

  /** `null` opens the store with no main database, as when the server cannot reach it at start-up. */
  const open = async (primary: FakeMain | null = main, reason?: string) => {
    const store = new ResilientStore(primary ?? undefined, new JsonFileStore(join(dir, 'fallback.json')), {
      configured: 'mongodb',
      unavailableReason: reason,
    });
    await store.init();
    return store;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'luxcores-resilient-'));
    mainFile = new JsonFileStore(join(dir, 'main.json'));
    main = new FakeMain(mainFile);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('uses the main database while it works, and reports it', async () => {
    const store = await open();
    await store.insert('players', { id: 'a', label: 'first' } as Item);
    expect(await mainFile.get('players', 'a')).toMatchObject({ label: 'first' });
    expect(store.status()).toEqual({ configured: 'mongodb', active: 'mongodb', degraded: false });
    await store.close();
  });

  it('runs on the JSON file for the whole run when the main database is unreachable at start-up', async () => {
    const store = await open(null, 'unreachable at start-up');
    await store.insert('players', { id: 'a', label: 'first' } as Item);
    expect(await store.get<Item>('players', 'a')).toMatchObject({ label: 'first' });
    expect(store.status()).toMatchObject({ active: 'json', degraded: true, reason: 'unreachable at start-up' });
    await store.close();
  });

  it('falls back when the main database fails its start-up', async () => {
    main.initFails = true;
    const store = await open();
    expect(store.status()).toMatchObject({ active: 'json', degraded: true });
    await store.insert('matches', { id: 'm', label: 'x' } as Item);
    expect(main.calls, 'the main database is left alone').toBe(0);
    await store.close();
  });

  it('keeps players and matches on the file while the main database works, so a fallback finds them', async () => {
    const store = await open();
    await store.insert('players', { id: 'p', label: 'one' } as Item);
    await store.insert('matches', { id: 'm', label: 'two' } as Item);
    await store.insert('replays', { id: 'r', label: 'three' } as Item);
    await store.update('players', 'p', { label: 'renamed' } as Partial<Item>);
    main.down = true;
    expect(await store.get<Item>('players', 'p')).toMatchObject({ label: 'renamed' });
    expect(await store.get<Item>('matches', 'm')).toMatchObject({ label: 'two' });
    expect(await store.get('replays', 'r'), 'replays are too big to mirror').toBeNull();
    await store.close();
  });

  it('switches to the file when the main database fails during the run, finishes the call there and stays', async () => {
    const store = await open();
    await store.insert('matches', { id: 'm', label: 'before' } as Item);
    main.down = true;
    const updated = await store.update<Item>('matches', 'm', { label: 'after' });
    expect(updated).toMatchObject({ label: 'after' });
    expect(store.status()).toMatchObject({ active: 'json', degraded: true });
    main.down = false; // the database comes back, but the run stays on the file
    const calls = main.calls;
    await store.insert('players', { id: 'q', label: 'late' } as Item);
    expect(main.calls).toBe(calls);
    expect(await mainFile.get('players', 'q')).toBeNull();
    await store.close();
  });

  it('passes an error of the request on, without falling back', async () => {
    const store = await open();
    await store.insert('players', { id: 'a', label: 'x' } as Item);
    await expect(store.insert('players', { id: 'a', label: 'again' } as Item)).rejects.toThrow(/already exists/);
    expect(store.status().degraded).toBe(false);
    await store.close();
  });

  it('copies what a fallback run changed to the main database at the next start', async () => {
    const first = await open(null, 'down');
    await first.insert('players', { id: 'new', label: 'made offline' } as Item);
    await first.insert('players', { id: 'gone', label: 'removed offline' } as Item);
    await first.close();

    await mainFile.init();
    await mainFile.insert('players', { id: 'gone', label: 'old' } as Item);
    await mainFile.insert('players', { id: 'kept', label: 'untouched' } as Item);
    const second = await open(main);
    expect(second.status().degraded).toBe(false);
    expect(await mainFile.get('players', 'new')).toMatchObject({ label: 'made offline' });
    expect(await mainFile.get('players', 'kept')).toMatchObject({ label: 'untouched' });
    await second.close();
  });

  it('applies a removal from the fallback run too, and only once', async () => {
    const first = await open(null, 'down');
    await first.insert('players', { id: 'x', label: 'a' } as Item);
    expect(await first.remove('players', 'x')).toBe(true);
    await first.close();
    await mainFile.init();
    await mainFile.insert('players', { id: 'x', label: 'in main' } as Item);
    const second = await open(main);
    expect(await mainFile.get('players', 'x')).toBeNull();
    await second.close();
    const calls = main.calls;
    const third = await open(main);
    expect(main.calls - calls, 'nothing is copied again').toBeLessThan(5);
    await third.close();
  });

  it('fills an empty main database from the JSON file the first time it is used', async () => {
    const file = new JsonFileStore(join(dir, 'fallback.json'));
    await file.init();
    await file.insert('players', { id: 'old', label: 'from the file era' } as Item);
    await file.insert('replays', { id: 'r', label: 'replay' } as Item);
    await file.close();
    const store = await open();
    expect(await mainFile.get('players', 'old')).toMatchObject({ label: 'from the file era' });
    expect(await mainFile.get('replays', 'r')).toMatchObject({ label: 'replay' });
    await store.close();
  });

  it('does not overwrite a filled main database with the file', async () => {
    const file = new JsonFileStore(join(dir, 'fallback.json'));
    await file.init();
    await file.insert('players', { id: 'stale', label: 'old copy' } as Item);
    await file.close();
    await mainFile.init();
    await mainFile.insert('players', { id: 'real', label: 'live' } as Item);
    const store = await open();
    expect(await mainFile.get('players', 'stale')).toBeNull();
    await store.close();
  });

  it('serves a plain JSON setup without any copy or note', async () => {
    const store = new ResilientStore(undefined, new JsonFileStore(join(dir, 'only.json')), { configured: 'json' });
    await store.init();
    await store.insert('players', { id: 'a', label: 'x' } as Item);
    expect(store.status()).toMatchObject({ configured: 'json', active: 'json', degraded: false });
    await store.close();
  });
});

describe('isUnavailable', () => {
  it.each([
    [Object.assign(new Error('x'), { name: 'MongoNetworkError' }), true],
    [Object.assign(new Error('x'), { name: 'MongoServerSelectionError' }), true],
    [Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), true],
    [Object.assign(new Error('terminating'), { code: '57P01' }), true],
    [new Error('Connection terminated unexpectedly'), true],
    [new Error('Client was closed'), true],
    [Object.assign(new Error('duplicate key'), { name: 'MongoServerError', code: 11000 }), false],
    [Object.assign(new Error('duplicate key value'), { code: '23505' }), false],
    [new Error('items/a already exists'), false],
    [undefined, false],
  ])('classifies %s', (err, expected) => {
    expect(isUnavailable(err)).toBe(expected);
  });
});
