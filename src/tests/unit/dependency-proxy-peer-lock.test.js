import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url)));
const lock = JSON.parse(fs.readFileSync(new URL('../../../package-lock.json', import.meta.url)));

function resolve(packages, from, name) {
  let directory = from;
  while (true) {
    const candidate = path.posix.join(directory, 'node_modules', name);
    if (packages[candidate]) return candidate;
    if (!directory) return null;
    const parent = path.posix.dirname(directory);
    directory = parent === '.' ? '' : parent;
  }
}

function requiredClosure(packages, start) {
  const visited = new Set();
  function visit(location) {
    if (visited.has(location)) return;
    visited.add(location);
    assert.ok(packages[location], `Missing locked package: ${location}`);
    for (const name of Object.keys(packages[location].dependencies ?? {})) {
      const target = resolve(packages, location, name);
      assert.ok(target, `Missing required dependency ${name} from ${location}`);
      visit(target);
    }
  }
  visit(start);
  return visited;
}

test('browser proxy peer is explicitly development-only, not an optional subtree Dependabot can prune', () => {
  assert.equal(manifest.dependencies['proxy-agent'], undefined);
  assert.equal(manifest.devDependencies['proxy-agent'], '8.0.2');
  assert.equal(lock.packages[''].devDependencies['proxy-agent'], manifest.devDependencies['proxy-agent']);
  const provider = lock.packages['node_modules/proxy-agent'];
  assert.equal(provider.version, '8.0.2');
  assert.equal(provider.dev, true);
  assert.notEqual(provider.optional, true);
  assert.notEqual(provider.peer, true);
  const browsers = Object.entries(lock.packages).find(([location]) => location.endsWith('/@puppeteer/browsers'));
  assert.ok(browsers);
  assert.equal(browsers[1].peerDependencies['proxy-agent'], '>=8.0.1');
  assert.equal(browsers[1].peerDependenciesMeta['proxy-agent'].optional, true);
  assert.equal(resolve(lock.packages, browsers[0], 'proxy-agent'), 'node_modules/proxy-agent');
});

test('both browser proxy 8 and Lighthouse proxy 6 retain complete required dependency closures', () => {
  const browser = requiredClosure(lock.packages, 'node_modules/proxy-agent');
  const lighthouseProxy = resolve(lock.packages, 'node_modules/@lhci/cli', 'proxy-agent');
  assert.match(lock.packages[lighthouseProxy].version, /^6\./);
  const lighthouse = requiredClosure(lock.packages, lighthouseProxy);
  assert.ok(browser.size > 10);
  assert.ok(lighthouse.size > 10);
  assert.equal(lock.packages[lighthouseProxy].dev, true);
});

test('missing proxy transitive packages fail the closure check instead of silently dropping protection', () => {
  const packages = structuredClone(lock.packages);
  const agentBase = resolve(packages, 'node_modules/proxy-agent', 'agent-base');
  assert.equal(packages[agentBase].version, '9.0.0');
  // Remove every candidate so hoisting cannot hide the missing required edge.
  for (const location of Object.keys(packages)) if (location.endsWith('/agent-base')) delete packages[location];
  assert.throws(() => requiredClosure(packages, 'node_modules/proxy-agent'), /Missing required dependency agent-base/);
});
