import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { getApiKeys: vi.fn(), createApiKey: vi.fn(), deleteApiKey: vi.fn() },
}));

const { api } = await import('../lib/api');
const { ApiKeysSection } = await import('../pages/Settings');

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiKeysSection />
    </QueryClientProvider>,
  );
}

describe('Settings → API keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows each key’s scopes and flags legacy keys with no expiry', async () => {
    api.getApiKeys.mockResolvedValue({
      keys: [
        { id: 'k1', name: 'Legacy bot', scopes: ['ai_bridge:read', 'ai_bridge:actions'], createdAt: '2026-01-01T00:00:00Z', expiresAt: null, noExpiry: true },
        { id: 'k2', name: 'Reader', scopes: ['ai_bridge:read'], createdAt: '2026-09-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' },
      ],
    });
    renderSection();

    expect(await screen.findByText('Legacy bot')).toBeInTheDocument();
    expect(screen.getAllByText('No expiry')).toHaveLength(1);
    expect(screen.getByText('Scopes: Embedded AI chat (legacy), AI bridge actions (legacy)')).toBeInTheDocument();
    expect(screen.getByText(/Scopes: Embedded AI chat \(legacy\)$/)).toBeInTheDocument();
  });

  it('creates a key with the chosen scopes and expiry', async () => {
    api.getApiKeys.mockResolvedValue({ keys: [] });
    api.createApiKey.mockResolvedValue({ id: 'k3', key: 'ashbi_raw' });
    renderSection();

    fireEvent.change(screen.getByLabelText(/api key name/i), { target: { value: 'Zapier' } });
    fireEvent.click(screen.getByLabelText(/^workspace actions/i));
    fireEvent.change(screen.getByLabelText(/expires after/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledWith({
      name: 'Zapier', scopes: ['workspace:read', 'workspace:actions'], expiresInDays: 30,
    }));
    expect(await screen.findByText('ashbi_raw')).toBeInTheDocument();
  });

  it('cannot create a key without a scope', async () => {
    api.getApiKeys.mockResolvedValue({ keys: [] });
    renderSection();

    fireEvent.change(screen.getByLabelText(/api key name/i), { target: { value: 'Zapier' } });
    fireEvent.click(screen.getByLabelText(/^read workspace/i));

    expect(screen.getByText(/choose at least one scope/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create key/i })).toBeDisabled();
  });

  it('keeps a newly created secret visible when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    api.getApiKeys.mockResolvedValue({ keys: [] });
    api.createApiKey.mockResolvedValue({ id: 'k3', key: 'ashbi_raw' });
    renderSection();
    fireEvent.change(screen.getByLabelText(/api key name/i), { target: { value: 'Reader' } });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));
    await screen.findByText('ashbi_raw');
    fireEvent.click(screen.getByRole('button', { name: 'Copy API key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('copy it manually before dismissing');
    expect(screen.getByText('ashbi_raw')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /I've copied it/ }));
    expect(screen.queryByText('ashbi_raw')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
