import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260809223000_unique_invoice_per_proposal/migration.sql', 'utf8');
const contracts = readFileSync('src/routes/contract.routes.js', 'utf8');
const invoices = readFileSync('src/routes/invoice.routes.js', 'utf8');

test('one proposal can produce at most one invoice at the database boundary', () => {
  const invoiceModel = schema.match(/model Invoice \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(invoiceModel, /proposalId\s+String\?\s+@unique/);
  assert.match(migration, /CREATE UNIQUE INDEX "invoices_proposalId_key" ON "invoices"\("proposalId"\)/);
});

test('proposal contract conversion returns the existing record and recovers concurrent uniqueness races', () => {
  assert.match(contracts, /if \(existing\) return existing/);
  assert.match(contracts, /error\?\.code !== 'P2002'/);
  assert.ok(contracts.match(/contract\.findUnique\([\s\S]*?proposalId: proposal\.id/g)?.length >= 2);
});

test('proposal invoice conversion returns the existing record and recovers concurrent uniqueness races', () => {
  assert.ok(invoices.match(/invoice\.findUnique\([\s\S]*?proposalId: proposal\.id/g)?.length >= 2);
  assert.match(invoices, /if \(existing\) return existing/);
  assert.match(invoices, /error\?\.code !== 'P2002'/);
});
