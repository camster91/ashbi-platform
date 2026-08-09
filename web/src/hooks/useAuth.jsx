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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authState, setAuthState] = useState({ status: 'checking', reason: null, message: '' });
  const navigate = useNavigate();
  const location = useLocation();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const checkAuth = useCallback(async () => {
    if (mountedRef.current) {
      setIsLoading(true);
      setAuthState((current) => ({ ...current, status: 'checking' }));
    }
    try {
      const userData = await api.me();
      if (mountedRef.current) {
        setUser(userData);
        setAuthState({ status: 'authenticated', reason: null, message: '' });
      }
    } catch (error) {
      if (mountedRef.current) {
        const reason = authFailureReason(error);
        if (reason === 'signed_out') {
          await purgePrivateCaches();
          setUser(null);
          setAuthState({ status: 'unauthenticated', reason, message: error.message || '' });
        } else {
          setAuthState({ status: 'error', reason, message: error.message || '' });
        }
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (email, password, returnTo = '/dashboard') => {
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

  const expireSession = useCallback(async (message = '') => {
    await clearBrowserPushSubscription();
    await purgePrivateCaches();
    if (!mountedRef.current) return;
    const returnTo = safeReturnPath(`${location.pathname}${location.search}${location.hash}`);
    setUser(null);
    setAuthState({ status: 'unauthenticated', reason: 'expired', message });
    navigate('/login', { replace: true, state: { reason: 'expired', message, returnTo } });
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
