// from-proposal treats only the one-invoice-per-proposal constraint as
// "already created"; any other unique violation (e.g. an invoice-number
// conflict) must surface as an error instead of returning a wrong invoice.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isUniqueViolationOn } from '../../routes/invoice.routes.js';

const PROPOSAL = { index: 'invoices_proposalId_key', fields: ['proposalId'] };

test('recognizes the proposal unique constraint in both Prisma error shapes', () => {
  assert.equal(isUniqueViolationOn({ code: 'P2002', meta: { target: ['proposalId'] } }, PROPOSAL), true);
  assert.equal(isUniqueViolationOn({ code: 'P2002', meta: { target: 'invoices_proposalId_key' } }, PROPOSAL), true);
  assert.equal(isUniqueViolationOn({
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { index: 'invoices_proposalId_key' } } } },
  }, PROPOSAL), true);
});

test('ignores other unique constraints and other errors', () => {
  assert.equal(isUniqueViolationOn({
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { index: 'invoices_organizationId_invoiceNumber_key' } } } },
  }, PROPOSAL), false);
  assert.equal(isUniqueViolationOn({ code: 'P2002', meta: { target: ['organizationId', 'invoiceNumber'] } }, PROPOSAL), false);
  assert.equal(isUniqueViolationOn({ code: 'P2025' }, PROPOSAL), false);
  assert.equal(isUniqueViolationOn(null, PROPOSAL), false);
});
