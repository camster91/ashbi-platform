import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { request: vi.fn(), reauth: vi.fn() },
  setReauthHandler: vi.fn(),
}));

const { api, setReauthHandler } = await import('../lib/api');
const { ReauthDialog, ReauthProvider } = await import('../components/ReauthDialog');

function renderDialog({ onSuccess = vi.fn(), onCancel = vi.fn() } = {}) {
  render(<ReauthDialog isOpen onSuccess={onSuccess} onCancel={onCancel} />);
  return { onSuccess, onCancel };
}

describe('ReauthDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a labelled modal dialog that asks a password-only user for their password', async () => {
    api.request.mockResolvedValue({ enabled: false });
    api.reauth.mockResolvedValue({ reauthenticated: true });
    const { onSuccess } = renderDialog();

    const dialog = screen.getByRole('dialog', { name: /confirm it’s you/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const field = await screen.findByLabelText(/^password$/i);
    await waitFor(() => expect(field).toHaveFocus());
    expect(api.request).toHaveBeenCalledWith('/auth/mfa', { silent: true });

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your password/i);
    expect(api.reauth).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(api.reauth).toHaveBeenCalledWith({ password: 'my-password' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('asks a two-factor user for a code and can switch to a recovery code', async () => {
    api.request.mockResolvedValue({ enabled: true });
    api.reauth.mockResolvedValue({ reauthenticated: true });
    const { onSuccess } = renderDialog();

    const code = await screen.findByLabelText(/authentication code/i);
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    fireEvent.change(code, { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(api.reauth).toHaveBeenCalledWith({ code: '123456' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /use a recovery code instead/i }));
    const recovery = screen.getByLabelText(/recovery code/i);
    fireEvent.change(recovery, { target: { value: 'abcd-efgh-jkmn-pqrs' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(api.reauth).toHaveBeenLastCalledWith({ code: 'abcd-efgh-jkmn-pqrs' }));
  });

  it('announces a rejected password and stays open', async () => {
    api.request.mockResolvedValue({ enabled: false });
    api.reauth.mockRejectedValue(Object.assign(new Error('Current password is incorrect'), { status: 400, data: {} }));
    const { onSuccess, onCancel } = renderDialog();

    fireEvent.change(await screen.findByLabelText(/^password$/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('aria-invalid', 'true');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('switches to a code when the server says two-factor is required', async () => {
    api.request.mockRejectedValue(new Error('offline'));
    api.reauth.mockRejectedValue(Object.assign(new Error('Enter your authentication code or a recovery code'), {
      status: 400, data: { code: 'MFA_CODE_REQUIRED' },
    }));
    renderDialog();

    fireEvent.change(await screen.findByLabelText(/^password$/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(await screen.findByLabelText(/authentication code/i)).toBeInTheDocument();
  });

  it('cancels with Escape', async () => {
    api.request.mockResolvedValue({ enabled: false });
    const { onCancel } = renderDialog();
    await screen.findByLabelText(/^password$/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab focus inside the dialog', async () => {
    api.request.mockResolvedValue({ enabled: false });
    renderDialog();
    await screen.findByLabelText(/^password$/i);
    const confirm = screen.getByRole('button', { name: /^confirm$/i });
    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('ReauthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.request.mockResolvedValue({ enabled: false });
  });

  it('registers an API-layer handler that resolves true after re-authentication', async () => {
    api.reauth.mockResolvedValue({ reauthenticated: true });
    render(<ReauthProvider><p>App</p></ReauthProvider>);
    await waitFor(() => expect(setReauthHandler).toHaveBeenCalledWith(expect.any(Function)));
    const handler = setReauthHandler.mock.calls.findLast(([fn]) => typeof fn === 'function')[0];

    let result;
    handler({ endpoint: '/api-keys' }).then((value) => { result = value; });
    fireEvent.change(await screen.findByLabelText(/^password$/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(result).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resolves false when the user cancels', async () => {
    render(<ReauthProvider><p>App</p></ReauthProvider>);
    await waitFor(() => expect(setReauthHandler).toHaveBeenCalledWith(expect.any(Function)));
    const handler = setReauthHandler.mock.calls.findLast(([fn]) => typeof fn === 'function')[0];

    let result;
    handler({ endpoint: '/api-keys' }).then((value) => { result = value; });
    await screen.findByLabelText(/^password$/i);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(result).toBe(false));
    expect(api.reauth).not.toHaveBeenCalled();
  });
});
