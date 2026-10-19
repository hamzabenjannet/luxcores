import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, linkUrl } from '../src/client/test-hub-links.js';

const page = {
  path: '/',
  params: [
    { name: 'name', kind: 'text' },
    { name: 'vsBot', kind: 'flag' },
    { name: 'seed', kind: 'number' },
    { name: 'perf', kind: 'flag' },
  ],
};

test('a link carries only what was set, in the order the page lists', () => {
  assert.equal(buildUrl('http://10.0.0.5:3000', page, {}), 'http://10.0.0.5:3000/');
  assert.equal(buildUrl('http://10.0.0.5:3000', page, { perf: true, seed: '777', vsBot: true, name: 'Hala Ben' }), 'http://10.0.0.5:3000/?name=Hala%20Ben&vsBot=1&seed=777&perf=1');
});

test('an unticked flag, an empty text and a trailing slash on the origin leave no trace', () => {
  assert.equal(buildUrl('http://host:3000/', page, { vsBot: false, seed: '  ', name: '' }), 'http://host:3000/');
  assert.equal(linkUrl('http://host:3000/', { path: '/api/docs' }), 'http://host:3000/api/docs');
  assert.equal(linkUrl('http://host:3000', { path: '/determinism.html?suite=1' }), 'http://host:3000/determinism.html?suite=1');
});
