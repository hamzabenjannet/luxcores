import { describe, expect, it } from 'vitest';
import { api, createTestApp } from './helpers/create-app.js';

describe('the test hub', () => {
  it('lists the pages, the ready-made links and the addresses of the server, and serves the page', async () => {
    const t = await createTestApp({ TEST_HUB: 'true' });
    try {
      const res = await api(t.url, '/api/dev/links');
      expect(res.status).toBe(200);
      expect(res.body.origins[0].url).toBe(t.url);
      expect(res.body.pages.map((p: { id: string }) => p.id)).toEqual(['game', 'determinism']);
      const game = res.body.pages[0];
      expect(game.params.map((p: { name: string }) => p.name)).toContain('maxTicks');
      expect(res.body.presets.length).toBeGreaterThan(5);
      expect(res.body.presets.some((p: { path: string }) => p.path === '/determinism.html?suite=1')).toBe(true);
      const titles = res.body.links.map((l: { title: string }) => l.title);
      expect(titles).toContain('API docs (Swagger)');
      expect(titles).toContain('bots-seed-777.json'); // the golden replays come from the directory

      const page = await fetch(`${t.url}/tests`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('src/client/test-hub.js');

      const docs = await api(t.url, '/api/docs-json');
      expect(Object.keys(docs.body.paths)).toContain('/api/dev/links');
      expect(docs.body.info.description).toContain('/tests');
    } finally {
      await t.close();
    }
  });

  it('answers 404 on both routes when TEST_HUB is off', async () => {
    const t = await createTestApp({ TEST_HUB: 'false' });
    try {
      expect((await api(t.url, '/api/dev/links')).status).toBe(404);
      expect((await fetch(`${t.url}/tests`)).status).toBe(404);
    } finally {
      await t.close();
    }
  });

  it('is off by default in production and on elsewhere', async () => {
    const { default: configuration } = await import('../src/config/configuration.js');
    const saved = { ...process.env };
    const hub = (env: Record<string, string>): boolean => {
      for (const key of ['NODE_ENV', 'JWT_SECRET', 'ADMIN_API_KEY', 'TEST_HUB']) delete process.env[key];
      Object.assign(process.env, env);
      return configuration().testHub;
    };
    try {
      const prod = { NODE_ENV: 'production', JWT_SECRET: 'x', ADMIN_API_KEY: 'y' };
      expect(hub(prod)).toBe(false);
      expect(hub({ ...prod, TEST_HUB: 'true' })).toBe(true);
      expect(hub({ NODE_ENV: 'development' })).toBe(true);
      expect(hub({})).toBe(true);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
