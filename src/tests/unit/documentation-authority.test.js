import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('README points setup and production operations at authoritative paths', () => {
  const readme = read('README.md');
  assert.match(readme, /PostgreSQL 16 with pgvector/);
  assert.match(readme, /Redis 7\+/);
  assert.match(readme, /prisma migrate deploy/);
  assert.match(readme, /dev:worker/);
  assert.match(readme, /docs\/deployment-and-rollback\.md/);
  assert.match(readme, /docs\/backup-and-restore\.md/);
  assert.doesNotMatch(readme, /docker-compose up -d/);
  assert.doesNotMatch(readme, /Deploy.*Coolify/);
});

test('historical plans carry an explicit superseded or historical warning', () => {
  for (const path of ['PRODUCT_ROADMAP.md', 'PRODUCTION_DEPLOYMENT.md', 'SECURITY_CHECKLIST.md', 'UX_UI_IMPROVEMENT_PLAN.md', 'spec.md', 'features-research.md', 'AGENT_DEPLOYMENT.md', 'INTEGRATIONS.md']) {
    assert.match(read(path).slice(0, 1_500), /Superseded|Historical checklist/, `${path} lacks an early warning`);
  }
});

test('canonical product status links every open product and external gate', () => {
  const status = read('docs/product-status.md');
  for (const issue of [108, 111, 118, 280, 282, 283, 285, 286, 287, 288, 289, 290, 291, 292, 303, 305, 308, 309, 310, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 378, 379, 380, 381, 393]) {
    assert.match(status, new RegExp(`issues/${issue}(?:\\)|$)`), `missing issue #${issue}`);
  }
  assert.match(status, /not yet proven as a general-market replacement/i);
});

test('relative Markdown links in authoritative documents resolve in the checkout', () => {
  for (const path of ['README.md', 'docs/product-status.md']) {
    const source = read(path);
    const base = dirname(join(root, path));
    for (const match of source.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)#]+)(?:#[^)]+)?\)/g)) {
      assert.equal(existsSync(resolve(base, match[1])), true, `${path} has a broken link to ${match[1]}`);
    }
  }
});
