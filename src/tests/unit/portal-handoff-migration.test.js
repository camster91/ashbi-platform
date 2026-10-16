import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const migration = fs.readFileSync(new URL('../../../prisma/migrations/20261016110000_portal_human_handoffs/migration.sql', import.meta.url), 'utf8');

test('handoff migration matches offline Prisma index/FK metadata and permits historical contact removal', () => {
  // Schema compilation only: no database connection or migration is performed.
  const sql = execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'],
    { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "portal_handoff_requests"\([^;]+;/g)];
  assert.equal(indexes.length, 5);
  for (const [statement, name] of indexes) {
    assert.ok(migration.replaceAll(/\s+/g, '').includes(statement.replaceAll(/\s+/g, '')), `Exact index definition: ${name}`);
    assert.ok(Buffer.byteLength(name) <= 63);
  }
  const keys = [...sql.matchAll(/ALTER TABLE "portal_handoff_requests" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "([^"]+)"[^;]+;/g)];
  assert.equal(keys.length, 3);
  for (const [, name, , parent] of keys) {
    const definition = migration.split('\n').find(line => line.includes(`CONSTRAINT "${name}"`));
    assert.ok(definition, `Exact foreign-key name: ${name}`);
    assert.match(definition, /ON DELETE RESTRICT ON UPDATE CASCADE/);
    assert.ok(['organizations', 'clients', 'projects'].includes(parent));
  }
  assert.doesNotMatch(migration, /REFERENCES "(?:contacts|users)"/);
});
