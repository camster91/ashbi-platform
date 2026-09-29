import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
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
import { buildApp } from '../../index.js';

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

test('setHeaders works with a raw Node ServerResponse as well as a Fastify reply', () => {
  const root = builtSpa();
  const { setHeaders } = spaStaticOptions(root);
  // Older @fastify/static majors pass the raw ServerResponse, which has
  // setHeader() but no header(); the callback must not throw there.
  const raw = new http.ServerResponse(new http.IncomingMessage(new net.Socket()));
  setHeaders(raw, path.join(root, 'assets', 'index-4f9a1c2b.js'));
  assert.equal(raw.getHeader('cache-control'), IMMUTABLE_ASSET_CACHE);
  const headers = {};
  setHeaders({ header: (name, value) => { headers[name] = value; } }, path.join(root, 'index.html'));
  assert.deepEqual(headers, { 'Cache-Control': REVALIDATE_CACHE });
});

test('the real API factory serves the built SPA with the cache policy (production path)', async () => {
  const app = await buildApp({
    initializeRuntime: false,
    jwtSecret: 'test-only-jwt-secret',
    serveBuiltSpa: true,
    spaRoot: builtSpa(),
  });
  try {
    const cases = [
      ['/', REVALIDATE_CACHE, /<div id="root">/],
      ['/assets/index-4f9a1c2b.js', IMMUTABLE_ASSET_CACHE, /console\.log/],
      ['/projects/abc?tab=files', REVALIDATE_CACHE, /<div id="root">/],
      ['/sw.js', REVALIDATE_CACHE, /addEventListener/],
    ];
    for (const [url, cache, body] of cases) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200, `${url}: ${response.body.slice(0, 200)}`);
      assert.equal(response.headers['cache-control'], cache, url);
      assert.match(response.body, body, url);
    }
    const missingApi = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' });
    assert.notEqual(missingApi.statusCode, 200);
    assert.doesNotMatch(missingApi.body, /<div id="root">/, 'unknown API routes never fall back to the SPA');
  } finally {
    await app.close();
  }
});
