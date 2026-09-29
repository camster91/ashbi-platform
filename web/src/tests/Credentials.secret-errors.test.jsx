import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const credential = { id: 'cred-1', label: 'WP Admin', username: 'admin', category: 'WEBSITE', client: { id: 'c1', name: 'Northwind' } };
// A plain function (not a spy) so a rejected read is only observed by the page.
const calls = [];
let passwordImpl = async () => ({ password: '' });
const getCredentialPassword = (...args) => { calls.push(args); return passwordImpl(...args); };
const failRead = () => { passwordImpl = () => Promise.reject(Object.assign(new Error('Server error'), { status: 500 })); };

vi.mock('../lib/api', () => ({
  api: {
    getCredentials: vi.fn(async () => [credential]),
    getClients: vi.fn(async () => ({ clients: [] })),
    getCredentialPassword: (...args) => getCredentialPassword(...args),
    createCredential: vi.fn(),
    updateCredential: vi.fn(),
    deleteCredential: vi.fn(),
  },
}));

const { default: Credentials } = await import('../pages/Credentials');

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><Credentials /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Credentials secret reads', () => {
  beforeEach(() => { calls.length = 0; passwordImpl = async () => ({ password: '' }); });
  afterEach(() => vi.restoreAllMocks());

  it('explains a failed edit instead of silently never opening the form', async () => {
    failRead();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit WP Admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('“WP Admin” could not be opened for editing');
    expect(screen.queryByText('Edit Credential')).not.toBeInTheDocument();
  });

  it('reports failed reveal and copy clicks inline', async () => {
    failRead();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Show password for WP Admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The password could not be shown');
    fireEvent.click(screen.getByRole('button', { name: 'Copy password for WP Admin' }));
    expect(await screen.findByText('The password could not be copied. Try again.')).toBeInTheDocument();
  });

  it('opens the edit form with the decrypted password on success', async () => {
    // A placeholder, not a credential: the value is irrelevant to this test.
    passwordImpl = async () => ({ password: 'placeholder-value' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit WP Admin' }));
    expect(await screen.findByText('Edit Credential')).toBeInTheDocument();
    expect(calls[0]).toEqual(['cred-1', 'edit credential']);
  });
});
