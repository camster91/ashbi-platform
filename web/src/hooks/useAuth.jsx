import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { purgePrivateCaches } from '../lib/private-cache';
import { reloadTo } from '../lib/navigation';
import { MFA_ENROLLMENT_REQUIRED_EVENT } from '../lib/mfa-enrollment';
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
  if (error?.status === 429) return 'rate_limited';
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

const RATE_LIMIT_RETRY_DEFAULT_MS = 5_000;
const RATE_LIMIT_RETRY_MAX_MS = 60_000;

// How long to wait before re-checking the session after a 429: the server's
// Retry-After when present, bounded so the app never waits indefinitely.
export function rateLimitRetryDelayMs(error) {
  const seconds = error?.retryAfterSeconds;
  if (!Number.isFinite(seconds)) return RATE_LIMIT_RETRY_DEFAULT_MS;
  return Math.min(Math.max(seconds * 1000, 1_000), RATE_LIMIT_RETRY_MAX_MS);
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
  const userRef = useRef(null);
  const retryTimerRef = useRef(null);
  const checkAuthRef = useRef(null);
  userRef.current = user;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authCheckSequenceRef.current += 1;
      clearTimeout(retryTimerRef.current);
    };
  }, []);

  const checkAuth = useCallback(async () => {
    const sequence = ++authCheckSequenceRef.current;
    const isCurrentCheck = () => mountedRef.current && sequence === authCheckSequenceRef.current;
    clearTimeout(retryTimerRef.current);
    let waitingToRetry = false;
    if (mountedRef.current) {
      // A re-check keeps an already signed-in app on screen.
      if (!userRef.current) setIsLoading(true);
      setAuthState((current) => ({ ...current, status: userRef.current ? 'authenticated' : 'checking' }));
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
        if (reason === 'rate_limited') {
          // Too many requests is "retry later", never "signed out" or a
          // blocking error: keep any session on screen, show a notice, and
          // re-check after Retry-After.
          const retryInMs = rateLimitRetryDelayMs(error);
          waitingToRetry = !userRef.current;
          setAuthState({
            status: userRef.current ? 'authenticated' : 'checking',
            reason,
            message: error.message || '',
            retryInMs,
          });
          retryTimerRef.current = setTimeout(() => {
            if (isCurrentCheck()) checkAuthRef.current?.();
          }, retryInMs);
        } else if (reason === 'signed_out') {
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
      if (isCurrentCheck() && !waitingToRetry) setIsLoading(false);
    }
  }, []);
  checkAuthRef.current = checkAuth;

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

  // Invalidate any in-flight session check and cancel a scheduled 429 retry.
  // A pending rate-limited check keeps isLoading true until its retry runs;
  // once invalidated that retry never runs, so isLoading must be settled
  // here or private routes would spin forever (e.g. a sign-in that
  // succeeds while the retry is still scheduled).
  const cancelPendingAuthCheck = useCallback(() => {
    authCheckSequenceRef.current += 1;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    if (mountedRef.current) setIsLoading(false);
  }, []);

  const finishSignIn = useCallback(async (userData, returnTo) => {
    await purgePrivateCaches();
    if (mountedRef.current) {
      cancelPendingAuthCheck();
      setUser(userData);
      setAuthState({ status: 'authenticated', reason: null, message: '' });
      navigate(safeReturnPath(returnTo), { replace: true });
    }
    return userData;
  }, [cancelPendingAuthCheck, navigate]);

  // Resolves to the signed-in user, or — for staff accounts with two-factor
  // authentication — to { mfaRequired, challengeToken } without a session yet.
  const login = useCallback(async (email, password, returnTo = '/dashboard') => {
    cancelPendingAuthCheck();
    const result = await api.login(email, password);
    if (result?.mfaRequired) {
      return { mfaRequired: true, challengeToken: result.challengeToken, expiresInSeconds: result.expiresInSeconds };
    }
    return finishSignIn(result.user, returnTo);
  }, [cancelPendingAuthCheck, finishSignIn]);

  // Second sign-in step: factor is { code } or { recoveryCode }.
  const completeMfaLogin = useCallback(async (challengeToken, factor, returnTo = '/dashboard') => {
    cancelPendingAuthCheck();
    const result = await api.loginMfa({ challengeToken, ...factor });
    await finishSignIn(result.user, returnTo);
    return result;
  }, [cancelPendingAuthCheck, finishSignIn]);

  const logout = useCallback(async () => {
    cancelPendingAuthCheck();
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
  }, [cancelPendingAuthCheck, navigate]);

  const expireSession = useCallback(async (message = '', reason = sessionEndReason(message)) => {
    cancelPendingAuthCheck();
    await clearBrowserPushSubscription();
    await purgePrivateCaches();
    if (!mountedRef.current) return;
    const returnTo = safeReturnPath(`${location.pathname}${location.search}${location.hash}`);
    setUser(null);
    setAuthState({ status: 'unauthenticated', reason, message });
    navigate('/login', { replace: true, state: { reason, message, returnTo } });
  }, [cancelPendingAuthCheck, location.hash, location.pathname, location.search, navigate]);

  // Organization MFA requirement: any API answer of 403
  // MFA_ENROLLMENT_REQUIRED (the requirement was turned on during this
  // session, or two-factor was reset) marks the signed-in user, and
  // MfaEnrollmentGate then routes them to setup.
  useEffect(() => {
    const markRequired = () => {
      setUser((current) => (current && !current.mfaEnrollmentRequired ? { ...current, mfaEnrollmentRequired: true } : current));
    };
    window.addEventListener(MFA_ENROLLMENT_REQUIRED_EVENT, markRequired);
    return () => window.removeEventListener(MFA_ENROLLMENT_REQUIRED_EVENT, markRequired);
  }, []);

  // After enrolling, the same session has full access again. Reload so the
  // queries and the realtime connection refused while it was restricted
  // start fresh.
  const completeMfaEnrollment = useCallback(async (to = '/dashboard') => {
    authCheckSequenceRef.current += 1;
    await purgePrivateCaches();
    reloadTo(to);
  }, []);

  // Support impersonation (#416): the server keeps the admin's own session
  // and adds a read-only view cookie; /auth/me then answers as the viewed
  // person with an `impersonation` block. Both transitions reload the app so
  // no cached data or socket of the previous identity survives.
  const startImpersonation = useCallback(async (member, reason) => {
    authCheckSequenceRef.current += 1;
    const result = await api.startImpersonation(member.id, reason);
    await purgePrivateCaches();
    reloadTo(result?.session?.subject?.role === 'CLIENT' ? '/client/dashboard' : '/dashboard');
    return result;
  }, []);

  const stopImpersonation = useCallback(async ({ to = '/team' } = {}) => {
    authCheckSequenceRef.current += 1;
    try {
      await api.stopImpersonation();
    } catch {
      // The view may already have ended (expired or revoked); continue.
    }
    await purgePrivateCaches();
    reloadTo(to);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, authState, login, completeMfaLogin, completeMfaEnrollment, logout, expireSession, checkAuth, startImpersonation, stopImpersonation }}>
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
