import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
const { auth, api, toast } = vi.hoisted(() => ({ auth: { role: 'TEAM' }, api: { getRetainerList: vi.fn() }, toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../hooks/useAuth', () => ({ AuthProvider: ({ children }) => children, useAuth: () => ({ user: { id: 'member', role: auth.role }, isLoading: false, authState: { status: 'authenticated' }, expireSession: vi.fn() }) }));
vi.mock('../hooks/useToast', () => ({ ToastProvider: ({ children }) => children, useToast: () => toast }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [] }) }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../components/QueryProvider', () => ({ default: ({ children }) => children }));
vi.mock('../components/Layout', () => ({ default: ({ children }) => children }));
vi.mock('../components/ImpersonationBanner', () => ({ default: () => null }));
const caches = [];
function openRoute() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache); render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/retainers']}><App /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); auth.role = 'TEAM'; api.getRetainerList.mockResolvedValue([{ id: 'plan', clientId: 'client', client: { name: 'Authorized client' }, hoursPerMonth: 20, hoursUsed: 0, hoursRemaining: 20, percentUsed: 0, serviceDescription: 'Administrator supplied scope' }]); });
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); });
it('the actual /retainers App route denies TEAM without reading finance data', async () => {
  openRoute(); await screen.findByRole('heading', { name: 'Administrator access required' });
  expect(api.getRetainerList).not.toHaveBeenCalled(); expect(screen.queryByText('Administrator supplied scope')).not.toBeInTheDocument();
});
it('the actual /retainers App route lets authorized administrators read included-work notes', async () => {
  auth.role = 'ADMIN'; openRoute(); await screen.findByText('Administrator supplied scope');
  expect(api.getRetainerList).toHaveBeenCalledOnce();
});
