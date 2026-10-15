import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['listClientAgentConversations', 'createClientAgentConversation', 'getClientAgentConversation', 'startClientAgentRun', 'getClientAgentRun', 'getClientAgentRunByIntent', 'cancelClientAgentRun'].map((name) => [name, vi.fn()])), auth: { user: { id: 'staff-1', organizationId: 'org-1', role: 'TEAM' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const { default: ClientAgentConversations } = await import('../components/ClientAgentConversations');
const conversation = { id: 'conversation-1', title: 'Client planning', revision: 0, createdById: 'staff-1', archivedAt: null };
const terminalRun = { id: 'run-1', prompt: 'Saved question', response: '<img src=x onerror=alert(1)>', status: 'SUCCEEDED', requestedById: 'staff-1', createdAt: '2026-10-15T12:00:00Z' };
const clients = [];

function setup(props = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(cache);
  const element = (next = {}) => <QueryClientProvider client={cache}><ClientAgentConversations clientId="client-1" profileEnabled {...props} {...next} /></QueryClientProvider>;
  const view = render(element());
  return { ...view, cache, change: (next) => view.rerender(element(next)) };
}

async function openConversation() {
  fireEvent.click(await screen.findByRole('button', { name: 'Client planning' }));
  return screen.findByLabelText('Question for the account manager');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  sessionStorage.clear();
  auth.user = { id: 'staff-1', organizationId: 'org-1', role: 'TEAM' };
  api.listClientAgentConversations.mockResolvedValue({ scope: 'SHARED_STAFF', items: [conversation], nextCursor: null });
  api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [], nextCursor: null });
  api.createClientAgentConversation.mockResolvedValue(conversation);
  api.startClientAgentRun.mockResolvedValue(terminalRun);
  api.getClientAgentRun.mockResolvedValue(terminalRun);
  api.getClientAgentRunByIntent.mockRejectedValue({ status: 404 });
  api.cancelClientAgentRun.mockResolvedValue({ ...terminalRun, response: null, status: 'CANCELLED' });
});

afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ClientAgentConversations', () => {
  it('loads saved history after mounting and never starts inference without Send', async () => {
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [terminalRun], nextCursor: null });
    const first = setup();
    await openConversation();
    expect(screen.getByText(/Shared with the Ashbi team/)).toHaveTextContent('not private');
    expect(await screen.findByText('Saved question')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
    first.unmount();
    setup();
    await openConversation();
    expect(await screen.findByText('Saved question')).toBeInTheDocument();
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
  });

  it('creates a shared conversation without invoking the model', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'New conversation' }));
    fireEvent.change(screen.getByLabelText('Conversation title'), { target: { value: 'New planning conversation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await screen.findByLabelText('Question for the account manager');
    expect(api.createClientAgentConversation).toHaveBeenCalledExactlyOnceWith('client-1', { title: 'New planning conversation' });
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
  });

  it('retains the same intent through ambiguous errors and reload without storing the question', async () => {
    api.startClientAgentRun.mockRejectedValueOnce(new Error('timeout private provider detail')).mockResolvedValueOnce(terminalRun);
    const first = setup();
    const question = await openConversation();
    fireEvent.change(question, { target: { value: 'A private client question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText(/The attempt could not be confirmed/);
    const firstKey = api.startClientAgentRun.mock.calls[0][2].idempotencyKey;
    const stored = sessionStorage.getItem(sessionStorage.key(0));
    expect(JSON.parse(stored)).toEqual({ key: firstKey, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(stored).not.toContain('private');
    expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
    first.unmount();
    setup();
    const reopened = await openConversation();
    await waitFor(() => expect(api.getClientAgentRunByIntent).toHaveBeenCalledWith('client-1', 'conversation-1', firstKey));
    expect(api.startClientAgentRun).toHaveBeenCalledTimes(1);
    fireEvent.change(reopened, { target: { value: 'A different question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved attempt' }));
    await screen.findByText(/An earlier attempt is unresolved/);
    expect(api.startClientAgentRun).toHaveBeenCalledTimes(1);
    fireEvent.change(reopened, { target: { value: 'A private client question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved attempt' }));
    await waitFor(() => expect(api.startClientAgentRun).toHaveBeenCalledTimes(2));
    expect(api.startClientAgentRun.mock.calls[1][2]).toEqual({ question: 'A private client question', idempotencyKey: firstKey });
    await waitFor(() => expect(sessionStorage.length).toBe(0));
  });

  it('recovers a committed receipt by exact intent after reload without dispatching again', async () => {
    api.startClientAgentRun.mockRejectedValueOnce(new Error('connection lost'));
    const first = setup();
    fireEvent.change(await openConversation(), { target: { value: 'Find saved request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText(/The attempt could not be confirmed/);
    const savedKey = api.startClientAgentRun.mock.calls[0][2].idempotencyKey;
    first.unmount();
    api.getClientAgentRunByIntent.mockResolvedValue(terminalRun);
    setup();
    await openConversation();
    await waitFor(() => expect(sessionStorage.length).toBe(0));
    expect(api.getClientAgentRunByIntent).toHaveBeenCalledWith('client-1', 'conversation-1', savedKey);
    expect(api.startClientAgentRun).toHaveBeenCalledTimes(1);
  });

  it('does not paint a late request result into a different client or account', async () => {
    let finish;
    api.startClientAgentRun.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = setup();
    fireEvent.change(await openConversation(), { target: { value: 'Question for first client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.startClientAgentRun).toHaveBeenCalledTimes(1));
    auth.user = { id: 'staff-2', organizationId: 'org-1', role: 'ADMIN' };
    view.change({ clientId: 'client-2' });
    await openConversation();
    await act(async () => finish({ ...terminalRun, response: 'First client confidential result' }));
    expect(screen.queryByText('First client confidential result')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Question for the account manager')).toHaveValue('');
    expect(api.getClientAgentConversation).toHaveBeenCalledWith('client-2', 'conversation-1', expect.any(Object));
  });

  it('polls queued work until terminal and cleans up polling on unmount', async () => {
    const queued = { ...terminalRun, response: null, status: 'QUEUED' };
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [queued], nextCursor: null });
    api.getClientAgentRun.mockResolvedValueOnce(queued).mockResolvedValue(terminalRun);
    const view = setup();
    await openConversation();
    await waitFor(() => expect(api.getClientAgentRun).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Status: SUCCEEDED')).toBeInTheDocument(), { timeout: 4500 });
    expect(api.getClientAgentRun).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    expect(api.getClientAgentRun).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    expect(api.getClientAgentRun).toHaveBeenCalledTimes(2);
  });

  it('polls an active run beyond the oldest 50 history turns and never duplicates it', async () => {
    const oldRuns = Array.from({ length: 50 }, (_, index) => ({ ...terminalRun, id: `old-run-${index}`, prompt: `Old question ${index}`, response: 'Old answer' }));
    const queued = { ...terminalRun, id: 'run-live', prompt: 'Newest pending question', response: null, status: 'QUEUED' };
    const complete = { ...queued, status: 'SUCCEEDED', response: 'Newest saved answer' };
    api.getClientAgentConversation.mockResolvedValueOnce({ scope: 'SHARED_STAFF', conversation, runs: oldRuns, activeRun: queued, nextCursor: 'old-run-49' })
      .mockResolvedValueOnce({ scope: 'SHARED_STAFF', conversation, runs: [complete], activeRun: null, nextCursor: null });
    api.getClientAgentRun.mockResolvedValueOnce(queued).mockResolvedValue(complete);
    setup();
    await openConversation();
    expect(await screen.findByText('Newest pending question')).toBeInTheDocument();
    await waitFor(() => expect(api.getClientAgentRun).toHaveBeenCalledWith('client-1', 'conversation-1', 'run-live'));
    await screen.findByText('Newest saved answer', {}, { timeout: 4500 });
    expect(api.getClientAgentConversation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load more saved questions' }));
    await waitFor(() => expect(api.getClientAgentConversation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more saved questions' })).not.toBeInTheDocument());
    expect(screen.getAllByText('Newest pending question')).toHaveLength(1);
    expect(screen.getAllByText('Newest saved answer')).toHaveLength(1);
  });

  it('cancels only on explicit action and shows honest provider-cost wording', async () => {
    const running = { ...terminalRun, response: null, status: 'RUNNING' };
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [running], nextCursor: null });
    api.getClientAgentRun.mockResolvedValue(running);
    setup();
    await openConversation();
    expect(await screen.findByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
    expect(api.cancelClientAgentRun).not.toHaveBeenCalled();
    expect(screen.getByText(/Stopping a run may not stop/)).toHaveTextContent('cost');
    api.getClientAgentRun.mockResolvedValue({ ...running, status: 'CANCELLED' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await screen.findByText('Status: CANCELLED');
    expect(api.cancelClientAgentRun).toHaveBeenCalledExactlyOnceWith('client-1', 'conversation-1', 'run-1');
    expect(screen.getByText(/An in-flight provider request may still complete/)).toBeInTheDocument();
  });

  it('lets a staff colleague read active shared work without offering unauthorized cancellation', async () => {
    const running = { ...terminalRun, requestedById: 'staff-colleague', response: null, status: 'RUNNING' };
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [running], activeRun: running, nextCursor: null });
    api.getClientAgentRun.mockResolvedValue(running);
    const view = setup();
    await openConversation();
    await waitFor(() => expect(api.getClientAgentRun).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Saved question')).toBeInTheDocument();
    expect(screen.getByText('Status: RUNNING')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    api.getClientAgentRun.mockResolvedValue({ ...running, status: 'SUCCEEDED', response: 'Shared colleague answer' });
    await act(async () => { await view.cache.invalidateQueries({ queryKey: ['client-agent-conversation', 'org-1', 'staff-1', 'client-1', 'conversation-1', 'run'] }); });
    expect(await screen.findByText('Shared colleague answer')).toBeInTheDocument();
    expect(screen.getByText('Saved question')).toBeInTheDocument();
    expect(api.cancelClientAgentRun).not.toHaveBeenCalled();
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
  });

  it('stops polling when an active conversation is unmounted', async () => {
    const running = { ...terminalRun, response: null, status: 'RUNNING' };
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [running], nextCursor: null });
    api.getClientAgentRun.mockResolvedValue(running);
    const view = setup();
    await openConversation();
    await waitFor(() => expect(api.getClientAgentRun).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.getClientAgentRun).toHaveBeenCalledTimes(1);
  });

  it('creates a different intent only after a terminal receipt releases the previous one', async () => {
    setup();
    fireEvent.change(await openConversation(), { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.startClientAgentRun).toHaveBeenCalledTimes(1));
    const firstKey = api.startClientAgentRun.mock.calls[0][2].idempotencyKey;
    await waitFor(() => expect(sessionStorage.length).toBe(0));
    fireEvent.change(screen.getByLabelText('Question for the account manager'), { target: { value: 'Second question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.startClientAgentRun).toHaveBeenCalledTimes(2));
    expect(api.startClientAgentRun.mock.calls[1][2].idempotencyKey).not.toBe(firstKey);
  });

  it('hides cached transcripts on a denied fetch and does not render client roles', async () => {
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [terminalRun], nextCursor: null });
    const view = setup();
    await openConversation();
    expect(await screen.findByText('Saved question')).toBeInTheDocument();
    api.getClientAgentConversation.mockRejectedValue({ status: 403 });
    await act(async () => { await view.cache.invalidateQueries({ queryKey: ['client-agent-conversation'] }); });
    await screen.findByRole('alert');
    expect(screen.queryByText('Saved question')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no longer have access');
    auth.user.role = 'CLIENT';
    view.change({});
    expect(screen.queryByRole('region', { name: 'Account manager conversations' })).not.toBeInTheDocument();
  });

  it('hides a cached active run and stops status polling after permission denial', async () => {
    const running = { ...terminalRun, response: null, status: 'RUNNING' };
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [running], nextCursor: null });
    api.getClientAgentRun.mockResolvedValue(running);
    const view = setup();
    await openConversation();
    await waitFor(() => expect(api.getClientAgentRun).toHaveBeenCalledTimes(1));
    api.getClientAgentRun.mockRejectedValue({ status: 403 });
    await act(async () => { await view.cache.invalidateQueries({ queryKey: ['client-agent-conversation', 'org-1', 'staff-1', 'client-1', 'conversation-1', 'run'] }); });
    await screen.findByRole('alert');
    expect(screen.queryByText('Saved question')).not.toBeInTheDocument();
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.getClientAgentRun).toHaveBeenCalledTimes(2);
  });

  it('keeps paused and unknown runs readable without automatic retry', async () => {
    api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [{ ...terminalRun, status: 'UNKNOWN', response: null }], nextCursor: null });
    setup({ profileEnabled: false });
    const input = await openConversation();
    fireEvent.change(input, { target: { value: 'Do not dispatch this' } });
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    expect(screen.getByText(/The provider outcome is unknown/)).toHaveTextContent('will not be retried automatically');
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
    expect(api.getClientAgentRun).not.toHaveBeenCalled();
  });

  it('fails closed when intent storage silently drops writes', async () => {
    setup();
    fireEvent.change(await openConversation(), { target: { value: 'Do not lose this intent' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText(/Browser storage could not retain/);
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
  });
});
