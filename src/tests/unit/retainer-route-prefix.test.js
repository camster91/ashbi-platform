import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('retainer routes mount at the API path consumed by the UI', async () => {
  const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');

  assert.match(source, /register\(retainerRoutes, \{ prefix: '\/api' \}\)/);
  assert.doesNotMatch(source, /register\(retainerRoutes, \{ prefix: '\/api\/retainers' \}\)/);
});
