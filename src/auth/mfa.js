// Optional TOTP multi-factor authentication for staff accounts.
//
// Security properties:
// - The TOTP secret is stored only as an AES-256-GCM envelope produced by the
//   credential vault's encryption (src/utils/crypto.js, CREDENTIALS_KEY /
//   CREDENTIALS_KEYRING). It is never logged.
// - Recovery codes are shown once and stored only as SHA-256 hashes; each is
//   removed on use by an optimistic, single-winner update.
// - A code is accepted at most once: the highest accepted time step is stored
//   and later submissions must be for a strictly newer step.
// - Repeated wrong codes lock the second factor for the account (across IPs),
//   in addition to the per-IP route rate limit.
// - The password step returns an "MFA pending" challenge token that is signed
//   with a key derived from JWT_SECRET but in a different format, so it can
//   never be accepted where a session JWT is expected.

import crypto from 'node:crypto';
import env from '../config/env.js';
import { decrypt, encrypt, safeEqual } from '../utils/crypto.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

// Every staff role may enroll (ADMIN, TEAM, STAFF and any future staff role);
// client-portal users and bot identities authenticate differently.
export const MFA_INELIGIBLE_ROLES = Object.freeze(['CLIENT', 'BOT']);
export const MFA_ISSUER = 'Ashbi Hub';
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCKOUT_MS = 15 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;

const CHALLENGE_TYPE = 'mfa_challenge';
// No 0/o/1/l/i so codes survive being read aloud or copied by hand.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_GROUPS = 4;
const RECOVERY_GROUP_LENGTH = 4;

export function isMfaEligible(user) {
  return Boolean(user) && typeof user.role === 'string' && !MFA_INELIGIBLE_ROLES.includes(user.role);
}

/**
 * Whether a password login must be completed with a second factor. This
 * deliberately ignores the role: once enabled, a later role change must not
 * silently drop the second factor.
 */
export function isMfaRequired(user) {
  return Boolean(user) && user.mfaEnabled === true && Boolean(user.mfaSecret);
}

export function encryptMfaSecret(secret) {
  return encrypt(secret);
}

export function decryptMfaSecret(ciphertext) {
  return decrypt(ciphertext);
}

export function startEnrollment(user) {
  const secret = generateTotpSecret();
  return {
    secret,
    encryptedSecret: encryptMfaSecret(secret),
    otpauthUri: otpauthUri({ secret, accountName: user.email, issuer: MFA_ISSUER }),
  };
}

// ---------------------------------------------------------------------------
// Recovery codes

export function normalizeRecoveryCode(code) {
  return String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(`ashbi-mfa-recovery:${normalizeRecoveryCode(code)}`).digest('hex');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const groups = [];
    for (let g = 0; g < RECOVERY_GROUPS; g += 1) {
      let group = '';
      for (let c = 0; c < RECOVERY_GROUP_LENGTH; c += 1) {
        group += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
      }
      groups.push(group);
    }
    codes.push(groups.join('-'));
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Constant-time lookup: every stored hash is compared. Returns the matched hash or null. */
export function findRecoveryCodeHash(storedHashes, code) {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH) return null;
  const submitted = hashRecoveryCode(normalized);
  let match = null;
  for (const stored of storedHashes || []) {
    if (safeEqual(stored, submitted) && match === null) match = stored;
  }
  return match;
}

// ---------------------------------------------------------------------------
// MFA-pending challenge token

function challengeKey() {
  const secret = process.env.JWT_SECRET || env.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is required for MFA challenges');
  return crypto.createHmac('sha256', secret).update('ashbi:mfa-challenge:v1').digest();
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', challengeKey()).update(encodedPayload).digest('base64url');
}

export function createMfaChallenge(user, { nowMs = Date.now(), ttlSeconds = MFA_CHALLENGE_TTL_SECONDS } = {}) {
  const iat = Math.floor(nowMs / 1000);
  const payload = {
    typ: CHALLENGE_TYPE,
    uid: user.id,
    sv: user.sessionVersion,
    iat,
    exp: iat + ttlSeconds,
    nonce: crypto.randomBytes(12).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `mfa.${encoded}.${sign(encoded)}`;
}

/** Returns the challenge payload, or null when forged, malformed, or expired. */
export function verifyMfaChallenge(token, { nowMs = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'mfa') return null;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, sign(encoded))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.typ !== CHALLENGE_TYPE || typeof payload.uid !== 'string') return null;
  if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(nowMs / 1000)) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Second-factor verification (login, disable)

export function isMfaLocked(user, nowMs = Date.now()) {
  return Boolean(user.mfaLockedUntil && new Date(user.mfaLockedUntil).getTime() > nowMs);
}

/** When the most recent lockout began (ms), or null. Persists after the lock expires. */
export function lastLockStartedAt(user) {
  if (!user.mfaLockedUntil) return null;
  return new Date(user.mfaLockedUntil).getTime() - MFA_LOCKOUT_MS;
}

/**
 * Challenges issued before the account's most recent lockout are dead, so a
 * single challenge token is worth at most MFA_MAX_FAILED_ATTEMPTS guesses.
 */
export function isChallengeRevokedByLockout(user, challenge) {
  const lockStart = lastLockStartedAt(user);
  return lockStart !== null && challenge.iat * 1000 <= lockStart;
}

function isNotFound(err) {
  return err?.code === 'P2025';
}

/**
 * Atomically reserve one verification attempt before any code is evaluated.
 *
 * The increment is a single conditional UPDATE ... RETURNING on the current
 * row (not the row read at the start of the request), so concurrent requests
 * receive distinct attempt numbers and at most MFA_MAX_FAILED_ATTEMPTS of
 * them can ever be evaluated before the account locks. The condition also
 * refuses to count attempts while a lock is active, so an attacker hammering
 * a locked account cannot pre-load the counter for when the lock expires.
 * Returns the attempt number, or null when the account is locked.
 */
async function reserveAttempt(prisma, userId, nowMs) {
  try {
    const row = await prisma.user.update({
      where: { id: userId, OR: [{ mfaLockedUntil: null }, { mfaLockedUntil: { lte: new Date(nowMs) } }] },
      data: { mfaFailedAttempts: { increment: 1 } },
      select: { mfaFailedAttempts: true },
    });
    return row.mfaFailedAttempts;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function lockAccount(prisma, userId, nowMs) {
  // Conditional so concurrent lockers do not keep pushing the expiry forward.
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ mfaLockedUntil: null }, { mfaLockedUntil: { lte: new Date(nowMs) } }] },
    data: { mfaFailedAttempts: 0, mfaLockedUntil: new Date(nowMs + MFA_LOCKOUT_MS) },
  });
}

/**
 * Verify a TOTP code against an encrypted secret and atomically claim its
 * time step so the same code cannot be used twice.
 * Returns 'ok' | 'invalid' | 'replayed'.
 */
export async function claimTotpCode(prisma, user, code, { nowMs = Date.now(), encryptedSecret = user.mfaSecret } = {}) {
  if (!encryptedSecret) return 'invalid';
  const step = verifyTotp(decryptMfaSecret(encryptedSecret), code, { timeMs: nowMs, window: 1 });
  if (step === null) return 'invalid';
  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
    },
    data: { mfaLastUsedStep: step },
  });
  return claimed.count === 1 ? 'ok' : 'replayed';
}

/**
 * Check a TOTP code or a recovery code for a user with MFA enabled.
 *
 * On success with a recovery code the code is consumed and sessionVersion is
 * bumped in the same conditional update (so two concurrent uses cannot both
 * win and every other session is revoked). Returns
 * { ok, method, reason, recoveryCodesRemaining, sessionVersion }.
 */
export async function verifySecondFactor(prisma, user, { code, recoveryCode } = {}, { nowMs = Date.now() } = {}) {
  const attempt = await reserveAttempt(prisma, user.id, nowMs);
  if (attempt === null) return { ok: false, reason: 'locked' };
  if (attempt > MFA_MAX_FAILED_ATTEMPTS) {
    // Budget already spent by concurrent requests: lock without evaluating.
    await lockAccount(prisma, user.id, nowMs);
    return { ok: false, reason: 'locked' };
  }

  const fail = async (reason) => {
    if (attempt >= MFA_MAX_FAILED_ATTEMPTS) {
      await lockAccount(prisma, user.id, nowMs);
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason };
  };

  if (recoveryCode) {
    const hash = findRecoveryCodeHash(user.mfaRecoveryCodes, recoveryCode);
    if (hash) {
      const remaining = user.mfaRecoveryCodes.filter((stored) => stored !== hash);
      const consumed = await prisma.user.updateMany({
        where: { id: user.id, sessionVersion: user.sessionVersion, mfaRecoveryCodes: { has: hash } },
        data: {
          mfaRecoveryCodes: { set: remaining },
          sessionVersion: { increment: 1 },
          mfaFailedAttempts: 0,
        },
      });
      if (consumed.count === 1) {
        return {
          ok: true,
          method: 'recovery_code',
          recoveryCodesRemaining: remaining.length,
          sessionVersion: user.sessionVersion + 1,
        };
      }
    }
    return fail('invalid');
  }

  if (code) {
    const result = await claimTotpCode(prisma, user, code, { nowMs });
    if (result === 'ok') {
      await prisma.user.update({ where: { id: user.id }, data: { mfaFailedAttempts: 0 } });
      return {
        ok: true,
        method: 'totp',
        recoveryCodesRemaining: (user.mfaRecoveryCodes || []).length,
        sessionVersion: user.sessionVersion,
      };
    }
    return fail(result === 'replayed' ? 'replayed' : 'invalid');
  }

  return fail('invalid');
}

export const MFA_USER_SELECT = Object.freeze({
  id: true,
  email: true,
  name: true,
  role: true,
  clientId: true,
  organizationId: true,
  isActive: true,
  sessionVersion: true,
  password: true,
  mfaEnabled: true,
  mfaSecret: true,
  mfaEnabledAt: true,
  mfaLastUsedStep: true,
  mfaRecoveryCodes: true,
  mfaFailedAttempts: true,
  mfaLockedUntil: true,
});

/** Public MFA status: never includes the secret or the recovery code hashes. */
export function mfaStatus(user) {
  return {
    eligible: isMfaEligible(user),
    enabled: Boolean(user.mfaEnabled),
    enabledAt: user.mfaEnabledAt ?? null,
    pendingEnrollment: !user.mfaEnabled && Boolean(user.mfaSecret),
    recoveryCodesRemaining: user.mfaEnabled ? (user.mfaRecoveryCodes || []).length : 0,
  };
}
