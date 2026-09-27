// Password hashing and verification shared by staff and client sign-in.
//
// - New hashes are bcrypt (cost 12).
// - Legacy unsalted SHA-256 hex hashes are accepted once: a successful sign-in
//   rehashes the password with bcrypt before any session is issued
//   (upgradeLegacyHash), and sign-in fails if that write fails. The comparison
//   is constant-time. `npm run audit:password-hashes` finds (and can reset)
//   accounts that have not signed in since.
// - When no account matches, sign-in still runs one bcrypt comparison against
//   a throwaway hash (dummyPasswordCheck), so response time does not reveal
//   whether an email is registered.

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

export const BCRYPT_ROUNDS = 12;
const LEGACY_SHA256 = /^[0-9a-f]{64}$/i;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function isBcryptHash(hash) {
  return typeof hash === 'string' && hash.startsWith('$2');
}

export function isLegacyHash(hash) {
  return typeof hash === 'string' && LEGACY_SHA256.test(hash);
}

/** bcrypt, or a legacy SHA-256 hex hash compared in constant time. Anything else fails. */
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string') return false;
  if (isBcryptHash(hash)) return bcrypt.compare(password, hash);
  if (!isLegacyHash(hash)) return false;
  const expected = crypto.createHash('sha256').update(password).digest();
  const actual = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * After a successful verifyPassword: replace a legacy hash with bcrypt. Throws
 * (so the caller refuses the sign-in) when the write fails.
 */
export async function upgradeLegacyHash(prisma, user, password) {
  if (isBcryptHash(user.password)) return false;
  const hash = await hashPassword(password);
  await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
  return true;
}

let dummyHash = null;

/** A bcrypt comparison that always fails, costing the same as a real one. */
export async function dummyPasswordCheck(password) {
  dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  await bcrypt.compare(typeof password === 'string' ? password : '', await dummyHash);
  return false;
}

/** Compute the throwaway hash ahead of the first unknown-email sign-in. */
export function warmDummyPasswordHash() {
  dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  return dummyHash;
}
