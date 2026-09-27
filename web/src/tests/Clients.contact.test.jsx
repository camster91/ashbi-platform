import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const clients = [
  {
    id: 'c1',
    name: 'Northwind Coffee Roasters',
    domain: 'northwindcoffee.com',
    status: 'ACTIVE',
    updatedAt: '2030-01-02T12:00:00.000Z',
    contacts: [{ id: 'ct1', name: 'Olivia Chen', email: 'olivia@northwindcoffee.com', isPrimary: true }],
    _count: { projects: 1, contacts: 2 },
  },
  { id: 'c2', name: 'No Contact Co', status: 'ACTIVE', updatedAt: '2030-01-02T12:00:00.000Z', contacts: [], _count: { projects: 0, contacts: 0 } },
];

vi.mock('../lib/api', () => ({
  api: new Proxy(
    { getClients: vi.fn(async () => ({ clients, total: 2 })) },
    { get: (target, prop) => target[prop] ?? vi.fn(async () => []) },
  ),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const { default: Clients } = await import('../pages/Clients');

describe('Clients table', () => {
  it('shows the primary contact in the Contact column', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Clients /></MemoryRouter>
      </QueryClientProvider>,
    );
    const row = (await screen.findByRole('button', { name: /Expand client Northwind Coffee Roasters/ })).closest('tr');
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Olivia Chen');
    expect(cells[1]).toHaveTextContent('olivia@northwindcoffee.com');
    const emptyRow = screen.getByRole('button', { name: /Expand client No Contact Co/ }).closest('tr');
    expect(within(emptyRow).getAllByRole('cell')[1]).toHaveTextContent('—');
  });
});
