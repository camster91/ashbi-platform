/**
 * General Utilities Unit Tests
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeParse } from '../utils/safeParse.js';

describe('safeParse Utility', () => {
  test('should parse valid JSON', () => {
    const input = '{"a": 1, "b": "test"}';
    const expected = { a: 1, b: 'test' };
    assert.deepEqual(safeParse(input), expected);
  });

  test('should return fallback for invalid JSON', () => {
    const input = '{invalid}';
    const fallback = { error: true };
    assert.deepEqual(safeParse(input, fallback), fallback);
  });

  test('should return null for invalid JSON if no fallback provided', () => {
    assert.equal(safeParse('{bad}'), null);
  });

  test('should return fallback for null/undefined input', () => {
    assert.equal(safeParse(null, 'default'), 'default');
    assert.equal(safeParse(undefined, 'default'), 'default');
  });
});
