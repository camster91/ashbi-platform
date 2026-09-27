/**
 * A 429 from /api/auth/me means "retry later": the SPA must not sign the user
 * out or replace the app with the blocking "We could not verify your session"
 * screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../lib/private-cache', () => ({
  purgePrivateCaches: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../hooks/usePushNotifications', () => ({
  clearBrowserPushSubscription: vi.fn().mockResolvedValue(undefined),
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import api from '../lib/api.js';
import RateLimitNotice from '../components/RateLimitNotice';
import { AuthProvider, authFailureReason, rateLimitRetryDelayMs, useAuth } from '../hooks/useAuth';

function response(status, data, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: vi.fn().mockResolvedValue(data),
  };
}

const tooMany = (retryAfter = '1') => response(429, { error: 'Rate limit exceeded' }, { 'retry-after': retryAfter });
const user = { id: 'u1', email: 'staff@example.com', role: 'TEAM' };

function wrapper({ children }) {
  return (
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

describe('session check under rate limiting', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies 429 as rate_limited and honours Retry-After within bounds', async () => {
    expect(authFailureReason({ status: 429 })).toBe('rate_limited');
    expect(rateLimitRetryDelayMs({ retryAfterSeconds: 3 })).toBe(3000);
    expect(rateLimitRetryDelayMs({ retryAfterSeconds: 0 })).toBe(1000);
    expect(rateLimitRetryDelayMs({ retryAfterSeconds: 3600 })).toBe(60_000);
    expect(rateLimitRetryDelayMs({})).toBe(5000);

    fetch.mockResolvedValueOnce(tooMany('7'));
    await expect(api.me()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 7 });
  });

  it('keeps checking (no error screen, no sign-out) and recovers after Retry-After', async () => {
    fetch.mockResolvedValueOnce(tooMany('1')).mockResolvedValueOnce(response(200, user));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.authState.reason).toBe('rate_limited'));
    expect(result.current.authState.status).not.toBe('error');
    expect(result.current.authState.status).not.toBe('unauthenticated');
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.user).toEqual(user), { timeout: 4000 });
    expect(result.current.authState).toMatchObject({ status: 'authenticated', reason: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a rate-limited re-check keeps the signed-in session on screen', async () => {
    fetch.mockResolvedValueOnce(response(200, user)).mockResolvedValueOnce(tooMany('30'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).toEqual(user));

    await act(async () => { await result.current.checkAuth(); });
    expect(result.current.user).toEqual(user);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.authState).toMatchObject({ status: 'authenticated', reason: 'rate_limited' });
  });

  it('renders a non-blocking notice instead of the session failure screen', async () => {
    fetch.mockResolvedValue(tooMany('30'));
    function Probe() {
      const { authState } = useAuth();
      return <RateLimitNotice authState={authState} />;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes><Route path="/" element={<Probe />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/The server is busy. Retrying in 30s; you have not been signed out./)).toBeTruthy();
    expect(screen.queryByText(/We could not verify your session/)).toBeNull();
    const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(app).toMatch(/<PageLoader authState=\{authState\} \/>/);
    expect(app).toMatch(/<RateLimitNotice authState=\{authState\} \/>\{children\}/);
  });
});
