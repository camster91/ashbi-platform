import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Organization MFA requirement: the redirect to two-factor setup, from a
// sign-in that already says so and from a 403 MFA_ENROLLMENT_REQUIRED that
// arrives mid-session, and the setup page itself.

vi.mock('../lib/api', () => ({
  api: {
    me: vi.fn(),
    logout: vi.fn(),
    getMfaStatus: vi.fn(),
    startMfaEnrollment: vi.fn(),
    confirmMfaEnrollment: vi.fn(),
    disableMfa: vi.fn(),
  },
  setUnauthorizedCallback: vi.fn(),
  setApiErrorCallback: vi.fn(),
}));
vi.mock('../lib/private-cache', () => ({ purgePrivateCaches: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/navigation', () => ({ reloadTo: vi.fn() }));
vi.mock('../hooks/usePushNotifications', () => ({ clearBrowserPushSubscription: vi.fn().mockResolvedValue(undefined) }));

const { api } = await import('../lib/api');
const { reloadTo } = await import('../lib/navigation');
const { AuthProvider } = await import('../hooks/useAuth');
const { default: MfaEnrollmentGate } = await import('../components/MfaEnrollmentGate');
const { default: MfaEnrollmentRequired } = await import('../pages/MfaEnrollmentRequired');
const { announceMfaEnrollmentRequired, MFA_ENROLLMENT_PATH } = await import('../lib/mfa-enrollment');

const STAFF = { id: 'u1', email: 'staff@agency.test', name: 'Staff', role: 'STAFF', skills: [] };

function renderApp(path = '/dashboard') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route path="/dashboard" element={<MfaEnrollmentGate><h1>Dashboard</h1></MfaEnrollmentGate>} />
            <Route path="/settings" element={<h1>Settings page</h1>} />
            <Route path={MFA_ENROLLMENT_PATH} element={<MfaEnrollmentGate><MfaEnrollmentRequired /></MfaEnrollmentGate>} />
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('two-factor setup redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: false, pendingEnrollment: false, recoveryCodesRemaining: 0, requiredByOrganization: true });
  });

  it('sends a restricted session straight to setup, with the explanation focused', async () => {
    api.me.mockResolvedValue({ ...STAFF, mfaEnrollmentRequired: true });
    renderApp('/dashboard');

    const heading = await screen.findByRole('heading', { name: /set up two-factor authentication/i });
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/your organization requires two-factor authentication for every staff account/i)).toBeInTheDocument();
    expect(await screen.findByRole('form', { name: /set up two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('moves to setup when the API refuses a request mid-session', async () => {
    api.me.mockResolvedValue({ ...STAFF, mfaEnrollmentRequired: false });
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    act(() => { announceMfaEnrollmentRequired(); });

    expect(await screen.findByRole('heading', { name: /set up two-factor authentication/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('leaves unrestricted sessions alone and sends them away from the setup page', async () => {
    api.me.mockResolvedValue({ ...STAFF, mfaEnrollmentRequired: false });
    renderApp(MFA_ENROLLMENT_PATH);
    expect(await screen.findByRole('heading', { name: 'Settings page' })).toBeInTheDocument();
  });

  it('continues into the app once enrollment is complete, without signing in again', async () => {
    api.me.mockResolvedValue({ ...STAFF, mfaEnrollmentRequired: true });
    api.startMfaEnrollment.mockResolvedValue({ secret: 'AAAABBBBCCCCDDDD', otpauthUri: 'otpauth://totp/x?secret=AAAABBBBCCCCDDDD' });
    api.confirmMfaEnrollment.mockResolvedValue({ enabled: true, recoveryCodes: ['abcd-efgh-jkmn-pqrs'] });
    renderApp('/dashboard');

    fireEvent.change(await screen.findByLabelText(/current password/i), { target: { value: 'hunter22-password' } });
    fireEvent.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
    fireEvent.change(await screen.findByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /turn on two-factor authentication/i }));
    fireEvent.click(await screen.findByRole('button', { name: /i have saved my codes/i }));

    await waitFor(() => expect(reloadTo).toHaveBeenCalledWith('/dashboard'));
    expect(api.me).toHaveBeenCalledTimes(1);
  });
});
