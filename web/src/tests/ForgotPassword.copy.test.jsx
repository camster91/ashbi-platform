import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from '../pages/ForgotPassword';

describe('ForgotPassword confirmation copy', () => {
  beforeEach(() => {
    localStorage.setItem('hub_language', 'en');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ message: 'ok' }) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('does not claim an email was sent to an address that may have no account', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ForgotPassword /></MemoryRouter>);

    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: /reset link/i }));

    const confirmation = await screen.findByText(/If an account exists for/);
    expect(confirmation).toHaveTextContent("If an account exists for nobody@example.com, we've sent a reset link.");
    expect(screen.queryByText(/We've sent a password reset link to/)).toBeNull();
  });
});
