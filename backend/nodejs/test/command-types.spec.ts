import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { COMMAND_TYPES } from '../src/game/command-types.js';

it('lists exactly the command types that src/sim/commands.js defines', async () => {
  const source = await readFile(resolve('../../src/sim/commands.js'), 'utf8');
  const start = source.indexOf("{t:'build'");
  const typedef = source.slice(start, source.indexOf('} Command\n', start));
  const inSim = [...typedef.matchAll(/\{t:'(\w+)'/g)].map((m) => m[1]).sort();
  expect(inSim.length).toBeGreaterThan(10);
  expect([...COMMAND_TYPES].sort()).toEqual(inSim);
});
