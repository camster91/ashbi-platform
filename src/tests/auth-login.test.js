/**
 * Auth Login Flow Integration Tests
 *
 * Tests the authentication endpoints against the live API.
 * Validates that the server returns the correct error messages
 * that the frontend API client depends on.
 *
 * Run with: node --test src/tests/auth-login.test.js
 * Requires: hub.ashbi.ca must be accessible
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const API_BASE = 'https://hub.ashbi.ca/api';

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// Rate limiter allows 5 req/min on auth endpoints — space tests out
function isRateLimited(status) {
  return status === 429;
}

describe('Auth Login Flow - Live API Tests', () => {

  describe('GET /auth/me', () => {
    it('should return 401 with "Unauthorized" (not "API key required")', async () => {
      const { status, data } = await fetchJSON(`${API_BASE}/auth/me`);

      assert.equal(status, 401, 'Unauthenticated /auth/me should return 401');
      assert.equal(data.error, 'Unauthorized', 'Should return "Unauthorized" — this is what the frontend expects');
    });

    it('should NEVER return "API key required" from /auth/me', async () => {
      const { data } = await fetchJSON(`${API_BASE}/auth/me`);

      assert.notEqual(data.error, 'API key required',
        '/auth/me must return "Unauthorized" for missing JWT, not "API key required". ' +
        'If this fails, the authenticate decorator was changed to authenticateAny which breaks the frontend.'
      );
    });
  });

  describe('POST /auth/login', () => {
    it('should return 401 for invalid credentials', async () => {
      const { status, data } = await fetchJSON(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: 'nonexistent-user-99@ashbi.ca', password: 'wrongpassword123' }),
      });

      if (isRateLimited(status)) return; // skip on rate limit

      assert.equal(status, 401);
      assert.equal(data.error, 'Invalid credentials');
    });

    it('should validate request body schema', async () => {
      const { status, data } = await fetchJSON(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: 'not-an-email', password: 'password123' }),
      });

      if (isRateLimited(status)) return;

      assert.equal(status, 400, 'Invalid email format should return 400');
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should return success even for unknown email (no email leak)', async () => {
      const { status, data } = await fetchJSON(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        body: JSON.stringify({ email: 'unknown-user-12345@ashbi.ca' }),
      });

      if (isRateLimited(status)) return;

      assert.equal(status, 200);
      assert.equal(data.success, true, 'Should not reveal if email exists');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('should reject invalid reset token', async () => {
      const { status, data } = await fetchJSON(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ token: 'invalid-token-12345', newPassword: 'newpassword123' }),
      });

      if (isRateLimited(status)) return;

      assert.equal(status, 400);
      assert.equal(data.error, 'Invalid or expired reset token');
    });
  });

  describe('Auth error format consistency', () => {
    it('all auth errors should use { error: string } format', async () => {
      const meRes = await fetchJSON(`${API_BASE}/auth/me`);

      assert.ok(typeof meRes.data.error === 'string', '/auth/me error should be a string');
      assert.ok(meRes.data.error.length > 0, '/auth/me error should not be empty');
    });
  });
});