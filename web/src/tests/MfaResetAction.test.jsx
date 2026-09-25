import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { adminResetMfa: vi.fn(), getMfaStatus: vi.fn() },
}));

const { api } = await import('../lib/api');
const { default: MfaResetAction } = await import('../components/MfaResetAction');

const member = { id: 'user-7', name: 'Robin', email: 'robin@agency.test', mfaEnabled: true, mfaLocked: true };

function renderAction(onReset = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MfaResetAction member={member} onReset={onReset} />
    </QueryClientProvider>,
  );
  return onReset;
}

describe('Team → admin two-factor reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: false });
  });

  it('confirms with the admin password before resetting', async () => {
    api.adminResetMfa.mockResolvedValue({ reset: true });
    const onReset = renderAction();

    fireEvent.click(screen.getByRole('button', { name: /reset two-factor authentication for robin/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/clears the lockout/i);
    expect(dialog).toHaveTextContent(/signs them out everywhere/i);

    fireEvent.click(screen.getByRole('button', { name: /^reset two-factor authentication$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your password/i);
    expect(api.adminResetMfa).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'admin-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset two-factor authentication$/i }));

    await waitFor(() => expect(api.adminResetMfa).toHaveBeenCalledWith('user-7', { password: 'admin-password' }));
    expect(screen.queryByLabelText(/your authentication code/i)).not.toBeInTheDocument();
    await waitFor(() => expect(onReset).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('announces a rejected password and keeps the dialog open', async () => {
    api.adminResetMfa.mockRejectedValue(new Error('Current password is incorrect'));
    const onReset = renderAction();

    fireEvent.click(screen.getByRole('button', { name: /reset two-factor authentication for robin/i }));
    fireEvent.change(await screen.findByLabelText(/your password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset two-factor authentication$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("asks for the admin's own code when their account uses two-factor authentication", async () => {
    api.getMfaStatus.mockResolvedValue({ eligible: true, enabled: true });
    api.adminResetMfa.mockResolvedValue({ reset: true });
    renderAction();

    fireEvent.click(screen.getByRole('button', { name: /reset two-factor authentication for robin/i }));
    const codeInput = await screen.findByLabelText(/your authentication code/i);
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    expect(codeInput).toHaveAttribute('inputmode', 'numeric');

    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'admin-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset two-factor authentication$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/6-digit code/i);
    expect(api.adminResetMfa).not.toHaveBeenCalled();

    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset two-factor authentication$/i }));
    await waitFor(() => expect(api.adminResetMfa).toHaveBeenCalledWith('user-7', { password: 'admin-password', code: '123456' }));
  });

  it('shows the code field when the server says one is required', async () => {
    api.adminResetMfa.mockRejectedValueOnce(Object.assign(new Error('Enter your authentication code or a recovery code'), { status: 400, data: { code: 'MFA_CODE_REQUIRED' } }));
    renderAction();

    fireEvent.click(screen.getByRole('button', { name: /reset two-factor authentication for robin/i }));
    fireEvent.change(await screen.findByLabelText(/your password/i), { target: { value: 'admin-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset two-factor authentication$/i }));

    expect(await screen.findByLabelText(/your authentication code/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/authentication code/i);
  });
});
