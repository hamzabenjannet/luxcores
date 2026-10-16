import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import WebSocket from 'ws';
import { AppModule } from '../../src/app.module.js';
import {
  configureApp,
  setupSwagger,
  startRabbitConsumer,
} from '../../src/app.setup.js';

export interface TestApp {
  app: INestApplication;
  /** `http://127.0.0.1:<port>` */
  url: string;
  dbPath: string;
  /** Closes the app the way a SIGTERM does, and keeps the database file for inspection. */
  shutdown(): Promise<void>;
  /** Shuts down if needed, restores the environment and deletes the database. */
  close(): Promise<void>;
}

/**
 * Boots the whole app on a random port with a throwaway JSON database. `env`
 * overrides the defaults below; they apply before the config module reads them.
 */
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<TestApp> {
  const dir = await mkdtemp(join(tmpdir(), 'luxcores-backend-'));
  const dbPath = join(dir, 'db.json');
  const settings: Record<string, string> = {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-with-enough-length',
    ADMIN_API_KEY: 'test-admin-key-with-enough-length',
    DATABASE_DRIVER: 'json',
    JSON_DB_PATH: dbPath,
    RABBITMQ_URL: '',
    MATCH_MAX_TICKS: '60',
    RATE_LIMIT_PER_MINUTE: '100000', // tests make many requests from one address
    RATE_LIMIT_AUTH_PER_MINUTE: '100000',
    ...env,
  };
  const saved = new Map(Object.keys(settings).map((k) => [k, process.env[k]]));
  Object.assign(process.env, settings);

  // NestFactory, not Test.createTestingModule: ServeStaticModule needs the HTTP adapter
  // to exist while the providers are built, and the testing module creates it too late.
  const app = await NestFactory.create(AppModule, {
    logger: process.env.TEST_LOGS ? undefined : ['error', 'warn'], // TEST_LOGS=1 shows every Nest log line
  });
  configureApp(app);
  setupSwagger(app);
  await startRabbitConsumer(app); // does nothing unless RABBITMQ_URL is set
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await app.close();
  };

  return {
    app,
    url: `http://127.0.0.1:${port}`,
    dbPath,
    shutdown,
    async close() {
      await shutdown();
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface Session {
  token: string;
  player: { id: string; name: string };
}

/** Signs in as a new guest. */
export async function guest(url: string, name: string): Promise<Session> {
  const res = await fetch(`${url}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201)
    throw new Error(`guest login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    accessToken: string;
    player: Session['player'];
  };
  return { token: body.accessToken, player: body.player };
}

/** JSON request with an optional bearer token. */
export async function api<T = any>(
  url: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${url}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}

/** Connects to the `/game` namespace and resolves once the handshake succeeds. */
export function connectSocket(url: string, token?: string): Promise<Socket> {
  const socket = io(`${url}/game`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

/** Resolves with the first `event` payload that passes `accept`. */
export function waitFor<T = any>(
  socket: Socket,
  event: string,
  accept: (payload: T) => boolean = () => true,
  ms = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    const handler = (payload: T) => {
      if (!accept(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Emits an event and waits for its ack. */
export function ack<T = any>(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<T> {
  return socket.timeout(5000).emitWithAck(event, payload) as Promise<T>;
}

/** A frame of the plain WebSocket protocol. */
export interface WsFrame {
  event: string;
  data?: any;
  id?: number;
}

/** Plain WebSocket client with request/ack helpers. */
export class RawClient {
  readonly frames: WsFrame[] = [];
  private nextId = 1;
  private waiters: {
    accept: (f: WsFrame) => boolean;
    resolve: (f: WsFrame) => void;
  }[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as WsFrame;
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (!w.accept(frame)) return true;
        w.resolve(frame);
        return false;
      });
    });
  }

  /** Sends a request and resolves with the data of its ack. */
  async request<T = any>(event: string, data?: unknown): Promise<T> {
    const id = this.nextId++;
    const reply = this.next((f) => f.event === 'ack' && f.id === id);
    this.ws.send(JSON.stringify({ event, data, id }));
    return (await reply).data as T;
  }

  /** Resolves with the first frame (past or future) that passes `accept`. */
  next(accept: (f: WsFrame) => boolean, ms = 15_000): Promise<WsFrame> {
    const seen = this.frames.find(accept);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for a frame')),
        ms,
      );
      this.waiters.push({
        accept,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  /** Resolves with the close code. */
  closed(): Promise<number> {
    return new Promise((resolve) =>
      this.ws.once('close', (code) => resolve(code)),
    );
  }
}

/** Connects to `/ws`. Resolves once open; rejects with the HTTP status when the upgrade is refused. */
export function connectRaw(
  url: string,
  options: { token?: string; query?: boolean } = {},
): Promise<RawClient> {
  const wsUrl = `${url.replace('http', 'ws')}/ws${options.token && options.query ? `?token=${options.token}` : ''}`;
  const ws = new WebSocket(wsUrl, {
    headers:
      options.token && !options.query
        ? { authorization: `Bearer ${options.token}` }
        : {},
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(new RawClient(ws)));
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`HTTP ${res.statusCode}`)),
    );
    ws.once('error', (err) => reject(err));
  });
}
