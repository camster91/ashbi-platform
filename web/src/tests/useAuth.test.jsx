/**
 * useAuth Hook Tests
 *
 * Tests the authentication context provider and hook behavior
 * including login, logout, checkAuth, and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';

// Mock the API module
vi.mock('../lib/api', () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
  setUnauthorizedCallback: vi.fn(),
  setApiErrorCallback: vi.fn(),
}));

// Import the mocked api after vi.mock
import { api } from '../lib/api';

// Wrapper that includes router context (useNavigate requires it)
function wrapper({ children }) {
  return (
    <BrowserRouter>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  );
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider requirements', () => {
    it('throws when useAuth is called outside AuthProvider', () => {
      const originalError = console.error;
      console.error = vi.fn();

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');

      console.error = originalError;
    });
  });

  describe('initial state', () => {
    it('starts with isLoading=true', () => {
      api.me.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.user).toBeNull();
    });

    it('sets user when checkAuth succeeds', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'ADMIN' };
      api.me.mockResolvedValue(mockUser);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
    });

    it('sets user to null when checkAuth fails (not authenticated)', async () => {
      api.me.mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toBeNull();
    });
  });

  describe('login', () => {
    it('calls api.login and sets user on success', async () => {
      const mockUser = { id: '1', email: 'test@example.com', name: 'Test', role: 'ADMIN' };
      api.me.mockRejectedValue(new Error('Unauthorized'));
      api.login.mockResolvedValue({ user: mockUser });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let loggedInUser;
      await act(async () => {
        loggedInUser = await result.current.login('test@example.com', 'password123');
      });

      expect(api.login).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(result.current.user).toEqual(mockUser);
      expect(loggedInUser).toEqual(mockUser);
    });

    it('propagates login errors', async () => {
      api.me.mockRejectedValue(new Error('Unauthorized'));
      api.login.mockRejectedValue(new Error('Invalid credentials'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.login('bad@example.com', 'wrong');
        })
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('logout', () => {
    it('calls api.logout and clears user', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'ADMIN' };
      api.me.mockResolvedValue(mockUser);
      api.logout.mockResolvedValue({});

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);

      await act(async () => {
        await result.current.logout();
      });

      expect(api.logout).toHaveBeenCalled();
      expect(result.current.user).toBeNull();
    });

    it('clears user even if api.logout fails', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'ADMIN' };
      api.me.mockResolvedValue(mockUser);
      api.logout.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
    });
  });

  describe('checkAuth', () => {
    it('can be called manually to refresh user state', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'ADMIN' };
      api.me.mockResolvedValue(mockUser);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Clear the mock to verify it's called again
      api.me.mockClear();
      api.me.mockResolvedValue({ id: '2', email: 'updated@example.com', role: 'USER' });

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(api.me).toHaveBeenCalledTimes(1);
      expect(result.current.user.email).toBe('updated@example.com');
    });

    it('handles checkAuth failure gracefully', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'ADMIN' };
      api.me.mockResolvedValue(mockUser);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Now simulate a session expiry
      api.me.mockRejectedValue(new Error('Unauthorized'));

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(result.current.user).toBeNull();
    });
  });

  describe('memoization', () => {
    it('login function is stable across renders', async () => {
      api.me.mockResolvedValue({ id: '1', email: 'test@example.com' });

      const { result, rerender } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstLogin = result.current.login;
      rerender();
      const secondLogin = result.current.login;

      expect(firstLogin).toBe(secondLogin);
    });

    it('logout function is stable across renders', async () => {
      api.me.mockResolvedValue({ id: '1', email: 'test@example.com' });

      const { result, rerender } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstLogout = result.current.logout;
      rerender();
      const secondLogout = result.current.logout;

      expect(firstLogout).toBe(secondLogout);
    });
  });
});