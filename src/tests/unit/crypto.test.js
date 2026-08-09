/**
 * Crypto Utilities Unit Tests
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  encrypt,
  encryptWithVersion,
  decrypt,
  getCiphertextKeyVersion,
} from '../../utils/crypto.js';

// Set environment variable for testing
process.env.CREDENTIALS_KEY = 'test-secret-key-1234567890';
process.env.CREDENTIALS_KEYRING = JSON.stringify({
  legacy: 'test-secret-key-1234567890',
  v2: 'second-test-key-0987654321',
});
process.env.CREDENTIALS_ACTIVE_KEY_VERSION = 'v2';

function legacyEncrypt(plaintext) {
  const key = crypto.createHash('sha256').update(process.env.CREDENTIALS_KEY).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

describe('Crypto Utilities', () => {
  test('encrypt and decrypt should return original text', () => {
    const original = 'sensitive-password-123';
    const encrypted = encrypt(original);
    
    assert.notEqual(original, encrypted);
    assert.ok(encrypted.includes(':'), 'Encrypted format should include delimiters');
    assert.equal(getCiphertextKeyVersion(encrypted), 'v2');
    
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
    const encrypted = encryptWithVersion('secret', 'v2');
    process.env.CREDENTIALS_KEYRING = JSON.stringify({ legacy: process.env.CREDENTIALS_KEY, v2: 'different-key' });
    
    // GCM authentication will fail if key or data changes
    assert.throws(() => {
      decrypt(encrypted);
    }, /Unsupported state or unable to authenticate data/);
    
    // Restore key
    process.env.CREDENTIALS_KEYRING = JSON.stringify({
      legacy: process.env.CREDENTIALS_KEY,
      v2: 'second-test-key-0987654321',
    });
  });

  test('legacy ciphertext remains readable while its key coexists', () => {
    const encrypted = legacyEncrypt('legacy-secret');
    assert.equal(getCiphertextKeyVersion(encrypted), 'legacy');
    assert.equal(decrypt(encrypted), 'legacy-secret');
  });

  test('unknown key versions fail closed', () => {
    const encrypted = encryptWithVersion('secret', 'v2').replace(/^v1:v2:/, 'v1:retired:');
    assert.throws(() => decrypt(encrypted), /key version is unavailable/);
  });
});
