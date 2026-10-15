import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export async function clearBrowserPushSubscription({ removeFromServer = false, signal } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return true;
  try {
    // Session expiry and logout must not wait indefinitely for a service worker
    // that is blocked, failed to install, or has not activated yet.
    const reg = await navigator.serviceWorker.getRegistration();
    if (signal?.aborted || !reg) return true;
    const sub = await reg.pushManager?.getSubscription();
    if (signal?.aborted || !sub) return true;
    if (removeFromServer) await api.unsubscribePush(sub.endpoint);
    if (signal?.aborted) return true;
    await sub.unsubscribe();
    return true;
  } catch (error) {
    console.error('Push cleanup failed:', error);
    return false;
  }
}

const OPT_IN_KEY_PREFIX = 'push-opt-in:';

// Per-account consent record for this browser. Browser-level
// Notification.permission is shared by every account that signs in here, so it
// cannot by itself tell us whether *this* user asked for push notifications.
// Returns true (opted in), false (explicitly opted out) or null (never chose).
export function getPushOptIn(userId) {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(`${OPT_IN_KEY_PREFIX}${userId}`);
    if (value === 'in') return true;
    if (value === 'out') return false;
    return null;
  } catch {
    return null;
  }
}

export function setPushOptIn(userId, optedIn) {
  if (!userId) return;
  try {
    localStorage.setItem(`${OPT_IN_KEY_PREFIX}${userId}`, optedIn ? 'in' : 'out');
  } catch { /* storage unavailable; consent then lasts only for this page */ }
}

// The shell may silently restore a subscription only when the browser already
// grants permission AND this specific account opted in on this browser.
export function shouldAutoResubscribe({ userId, permission }) {
  return Boolean(userId) && permission === 'granted' && getPushOptIn(userId) === true;
}

export function usePushNotifications({ userId } = {}) {
  const supported = typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
  const [permission, setPermission] = useState(() => supported ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [browserSubscriptionPresent, setBrowserSubscriptionPresent] = useState(false);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [optedIn, setOptedIn] = useState(() => getPushOptIn(userId));

  const recordOptIn = useCallback((value) => {
    setPushOptIn(userId, value);
    setOptedIn(getPushOptIn(userId) ?? value);
  }, [userId]);

  useEffect(() => {
    setOptedIn(getPushOptIn(userId));
  }, [userId]);

  const checkSubscription = useCallback(async () => {
    if (!supported) {
      setStatus('unsupported');
      return false;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      // Browser permission and subscriptions are shared across accounts. A
      // leftover subscription cannot establish this account's consent, even
      // for legacy subscriptions with no recorded preference.
      const accountSubscribed = !!sub && getPushOptIn(userId) === true;
      setBrowserSubscriptionPresent(!!sub);
      setSubscribed(accountSubscribed);
      setStatus(!navigator.onLine ? 'offline' : accountSubscribed ? 'subscribed' : Notification.permission);
      return accountSubscribed;
    } catch {
      setStatus('error');
      setError('We could not inspect this browser notification subscription. Try again.');
      return false;
    }
  }, [supported, userId]);

  useEffect(() => {
    checkSubscription();
    const updateConnection = () => setOffline(!navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, [checkSubscription]);

  // `auto: true` is the shell's silent re-registration; anything else (including
  // being used directly as an onClick handler) is an explicit user request.
  const subscribe = useCallback(async (options) => {
    const auto = options?.auto === true;
    setError('');
    // Never subscribe without an account to record consent against.
    if (!userId) return false;
    if (auto && getPushOptIn(userId) !== true) return false;
    if (!supported) {
      setStatus('unsupported');
      return false;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      setError('You are offline. Reconnect before enabling notifications.');
      return false;
    }
    try {
      setStatus('subscribing');
      const perm = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      setPermission(perm);
      if (perm !== 'granted') {
        setStatus(perm);
        if (perm === 'denied') {
          setError('Notifications are blocked in your browser settings. Allow them there, then try again.');
        }
        return false;
      }
      if (!auto) recordOptIn(true);

      // Another hook instance (e.g. Settings "Disable") may record an opt-out
      // while this request is in flight; that choice must win.
      const optedOutMeanwhile = () => getPushOptIn(userId) === false;
      const abandon = async (createdSub) => {
        if (createdSub) {
          try { await createdSub.unsubscribe(); } catch { /* best effort */ }
        }
        setStatus(Notification.permission);
        return false;
      };

      const { publicKey } = await api.getPushVapidKey();
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      if (optedOutMeanwhile()) return abandon(existing ? null : sub);

      const subJson = sub.toJSON();
      await api.subscribePush({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      });

      if (optedOutMeanwhile()) {
        // Undo the server registration we just made on the user's behalf.
        try { await api.unsubscribePush(subJson.endpoint); } catch { /* Disable retries cleanup */ }
        return abandon(existing ? null : sub);
      }
      recordOptIn(true);
      setBrowserSubscriptionPresent(true);
      setSubscribed(true);
      setStatus('subscribed');
      return true;
    } catch (err) {
      console.error('Push subscription failed:', err);
      setStatus('error');
      setError(err?.message || 'Notifications could not be enabled. Try again.');
      return false;
    }
  }, [supported, userId, recordOptIn]);

  const unsubscribe = useCallback(async () => {
    setError('');
    // Record the opt-out first so a failed or interrupted cleanup can never be
    // silently undone by the shell's automatic re-subscription on next load.
    recordOptIn(false);
    if (!supported) return true;
    if (!navigator.onLine) {
      setStatus('offline');
      setError('You are offline. Reconnect before disabling notifications.');
      return false;
    }
    try {
      setStatus('unsubscribing');
      const cleared = await clearBrowserPushSubscription({ removeFromServer: true });
      if (!cleared) throw new Error('Notifications could not be disabled. Try again.');
      setBrowserSubscriptionPresent(false);
      setSubscribed(false);
      setStatus(Notification.permission);
      return true;
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Notifications could not be disabled. Try again.');
      return false;
    }
  }, [supported, recordOptIn]);

  const cleanupPending = browserSubscriptionPresent && optedIn === false;
  return { permission, subscribed, status, error, supported, offline, optedIn, cleanupPending, subscribe, unsubscribe, checkSubscription };
}

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
