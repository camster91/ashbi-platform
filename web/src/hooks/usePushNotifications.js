import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export async function clearBrowserPushSubscription({ removeFromServer = false } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return true;
  try {
    // Session expiry and logout must not wait indefinitely for a service worker
    // that is blocked, failed to install, or has not activated yet.
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return true;
    const sub = await reg.pushManager?.getSubscription();
    if (!sub) return true;
    if (removeFromServer) await api.unsubscribePush(sub.endpoint);
    await sub.unsubscribe();
    return true;
  } catch (error) {
    console.error('Push cleanup failed:', error);
    return false;
  }
}

export function usePushNotifications() {
  const supported = typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
  const [permission, setPermission] = useState(() => supported ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  const checkSubscription = useCallback(async () => {
    if (!supported) {
      setStatus('unsupported');
      return false;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
      setStatus(!navigator.onLine ? 'offline' : sub ? 'subscribed' : Notification.permission);
      return !!sub;
    } catch {
      setStatus('error');
      setError('We could not inspect this browser notification subscription. Try again.');
      return false;
    }
  }, [supported]);

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

  const subscribe = useCallback(async () => {
    setError('');
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

      const { publicKey } = await api.getPushVapidKey();
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = sub.toJSON();
      await api.subscribePush({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      });

      setSubscribed(true);
      setStatus('subscribed');
      return true;
    } catch (err) {
      console.error('Push subscription failed:', err);
      setStatus('error');
      setError(err?.message || 'Notifications could not be enabled. Try again.');
      return false;
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    setError('');
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
      setSubscribed(false);
      setStatus(Notification.permission);
      return true;
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Notifications could not be disabled. Try again.');
      return false;
    }
  }, [supported]);

  return { permission, subscribed, status, error, supported, offline, subscribe, unsubscribe, checkSubscription };
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
