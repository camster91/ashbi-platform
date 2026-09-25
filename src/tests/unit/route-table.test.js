import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildApp } from '../../index.js';

const FIXTURE_URL = new URL('../fixtures/route-table.json', import.meta.url);

/**
 * Flatten Fastify's `printRoutes({ commonPrefix: false })` tree into sorted
 * "METHOD /url" entries. Each tree level is indented by four characters and
 * a child's URL is its ancestors' segments concatenated with its own.
 *
 * @param {string} tree
 * @returns {string[]}
 */
function flattenRouteTree(tree) {
  const stack = [];
  const routes = new Set();
  for (const line of tree.split('\n')) {
    const match = /^((?:│ {3}| {4})*)(?:├── |└── )(.*)$/.exec(line);
    if (!match) {
      assert.equal(line.trim(), '', `Unrecognized printRoutes line: ${line}`);
      continue;
    }
    const depth = match[1].length / 4;
    const label = match[2];
    const methods = /^(.*) \(([A-Z]+(?:, [A-Z]+)*)\)$/.exec(label);
    const segment = methods ? methods[1] : label;
    stack.length = depth;
    stack.push(segment);
    if (!methods) continue;
    // The root node's "/" is elided for top-level wildcards (e.g. "*").
    const joined = stack.join('');
    const url = joined.startsWith('/') ? joined : `/${joined}`;
    for (const method of methods[2].split(', ')) routes.add(`${method} ${url}`);
  }
  return [...routes].sort();
}

/**
 * Build the application without listening and return its sorted route table.
 *
 * @returns {Promise<string[]>}
 */
async function collectRouteTable() {
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  try {
    await app.ready();
    return flattenRouteTree(app.printRoutes({ commonPrefix: false }));
  } finally {
    await app.close();
  }
}

test('route tree flattening reconstructs nested URLs and methods', () => {
  const tree = [
    '├── /api/a (GET, HEAD)',
    '│   └── /b (POST)',
    '├── /api/c',
    '│   ├── d (DELETE)',
    '│   └── :id (PUT)',
    '├── /api/e (GET)',
    '└── * (OPTIONS)',
    '',
  ].join('\n');
  assert.deepEqual(flattenRouteTree(tree), [
    'DELETE /api/cd',
    'GET /api/a',
    'GET /api/e',
    'HEAD /api/a',
    'OPTIONS /*',
    'POST /api/a/b',
    'PUT /api/c:id',
  ]);
});

test('application route table matches the committed snapshot exactly', async () => {
  const actual = await collectRouteTable();
  if (process.env.UPDATE_ROUTE_TABLE === '1') {
    fs.writeFileSync(FIXTURE_URL, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const expected = JSON.parse(fs.readFileSync(FIXTURE_URL, 'utf8'));
  const added = actual.filter((route) => !expected.includes(route));
  const removed = expected.filter((route) => !actual.includes(route));
  assert.deepEqual({ added, removed }, { added: [], removed: [] });
  assert.deepEqual(actual, expected);
});

test('every snapshotted route resolves through the router', async () => {
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  try {
    await app.ready();
    const expected = JSON.parse(fs.readFileSync(FIXTURE_URL, 'utf8'));
    for (const entry of expected) {
      const [method, url] = entry.split(' ');
      assert.ok(app.hasRoute({ method, url }), `missing route ${entry}`);
    }
  } finally {
    await app.close();
  }
});
