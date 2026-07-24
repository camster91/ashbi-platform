// AES-256 encryption for credentials vault

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  const key = process.env.CREDENTIALS_KEY;
  if (!key) {
    throw new Error('CREDENTIALS_KEY environment variable is required for credential encryption');
  }
  // Hash the key to ensure it's exactly 32 bytes for AES-256
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Constant-time string comparison for secrets/signatures. Hashing both inputs
 * to a fixed length first avoids leaking length via timingSafeEqual (which
 * throws on unequal-length buffers).
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext, { audit = false, label } = {}) {
  if (!ciphertext) return ciphertext;
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }
  // Audit log: track every decryption of sensitive credentials
  if (audit || label) {
    console.warn(`[CREDENTIAL AUDIT] Decryption accessed${label ? `: ${label}` : ''} at ${new Date().toISOString()}`);
  }
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
