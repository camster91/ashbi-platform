// Test helpers for routes guarded by requireRecentAuth (src/auth/reauth.js).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { signReauthToken } = await import('../../auth/reauth.js');

/** A fixed session `iat`, so a fake principal and its reauth token agree. */
export const TEST_SESSION_IAT = 1_700_000_000;

/** Give a fake principal the session claims the guard binds to. */
export function withSession(user) {
  return { sessionVersion: 0, iat: TEST_SESSION_IAT, ...user };
}

/** Cookies carrying a fresh re-authentication for `user`'s session. */
export function reauthCookies(user) {
  return { reauth: signReauthToken(withSession(user)) };
}
