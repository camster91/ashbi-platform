/**
 * Crypto Utilities Unit Tests
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../utils/crypto.js';

// Set environment variable for testing
process.env.CREDENTIALS_KEY = 'test-secret-key-1234567890';

describe('Crypto Utilities', () => {
  test('encrypt and decrypt should return original text', () => {
    const original = 'sensitive-password-123';
    const encrypted = encrypt(original);
    
    assert.notEqual(original, encrypted);
    assert.ok(encrypted.includes(':'), 'Encrypted format should include delimiters');
    
    const decrypted = decrypt(encrypted);
    assert.equal(original, decrypted);
  });

  test('should return input if null or empty', () => {
    assert.equal(encrypt(null), null);
    assert.equal(encrypt(''), '');
    assert.equal(decrypt(null), null);
    assert.equal(decrypt(''), '');
  });

  test('decrypt should throw for invalid format', () => {
    assert.throws(() => {
      decrypt('invalid-format');
    }, /Invalid encrypted format/);
  });

  test('decrypt should throw if key changes', () => {
    const encrypted = encrypt('secret');
    process.env.CREDENTIALS_KEY = 'different-key';
    
    // GCM authentication will fail if key or data changes
    assert.throws(() => {
      decrypt(encrypted);
    }, /Unsupported state or unable to authenticate data/);
    
    // Restore key
    process.env.CREDENTIALS_KEY = 'test-secret-key-1234567890';
  });

  test('should log audit message when requested', () => {
    const originalWarn = console.warn;
    let logged = false;
    console.warn = (msg) => {
      if (msg.includes('[CREDENTIAL AUDIT]')) logged = true;
    };
    
    const encrypted = encrypt('secret');
    decrypt(encrypted, { audit: true, label: 'Test Entry' });
    
    console.warn = originalWarn;
    assert.ok(logged, 'Audit log should be triggered');
  });
});
