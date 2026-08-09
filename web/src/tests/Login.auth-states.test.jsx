import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../pages/Login';

const login = vi.fn();

vi.mock('../hooks/useAuth', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, useAuth: () => ({ login }) };
});

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login authentication states', () => {
  beforeEach(() => login.mockReset());

  it('explains expiry, removes the nonfunctional remember control, and restores a safe path', async () => {
    login.mockResolvedValue({ id: 'user-one' });
    renderLogin({
      pathname: '/login',
      state: { reason: 'expired', returnTo: '/projects?create=true' },
    });

    expect(screen.getByRole('status')).toHaveTextContent(/session expired/i);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith(
      'person@example.com',
      'password',
      '/projects?create=true',
    ));
  });

  it('announces sign-in progress without relying on a spinner', async () => {
    login.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ id: 'user-one' }), 1000);
    }));
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('button', { name: /signing in/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /signing in/i }).closest('form')).toHaveAttribute('aria-busy', 'true');

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled());
  });

});
