import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { purgePrivateCaches } from '../lib/private-cache';
import { clearBrowserPushSubscription } from './usePushNotifications';

const AuthContext = createContext(null);

export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  if (value.startsWith('/login') || value.startsWith('/forgot-password') || value.startsWith('/reset-password')) {
    return '/dashboard';
  }
  return value;
}

export function authFailureReason(error) {
  if (error?.status === 401) return 'signed_out';
  if (error?.status === 403) return 'forbidden';
  if (error?.name === 'NetworkError' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
  if (error?.name === 'TimeoutError') return 'timeout';
  if (error?.status >= 500) return 'server';
  return 'unknown';
}

export function sessionEndReason(message) {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  return normalized.includes('revoked') && !normalized.includes('expired') ? 'revoked' : 'expired';
}

function isSignInScreen(pathname) {
  return pathname === '/login';
}

const FIRST_PAINT_FALLBACK_MS = 1000;

// Runs `callback` once the page's first contentful paint has been presented
// (not merely scheduled: a requestAnimationFrame hop still lands before the
// frame reaches the screen). Falls back to a timer where paint timing is
// unavailable or never fires, e.g. in a background tab. Returns a cancel
// function for effect cleanup.
export function afterFirstContentfulPaint(callback, fallbackMs = FIRST_PAINT_FALLBACK_MS) {
  let done = false;
  let observer = null;
  let timer = null;
  const run = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    clearTimeout(timer);
    callback();
  };
  const painted = () => typeof performance !== 'undefined'
    && typeof performance.getEntriesByName === 'function'
    && performance.getEntriesByName('first-contentful-paint').length > 0;

  if (painted()) {
    timer = setTimeout(run, 0);
  } else {
    timer = setTimeout(run, fallbackMs);
    try {
      observer = new PerformanceObserver((list) => {
        if (list.getEntriesByName('first-contentful-paint').length > 0) run();
      });
      observer.observe({ type: 'paint', buffered: true });
    } catch {
      observer = null; // No paint timing support: the fallback timer runs it.
    }
  }
  return () => {
    done = true;
    observer?.disconnect();
    clearTimeout(timer);
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authState, setAuthState] = useState({ status: 'checking', reason: null, message: '' });
  const navigate = useNavigate();
  const location = useLocation();
  const mountedRef = useRef(true);
  const authCheckSequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authCheckSequenceRef.current += 1;
    };
  }, []);

  const checkAuth = useCallback(async () => {
    const sequence = ++authCheckSequenceRef.current;
    const isCurrentCheck = () => mountedRef.current && sequence === authCheckSequenceRef.current;
    if (mountedRef.current) {
      setIsLoading(true);
      setAuthState((current) => ({ ...current, status: 'checking' }));
    }
    try {
      const userData = await api.me();
      if (isCurrentCheck()) {
        setUser(userData);
        setAuthState({ status: 'authenticated', reason: null, message: '' });
      }
    } catch (error) {
      if (isCurrentCheck()) {
        const reason = authFailureReason(error);
        if (reason === 'signed_out') {
          await purgePrivateCaches();
          if (isCurrentCheck()) {
            setUser(null);
            setAuthState({ status: 'unauthenticated', reason, message: error.message || '' });
          }
        } else {
          setAuthState({ status: 'error', reason, message: error.message || '' });
        }
      }
    } finally {
      if (isCurrentCheck()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSignInScreen(window.location.pathname)) {
      checkAuth();
      return undefined;
    }
    // Nothing on the sign-in screen waits for the session check, so let the
    // form reach the screen first. When /api/auth/me completed before that
    // paint, Lighthouse's simulation charged its whole round trip (plus the
    // script work that starts it) to the login page's largest contentful
    // paint.
    return afterFirstContentfulPaint(checkAuth);
  }, [checkAuth]);

  const login = useCallback(async (email, password, returnTo = '/dashboard') => {
    authCheckSequenceRef.current += 1;
    const { user: userData } = await api.login(email, password);
    await purgePrivateCaches();
    if (mountedRef.current) {
      setUser(userData);
      setAuthState({ status: 'authenticated', reason: null, message: '' });
      navigate(safeReturnPath(returnTo), { replace: true });
    }
    return userData;
  }, [navigate]);

  const logout = useCallback(async () => {
    authCheckSequenceRef.current += 1;
    await clearBrowserPushSubscription({ removeFromServer: true });
    try {
      await api.logout();
    } catch {
      // Even if logout API call fails, clear local state
    }
    await purgePrivateCaches();
    if (mountedRef.current) {
      setUser(null);
      setAuthState({ status: 'unauthenticated', reason: 'signed_out', message: '' });
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const expireSession = useCallback(async (message = '', reason = sessionEndReason(message)) => {
    authCheckSequenceRef.current += 1;
    await clearBrowserPushSubscription();
    await purgePrivateCaches();
    if (!mountedRef.current) return;
    const returnTo = safeReturnPath(`${location.pathname}${location.search}${location.hash}`);
    setUser(null);
    setAuthState({ status: 'unauthenticated', reason, message });
    navigate('/login', { replace: true, state: { reason, message, returnTo } });
  }, [location.hash, location.pathname, location.search, navigate]);

  return (
    <AuthContext.Provider value={{ user, isLoading, authState, login, logout, expireSession, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
