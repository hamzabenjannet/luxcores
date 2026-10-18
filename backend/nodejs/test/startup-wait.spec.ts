import { describe, expect, it } from 'vitest';
import { withinWindow } from '../src/common/startup-wait.js';

describe('withinWindow', () => {
  it('returns at once when the first try works', async () => {
    let tries = 0;
    expect(await withinWindow(async () => ++tries, 1000)).toBe(1);
  });

  it('keeps trying until a service that starts late answers', async () => {
    const readyAt = Date.now() + 300;
    let tries = 0;
    const result = await withinWindow(
      async () => {
        tries++;
        if (Date.now() < readyAt) throw new Error('not yet');
        return 'up';
      },
      2000,
      50,
    );
    expect(result).toBe('up');
    expect(tries).toBeGreaterThan(2);
  });

  it('gives up with the last error once the window has passed', async () => {
    const started = Date.now();
    await expect(
      withinWindow(
        async () => {
          throw new Error('still down');
        },
        300,
        50,
      ),
    ).rejects.toThrow('still down');
    expect(Date.now() - started).toBeLessThan(700);
  });

  it('tries exactly once with a window of zero', async () => {
    let tries = 0;
    await expect(
      withinWindow(async () => {
        tries++;
        throw new Error('down');
      }, 0),
    ).rejects.toThrow('down');
    expect(tries).toBe(1);
  });
});
