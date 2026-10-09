import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen } from '../pages/ClientPortal';

afterEach(() => vi.unstubAllGlobals());
describe('returning client password sign-in', () => {
  it('uses the normal client login endpoint and opens the portal only after success', async () => {
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const signedIn = vi.fn();
    render(<LoginScreen onSignedIn={signedIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a password' }));
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'qa@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In', exact: true }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/auth\/client\/login$/);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: 'qa@example.invalid', password: 'synthetic-test-password' });
  });
  it('keeps a rejected password on the sign-in screen with an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const signedIn = vi.fn();
    render(<LoginScreen onSignedIn={signedIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a password' }));
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'qa@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(signedIn).not.toHaveBeenCalled();
  });
});
