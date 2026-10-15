import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrowserPushSubscription, getPushOptIn, setPushOptIn,
  shouldAutoResubscribe, usePushNotifications,
} from '../hooks/usePushNotifications';

const apiMock = vi.hoisted(() => ({
  getPushVapidKey: vi.fn(), subscribePush: vi.fn(), unsubscribePush: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

const browserProperties = [
  [window, 'Notification'], [window, 'PushManager'],
  [navigator, 'serviceWorker'], [navigator, 'onLine'],
].map(([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)]);

describe('push consent after a shared browser changes accounts', () => {
  let subscription;
  let pushManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    apiMock.getPushVapidKey.mockResolvedValue({ publicKey: 'AQAB' });
    apiMock.subscribePush.mockResolvedValue({ success: true });
    subscription = {
      endpoint: 'https://push.example/account-a',
      toJSON: () => ({
        endpoint: 'https://push.example/account-a', keys: { p256dh: 'key', auth: 'auth' },
      }),
      unsubscribe: vi.fn().mockRejectedValue(new Error('Browser cleanup failed')),
    };
    pushManager = {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn(),
    };
    Object.defineProperty(window, 'Notification', {
      configurable: true, value: { permission: 'granted', requestPermission: vi.fn() },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({ pushManager }),
        getRegistration: vi.fn().mockResolvedValue({ pushManager }),
      },
    });
    setPushOptIn('account-a', true);
    // Logout attempted cleanup, but the browser retained A's subscription.
    expect(await clearBrowserPushSubscription()).toBe(false);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [target, key, descriptor] of browserProperties) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    }
    localStorage.clear();
  });

  async function mountAccount(userId) {
    const hook = renderHook(() => usePushNotifications({ userId }));
    await waitFor(() => expect(hook.result.current.status).not.toBe('checking'));
    return hook;
  }

  it('does not infer B consent or subscribed status from the browser subscription left by A', async () => {
    const { result } = await mountAccount('account-b');

    expect(getPushOptIn('account-b')).toBeNull();
    expect(result.current.optedIn).toBeNull();
    expect(result.current.subscribed).toBe(false);
    expect(shouldAutoResubscribe({ userId: 'account-b', permission: 'granted' })).toBe(false);
    expect(apiMock.subscribePush).not.toHaveBeenCalled();
  });

  it('refuses silent registration for B despite a leftover subscription and granted permission', async () => {
    const { result } = await mountAccount('account-b');

    await act(async () => {
      expect(await result.current.subscribe({ auto: true })).toBe(false);
    });

    expect(apiMock.getPushVapidKey).not.toHaveBeenCalled();
    expect(apiMock.subscribePush).not.toHaveBeenCalled();
    expect(getPushOptIn('account-b')).toBeNull();
  });

  it('allows B to explicitly enable notifications and records B consent', async () => {
    const { result } = await mountAccount('account-b');

    await act(async () => {
      expect(await result.current.subscribe()).toBe(true);
    });

    expect(getPushOptIn('account-b')).toBe(true);
    expect(result.current.optedIn).toBe(true);
    expect(result.current.subscribed).toBe(true);
    expect(apiMock.subscribePush).toHaveBeenCalledWith(subscription.toJSON());
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('still restores notifications for A with previously recorded explicit consent', async () => {
    const { result } = await mountAccount('account-a');
    expect(result.current.subscribed).toBe(true);

    await act(async () => {
      expect(await result.current.subscribe({ auto: true })).toBe(true);
    });

    expect(getPushOptIn('account-a')).toBe(true);
    expect(apiMock.subscribePush).toHaveBeenCalledWith(subscription.toJSON());
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('preserves a failed Disable cleanup retry after reload without restoring consent', async () => {
    apiMock.unsubscribePush.mockRejectedValueOnce(new Error('Network unavailable'));
    const first = await mountAccount('account-a');
    await act(async () => {
      expect(await first.result.current.unsubscribe()).toBe(false);
    });
    expect(getPushOptIn('account-a')).toBe(false);
    first.unmount();

    const second = await mountAccount('account-a');
    expect(second.result.current.subscribed).toBe(false);
    expect(second.result.current.cleanupPending).toBe(true);
    expect(shouldAutoResubscribe({ userId: 'account-a', permission: 'granted' })).toBe(false);

    apiMock.unsubscribePush.mockResolvedValue({ success: true });
    subscription.unsubscribe.mockResolvedValue(true);
    await act(async () => {
      expect(await second.result.current.unsubscribe()).toBe(true);
    });
    expect(second.result.current.cleanupPending).toBe(false);
    expect(second.result.current.subscribed).toBe(false);
    expect(getPushOptIn('account-a')).toBe(false);
  });
});
