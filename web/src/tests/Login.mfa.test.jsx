import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../pages/Login';

const login = vi.fn();
const completeMfaLogin = vi.fn();

vi.mock('../hooks/useAuth', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, useAuth: () => ({ login, completeMfaLogin }) };
});

function apiError(message, status, data = {}) {
  return Object.assign(new Error(message), { status, data: { error: message, ...data } });
}

async function reachSecondStep(entry = '/login') {
  login.mockResolvedValue({ mfaRequired: true, challengeToken: 'mfa.challenge.sig', expiresInSeconds: 300 });
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Login />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'staff@example.com' } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  return screen.findByLabelText('Authentication code');
}

describe('Login two-factor step', () => {
  beforeEach(() => {
    login.mockReset();
    completeMfaLogin.mockReset();
  });

  it('asks for an authenticator code with one-time-code autofill and a numeric keypad', async () => {
    const input = await reachSecondStep();

    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAccessibleDescription(/authenticator app/i);
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it('completes sign-in with the challenge, code and return path', async () => {
    completeMfaLogin.mockResolvedValue({ user: { id: 'u1' } });
    const input = await reachSecondStep({ pathname: '/login', state: { returnTo: '/invoices' } });

    fireEvent.change(input, { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => expect(completeMfaLogin).toHaveBeenCalledWith('mfa.challenge.sig', { code: '123456' }, '/invoices'));
  });

  it('announces a wrong code and validates the format before submitting', async () => {
    const input = await reachSecondStep();

    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/6-digit code/i);
    expect(completeMfaLogin).not.toHaveBeenCalled();

    completeMfaLogin.mockRejectedValue(apiError('Invalid authentication code', 401));
    fireEvent.change(input, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(await screen.findByText('Invalid authentication code')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid authentication code');
    expect(screen.getByLabelText('Authentication code')).toHaveAttribute('aria-invalid', 'true');
  });

  it('accepts a recovery code instead', async () => {
    completeMfaLogin.mockResolvedValue({ user: { id: 'u1' } });
    await reachSecondStep();

    fireEvent.click(screen.getByRole('button', { name: /use a recovery code instead/i }));
    const input = screen.getByLabelText('Recovery code');
    fireEvent.change(input, { target: { value: 'abcd-efgh-jkmn-pqrs' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => expect(completeMfaLogin).toHaveBeenCalledWith(
      'mfa.challenge.sig',
      { recoveryCode: 'abcd-efgh-jkmn-pqrs' },
      '/dashboard',
    ));
  });

  it('returns to the password step when the challenge has expired', async () => {
    completeMfaLogin.mockRejectedValue(apiError('Your sign-in attempt expired. Enter your email and password again.', 401, { code: 'MFA_CHALLENGE_EXPIRED' }));
    const input = await reachSecondStep();

    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in attempt expired/i);
  });

  it('can go back to the password step', async () => {
    await reachSecondStep();
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('');
  });
});
