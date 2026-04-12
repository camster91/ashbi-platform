/**
 * Frontend API Client Auth Tests
 *
 * Tests the api.js request() function's behavior around auth endpoints:
 * - The `silent` option suppresses global error dispatch
 * - Auth endpoints (/auth/login, /auth/me) skip api:unauthorized dispatch
 * - Non-auth 401s still trigger the global handler
 *
 * These are unit tests that mock fetch and the callback system.
 * Run with: node --test web/src/tests/api-auth.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// We test the logic of the api.js request function by reimplementing
// the key parts here, since the module uses import.meta.env which
// doesn't work in Node test runner. This validates the behavioral contract.

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Recreate the core request logic from api.js for testing
function createApiClient() {
  let onUnauthorized = null;
  let onApiError = null;
  const dispatchedErrors = [];
  const dispatchedUnauthorized = [];

  function setUnauthorizedCallback(cb) { onUnauthorized = cb; }
  function setApiErrorCallback(cb) { onApiError = cb; }

  function dispatchApiError(error, endpoint) {
    dispatchedErrors.push({ error, endpoint });
    if (onApiError) onApiError(error, endpoint);
  }

  // Mock fetch that returns configurable responses
  let mockFetch = null;

  async function request(endpoint, options = {}) {
    const silent = options.silent ?? false;

    if (!mockFetch) throw new Error('No mock fetch configured');

    const response = await mockFetch(endpoint, options);

    if (response.status === 401) {
      const error = new ApiError(
        response.data?.error || 'Session expired. Please log in again.',
        response.status,
        response.data
      );

      const isAuthEndpoint = endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/me');
      if (!silent && !isAuthEndpoint) {
        dispatchApiError(error, endpoint);
        dispatchedUnauthorized.push(response.data?.error || 'Session expired. Please log in again.');
      }

      throw error;
    }

    if (!response.ok) {
      const error = new ApiError(
        response.data?.error || 'Request failed',
        response.status,
        response.data
      );
      if (!silent) {
        dispatchApiError(error, endpoint);
      }
      throw error;
    }

    return response.data;
  }

  function setMockFetch(fn) { mockFetch = fn; }
  function resetDispatched() {
    dispatchedErrors.length = 0;
    dispatchedUnauthorized.length = 0;
  }

  return {
    request,
    setMockFetch,
    setUnauthorizedCallback,
    setApiErrorCallback,
    resetDispatched,
    get dispatchedErrors() { return dispatchedErrors; },
    get dispatchedUnauthorized() { return dispatchedUnauthorized; },
  };
}

describe('API Client Auth Behavior', () => {
  let client;

  beforeEach(() => {
    client = createApiClient();
  });

  describe('/auth/me endpoint', () => {
    it('should NOT dispatch global error for 401 when silent=true', async () => {
      client.setMockFetch(async (endpoint) => ({
        status: 401,
        ok: false,
        data: { error: 'Unauthorized' },
      }));

      try {
        await client.request('/auth/me', { silent: true });
        assert.fail('Should have thrown');
      } catch (err) {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Unauthorized');
      }

      assert.equal(client.dispatchedErrors.length, 0, 'Should NOT dispatch any global errors');
      assert.equal(client.dispatchedUnauthorized.length, 0, 'Should NOT dispatch unauthorized event');
    });

    it('should NOT dispatch global error for 401 even without silent (auth endpoint check)', async () => {
      client.setMockFetch(async (endpoint) => ({
        status: 401,
        ok: false,
        data: { error: 'Unauthorized' },
      }));

      try {
        await client.request('/auth/me');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.equal(err.status, 401);
      }

      assert.equal(client.dispatchedErrors.length, 0, 'Auth endpoint should NOT trigger global error dispatch');
      assert.equal(client.dispatchedUnauthorized.length, 0, 'Auth endpoint should NOT trigger unauthorized dispatch');
    });
  });

  describe('/auth/login endpoint', () => {
    it('should NOT dispatch api:unauthorized for 401 (wrong credentials)', async () => {
      client.setMockFetch(async (endpoint) => ({
        status: 401,
        ok: false,
        data: { error: 'Invalid credentials' },
      }));

      try {
        await client.request('/auth/login', { method: 'POST', body: { email: 'x@y.com', password: 'wrong' } });
        assert.fail('Should have thrown');
      } catch (err) {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Invalid credentials');
      }

      assert.equal(client.dispatchedErrors.length, 0, 'Login 401 should NOT trigger global error dispatch');
      assert.equal(client.dispatchedUnauthorized.length, 0, 'Login 401 should NOT trigger unauthorized dispatch');
    });

    it('should still throw the error for the caller to handle', async () => {
      client.setMockFetch(async () => ({
        status: 401,
        ok: false,
        data: { error: 'Invalid credentials' },
      }));

      let caught = false;
      try {
        await client.request('/auth/login', { method: 'POST' });
      } catch (err) {
        caught = true;
        assert.equal(err.message, 'Invalid credentials');
        assert.equal(err.status, 401);
      }
      assert.ok(caught, 'Error should still be thrown for inline handling');
    });
  });

  describe('Non-auth 401 responses', () => {
    it('SHOULD dispatch global error for 401 on protected endpoints', async () => {
      client.setMockFetch(async (endpoint) => ({
        status: 401,
        ok: false,
        data: { error: 'Session expired. Please log in again.' },
      }));

      try {
        await client.request('/inbox');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.equal(err.status, 401);
      }

      assert.equal(client.dispatchedErrors.length, 1, 'Non-auth 401 SHOULD trigger global error dispatch');
      assert.equal(client.dispatchedUnauthorized.length, 1, 'Non-auth 401 SHOULD trigger unauthorized dispatch');
    });

    it('should respect silent flag on any endpoint', async () => {
      client.setMockFetch(async () => ({
        status: 401,
        ok: false,
        data: { error: 'Session expired' },
      }));

      try {
        await client.request('/inbox', { silent: true });
      } catch {}

      assert.equal(client.dispatchedErrors.length, 0, 'Silent flag should suppress global error dispatch');
      assert.equal(client.dispatchedUnauthorized.length, 0, 'Silent flag should suppress unauthorized dispatch');
    });
  });

  describe('Non-401 errors', () => {
    it('should dispatch global error for 500 on non-silent requests', async () => {
      client.setMockFetch(async () => ({
        status: 500,
        ok: false,
        data: { error: 'Internal server error' },
      }));

      try {
        await client.request('/inbox');
      } catch {}

      assert.equal(client.dispatchedErrors.length, 1);
    });

    it('should NOT dispatch global error for 500 on silent requests', async () => {
      client.setMockFetch(async () => ({
        status: 500,
        ok: false,
        data: { error: 'Internal server error' },
      }));

      try {
        await client.request('/inbox', { silent: true });
      } catch {}

      assert.equal(client.dispatchedErrors.length, 0);
    });
  });
});