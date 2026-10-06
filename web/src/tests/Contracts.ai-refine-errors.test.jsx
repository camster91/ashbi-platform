import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getContracts: vi.fn(),
  getProposals: vi.fn(),
  getClients: vi.fn(),
  aiChat: vi.fn(),
};
vi.mock('../lib/api', () => {
  const proxy = new Proxy({}, { get: (_t, prop) => api[prop] ?? vi.fn(async () => ({})) });
  return { api: proxy, default: proxy };
});
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));

const { default: Contracts } = await import('../pages/Contracts');

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Contracts /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function refine() {
  fireEvent.click(await screen.findByRole('button', { name: 'Refine contract Retainer with AI' }));
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Add a late fee' } });
  fireEvent.click(screen.getByRole('button', { name: /^Refine$/ }));
  await waitFor(() => expect(api.aiChat).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getContracts.mockResolvedValue([{ id: 'c-1', title: 'Retainer', status: 'DRAFT', content: 'Terms', client: { name: 'Contoso' } }]);
  api.getProposals.mockResolvedValue([]);
  api.getClients.mockResolvedValue({ clients: [] });
});

describe('contract AI refine errors', () => {
  it('leaves AI_* errors to the global AI toast, so only one message shows', async () => {
    api.aiChat.mockRejectedValue(Object.assign(
      new Error("AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings."),
      { status: 503, data: { code: 'AI_UNAVAILABLE' } },
    ));
    renderPage();
    await refine();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Refine$/ })).not.toBeDisabled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('still reports errors the global handler does not describe as AI errors', async () => {
    api.aiChat.mockRejectedValue(Object.assign(new Error('Message is required'), { status: 400, data: { code: 'VALIDATION_ERROR' } }));
    renderPage();
    await refine();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('AI refine failed', 'Message is required'));
  });
});
