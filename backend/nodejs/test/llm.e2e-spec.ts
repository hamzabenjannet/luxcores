import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ack, api, connectSocket, createTestApp, guest, waitFor } from './helpers/create-app.js';

interface Entity {
  id: number;
  kind: number;
  team: number;
}
interface Snapshot {
  tick: number;
  entities: Entity[];
}

/** `KIND.SOLAR` and `KIND.BARRACKS` of src/sim/state.js, which the spec endpoint also lists. */
const SOLAR = 2;

/**
 * An Ollama server for the test: it answers `/api/chat` with a plan that builds a
 * collector on the first free tile the observation offered, so the case needs no
 * model and no network. It also counts the questions the backend asked.
 */
async function stubOllama(): Promise<{ url: string; asked: () => number; close: () => Promise<void> }> {
  let asked = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
        return;
      }
      asked++;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        messages?: { role: string; content: string }[];
      };
      const last = body.messages?.at(-1)?.content ?? '';
      const observation = JSON.parse(/\{[\s\S]*\}/.exec(last)?.[0] ?? '{}') as {
        freeTiles?: { base?: number[][] };
      };
      const tile = observation.freeTiles?.base?.[0] ?? [48, 98];
      const content = JSON.stringify({ actions: [{ action: 'build', building: 'solar', tile }], note: 'economy first' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'qwen2.5:3b', message: { role: 'assistant', content } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    asked: () => asked,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('the bot a language model drives', () => {
  it('is offered by the spec endpoint with the defaults the clients prefill', async () => {
    const t = await createTestApp({ LLM_BOT: 'on' });
    try {
      const spec = await api(t.url, '/api/game/spec');
      expect(spec.body.llm).toMatchObject({
        available: true,
        defaultEndpoint: 'http://localhost:11434',
        defaultModel: 'qwen2.5:3b',
        allowedHosts: ['localhost', '127.0.0.1', '::1'],
      });
    } finally {
      await t.close();
    }
  });

  it('stays off until a match asks for it, and a server with LLM_BOT=off refuses', async () => {
    const t = await createTestApp({ LLM_BOT: 'off' });
    try {
      expect((await api(t.url, '/api/game/spec')).body.llm.available).toBe(false);
      const player = await guest(t.url, 'NoModel');
      const plain = await api(t.url, '/api/matches', { token: player.token, body: { name: 'Scripted bot', vsBot: true } });
      expect(plain.status).toBe(201);
      expect(plain.body.llm).toBeUndefined();
      const asked = await api(t.url, '/api/matches', {
        token: player.token,
        body: { name: 'Model bot', vsBot: true, llm: { endpoint: 'http://localhost:11434', model: 'qwen2.5:3b' } },
      });
      expect(asked.status).toBe(400);
      expect(JSON.stringify(asked.body)).toContain('LLM_BOT=on');
    } finally {
      await t.close();
    }
  });

  it('refuses a host the allowlist does not hold, a bad model name and a match with no bot', async () => {
    const t = await createTestApp({ LLM_BOT: 'on' });
    try {
      const player = await guest(t.url, 'Policy');
      const remote = await api(t.url, '/api/matches', {
        token: player.token,
        body: { name: 'Remote model', vsBot: true, llm: { endpoint: 'http://ollama.example.com:11434', model: 'qwen2.5:3b' } },
      });
      expect(remote.status).toBe(400);
      expect(JSON.stringify(remote.body)).toContain('LLM_ALLOWED_HOSTS');

      const badModel = await api(t.url, '/api/matches', {
        token: player.token,
        body: { name: 'Bad model', vsBot: true, llm: { endpoint: 'http://localhost:11434', model: 'not a model' } },
      });
      expect(badModel.status).toBe(400);

      const noBot = await api(t.url, '/api/matches', {
        token: player.token,
        body: { name: 'No bot', llm: { endpoint: 'http://localhost:11434', model: 'qwen2.5:3b' } },
      });
      expect(noBot.status).toBe(400);
      expect(JSON.stringify(noBot.body)).toContain('vsBot or botVsBot');
    } finally {
      await t.close();
    }
  });

  it('plays a match: the model builds through the sim, and the replay says it cannot be reproduced', async () => {
    const model = await stubOllama();
    const t = await createTestApp({ LLM_BOT: 'on', LLM_THINK_EVERY_TICKS: '10', MATCH_MAX_TICKS: '5000' });
    try {
      const player = await guest(t.url, 'ModelHost');
      const created = await api(t.url, '/api/matches', {
        token: player.token,
        body: { name: 'Model bot', botVsBot: true, seed: 4242, llm: { endpoint: `${model.url}/`, model: 'qwen2.5:3b' } },
      });
      expect(created.status).toBe(201);
      expect(created.body.llm).toEqual({ endpoint: model.url, model: 'qwen2.5:3b' });

      const matchId: string = created.body.id;
      const socket = await connectSocket(t.url, player.token);
      await ack(socket, 'match:join', { matchId });
      const started = waitFor(socket, 'match:started');
      await api(t.url, `/api/matches/${matchId}/start`, { method: 'POST', token: player.token });
      await started;

      // Team 1 is the side the model drives, and its first plan builds a collector.
      const withCollector = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === SOLAR && e.team === 1), 15_000);
      expect(withCollector.entities.some((e) => e.kind === SOLAR && e.team === 1)).toBe(true);
      expect(model.asked()).toBeGreaterThan(0);

      const ended = waitFor<{ replayId?: string }>(socket, 'match:ended');
      await api(t.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: player.token });
      const { replayId } = await ended;
      socket.close();

      const record = await api(t.url, `/api/replays/${replayId}`, { token: player.token });
      expect(record.body.reproducible, 'a model cannot be asked the same question twice').toBe(false);
      // The model's commands are in the replay like a human's.
      expect(record.body.replay.commands.some((c: { playerId: number; cmd: { t: string } }) => c.playerId === 1 && c.cmd.t === 'build')).toBe(true);
    } finally {
      await t.close();
      await model.close();
    }
  });
});
