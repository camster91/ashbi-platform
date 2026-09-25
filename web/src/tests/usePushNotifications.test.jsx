import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrowserPushSubscription,
  getPushOptIn,
  setPushOptIn,
  shouldAutoResubscribe,
  usePushNotifications,
} from '../hooks/usePushNotifications';

const apiMock = vi.hoisted(() => ({
  getPushVapidKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMock }));

const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification');
const originalPushManager = Object.getOwnPropertyDescriptor(window, 'PushManager');
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');

function setBrowser({ permission = 'default', subscription = null, online = true } = {}) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn(),
  };
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission, requestPermission: vi.fn().mockResolvedValue(permission) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager }),
      getRegistration: vi.fn().mockResolvedValue({ pushManager }),
    },
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  return pushManager;
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.getPushVapidKey.mockResolvedValue({ publicKey: 'AQAB' });
    apiMock.subscribePush.mockResolvedValue({ success: true });
    apiMock.unsubscribePush.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    for (const [target, key, descriptor] of [
      [window, 'Notification', originalNotification],
      [window, 'PushManager', originalPushManager],
      [navigator, 'serviceWorker', originalServiceWorker],
      [navigator, 'onLine', originalOnLine],
    ]) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    }
  });

  it('registers an existing approved browser subscription to the signed-in account', async () => {
    const subscription = {
      endpoint: 'https://push.example/subscription',
      toJSON: () => ({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }),
    };
    setBrowser({ permission: 'granted', subscription });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    await act(() => result.current.subscribe());

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(apiMock.subscribePush).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      keys: { p256dh: 'key', auth: 'auth' },
    });
    expect(result.current.status).toBe('subscribed');
  });

  it('removes the server endpoint and browser subscription when disabled', async () => {
    const subscription = {
      endpoint: 'https://push.example/subscription',
      toJSON: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    setBrowser({ permission: 'granted', subscription });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    await act(() => result.current.unsubscribe());

    expect(apiMock.unsubscribePush).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(result.current.subscribed).toBe(false);
  });

  it('does not block session cleanup when no service worker is active', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: new Promise(() => {}),
        getRegistration: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(clearBrowserPushSubscription()).resolves.toBe(true);
    expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledOnce();
  });

  it('explains blocked permission without attempting a subscription', async () => {
    const pushManager = setBrowser({ permission: 'denied' });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.status).toBe('denied'));

    await act(() => result.current.subscribe());

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiMock.subscribePush).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/browser settings/i);
  });

  it('returns an actionable offline state before asking permission', async () => {
    setBrowser({ online: false });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));

    await act(() => result.current.subscribe());

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(result.current.status).toBe('offline');
    expect(result.current.error).toMatch(/offline/i);
  });

  it('records an explicit opt-in for the account that enabled notifications', async () => {
    const subscription = {
      endpoint: 'https://push.example/subscription',
      toJSON: () => ({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }),
    };
    const pushManager = setBrowser({ permission: 'default' });
    window.Notification.requestPermission.mockResolvedValue('granted');
    pushManager.subscribe.mockResolvedValue(subscription);
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.status).toBe('default'));

    await act(() => result.current.subscribe());

    expect(getPushOptIn('user-a')).toBe(true);
    expect(getPushOptIn('user-b')).toBeNull();
    expect(shouldAutoResubscribe({ userId: 'user-a', permission: 'granted' })).toBe(true);
  });

  it('persists an opt-out on disable so reloads do not re-subscribe', async () => {
    setPushOptIn('user-a', true);
    const subscription = {
      endpoint: 'https://push.example/subscription',
      toJSON: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    setBrowser({ permission: 'granted', subscription });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    await act(() => result.current.unsubscribe());

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(getPushOptIn('user-a')).toBe(false);
    expect(shouldAutoResubscribe({ userId: 'user-a', permission: 'granted' })).toBe(false);
  });

  it('keeps the opt-out even when disabling fails', async () => {
    setPushOptIn('user-a', true);
    const subscription = {
      endpoint: 'https://push.example/subscription',
      toJSON: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    setBrowser({ permission: 'granted', subscription });
    apiMock.unsubscribePush.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    await act(() => result.current.unsubscribe());

    expect(result.current.status).toBe('error');
    expect(getPushOptIn('user-a')).toBe(false);
  });
});

describe('shouldAutoResubscribe', () => {
  beforeEach(() => localStorage.clear());

  it('never auto-subscribes an account that has not opted in, even with granted permission', () => {
    setPushOptIn('user-a', true);
    expect(shouldAutoResubscribe({ userId: 'user-b', permission: 'granted' })).toBe(false);
    expect(shouldAutoResubscribe({ userId: undefined, permission: 'granted' })).toBe(false);
  });

  it('requires browser permission as well as opt-in', () => {
    setPushOptIn('user-a', true);
    expect(shouldAutoResubscribe({ userId: 'user-a', permission: 'default' })).toBe(false);
    expect(shouldAutoResubscribe({ userId: 'user-a', permission: 'denied' })).toBe(false);
  });

  it('treats unavailable storage as no consent', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(getPushOptIn('user-a')).toBeNull();
      expect(shouldAutoResubscribe({ userId: 'user-a', permission: 'granted' })).toBe(false);
      expect(() => setPushOptIn('user-a', true)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('usePushNotifications consent races and backfill', () => {
  const subscription = {
    endpoint: 'https://push.example/subscription',
    toJSON: () => ({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.getPushVapidKey.mockResolvedValue({ publicKey: 'AQAB' });
    apiMock.subscribePush.mockResolvedValue({ success: true });
    apiMock.unsubscribePush.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    for (const [target, key, descriptor] of [
      [window, 'Notification', originalNotification],
      [window, 'PushManager', originalPushManager],
      [navigator, 'serviceWorker', originalServiceWorker],
      [navigator, 'onLine', originalOnLine],
    ]) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    }
  });

  it('does not subscribe without a user to record consent against', async () => {
    const pushManager = setBrowser({ permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications());

    let outcome;
    await act(async () => { outcome = await result.current.subscribe(); });

    expect(outcome).toBe(false);
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiMock.subscribePush).not.toHaveBeenCalled();
  });

  it('auto path does nothing for an account that has not opted in', async () => {
    setBrowser({ permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-b' }));
    await waitFor(() => expect(result.current.status).toBe('granted'));

    await act(() => result.current.subscribe({ auto: true }));

    expect(apiMock.subscribePush).not.toHaveBeenCalled();
    expect(getPushOptIn('user-b')).toBeNull();
  });

  it('an opt-out recorded before the server POST aborts an in-flight auto re-subscribe', async () => {
    setPushOptIn('user-a', true);
    setBrowser({ permission: 'granted', subscription });
    let releaseKey;
    apiMock.getPushVapidKey.mockReturnValue(new Promise((resolve) => { releaseKey = resolve; }));
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    let pending;
    act(() => { pending = result.current.subscribe({ auto: true }); });
    // Settings (a separate hook instance) disables while Layout is in flight.
    setPushOptIn('user-a', false);
    releaseKey({ publicKey: 'AQAB' });

    let outcome;
    await act(async () => { outcome = await pending; });
    expect(outcome).toBe(false);
    expect(apiMock.subscribePush).not.toHaveBeenCalled();
    expect(getPushOptIn('user-a')).toBe(false);
  });

  it('an opt-out recorded during the server POST is not overwritten and the registration is undone', async () => {
    setPushOptIn('user-a', true);
    setBrowser({ permission: 'granted', subscription });
    apiMock.subscribePush.mockImplementation(async () => {
      setPushOptIn('user-a', false);
      return { success: true };
    });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    let outcome;
    await act(async () => { outcome = await result.current.subscribe({ auto: true }); });

    expect(outcome).toBe(false);
    expect(getPushOptIn('user-a')).toBe(false);
    expect(apiMock.unsubscribePush).toHaveBeenCalledWith(subscription.endpoint);
  });

  it('an explicit enable overrides a previous opt-out', async () => {
    setPushOptIn('user-a', false);
    setBrowser({ permission: 'granted', subscription });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    let outcome;
    await act(async () => { outcome = await result.current.subscribe(); });

    expect(outcome).toBe(true);
    expect(getPushOptIn('user-a')).toBe(true);
    expect(result.current.optedIn).toBe(true);
  });

  it('backfills opt-in once for an existing approved subscription with no stored preference', async () => {
    setBrowser({ permission: 'granted', subscription });
    const { result } = renderHook(() => usePushNotifications({ userId: 'user-a' }));

    await waitFor(() => expect(result.current.optedIn).toBe(true));
    expect(getPushOptIn('user-a')).toBe(true);
  });

  it('does not backfill over an explicit opt-out or without a subscription', async () => {
    setPushOptIn('user-a', false);
    setBrowser({ permission: 'granted', subscription });
    const first = renderHook(() => usePushNotifications({ userId: 'user-a' }));
    await waitFor(() => expect(first.result.current.subscribed).toBe(true));
    expect(getPushOptIn('user-a')).toBe(false);
    expect(first.result.current.optedIn).toBe(false);

    setBrowser({ permission: 'granted', subscription: null });
    const second = renderHook(() => usePushNotifications({ userId: 'user-b' }));
    await waitFor(() => expect(second.result.current.status).toBe('granted'));
    expect(getPushOptIn('user-b')).toBeNull();
  });
});
