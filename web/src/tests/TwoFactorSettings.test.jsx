import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getMfaStatus: vi.fn(),
    startMfaEnrollment: vi.fn(),
    confirmMfaEnrollment: vi.fn(),
    disableMfa: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: TwoFactorSettings, formatSecret } = await import('../components/TwoFactorSettings');

const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `abc${i}-defg-hjkm-npqr`);

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TwoFactorSettings />
    </QueryClientProvider>,
  );
}

describe('Settings → Security two-factor authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups the setup key for manual entry', () => {
    expect(formatSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });

  it('enrolls with the setup key, confirms a code and shows recovery codes once', async () => {
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: false, pendingEnrollment: false, recoveryCodesRemaining: 0 });
    api.startMfaEnrollment.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Ashbi%20Hub%3Astaff%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ashbi+Hub',
    });
    api.confirmMfaEnrollment.mockResolvedValue({ enabled: true, recoveryCodes: RECOVERY_CODES });
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSection();

    expect(await screen.findByText(/off/i, { selector: 'p' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: /set up two-factor authentication/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/current password/i);
    expect(api.startMfaEnrollment).not.toHaveBeenCalled();

    const passwordInput = screen.getByLabelText(/current password/i);
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    fireEvent.change(passwordInput, { target: { value: 'hunter22-password' } });
    fireEvent.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
    await waitFor(() => expect(api.startMfaEnrollment).toHaveBeenCalledWith('hunter22-password'));

    expect(await screen.findByTestId('mfa-setup-key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(screen.getByRole('link', { name: /open in authenticator app/i })).toHaveAttribute('href', expect.stringMatching(/^otpauth:\/\/totp\//));

    const codeInput = screen.getByLabelText(/enter the 6-digit code/i);
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    expect(codeInput).toHaveAttribute('inputmode', 'numeric');

    fireEvent.change(codeInput, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /turn on two-factor authentication/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/6-digit code/i);
    expect(api.confirmMfaEnrollment).not.toHaveBeenCalled();

    fireEvent.change(codeInput, { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: /turn on two-factor authentication/i }));
    await waitFor(() => expect(api.confirmMfaEnrollment).toHaveBeenCalledWith('123456'));

    const list = await screen.findByRole('list', { name: /recovery codes/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copy codes/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RECOVERY_CODES.join('\n')));
    expect(screen.getByRole('button', { name: /download codes/i })).toBeInTheDocument();

    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: true, enabledAt: '2026-09-25T00:00:00.000Z', recoveryCodesRemaining: 10 });
    fireEvent.click(screen.getByRole('button', { name: /i have saved my codes/i }));
    expect(await screen.findByText(/10 of 10 recovery codes remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/API keys you already created keep working/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /recovery codes/i })).not.toBeInTheDocument();
  });

  it('announces a rejected confirmation code', async () => {
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: false, recoveryCodesRemaining: 0 });
    api.startMfaEnrollment.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
    api.confirmMfaEnrollment.mockRejectedValue(new Error('That code did not match. Check the time on your device and try the current code.'));
    renderSection();

    fireEvent.change(await screen.findByLabelText(/current password/i), { target: { value: 'hunter22-password' } });
    fireEvent.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
    const codeInput = await screen.findByLabelText(/enter the 6-digit code/i);
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /turn on two-factor authentication/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not match/i);
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables only with the current password and a code', async () => {
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: true, enabledAt: '2026-09-25T00:00:00.000Z', recoveryCodesRemaining: 2 });
    api.disableMfa.mockResolvedValue({ enabled: false });
    renderSection();

    expect(await screen.findByText(/2 of 10 recovery codes remaining/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /turn off two-factor authentication/i });

    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '123456' } });
    fireEvent.submit(submit.closest('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/current password/i);
    expect(api.disableMfa).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'hunter22-password' } });
    fireEvent.click(screen.getByRole('button', { name: /use a recovery code instead/i }));
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abcd-efgh-jkmn-pqrs' } });
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: false, recoveryCodesRemaining: 0 });
    fireEvent.click(submit);

    await waitFor(() => expect(api.disableMfa).toHaveBeenCalledWith({ password: 'hunter22-password', recoveryCode: 'abcd-efgh-jkmn-pqrs' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/is off/i);
  });
});
