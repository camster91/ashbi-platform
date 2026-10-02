import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { AuthProvider, isPublicPagePath, useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  setUnauthorizedCallback: vi.fn(),
  setApiErrorCallback: vi.fn(),
}));
vi.mock('../lib/private-cache', () => ({ purgePrivateCaches: vi.fn().mockResolvedValue(undefined) }));

let navigateTo;
function Probe() {
  const { user, isLoading } = useAuth();
  navigateTo = useNavigate();
  return <p>{isLoading ? 'loading' : user ? `user:${user.id}` : 'signed-out'}</p>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><Probe /></AuthProvider>
    </MemoryRouter>,
  );
}

describe('session check on public pages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('classifies the public pages', () => {
    for (const path of ['/portal/invoice/t', '/portal/proposal/t', '/portal/estimate/t', '/portal/book', '/forgot-password', '/reset-password']) {
      expect(isPublicPagePath(path)).toBe(true);
    }
    for (const path of ['/dashboard', '/login', '/client/dashboard', '/client/abc', '/']) {
      expect(isPublicPagePath(path)).toBe(false);
    }
  });

  it('does not call /api/auth/me on a public page, and checks once the visitor moves on', async () => {
    api.me.mockResolvedValue({ id: 'u1' });
    renderAt('/portal/invoice/abc');
    await act(async () => {});
    expect(api.me).not.toHaveBeenCalled();

    act(() => navigateTo('/dashboard'));
    await waitFor(() => expect(screen.getByText('user:u1')).toBeInTheDocument());
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('still checks the session on staff pages', async () => {
    api.me.mockResolvedValue({ id: 'u2' });
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getByText('user:u2')).toBeInTheDocument());
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('finishes the session check under StrictMode (mount, unmount, remount)', async () => {
    api.me.mockResolvedValue({ id: 'u3' });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider><Probe /></AuthProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText('user:u3')).toBeInTheDocument());
  });

  it('does not check again when a signed-in visitor opens a public page and comes back', async () => {
    api.me.mockResolvedValue({ id: 'u4' });
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getByText('user:u4')).toBeInTheDocument());
    act(() => navigateTo('/portal/invoice/abc'));
    act(() => navigateTo('/dashboard'));
    await act(async () => {});
    expect(api.me).toHaveBeenCalledTimes(1);
    expect(screen.getByText('user:u4')).toBeInTheDocument();
  });
});
