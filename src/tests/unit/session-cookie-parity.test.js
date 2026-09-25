import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { sessionCookieOptions } from '../../auth/session.js';

const authRoutes = readFileSync(new URL('../../routes/auth.routes.js', import.meta.url), 'utf8');

describe('session cookie parity', () => {
  it('uses identical path/httpOnly/secure/sameSite for set and clear', () => {
    const withMaxAge = sessionCookieOptions({ includeMaxAge: true });
    const clear = sessionCookieOptions();

    assert.equal(withMaxAge.path, clear.path);
    assert.equal(withMaxAge.httpOnly, clear.httpOnly);
    assert.equal(withMaxAge.secure, clear.secure);
    assert.equal(withMaxAge.sameSite, clear.sameSite);
    assert.equal(typeof withMaxAge.maxAge, 'number');
    assert.equal('maxAge' in clear, false);
  });

  it('wires login and logout through the shared cookie helper', () => {
    assert.match(authRoutes, /sessionCookieOptions\(\{\s*includeMaxAge:\s*true\s*\}\)/);
    assert.match(authRoutes, /clearCookie\('token',\s*sessionCookieOptions\(\)\)/);
    assert.doesNotMatch(authRoutes, /process\.env\.NODE_ENV === 'production' && !request\.headers\.host/);
  });
});
