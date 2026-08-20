// AES-256 encryption for credentials vault

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

const ENVELOPE_VERSION = 'v1';
const KEY_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,40}$/;

function readKeyring() {
  let configured = {};
  // process.env is read at call time (not at module load) so that test
  // harnesses can set CREDENTIALS_KEY / CREDENTIALS_KEYRING after import.
  // env.credentialsKey captures the value at env.js load and would miss
  // any later assignment. Other call sites that need the value at request
  // time should use env.credentialsKey directly.
  if (process.env.CREDENTIALS_KEYRING) {
    try {
      configured = JSON.parse(process.env.CREDENTIALS_KEYRING);
    } catch {
      throw new Error('CREDENTIALS_KEYRING must be a JSON object');
    }
    if (!configured || Array.isArray(configured) || typeof configured !== 'object') {
      throw new Error('CREDENTIALS_KEYRING must be a JSON object');
    }
  }
  if (process.env.CREDENTIALS_KEY) configured.legacy ??= process.env.CREDENTIALS_KEY;
  return configured;
}

function activeKeyVersion() {
  // Same rationale as readKeyring: read at call time so test harnesses can
  // set CREDENTIALS_ACTIVE_KEY_VERSION after import. env.credentialsActiveKeyVersion
  // captures the value at env.js load and would miss later assignments.
  return process.env.CREDENTIALS_ACTIVE_KEY_VERSION || 'legacy';
}

function getKey(version) {
  if (!KEY_VERSION_PATTERN.test(version)) throw new Error('Invalid credential key version');
  const key = readKeyring()[version];
  if (typeof key !== 'string' || !key) {
    throw new Error(`Credential encryption key version is unavailable: ${version}`);
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

export function encryptWithVersion(plaintext, version) {
  if (!plaintext) return plaintext;
  const key = getKey(version);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_VERSION}:${version}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function encrypt(plaintext) {
  return encryptWithVersion(plaintext, activeKeyVersion());
}

export function getCiphertextKeyVersion(ciphertext) {
  if (!ciphertext) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length === 3) return 'legacy';
  if (parts.length === 5 && parts[0] === ENVELOPE_VERSION && KEY_VERSION_PATTERN.test(parts[1])) return parts[1];
  throw new Error('Invalid encrypted format');
}

export function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  const parts = ciphertext.split(':');
  const version = getCiphertextKeyVersion(ciphertext);
  const key = getKey(version);
  const [ivHex, tagHex, encrypted] = parts.length === 3 ? parts : parts.slice(2);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || !/^[a-f0-9]+$/i.test(encrypted)) {
    throw new Error('Invalid encrypted format');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function getActiveCredentialKeyVersion() {
  const version = activeKeyVersion();
  getKey(version);
  return version;
}
