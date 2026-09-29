// Prisma does not wrap a PostgreSQL migration in a transaction. The
// multi-statement migrations added by the security batch must each be
// all-or-nothing: an explicit BEGIN ... COMMIT around every statement, with
// any timeout set LOCAL to that transaction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const MIGRATIONS = [
  '20260927040500_client_portal_link_redemptions',
  '20260927050500_estimate_public_access',
  '20260927060000_email_webhook_receipts',
];

function statements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

for (const name of MIGRATIONS) {
  test(`${name} runs in one explicit transaction`, () => {
    const sql = readFileSync(new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
    const all = statements(sql);
    assert.equal(all[0], 'BEGIN');
    assert.equal(all.at(-1), 'COMMIT');
    assert.equal(all.filter((s) => s === 'BEGIN' || s === 'COMMIT').length, 2);
    for (const statement of all.filter((s) => /^SET\b/i.test(s))) {
      assert.match(statement, /^SET LOCAL\b/i, `${name}: timeouts are transaction-local`);
    }
    assert.doesNotMatch(sql, /CONCURRENTLY/i, `${name}: CONCURRENTLY cannot run inside a transaction`);
  });
}
