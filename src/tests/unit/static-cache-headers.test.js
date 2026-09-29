import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import {
  IMMUTABLE_ASSET_CACHE,
  REVALIDATE_CACHE,
  SHORT_PUBLIC_CACHE,
  spaStaticOptions,
} from '../../config/static-cache.js';

function builtSpa() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dist-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(root, 'assets', 'index-4f9a1c2b.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'assets', 'index-8d2e.css'), 'body{}');
  fs.writeFileSync(path.join(root, 'sw.js'), 'self.addEventListener("fetch",()=>{})');
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(root, 'icon-192.png'), 'png');
  return root;
}

test('hashed assets are immutable; the SPA shell, service worker and manifest revalidate', async () => {
  const app = Fastify();
  // Mirrors src/index.js: static plugin plus the SPA fallback to index.html.
  await app.register(fastifyStatic, spaStaticOptions(builtSpa()));
  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.status(404).send({ error: 'Not found' });
  });
  try {
    const cases = [
      ['/assets/index-4f9a1c2b.js', IMMUTABLE_ASSET_CACHE],
      ['/assets/index-8d2e.css', IMMUTABLE_ASSET_CACHE],
      ['/', REVALIDATE_CACHE],
      ['/index.html', REVALIDATE_CACHE],
      ['/dashboard/projects/abc', REVALIDATE_CACHE],
      ['/sw.js', REVALIDATE_CACHE],
      ['/manifest.json', REVALIDATE_CACHE],
      ['/icon-192.png', SHORT_PUBLIC_CACHE],
    ];
    for (const [url, expected] of cases) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200, url);
      assert.equal(response.headers['cache-control'], expected, url);
    }
    assert.equal(IMMUTABLE_ASSET_CACHE, 'public, max-age=31536000, immutable');
  } finally {
    await app.close();
  }
});

test('the API factory registers the SPA with the cache policy', () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.match(factory, /register\(fastifyStatic, spaStaticOptions\(/);
});
