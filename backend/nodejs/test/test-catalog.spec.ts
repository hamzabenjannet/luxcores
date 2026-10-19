import { describe, expect, it } from 'vitest';
import { LINKS, PAGES, PRESETS } from '../src/testhub/test-catalog.js';

describe('the test hub catalog', () => {
  it('gives every page, preset and parameter a unique name', () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const page of PAGES) {
      expect(new Set(page.params.map((p) => p.name)).size, page.id).toBe(page.params.length);
    }
  });

  it('keeps every preset to the page and the parameters that page documents', () => {
    for (const preset of PRESETS) {
      const page = PAGES.find((p) => p.id === preset.page);
      expect(page, `${preset.id} names page ${preset.page}`).toBeDefined();
      const url = new URL(preset.path, 'http://x');
      expect(url.pathname, preset.id).toBe(page!.path);
      const known = new Set(page!.params.map((p) => p.name));
      for (const [key, value] of url.searchParams) {
        expect(known.has(key), `${preset.id} uses ${key}`).toBe(true);
        const param = page!.params.find((p) => p.name === key)!;
        if (param.kind === 'flag') expect(value, `${preset.id} ${key}`).toBe('1');
        if (param.kind === 'number') expect(value, `${preset.id} ${key}`).toMatch(/^\d+$/);
      }
    }
  });

  it('writes every path from the root', () => {
    for (const item of [...PAGES, ...PRESETS, ...LINKS]) expect(item.path.startsWith('/')).toBe(true);
  });
});
