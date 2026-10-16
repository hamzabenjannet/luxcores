import { Logger } from '@nestjs/common';
import pg from 'pg';
import { type Doc, type FindOptions, DataStore } from './data-store.js';

/**
 * PostgreSQL adapter. Every collection lives in one `documents` table with a
 * `jsonb` payload, so adding a field to an entity needs no migration.
 * Equality filters use jsonb containment (`data @> $2`).
 */
export class PostgresStore extends DataStore {
  private readonly logger = new Logger(PostgresStore.name);
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new pg.Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        collection text NOT NULL,
        id         text NOT NULL,
        data       jsonb NOT NULL,
        PRIMARY KEY (collection, id)
      )`);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS documents_created_at ON documents (collection, (data->>'createdAt'))`,
    );
    this.logger.log('PostgreSQL connected');
  }

  async find<T extends Doc>(
    collection: string,
    where?: Partial<T>,
    options: FindOptions = {},
  ): Promise<T[]> {
    const {
      limit = null,
      offset = 0,
      sortBy = 'createdAt',
      order = 'desc',
    } = options;
    const direction = order === 'asc' ? 'ASC' : 'DESC'; // a fixed word, never user input
    const { rows } = await this.pool.query(
      `SELECT data FROM documents
        WHERE collection = $1 AND data @> $2::jsonb
        ORDER BY data->>$3 ${direction}, id
        LIMIT $4 OFFSET $5`,
      [collection, JSON.stringify(where ?? {}), sortBy, limit, offset],
    );
    return rows.map((row) => row.data as T);
  }

  async count<T extends Doc>(
    collection: string,
    where?: Partial<T>,
  ): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM documents WHERE collection = $1 AND data @> $2::jsonb',
      [collection, JSON.stringify(where ?? {})],
    );
    return rows[0].n as number;
  }

  async get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    const { rows } = await this.pool.query(
      'SELECT data FROM documents WHERE collection = $1 AND id = $2',
      [collection, id],
    );
    return rows[0] ? (rows[0].data as T) : null;
  }

  async insert<T extends Doc>(collection: string, doc: T): Promise<T> {
    await this.pool.query(
      'INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3::jsonb)',
      [collection, doc.id, JSON.stringify(doc)],
    );
    return doc;
  }

  async update<T extends Doc>(
    collection: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null> {
    const { rows } = await this.pool.query(
      `UPDATE documents SET data = data || $3::jsonb
        WHERE collection = $1 AND id = $2 RETURNING data`,
      [collection, id, JSON.stringify({ ...patch, id })],
    );
    return rows[0] ? (rows[0].data as T) : null;
  }

  async remove(collection: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM documents WHERE collection = $1 AND id = $2',
      [collection, id],
    );
    return result.rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
