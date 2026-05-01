import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const userData = await api.me();
      if (mountedRef.current) setUser(userData);
    } catch {
      if (mountedRef.current) setUser(null);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (email, password) => {
    const { user: userData } = await api.login(email, password);
    if (mountedRef.current) {
      setUser(userData);
      navigate('/');
    }
    return userData;
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if logout API call fails, clear local state
    }
    if (mountedRef.current) {
      setUser(null);
      navigate('/login');
    }
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkAuth }}>
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