import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionCookieOptions } from '../../auth/session.js';

describe('sessionCookieOptions', () => {
  it('uses secure strict cookies in production', () => {
    assert.deepEqual(sessionCookieOptions(true), {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
  });

  it('uses non-secure lax cookies outside production', () => {
    assert.deepEqual(sessionCookieOptions(false), {
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });
});
