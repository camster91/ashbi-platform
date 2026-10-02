import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getClients: vi.fn(),
  getAssets: vi.fn(),
};
vi.mock('../lib/api', () => ({ api: new Proxy({}, { get: (_t, prop) => api[prop] ?? vi.fn(async () => ({})) }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'TEAM' } }) }));

const { default: AssetLibrary } = await import('../pages/AssetLibrary');

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AssetLibrary /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getClients.mockResolvedValue({ clients: [{ id: 'c-north', name: 'Northwind' }, { id: 'c-con', name: 'Contoso' }], total: 2 });
  api.getAssets.mockResolvedValue([{ id: 'a1', name: 'Primary logo', type: 'BRAND', category: 'logo' }]);
});

describe('asset library client picker', () => {
  it('picks a client by name instead of asking for a raw id', async () => {
    renderPage();
    const picker = await screen.findByLabelText('Client');
    expect(picker.tagName).toBe('SELECT');
    expect(screen.queryByPlaceholderText(/Client ID/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Northwind' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: 'c-north' } });
    expect(await screen.findByText('Primary logo')).toBeInTheDocument();
    expect(api.getAssets).toHaveBeenCalledWith('c-north');
  });

  it('labels the search box and both filters', async () => {
    renderPage();
    expect(await screen.findByLabelText('Search')).toHaveAttribute('type', 'search');
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
  });

  it('finds clients beyond the first page with a labelled search', async () => {
    api.getClients.mockImplementation(async (params) => (params.search
      ? { clients: [{ id: 'c-zed', name: 'Zephyr Foods' }], total: 1 }
      : { clients: [{ id: 'c-north', name: 'Northwind' }], total: 250 }));
    renderPage();
    const search = await screen.findByLabelText('Find a client not in the list');
    expect(screen.getByText(/first 1 of 250 clients/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Zephyr Foods' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zep' } });
    expect(await screen.findByRole('option', { name: 'Zephyr Foods' })).toBeInTheDocument();
    expect(api.getClients).toHaveBeenCalledWith({ search: 'zep', limit: 50 });
    expect(screen.getByRole('status')).toHaveTextContent('1 matching client is now in the Client list.');

    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'c-zed' } });
    // The chosen client stays selected after the search is cleared.
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByLabelText('Client')).toHaveValue('c-zed');
    await waitFor(() => expect(api.getAssets).toHaveBeenCalledWith('c-zed'));
  });

  it('does not show the client search when every client is listed', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Northwind' });
    expect(screen.queryByLabelText('Find a client not in the list')).not.toBeInTheDocument();
  });

  it('explains an empty workspace and a failed client list', async () => {
    api.getClients.mockResolvedValueOnce({ clients: [], total: 0 });
    const { unmount } = renderPage();
    expect(await screen.findByText('No clients yet')).toBeInTheDocument();
    unmount();

    api.getClients.mockRejectedValueOnce(new Error('Clients are unavailable'));
    renderPage();
    expect(await screen.findByText(/Clients could not be loaded/)).toBeInTheDocument();
  });
});
