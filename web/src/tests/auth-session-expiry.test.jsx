import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), login: vi.fn() },
}));

const firstUser = { id: 'account-a', role: 'ADMIN' };
const nextUser = { id: 'account-b', role: 'TEAM' };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function wrapper({ children }) {
  return <MemoryRouter initialEntries={['/projects?x=1']}><AuthProvider>{children}</AuthProvider></MemoryRouter>;
}

// Use the real push/cache cleanup helpers: a timed-out enumeration must never
// resume against the subscription or caches belonging to the next account.
describe('bounded session expiry', () => {
  let cacheStorage;
  let serviceWorker;
  beforeEach(() => {
    vi.useFakeTimers();
    api.me.mockResolvedValue(firstUser);
    api.login.mockResolvedValue({ user: nextUser });
    cacheStorage = { keys: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(true) };
    serviceWorker = {
      controller: { postMessage: vi.fn() },
      getRegistration: vi.fn().mockResolvedValue(undefined),
      getRegistrations: vi.fn().mockResolvedValue([]),
    };
    vi.stubGlobal('caches', cacheStorage);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete navigator.serviceWorker;
    vi.clearAllMocks();
  });

  async function mount() {
    const view = renderHook(() => ({ ...useAuth(), location: useLocation() }), { wrapper });
    await act(async () => {});
    expect(view.result.current.user).toEqual(firstUser);
    return view;
  }

  it.each([
    ['push registration', 'Your session expired.', 'expired'],
    ['push subscription', 'This session was revoked by an administrator.', 'revoked'],
    ['cache keys', 'Your session expired.', 'expired'],
    ['worker registrations', 'This session was revoked by an administrator.', 'revoked'],
  ])('reaches sign-in within three seconds despite stalled %s and cancels its late effects', async (stall, message, reason) => {
    const { result } = await mount();
    const pending = deferred();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue({ unsubscribe }) } };
    const postMessage = vi.fn();
    if (stall === 'push registration') serviceWorker.getRegistration.mockReturnValueOnce(pending.promise);
    if (stall === 'push subscription') {
      serviceWorker.getRegistration.mockResolvedValueOnce(registration);
      registration.pushManager.getSubscription.mockReturnValueOnce(pending.promise);
    }
    if (stall === 'cache keys') cacheStorage.keys.mockReturnValueOnce(pending.promise);
    if (stall === 'worker registrations') serviceWorker.getRegistrations.mockReturnValueOnce(pending.promise);

    let expiry;
    await act(async () => {
      expiry = result.current.expireSession(message);
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(result.current.location.pathname).toBe('/projects');
    // Both branches start independently, even when either one is stalled.
    expect(serviceWorker.getRegistration).toHaveBeenCalledOnce();
    expect(cacheStorage.keys).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await expiry;
    });
    expect(result.current.user).toBeNull();
    expect(result.current.authState).toEqual({ status: 'unauthenticated', reason, message });
    expect(result.current.location.pathname).toBe('/login');
    expect(result.current.location.state).toEqual({ reason, message, returnTo: '/projects?x=1' });

    await act(async () => { await result.current.login('b@example.invalid', 'password', '/projects?x=1'); });
    cacheStorage.delete.mockClear();
    serviceWorker.controller.postMessage.mockClear();
    await act(async () => {
      if (stall === 'push registration') pending.resolve(registration);
      if (stall === 'push subscription') pending.resolve({ unsubscribe });
      if (stall === 'cache keys') pending.resolve(['hub-api-account-b']);
      if (stall === 'worker registrations') pending.resolve([{ active: { postMessage } }]);
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(serviceWorker.controller.postMessage).not.toHaveBeenCalled();
    expect(result.current.user).toEqual(nextUser);
    expect(result.current.authState.status).toBe('authenticated');
    expect(result.current.location.pathname + result.current.location.search).toBe('/projects?x=1');
  });

  it.each(['login', 'recheck'])('cancels expiry when a replacement %s succeeds before the deadline', async (attempt) => {
    const { result } = await mount();
    const pending = deferred();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    serviceWorker.getRegistration.mockReturnValueOnce(pending.promise);
    let expiry;
    await act(async () => { expiry = result.current.expireSession('Your session expired.'); });
    await act(async () => {
      if (attempt === 'login') await result.current.login('b@example.invalid', 'password', '/team');
      else {
        api.me.mockResolvedValueOnce(nextUser);
        await result.current.checkAuth();
      }
    });
    await act(async () => {
      pending.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ unsubscribe }) } });
      await vi.advanceTimersByTimeAsync(3000);
      await expiry;
    });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(result.current.user).toEqual(nextUser);
    expect(result.current.authState.status).toBe('authenticated');
    expect(result.current.location.pathname).toBe(attempt === 'login' ? '/team' : '/projects');
  });

  it.each(['login', 'recheck'])('still expires account A after a failed replacement %s', async (attempt) => {
    const { result } = await mount();
    serviceWorker.getRegistration.mockReturnValueOnce(new Promise(() => {}));
    let expiry;
    await act(async () => { expiry = result.current.expireSession('Your session expired.'); });
    await act(async () => {
      if (attempt === 'login') {
        api.login.mockRejectedValueOnce(new Error('Invalid credentials'));
        await expect(result.current.login('bad@example.invalid', 'bad')).rejects.toThrow('Invalid credentials');
      } else {
        api.me.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }));
        await result.current.checkAuth();
      }
      await vi.advanceTimersByTimeAsync(3000);
      await expiry;
    });
    expect(result.current.user).toBeNull();
    expect(result.current.authState).toEqual({ status: 'unauthenticated', reason: 'expired', message: 'Your session expired.' });
    expect(result.current.location.pathname).toBe('/login');
    expect(result.current.location.state.returnTo).toBe('/projects?x=1');
  });

  it.each([200, 503])('ignores a recheck started during cleanup that returns %s after expiry commits', async (status) => {
    const { result } = await mount();
    serviceWorker.getRegistration.mockReturnValueOnce(new Promise(() => {}));
    const pending = deferred();
    api.me.mockImplementationOnce(async () => {
      await pending.promise;
      if (status === 503) throw Object.assign(new Error('Service unavailable'), { status });
      return firstUser;
    });
    let expiry;
    let check;
    await act(async () => { expiry = result.current.expireSession('Your session expired.'); });
    await act(async () => { check = result.current.checkAuth(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await expiry;
    });
    const expiredState = { status: 'unauthenticated', reason: 'expired', message: 'Your session expired.' };
    expect(result.current.user).toBeNull();
    expect(result.current.authState).toEqual(expiredState);
    expect(result.current.location.pathname).toBe('/login');
    await act(async () => {
      pending.resolve();
      await check;
    });
    expect(result.current.user).toBeNull();
    expect(result.current.authState).toEqual(expiredState);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.location.pathname).toBe('/login');
    expect(result.current.location.state).toEqual({ reason: 'expired', message: 'Your session expired.', returnTo: '/projects?x=1' });
  });

  it('cleans up and redirects without waiting for the deadline when browser APIs complete', async () => {
    const { result } = await mount();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    serviceWorker.getRegistration.mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ unsubscribe }) } });
    cacheStorage.keys.mockResolvedValue(['hub-api-account-a', 'public-assets']);
    await act(async () => { await result.current.expireSession('Your session expired.'); });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(cacheStorage.delete).toHaveBeenCalledExactlyOnceWith('hub-api-account-a');
    expect(serviceWorker.controller.postMessage).toHaveBeenCalledWith({ type: 'PURGE_PRIVATE_CACHES' });
    expect(result.current.user).toBeNull();
    expect(result.current.location.pathname).toBe('/login');
    expect(vi.getTimerCount()).toBe(0);
  });
});
