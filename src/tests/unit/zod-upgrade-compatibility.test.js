import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCreateSchema, estimateUpdateSchema, assetUpdateSchema, rateCardUpdateSchema, validate } from '../../validators/schemas.js';

test('partial updates preserve omitted create defaults after Zod 4 upgrade', () => {
  assert.deepEqual(estimateUpdateSchema.parse({ title: 'Revised' }), { title: 'Revised' });
  assert.deepEqual(assetUpdateSchema.parse({ name: 'Revised' }), { name: 'Revised' });
  assert.deepEqual(rateCardUpdateSchema.parse({ name: 'Revised' }), { name: 'Revised' });
  assert.deepEqual(rateCardUpdateSchema.parse({ isActive: false, rates: [], isDefault: false }), { isActive: false, rates: [], isDefault: false });
  assert.equal(estimateCreateSchema.parse({ clientId: 'cm123456789012345678901234', title: 'Quote', lineItems: [{ description: 'Design', quantity: 1, unitPrice: 1 }] }).tax, 0);
});
test('invalid Zod input returns the existing validation error envelope', () => {
  const result = validate(estimateUpdateSchema, { tax: -1 });
  assert.equal(result.data, null);
  assert.match(result.error, /tax:/);
});
