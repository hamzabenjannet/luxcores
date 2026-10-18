import { describe, expect, it } from 'vitest';
import { api, createTestApp } from './helpers/create-app.js';

/**
 * An undecided match ends as a draw at a tick limit. The data file sets the default
 * (`match.stalemateTicks`), and MATCH_MAX_TICKS overrides it for longer test runs.
 */
describe('the match tick limit', () => {
  it('defaults to the stalemate value in data/balance.json', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: null });
    try {
      const spec = await api(t.url, '/api/game/spec');
      expect(spec.body.matchMaxTicks).toBe(10_000);
    } finally {
      await t.close();
    }
  });

  it('takes MATCH_MAX_TICKS when it is set, so a test run can go on longer', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '25000' });
    try {
      const spec = await api(t.url, '/api/game/spec');
      expect(spec.body.matchMaxTicks).toBe(25_000);
    } finally {
      await t.close();
    }
  });
});
