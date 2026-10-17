import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['getClientAccountManagerBrief', 'getClientAgentProfile', 'listClientAgentConversations', 'getClientAgentConversation', 'getClientAgentRun', 'reviewClientAgentRun', 'startClientAgentRun', 'cancelClientAgentRun'].map((name) => [name, vi.fn()])), auth: { user: { id: 'staff-1', organizationId: 'org-1', role: 'TEAM' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../components/ClientAgentSettings', () => ({ default: () => null }));
vi.mock('../components/PortalAssistantSettings', () => ({ default: () => null }));
vi.mock('../components/ClientAssistantPreview', () => ({ default: () => null }));
vi.mock('../components/ClientAgentTaskAction', () => ({ default: () => null }));
import ClientAccountManager from '../components/ClientAccountManager';
import ClientAgentConversations from '../components/ClientAgentConversations';
const caches = [];
const conversation = { id: 'conversation-old', title: 'Linked conversation', archivedAt: null };
const run = { id: 'run-old', conversationId: conversation.id, requestedById: 'staff-1', status: 'UNKNOWN', prompt: 'Exact older request', attentionReviewedAt: null };
const saved = { ...run, attentionReviewedAt: '2026-10-17T02:00:00.000Z' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function Location() {
  const { search } = useLocation(); const navigate = useNavigate();
  return <><output data-testid="query">{search}</output><button onClick={() => navigate('/client/client-1?keep=1&conversationId=conversation-next&runId=run-next')}>Next linked request</button><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}
function setup({ route = false, path = '/client/client-1?conversationId=conversation-old&runId=run-old' } = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache);
  const content = () => <QueryClientProvider client={cache}>{route ? <MemoryRouter initialEntries={[path]}><ClientAccountManager clientId="client-1" role={auth.user.role} /><Location /></MemoryRouter> : <ClientAgentConversations clientId="client-1" selectedConversationId={conversation.id} linkedRunId={run.id} />}</QueryClientProvider>;
  const view = render(content()); return { ...view, cache, refreshActor: () => view.rerender(content()) };
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); auth.user = { id: 'staff-1', organizationId: 'org-1', role: 'TEAM' };
  api.getClientAccountManagerBrief.mockResolvedValue({ rows: [] });
  api.getClientAgentProfile.mockResolvedValue({ enabled: false, pluginIds: [] });
  // The linked conversation and run are intentionally not in the first list/detail page.
  api.listClientAgentConversations.mockResolvedValue({ scope: 'SHARED_STAFF', items: [{ id: 'other', title: 'Newer conversation' }], nextCursor: 'more' });
  api.getClientAgentConversation.mockResolvedValue({ scope: 'SHARED_STAFF', conversation, runs: [], nextCursor: 'more' });
  api.getClientAgentRun.mockResolvedValue(run); api.reviewClientAgentRun.mockResolvedValue(saved);
});
afterEach(() => { cleanup(); caches.splice(0).forEach((c) => c.clear()); });

describe('agent run attention workflow', () => {
  it('opens both disclosures and exact older run from query, restoring it on reload without starting or reviewing', async () => {
    const view = setup({ route: true });
    expect(await screen.findByText('Exact older request')).toBeVisible();
    expect(screen.getByText('Account manager').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Saved conversations').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('listitem', { name: 'Linked account manager run' })).toHaveFocus();
    expect(api.getClientAgentRun).toHaveBeenCalledWith('client-1', conversation.id, run.id);
    view.unmount(); setup({ route: true });
    expect(await screen.findByText('Exact older request')).toBeVisible();
    expect(api.reviewClientAgentRun).not.toHaveBeenCalled(); expect(api.startClientAgentRun).not.toHaveBeenCalled();
    expect(api.cancelClientAgentRun).not.toHaveBeenCalled();
  });

  it('updates the query when selecting another conversation and removes the old exact-run target', async () => {
    setup({ route: true }); await screen.findByText('Exact older request');
    fireEvent.click(screen.getByRole('button', { name: 'Newer conversation' }));
    await waitFor(() => expect(screen.getByTestId('query')).toHaveTextContent('?conversationId=other'));
    expect(screen.getByTestId('query')).not.toHaveTextContent('runId');
    expect(screen.queryByText('Exact older request')).not.toBeInTheDocument();
  });

  it('lets the user collapse linked saved conversations and preserves unrelated query parameters', async () => {
    setup({ route: true, path: '/client/client-1?keep=1&conversationId=conversation-old&runId=run-old' });
    await screen.findByText('Exact older request');
    const summary = screen.getByText('Saved conversations');
    fireEvent.click(summary);
    await waitFor(() => expect(screen.getByTestId('query').textContent).toBe('?keep=1'));
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByTestId('query')).not.toHaveTextContent('conversationId');
    expect(screen.getByTestId('query')).not.toHaveTextContent('runId');
    expect(screen.queryByText('Exact older request')).not.toBeInTheDocument();
    expect(screen.getByText('Account manager').closest('details')).toHaveAttribute('open');
    // It remains closed across an unrelated state update, then can be reopened normally.
    fireEvent.click(summary);
    await waitFor(() => expect(summary.closest('details')).toHaveAttribute('open'));
    expect(screen.getByTestId('query')).toHaveTextContent('?keep=1');
  });

  it('restores exact same-client linked requests with back and forward navigation', async () => {
    api.getClientAgentRun.mockImplementation((_client, conversationId, id) => Promise.resolve({ ...run, id, conversationId, prompt: id === 'run-old' ? 'Older linked request' : 'Next linked request body' }));
    setup({ route: true, path: '/client/client-1?keep=1&conversationId=conversation-old&runId=run-old' });
    await screen.findByText('Older linked request');
    fireEvent.click(screen.getByRole('button', { name: 'Next linked request' }));
    expect(await screen.findByText('Next linked request body')).toBeVisible();
    expect(screen.queryByText('Older linked request')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Older linked request')).toBeVisible();
    expect(screen.queryByText('Next linked request body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(await screen.findByText('Next linked request body')).toBeVisible();
    expect(screen.getByText('Saved conversations').closest('details')).toHaveAttribute('open');
    expect(screen.getByTestId('query')).toHaveTextContent('keep=1');
    expect(api.reviewClientAgentRun).not.toHaveBeenCalled();
  });

  it('does not follow malformed IDs or run-only links', async () => {
    setup({ route: true, path: '/client/client-1?conversationId=../wrong&runId=run-old' });
    expect(screen.getByText('Account manager').closest('details')).not.toHaveAttribute('open');
    expect(api.getClientAgentRun).not.toHaveBeenCalled(); expect(api.getClientAgentConversation).not.toHaveBeenCalled();
  });

  it('keeps pending review in queue, blocks duplicate clicks, then invalidates only after persisted confirmation', async () => {
    const pending = deferred(); api.reviewClientAgentRun.mockReturnValue(pending.promise);
    const view = setup(); const invalidate = vi.spyOn(view.cache, 'invalidateQueries');
    const button = await screen.findByRole('button', { name: 'Mark reviewed' });
    fireEvent.click(button); fireEvent.click(button);
    expect(api.reviewClientAgentRun).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Marking reviewed…' })).toBeDisabled();
    expect(invalidate).not.toHaveBeenCalled();
    api.getClientAgentRun.mockResolvedValue(saved); await act(async () => pending.resolve(saved));
    expect(await screen.findByText(/Marked reviewed\. The run outcome/)).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-queue'] });
    expect(screen.getByText('Status: UNKNOWN')).toBeInTheDocument(); expect(screen.getByText(/may have incurred a cost/)).toBeInTheDocument();
    view.unmount(); setup(); expect(await screen.findByText(/Marked reviewed\. The run outcome/)).toBeInTheDocument();
  });

  it('requires manual GET after lost acknowledgement, never auto retries or clears; supports explicit retry only after unreviewed readback', async () => {
    api.reviewClientAgentRun.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(saved);
    const view = setup(); const invalidate = vi.spyOn(view.cache, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText(/Review could not be confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument(); expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check review status' }));
    expect(await screen.findByText(/saved run is not marked reviewed/)).toBeInTheDocument();
    expect(api.reviewClientAgentRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText(/Marked reviewed\. The run outcome/)).toBeInTheDocument(); expect(api.reviewClientAgentRun).toHaveBeenCalledTimes(2);
  });

  it('recovers a persisted lost acknowledgement by GET only', async () => {
    api.reviewClientAgentRun.mockRejectedValue(new Error('Lost response')); setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    await screen.findByRole('button', { name: 'Check review status' }); api.getClientAgentRun.mockResolvedValue(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Check review status' }));
    expect(await screen.findByText(/Marked reviewed\. The run outcome/)).toBeInTheDocument(); expect(api.reviewClientAgentRun).toHaveBeenCalledTimes(1);
  });

  it('hides transcript on denied review and ignores a late acknowledgement after identity changes', async () => {
    api.reviewClientAgentRun.mockRejectedValue({ status: 403 }); const first = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText(/This conversation is unavailable/)).toBeInTheDocument(); expect(screen.queryByText('Exact older request')).not.toBeInTheDocument(); first.unmount();
    const pending = deferred(); api.reviewClientAgentRun.mockReturnValue(pending.promise); const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' })); const invalidate = vi.spyOn(view.cache, 'invalidateQueries');
    auth.user = { id: 'different', organizationId: 'org-2', role: 'TEAM' }; api.listClientAgentConversations.mockRejectedValue({ status: 403 }); view.refreshActor();
    await act(async () => pending.resolve(saved));
    expect(screen.queryByText('Exact older request')).not.toBeInTheDocument(); expect(invalidate).not.toHaveBeenCalled();
  });

  it('hides other requester review controls and stale transcript after a denied exact-run refresh', async () => {
    api.getClientAgentRun.mockResolvedValue({ ...run, requestedById: 'other' }); const view = setup();
    await screen.findByText('Exact older request'); expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
    api.getClientAgentRun.mockRejectedValue({ status: 404 }); await act(async () => view.cache.invalidateQueries({ queryKey: ['client-agent-conversation'] }));
    expect(await screen.findByText(/This conversation is unavailable/)).toBeInTheDocument(); expect(screen.queryByText('Exact older request')).not.toBeInTheDocument();
  });

  it('does not accept mismatched or malformed review receipts', async () => {
    api.reviewClientAgentRun.mockResolvedValue({ ...saved, id: 'different' }); const view = setup(); const invalidate = vi.spyOn(view.cache, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' })); await screen.findByRole('button', { name: 'Check review status' });
    expect(invalidate).not.toHaveBeenCalled(); expect(screen.queryByText(/Marked reviewed\. The run outcome/)).not.toBeInTheDocument();
  });
  it('keeps review rechecks single-flight and uncertain when the status read fails', async () => {
    api.reviewClientAgentRun.mockRejectedValue(new Error('Lost response')); setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    await screen.findByRole('button', { name: 'Check review status' });
    const pending = deferred(); api.getClientAgentRun.mockReturnValue(pending.promise);
    const check = screen.getByRole('button', { name: 'Check review status' }); fireEvent.click(check); fireEvent.click(check);
    expect(screen.getByRole('button', { name: 'Checking review…' })).toBeDisabled();
    await act(async () => pending.reject(new Error('Read unavailable')));
    expect(await screen.findByRole('button', { name: 'Check review status' })).toBeInTheDocument();
    expect(api.reviewClientAgentRun).toHaveBeenCalledTimes(1); expect(screen.queryByText(/Marked reviewed\. The run outcome/)).not.toBeInTheDocument();
  });

  it('disables review while cached source data is being refreshed, and clears it for a client role', async () => {
    const view = setup(); await screen.findByRole('button', { name: 'Mark reviewed' });
    const pending = deferred(); api.getClientAgentRun.mockReturnValue(pending.promise);
    act(() => { void view.cache.invalidateQueries({ queryKey: ['client-agent-conversation'] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' })); expect(api.reviewClientAgentRun).not.toHaveBeenCalled();
    auth.user = { ...auth.user, role: 'CLIENT' }; view.refreshActor();
    await act(async () => pending.resolve(saved));
    expect(screen.queryByText('Exact older request')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  });

  it('opens an authorized exact source-channel run outside the shared picker and confirms review without a new question', async () => {
    const sourceConversation = { ...conversation, clientId: 'client-1', sourceChannelId: 'channel-1', sourceBindingId: 'binding-1', scope: 'WORKSPACE_CHANNEL' };
    api.listClientAgentConversations.mockResolvedValue({ scope: 'SHARED_STAFF', items: [], nextCursor: null });
    api.getClientAgentConversation.mockResolvedValue({ scope: 'WORKSPACE_CHANNEL', conversation: sourceConversation, runs: [], nextCursor: null });
    api.getClientAgentRun.mockResolvedValue({ ...run, scope: 'WORKSPACE_CHANNEL' });
    api.reviewClientAgentRun.mockResolvedValue({ ...saved, scope: 'WORKSPACE_CHANNEL' });
    const view = setup({ route: true });
    expect(await screen.findByText('Exact older request')).toBeVisible();
    expect(screen.getByText(/belongs to an authorized workspace channel/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Question for the account manager')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Linked conversation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText(/Marked reviewed\. The run outcome/)).toBeInTheDocument();
    expect(api.startClientAgentRun).not.toHaveBeenCalled();
    view.unmount(); api.getClientAgentRun.mockResolvedValue({ ...saved, scope: 'WORKSPACE_CHANNEL' }); setup({ route: true });
    expect(await screen.findByText(/Marked reviewed\. The run outcome/)).toBeInTheDocument();
    expect(api.reviewClientAgentRun).toHaveBeenCalledTimes(1);
  });

  it.each(['missing binding', 'wrong client', 'wrong run scope', 'denied source'])('withholds the source transcript for %s', async (failure) => {
    const sourceConversation = { ...conversation, clientId: 'client-1', sourceChannelId: 'channel-1', sourceBindingId: failure === 'missing binding' ? null : 'binding-1', scope: 'WORKSPACE_CHANNEL' };
    if (failure === 'wrong client') sourceConversation.clientId = 'other-client';
    api.getClientAgentConversation.mockResolvedValue({ scope: 'WORKSPACE_CHANNEL', conversation: sourceConversation, runs: [], nextCursor: null });
    api.getClientAgentRun.mockResolvedValue({ ...run, scope: failure === 'wrong run scope' ? 'SHARED_STAFF' : 'WORKSPACE_CHANNEL' });
    if (failure === 'denied source') api.getClientAgentConversation.mockRejectedValue({ status: 403 });
    setup({ route: true });
    await screen.findByText(/This conversation is unavailable/);
    expect(screen.queryByText('Exact older request')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  });

  it('withholds a previously visible source transcript after current membership changes', async () => {
    api.getClientAgentConversation.mockResolvedValue({ scope: 'WORKSPACE_CHANNEL', conversation: { ...conversation, clientId: 'client-1', sourceChannelId: 'channel-1', sourceBindingId: 'binding-1', scope: 'WORKSPACE_CHANNEL' }, runs: [], nextCursor: null });
    api.getClientAgentRun.mockResolvedValue({ ...run, scope: 'WORKSPACE_CHANNEL' });
    const view = setup({ route: true }); await screen.findByText('Exact older request');
    api.getClientAgentConversation.mockRejectedValue({ status: 403 });
    await act(async () => view.cache.invalidateQueries({ queryKey: ['client-agent-conversation'] }));
    expect(await screen.findByText(/This conversation is unavailable/)).toBeInTheDocument(); expect(screen.queryByText('Exact older request')).not.toBeInTheDocument();
  });

});