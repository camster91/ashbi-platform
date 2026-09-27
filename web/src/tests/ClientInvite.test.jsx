import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientInvite from '../pages/ClientInvite';

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/client/invite" element={<ClientInvite />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'olivia@northwind.example' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Str0ng!Passphrase' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Str0ng!Passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
}

describe('client invitation page', () => {
  const assign = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  it('accepts the invite token, creates the account and opens the client portal', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ user: { role: 'CLIENT' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/client/invite?token=abc123');
    expect(screen.getByRole('heading', { name: 'Accept your invitation' })).toBeInTheDocument();
    fillForm();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/client-portal'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/client/signup');
    expect(JSON.parse(init.body)).toEqual({ token: 'abc123', email: 'olivia@northwind.example', password: 'Str0ng!Passphrase' });
  });

  it('explains an expired invitation instead of sending the invitee to staff login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Invitation expired' }) })));
    renderAt('/client/invite?token=abc123');
    fillForm();
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation has expired');
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows guidance when the link has no token', () => {
    renderAt('/client/invite');
    expect(screen.getByRole('alert')).toHaveTextContent('This invitation link is incomplete.');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
