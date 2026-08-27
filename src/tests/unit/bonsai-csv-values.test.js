import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBonsaiMoney, parseBonsaiDecimal } from '../../services/bonsaiCsvValues.service.js';

test('Bonsai money parsing accepts exact supported financial values', () => {
  assert.equal(parseBonsaiMoney('1,234.56'), 1234.56);
  assert.equal(parseBonsaiMoney('-10.25'), -10.25);
  assert.equal(parseBonsaiMoney('0'), 0);
});

test('Bonsai money parsing rejects malformed or over-precise values', () => {
  assert.equal(parseBonsaiMoney('1,2,3.00'), null);
  assert.equal(parseBonsaiMoney('12.345'), null);
  assert.equal(parseBonsaiMoney('$12.00'), null);
  assert.equal(parseBonsaiMoney(''), null);
});

test('Bonsai decimal parsing rejects partial numbers while allowing precise percentages', () => {
  assert.equal(parseBonsaiDecimal('13.125'), 13.125);
  assert.equal(parseBonsaiDecimal('1,000.5'), 1000.5);
  assert.equal(parseBonsaiDecimal('1,2,3'), null);
  assert.equal(parseBonsaiDecimal('12 percent'), null);
});
