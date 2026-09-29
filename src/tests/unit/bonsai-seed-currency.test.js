// The Bonsai seed stores each invoice in its source currency. It used to take
// amountUsd || amountCad * 0.80 and leave currency to the CAD default, so USD
// invoices were labelled CAD and CAD invoices were understated by 20%.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bonsaiInvoiceAmount } from '../../../prisma/bonsai-invoice-amount.js';

test('a USD source invoice keeps its USD amount and currency', () => {
  assert.deepEqual(bonsaiInvoiceAmount({ number: '1', currency: 'USD', amountUsd: 900, amountCad: 0 }), { currency: 'USD', amount: 900 });
});

test('a CAD source invoice keeps its full CAD amount', () => {
  assert.deepEqual(bonsaiInvoiceAmount({ number: '2', currency: 'CAD', amountUsd: 0, amountCad: 445.01 }), { currency: 'CAD', amount: 445.01 });
});

test('an invoice with no amount in its currency is refused, never converted', () => {
  assert.throws(() => bonsaiInvoiceAmount({ number: '3', currency: 'CAD', amountUsd: 500, amountCad: 0 }), /no CAD amount/);
});

test('the seed persists the currency it billed in', () => {
  const seed = readFileSync(new URL('../../../prisma/bonsai-seed.js', import.meta.url), 'utf8');
  assert.match(seed, /bonsaiInvoiceAmount\(inv\)/);
  assert.match(seed, /total: amount,\n\s+currency,/);
  assert.doesNotMatch(seed, /amountCad \* 0\.8/);
});
