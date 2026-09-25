// Time-based one-time passwords (RFC 6238) built on RFC 4226 HOTP.
//
// Implemented with node:crypto so the authenticator factor carries no extra
// third-party dependency. Defaults match every mainstream authenticator app:
// HMAC-SHA1, 6 digits, 30-second steps.

import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_DEFAULTS = Object.freeze({
  algorithm: 'sha1',
  digits: 6,
  period: 30,
});

/** RFC 4648 base32 without padding (the form authenticator apps expect). */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new 160-bit shared secret, base32 encoded (RFC 4226 recommends >= 160 bits). */
export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function secretBuffer(secret) {
  return Buffer.isBuffer(secret) ? secret : base32Decode(secret);
}

/** RFC 4226 HOTP value for one counter. */
export function hotp(secret, counter, { algorithm = TOTP_DEFAULTS.algorithm, digits = TOTP_DEFAULTS.digits } = {}) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac(algorithm, secretBuffer(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The RFC 6238 time step for a moment (milliseconds since the epoch). */
export function totpStep(timeMs = Date.now(), period = TOTP_DEFAULTS.period) {
  return Math.floor(timeMs / 1000 / period);
}

export function totp(secret, { timeMs = Date.now(), ...options } = {}) {
  const period = options.period ?? TOTP_DEFAULTS.period;
  return hotp(secret, totpStep(timeMs, period), options);
}

/**
 * Check a submitted code against the steps within ±window of now.
 *
 * Every candidate step is compared (no early exit) with a constant-time
 * comparison so the response time does not reveal which step matched.
 * Returns the matched step number, or null.
 */
export function verifyTotp(secret, code, { timeMs = Date.now(), window = 1, ...options } = {}) {
  const digits = options.digits ?? TOTP_DEFAULTS.digits;
  const period = options.period ?? TOTP_DEFAULTS.period;
  const submitted = String(code ?? '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(submitted)) return null;
  const key = secretBuffer(secret);
  const current = totpStep(timeMs, period);
  const submittedBuffer = Buffer.from(submitted);
  let matched = null;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(key, step, { ...options, digits }));
    if (crypto.timingSafeEqual(expected, submittedBuffer) && matched === null) matched = step;
  }
  return matched;
}

/** otpauth:// provisioning URI understood by authenticator apps. */
export function otpauthUri({ secret, accountName, issuer }) {
  const label = encodeURIComponent(issuer ? `${issuer}:${accountName}` : accountName);
  const params = new URLSearchParams({
    secret,
    algorithm: TOTP_DEFAULTS.algorithm.toUpperCase(),
    digits: String(TOTP_DEFAULTS.digits),
    period: String(TOTP_DEFAULTS.period),
  });
  if (issuer) params.set('issuer', issuer);
  return `otpauth://totp/${label}?${params.toString()}`;
}
