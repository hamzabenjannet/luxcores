import { readFileSync } from 'node:fs';

/** Version from `package.json`, which sits two folders above `src/` and `dist/`. */
export const APP_VERSION: string = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;
