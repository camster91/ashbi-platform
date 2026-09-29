import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const thread = {
  id: 'thr-1',
  subject: 'Question about packaging timeline',
  status: 'OPEN',
  priority: 'HIGH',
  client: { id: 'c1', name: 'Northwind Coffee Roasters' },
  project: { id: 'p1', name: 'Northwind Brand Refresh' },
  createdAt: '2030-01-01T10:00:00.000Z',
  lastActivityAt: '2030-01-01T10:00:00.000Z',
  aiAnalysis: null,
  internalNotes: [],
  responses: [],
  messages: [
    {
      id: 'm1',
      direction: 'INBOUND',
      senderEmail: 'olivia@northwindcoffee.com',
      senderName: 'Olivia Chen',
      subject: 'Packaging timeline',
      bodyText: 'When can we expect the dieline?',
      receivedAt: '2030-01-01T10:00:00.000Z',
      createdAt: '2030-01-01T10:00:00.000Z',
    },
  ],
};

vi.mock('../lib/api', () => ({
  api: new Proxy(
    { getThread: vi.fn(async () => thread) },
    { get: (target, prop) => target[prop] ?? vi.fn(async () => ({})) },
  ),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Cameron', role: 'ADMIN' } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

const { default: Thread } = await import('../pages/Thread');

describe('Thread page', () => {
  it('renders an inbox thread (conversation heading included) without crashing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/thread/thr-1']}>
          <Routes>
            <Route path="/thread/:id" element={<Thread />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Question about packaging timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Conversation/ })).toBeInTheDocument();
    expect(screen.getByText('When can we expect the dieline?')).toBeInTheDocument();
  });
});
