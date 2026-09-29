import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: { redeemBreakGlass: vi.fn() } }));
const { api } = await import('../lib/api');
const { default: BreakGlass, tokenFromHash } = await import('../pages/BreakGlass');

const TOKEN = 'a'.repeat(43);

// The test setup replaces window.location with a plain object.
function renderPage(hash) {
  window.location = { ...window.location, hash, pathname: '/break-glass' };
  return render(<MemoryRouter><BreakGlass /></MemoryRouter>);
}

describe('Break-glass recovery page (#416)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  it('reads the token only from the URL fragment', () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash('#token=short')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });

  it('explains a missing token', () => {
    renderPage('');
    expect(screen.getByRole('alert')).toHaveTextContent(/missing its token/);
  });

  it('removes the token from the address bar and redeems it with a new password', async () => {
    api.redeemBreakGlass.mockResolvedValue({ success: true, mfaReset: true });
    renderPage(`#token=${TOKEN}`);
    await waitFor(() => expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/break-glass'));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Fresh-Start-2026' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Different-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/);
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Fresh-Start-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore access' }));
    await waitFor(() => expect(api.redeemBreakGlass).toHaveBeenCalledWith(TOKEN, 'Fresh-Start-2026'));
    expect(await screen.findByRole('status')).toHaveTextContent(/Two-factor authentication was turned off/);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows a used or expired link as an error', async () => {
    api.redeemBreakGlass.mockRejectedValue(Object.assign(new Error('This emergency access link is invalid, used or expired.'), { status: 400 }));
    renderPage(`#token=${TOKEN}`);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Fresh-Start-2026' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Fresh-Start-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid, used or expired/);
  });
});
