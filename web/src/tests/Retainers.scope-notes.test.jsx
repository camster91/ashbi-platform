import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Retainers from '../pages/Retainers';
const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['getRetainerList', 'createRetainerPlan', 'updateRetainerPlan'].map(name => [name, vi.fn()])), auth: { user: { role: 'ADMIN' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [{ id: 'client2', name: 'Second client' }] }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const plan = { id: 'plan1', clientId: 'client1', client: { name: 'Acme' }, hoursPerMonth: 20, hoursUsed: 2, hoursRemaining: 18, percentUsed: 10, monthlyAmountCad: 200, monthlyAmountUsd: null, serviceDescription: 'Agreed design work\nTwo revision rounds' };
const caches = [];
function setup() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache); return render(<QueryClientProvider client={cache}><MemoryRouter><Retainers /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.resetAllMocks(); auth.user.role = 'ADMIN'; api.getRetainerList.mockResolvedValue([plan]); api.updateRetainerPlan.mockResolvedValue({}); api.createRetainerPlan.mockResolvedValue({}); });
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); });
describe('retainer included-work notes', () => {
  it('shows supplied plain text and an explicit unknown state for legacy plans', async () => {
    api.getRetainerList.mockResolvedValue([plan, { ...plan, id: 'p2', clientId: 'c2', client: { name: 'Legacy' }, serviceDescription: null }]); setup();
    await screen.findByText(/Agreed design work/); expect(screen.getByText('Not provided')).toBeInTheDocument(); expect(screen.getAllByRole('heading', { name: 'Included-work notes' })).toHaveLength(2);
  });
  it('loads notes into the explicit edit form and clears only after Save', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Edit retainer Acme' }));
    const notes = screen.getByLabelText('Included-work notes (optional)'); expect(notes).toHaveValue(plan.serviceDescription); expect(notes).toHaveAttribute('maxlength', '4000');
    fireEvent.change(notes, { target: { value: '' } }); expect(api.updateRetainerPlan).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(api.updateRetainerPlan).toHaveBeenCalledExactlyOnceWith('client1', { hoursPerMonth: 20, monthlyAmountUsd: null, monthlyAmountCad: 200, serviceDescription: null }));
  });
  it('creates a plan with supplied notes without altering entered hours or currency amounts', async () => {
    setup(); await screen.findByText(/Agreed design work/); fireEvent.click(screen.getByRole('button', { name: 'Add Retainer', exact: true }));
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'client2' } }); fireEvent.change(screen.getByLabelText('Included-work notes (optional)'), { target: { value: '  Supplied scope  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(api.createRetainerPlan).toHaveBeenCalledExactlyOnceWith({ clientId: 'client2', tier: 'custom', hoursPerMonth: 20, monthlyAmountUsd: undefined, monthlyAmountCad: undefined, serviceDescription: 'Supplied scope' }));
  });
  it('omits untouched create notes so a concurrent existing-plan upsert preserves them, including after reset', async () => {
    setup(); await screen.findByText(/Agreed design work/);
    for (let attempt = 1; attempt <= 2; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: 'Add Retainer', exact: true }));
      expect(screen.getByLabelText('Included-work notes (optional)')).toHaveValue('');
      fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'client2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Plan' }));
      await waitFor(() => expect(api.createRetainerPlan).toHaveBeenCalledTimes(attempt));
      expect(Object.hasOwn(api.createRetainerPlan.mock.calls[attempt - 1][0], 'serviceDescription')).toBe(false);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Plan' })).not.toBeInTheDocument());
    }
  });
  it('sends explicit null when a user types then clears create notes', async () => {
    setup(); await screen.findByText(/Agreed design work/); fireEvent.click(screen.getByRole('button', { name: 'Add Retainer', exact: true }));
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'client2' } });
    const notes = screen.getByLabelText('Included-work notes (optional)');
    fireEvent.change(notes, { target: { value: 'Draft notes' } }); fireEvent.change(notes, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(api.createRetainerPlan).toHaveBeenCalledOnce());
    expect(api.createRetainerPlan.mock.calls[0][0].serviceDescription).toBe(null);
    expect(Object.hasOwn(api.createRetainerPlan.mock.calls[0][0], 'serviceDescription')).toBe(true);
  });
  it('keeps staff notes readable while only admins can edit scope', async () => {
    auth.user.role = 'TEAM'; setup(); await screen.findByText(/Agreed design work/);
    expect(screen.queryByRole('button', { name: /Edit retainer/ })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add Retainer', exact: true })).not.toBeInTheDocument(); expect(api.updateRetainerPlan).not.toHaveBeenCalled();
  });
});
