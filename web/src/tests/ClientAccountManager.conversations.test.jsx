import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['getClientAccountManagerBrief', 'previewClientAssistant', 'getClientAgentProfile', 'updateClientAgentProfile', 'listClientAgentConversations', 'createClientAgentConversation', 'getClientAgentConversation', 'startClientAgentRun', 'getClientAgentRun', 'getClientAgentRunByIntent', 'cancelClientAgentRun'].map((name) => [name, vi.fn()])), auth: { user: { id: 'staff-1', organizationId: 'org-1', role: 'TEAM' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const { default: ClientAccountManager } = await import('../components/ClientAccountManager');
const profile = { name: 'Client manager', instructions: '', enabled: true, pluginIds: ['client-work'], revision: 0 };
const conversation = { id: 'conversation-1', title: 'Saved planning', revision: 0 };
const clients = [];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter><ClientAccountManager clientId="client-1" clientName="Acme" role="TEAM" /></MemoryRouter></QueryClientProvider>);
}

async function openSaved() {
  fireEvent.click(screen.getByText('Account manager'));
  await waitFor(() => expect(api.getClientAccountManagerBrief).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Saved conversations'));
  await screen.findByRole('button', { name: 'Saved planning' });
}

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  auth.user = { id: 'staff-1', organizationId: 'org-1', role: 'TEAM' };
  api.getClientAccountManagerBrief.mockResolvedValue({ counts: {}, rows: [] });
  api.getClientAgentProfile.mockResolvedValue(profile);
  api.listClientAgentConversations.mockResolvedValue({ scope: 'SHARED_STAFF', items: [conversation], nextCursor: null });
  api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [], activeRun: null, nextCursor: null });
});
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); });

describe('account manager saved conversations integration', () => {
  it('loads conversations only when opened and preserves the brief, settings and preview', async () => {
    setup();
    expect(api.getClientAgentProfile).not.toHaveBeenCalled();
    expect(api.listClientAgentConversations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Account manager'));
    await waitFor(() => expect(api.getClientAccountManagerBrief).toHaveBeenCalled());
    expect(api.getClientAgentProfile).not.toHaveBeenCalled();
    expect(api.listClientAgentConversations).not.toHaveBeenCalled();
    expect(screen.getByText('Account manager settings')).toBeInTheDocument();
    expect(screen.getByText('Ask the account manager')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Saved conversations'));
    await screen.findByRole('button', { name: 'Saved planning' });
    expect(api.getClientAgentProfile).toHaveBeenCalledWith('client-1');
    expect(api.previewClientAssistant).not.toHaveBeenCalled();
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
  });

  it('uses saved settings changes to enable Send, leaving unsaved settings inactive', async () => {
    api.getClientAgentProfile.mockResolvedValue({ ...profile, enabled: false });
    api.updateClientAgentProfile.mockResolvedValue({ ...profile, revision: 1 });
    setup(); await openSaved();
    fireEvent.click(screen.getByRole('button', { name: 'Saved planning' }));
    fireEvent.change(await screen.findByLabelText('Question for the account manager'), { target: { value: 'Status?' } });
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    fireEvent.click(screen.getByText('Account manager settings'));
    const enable = await screen.findByLabelText('Enable account manager');
    fireEvent.click(enable);
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send question' })).toBeEnabled());
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
  });

  it('leaves saved history usable but pauses Send when profile loading fails', async () => {
    api.getClientAgentProfile.mockRejectedValue({ status: 403, message: 'Private config' });
    setup(); await openSaved();
    expect(await screen.findByText(/Account manager settings could not be checked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Saved planning' }));
    fireEvent.change(await screen.findByLabelText('Question for the account manager'), { target: { value: 'Status?' } });
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    expect(screen.queryByText('Private config')).not.toBeInTheDocument();
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
  });

  it('does not load the saved section after the outer account manager is closed and reopened', async () => {
    setup(); await openSaved();
    const priorCalls = api.listClientAgentConversations.mock.calls.length;
    fireEvent.click(screen.getByText('Account manager'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Account manager conversations' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Account manager'));
    await screen.findByText('Saved conversations');
    expect(screen.queryByRole('region', { name: 'Account manager conversations' })).not.toBeInTheDocument();
    expect(api.listClientAgentConversations).toHaveBeenCalledTimes(priorCalls);
  });
});
