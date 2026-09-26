import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getAiConnection: vi.fn(),
    connectAiProvider: vi.fn(),
    validateAiConnection: vi.fn(),
    rotateAiConnectionKey: vi.fn(),
    revokeAiConnection: vi.fn(),
    setOrganizationAiDisabled: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: AiByokSettings, parseModelList, dollarsToCents } = await import('../components/AiByokSettings');

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AiByokSettings />
    </QueryClientProvider>,
  );
}

const EMPTY = { connection: null, aiDisabled: false, platformAiDisabled: false, usage: { spentCents: 0, budgetCents: null, promptTokens: 0, completionTokens: 0, unpricedTokens: 0 } };
const CONNECTED = {
  aiDisabled: false,
  platformAiDisabled: false,
  connection: {
    id: 'c1', baseUrl: 'https://llm.example.com', baseUrlHost: 'llm.example.com', keyLast4: '1111', hasKey: true,
    allowedModels: ['model-a'], defaultModel: 'model-a', monthlyBudgetCents: 1000, status: 'active', lastValidatedAt: null,
  },
  usage: { spentCents: 850, budgetCents: 1000, promptTokens: 1200, completionTokens: 300, unpricedTokens: 0, alertThresholdPercent: 80 },
};

describe('Settings → AI provider (bring your own key)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses model lists and budgets', () => {
    expect(parseModelList('model-a, model-b\nmodel-a')).toEqual(['model-a', 'model-b']);
    expect(dollarsToCents('12.345')).toBe(1235);
    expect(dollarsToCents('0')).toBeNull();
  });

  it('connects with the key in a password field and clears it afterwards', async () => {
    api.getAiConnection.mockResolvedValue(EMPTY);
    api.connectAiProvider.mockResolvedValue({ connection: CONNECTED.connection });
    renderSection();

    const keyInput = await screen.findByLabelText('API key');
    expect(keyInput).toHaveAttribute('type', 'password');
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://llm.example.com/v1' } });
    fireEvent.change(keyInput, { target: { value: 'sk-secret-1111' } });
    fireEvent.change(screen.getByLabelText('Allowed models'), { target: { value: 'model-a, model-b' } });
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /connect provider/i }));

    await waitFor(() => expect(api.connectAiProvider).toHaveBeenCalledWith({
      baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-secret-1111', allowedModels: ['model-a', 'model-b'], defaultModel: 'model-a', monthlyBudgetCents: 2500,
    }));
    await waitFor(() => expect(keyInput).toHaveValue(''));
  });

  it('announces a failed validation accessibly', async () => {
    api.getAiConnection.mockResolvedValue(EMPTY);
    api.connectAiProvider.mockRejectedValue(Object.assign(new Error('Validation failed: The AI provider rejected the workspace API key.'), { data: { errorType: 'auth' } }));
    renderSection();

    fireEvent.change(await screen.findByLabelText('Base URL'), { target: { value: 'https://llm.example.com' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-bad-2222' } });
    fireEvent.change(screen.getByLabelText('Allowed models'), { target: { value: 'model-a' } });
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /connect provider/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected the workspace API key\. \(auth\)/);
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('shows the masked key and usage against the budget, and offers validate / rotate / revoke / disable', async () => {
    api.getAiConnection.mockResolvedValue(CONNECTED);
    api.validateAiConnection.mockResolvedValue({ valid: true });
    api.setOrganizationAiDisabled.mockResolvedValue({ ...CONNECTED, aiDisabled: true });
    renderSection();

    expect(await screen.findByText('••••1111')).toBeInTheDocument();
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '85');
    expect(screen.getByText('$8.50 of $10.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check connection/i }));
    expect(await screen.findByText('The provider accepted the key.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /turn ai off/i }));
    await waitFor(() => expect(api.setOrganizationAiDisabled).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole('button', { name: /rotate key/i }));
    expect(screen.getByLabelText('New API key')).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /revoke key/i }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^revoke key$/i }));
    await waitFor(() => expect(api.revokeAiConnection).toHaveBeenCalled());
  });
});
