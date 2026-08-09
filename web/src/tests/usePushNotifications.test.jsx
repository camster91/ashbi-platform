import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePushNotifications } from '../hooks/usePushNotifications';

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
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  return pushManager;
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const { result } = renderHook(() => usePushNotifications());
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
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    await act(() => result.current.unsubscribe());

    expect(apiMock.unsubscribePush).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(result.current.subscribed).toBe(false);
  });

  it('explains blocked permission without attempting a subscription', async () => {
    const pushManager = setBrowser({ permission: 'denied' });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('denied'));

    await act(() => result.current.subscribe());

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiMock.subscribePush).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/browser settings/i);
  });

  it('returns an actionable offline state before asking permission', async () => {
    setBrowser({ online: false });
    const { result } = renderHook(() => usePushNotifications());

    await act(() => result.current.subscribe());

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(result.current.status).toBe('offline');
    expect(result.current.error).toMatch(/offline/i);
  });
});
