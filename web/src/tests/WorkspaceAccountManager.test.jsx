import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceAccountManager from '../components/WorkspaceAccountManager';
const { api } = vi.hoisted(() => ({ api: Object.fromEntries(['getWorkspaceAccountManager', 'listWorkspaceAccountManagerRequests', 'getClientAgentProfile', 'installWorkspaceAccountManager', 'updateWorkspaceAccountManager', 'requestWorkspaceAccountManager', 'getWorkspaceAccountManagerByIntent', 'cancelWorkspaceAccountManagerRequest'].map(key => [key, vi.fn()])) }));
vi.mock('../lib/api', () => ({ api }));
const user = { id: 'u1', organizationId: 'org', role: 'ADMIN' };
const channel = { id: 'ch', kind: 'CLIENT', clientId: 'c', members: [{ userId: 'u1', user: { role: 'ADMIN' } }, { userId: 'u2', user: { role: 'TEAM' } }] };
const message = { id: 'msg', content: 'Review this draft', author: { id: 'u2', name: 'Bianca', role: 'TEAM', isActive: true } };
const binding = { id: 'b', enabled: true, revision: 3 };
const row = { id: 'r', kind: 'ACCOUNT_MANAGER_DRAFT', scope: 'WORKSPACE_CHANNEL', bindingId: 'b', status: 'SUCCEEDED', deliveryState: 'DELIVERED', response: 'A private draft', sourceMessageId: 'msg', requestedById: 'u1', conversationId: 'conversation', runId: 'run', profileRevision: 1, bindingRevision: 3, createdAt: '2026-10-16T12:00:00.000Z', startedAt: '2026-10-16T12:00:01.000Z', finishedAt: '2026-10-16T12:00:02.000Z', deliveredAt: '2026-10-16T12:00:02.000Z', suppressedAt: null, errorCode: null, deliveryCode: null };
const key = 'workspace-agent-intent:org:u1:ch';
function setup(props = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={cache}><WorkspaceAccountManager channel={channel} user={user} messages={[message]} {...props} /></QueryClientProvider>);
}
async function open() { fireEvent.click(screen.getByText('Channel account manager')); await screen.findByText('Account manager is enabled.'); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  api.getWorkspaceAccountManager.mockResolvedValue({ binding });
  api.listWorkspaceAccountManagerRequests.mockResolvedValue({ items: [], nextCursor: null });
  api.getClientAgentProfile.mockResolvedValue({ id: 'p', name: 'Client manager', enabled: true, pluginIds: ['client-work'] });
});
it('excludes nonmembers, company/direct and readonly channels even for admins', () => {
  for (const change of [{ members: [] }, { kind: 'COMPANY' }, { kind: 'DIRECT' }, { readOnly: true }, { clientId: null }]) {
    const view = setup({ channel: { ...channel, ...change } }); expect(screen.queryByText('Channel account manager')).not.toBeInTheDocument(); view.unmount();
  }
  expect(api.getWorkspaceAccountManager).not.toHaveBeenCalled();
});
it('loads lazily and installs only a materialized profile disabled', async () => {
  api.getWorkspaceAccountManager.mockResolvedValue({ binding: null }); setup(); expect(api.getWorkspaceAccountManager).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Channel account manager')); fireEvent.click(await screen.findByRole('button', { name: 'Install disabled account manager' }));
  await waitFor(() => expect(api.installWorkspaceAccountManager).toHaveBeenCalledExactlyOnceWith('ch', { profileId: 'p' })); expect(api.requestWorkspaceAccountManager).not.toHaveBeenCalled();
});
it('does not expose installation to TEAM', async () => {
  api.getWorkspaceAccountManager.mockResolvedValue({ binding: null }); setup({ user: { ...user, role: 'TEAM' } }); fireEvent.click(screen.getByText('Channel account manager'));
  await screen.findByText('No account manager installed.'); expect(screen.queryByRole('button', { name: /Install/ })).not.toBeInTheDocument(); expect(api.getClientAgentProfile).not.toHaveBeenCalled();
});
it('enables using current CAS without starting inference', async () => {
  api.getWorkspaceAccountManager.mockResolvedValue({ binding: { ...binding, enabled: false } }); setup(); fireEvent.click(screen.getByText('Channel account manager'));
  fireEvent.click(await screen.findByRole('button', { name: 'Enable account manager' })); await waitFor(() => expect(api.updateWorkspaceAccountManager).toHaveBeenCalledExactlyOnceWith('ch', 'b', { revision: 3, enabled: true })); expect(api.requestWorkspaceAccountManager).not.toHaveBeenCalled();
});
it('persists only the opaque key before POST and blocks double clicks', async () => {
  let resolve; api.requestWorkspaceAccountManager.mockImplementation(() => { expect(localStorage.getItem(key)).toMatch(/^[a-f0-9-]{36}$/); return new Promise(done => { resolve = done; }); });
  setup(); await open(); fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); const button = screen.getByRole('button', { name: 'Request AI draft' }); fireEvent.click(button); fireEvent.click(button);
  expect(api.requestWorkspaceAccountManager).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).not.toContain('Review'); resolve({ invocation: row }); await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});
it('reload recovery 404 preserves uncertainty and blocks a fresh request', async () => {
  localStorage.setItem(key, '11111111-1111-4111-8111-111111111111'); api.getWorkspaceAccountManagerByIntent.mockRejectedValue({ status: 404 }); setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' }));
  await screen.findByRole('alert'); expect(localStorage.getItem(key)).toBeTruthy(); expect(api.requestWorkspaceAccountManager).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Refresh account manager' })); await screen.findByText('Account manager is enabled.'); expect(screen.getByRole('button', { name: 'Request AI draft' })).toBeDisabled();
});
it('successful recovery clears only its scoped marker', async () => {
  localStorage.setItem(key, '11111111-1111-4111-8111-111111111111'); localStorage.setItem('unrelated', 'keep'); api.getWorkspaceAccountManagerByIntent.mockResolvedValue({ invocation: row }); setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull()); expect(localStorage.getItem('unrelated')).toBe('keep');
});
it('hides cached private drafts after membership read failure', async () => {
  api.listWorkspaceAccountManagerRequests.mockResolvedValueOnce({ items: [row] }).mockRejectedValue({ status: 404 }); setup(); await open(); await screen.findByText('A private draft'); fireEvent.click(screen.getByRole('button', { name: 'Refresh account manager' })); await screen.findByRole('alert'); expect(screen.queryByText('A private draft')).not.toBeInTheDocument();
});
it('suppressed and pending bodies never render; TEAM cannot cancel another request', async () => {
  api.listWorkspaceAccountManagerRequests.mockResolvedValue({ items: [{ ...row, deliveryState: 'SUPPRESSED' }, { ...row, id: 'r2', status: 'RUNNING', deliveryState: 'PENDING', requestedById: 'other' }] }); setup({ user: { ...user, role: 'TEAM' } }); await open(); await screen.findByText('The answer was withheld. It is not available in this channel.'); expect(screen.queryByText('A private draft')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Cancel draft request' })).not.toBeInTheDocument();
});
it('cancels owned pending request with honest usage copy', async () => {
  api.listWorkspaceAccountManagerRequests.mockResolvedValue({ items: [{ ...row, status: 'RUNNING', deliveryState: 'PENDING' }] }); setup(); await open(); await screen.findByText(/provider processing and usage may already have occurred/); fireEvent.click(screen.getByRole('button', { name: 'Cancel draft request' })); await waitFor(() => expect(api.cancelWorkspaceAccountManagerRequest).toHaveBeenCalledExactlyOnceWith('ch', 'r'));
});
it('filters oversized, bot and inactive sources', async () => {
  setup({ messages: [message, { ...message, id: 'long', content: 'x'.repeat(2001) }, { ...message, id: 'bot', author: { role: 'BOT' } }, { ...message, id: 'inactive', author: { role: 'TEAM', isActive: false } }] }); await open(); expect(screen.getAllByRole('option')).toHaveLength(2);
});
it('loads bounded pages explicitly and deduplicates overlap', async () => {
  api.listWorkspaceAccountManagerRequests.mockResolvedValueOnce({ items: [row], nextCursor: 'r' }).mockResolvedValueOnce({ items: [row, { ...row, id: 'r2', response: 'Next page' }], nextCursor: null }); setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Load more draft requests' })); await screen.findByText('Next page'); expect(screen.getAllByText('A private draft')).toHaveLength(1); expect(api.listWorkspaceAccountManagerRequests).toHaveBeenLastCalledWith('ch', { limit: 20, after: 'r' });
});

it('uses real history author shape and current member roles for source eligibility', async () => {
  setup({ messages: [{ ...message, author: { id: 'u2', name: 'Bianca' } }] }); await open();
  expect(screen.getByRole('option', { name: 'Bianca: Review this draft' })).toBeInTheDocument();
});
it('does not install an unmaterialized default profile', async () => {
  api.getWorkspaceAccountManager.mockResolvedValue({ binding: null }); api.getClientAgentProfile.mockResolvedValue({ id: null });
  setup(); fireEvent.click(screen.getByText('Channel account manager')); await screen.findByText(/Save an account manager profile/);
  expect(screen.queryByRole('button', { name: /Install disabled/ })).not.toBeInTheDocument();
});
it('keeps uncertain POST marker across unmount and never submits automatically on remount', async () => {
  api.requestWorkspaceAccountManager.mockRejectedValue(new Error('network'));
  const first = setup(); await open(); fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }));
  await screen.findByRole('alert'); expect(localStorage.getItem(key)).toBeTruthy(); first.unmount(); setup(); await open();
  expect(screen.getByRole('button', { name: 'Request AI draft' })).toBeDisabled(); expect(api.requestWorkspaceAccountManager).toHaveBeenCalledTimes(1);
});
it('switching channels discards visible private cards and isolates recovery', async () => {
  api.listWorkspaceAccountManagerRequests.mockResolvedValueOnce({ items: [row] }).mockResolvedValue({ items: [] });
  const first = setup(); await open(); await screen.findByText('A private draft'); first.unmount();
  setup({ channel: { ...channel, id: 'other' } }); await open(); expect(screen.queryByText('A private draft')).not.toBeInTheDocument();
});

it('retains reconciliation key after a malformed successful recovery response', async () => {
  localStorage.setItem(key, '11111111-1111-4111-8111-111111111111'); api.getWorkspaceAccountManagerByIntent.mockResolvedValue({});
  setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' })); await screen.findByRole('alert');
  expect(localStorage.getItem(key)).toBeTruthy(); expect(api.requestWorkspaceAccountManager).not.toHaveBeenCalled();
});
it('retains key after malformed successful POST receipt rather than allowing another inference', async () => {
  api.requestWorkspaceAccountManager.mockResolvedValue({}); setup(); await open();
  fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }));
  await screen.findByRole('alert'); expect(localStorage.getItem(key)).toBeTruthy(); expect(api.requestWorkspaceAccountManager).toHaveBeenCalledTimes(1);
});

it('a delayed old POST cannot erase the newer remount recovery key', async () => {
  let resolveOld; let resolveNew;
  api.requestWorkspaceAccountManager.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  const first = setup(); await open(); fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }));
  const firstKey = localStorage.getItem(key); first.unmount();
  api.getWorkspaceAccountManagerByIntent.mockResolvedValue({ invocation: row }); setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }));
  const secondKey = localStorage.getItem(key); expect(secondKey).not.toBe(firstKey);
  await act(async () => resolveOld({ invocation: row })); expect(localStorage.getItem(key)).toBe(secondKey);
  await act(async () => resolveNew({ invocation: row })); await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});
it('a delayed old recovery cannot erase the newer remount request key', async () => {
  let resolveOld; let resolveNew;
  localStorage.setItem(key, '11111111-1111-4111-8111-111111111111');
  api.getWorkspaceAccountManagerByIntent.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ invocation: row });
  const first = setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' })); first.unmount();
  setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' })); await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  api.requestWorkspaceAccountManager.mockImplementation(() => new Promise(resolve => { resolveNew = resolve; }));
  fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' })); const secondKey = localStorage.getItem(key);
  await act(async () => resolveOld({ invocation: row })); expect(localStorage.getItem(key)).toBe(secondKey);
  await act(async () => resolveNew({ invocation: row })); await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});
it.each([
  { id: 'partial', kind: 'ACCOUNT_MANAGER_DRAFT', scope: 'WORKSPACE_CHANNEL', requestedById: 'u1' },
  { ...row, status: 'RUNNING', deliveryState: 'DELIVERED' },
  { ...row, runId: '' }, { ...row, profileRevision: -1 }, { ...row, finishedAt: undefined },
])('keeps recovery for incomplete or incoherent typed receipt %#', async invocation => {
  localStorage.setItem(key, '11111111-1111-4111-8111-111111111111'); api.getWorkspaceAccountManagerByIntent.mockResolvedValue({ invocation });
  setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Recover previous request' })); await screen.findByRole('alert'); expect(localStorage.getItem(key)).toBeTruthy();
});
it('accepts the actual complete queued request contract without requiring delivered output', async () => {
  const queued = { ...row, status: 'QUEUED', deliveryState: 'PENDING', response: null, startedAt: null, finishedAt: null, deliveredAt: null };
  api.requestWorkspaceAccountManager.mockResolvedValue({ invocation: queued }); setup(); await open();
  fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull()); expect(api.requestWorkspaceAccountManager).toHaveBeenCalledTimes(1); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('compare-and-clear preserves a different key written while the instance is still mounted', async () => {
  let resolve; api.requestWorkspaceAccountManager.mockImplementation(() => new Promise(done => { resolve = done; })); setup(); await open();
  fireEvent.change(screen.getByLabelText('Source message for AI draft'), { target: { value: 'msg' } }); fireEvent.click(screen.getByRole('button', { name: 'Request AI draft' }));
  const newerKey = '22222222-2222-4222-8222-222222222222'; localStorage.setItem(key, newerKey);
  await act(async () => resolve({ invocation: row })); expect(localStorage.getItem(key)).toBe(newerKey); expect(screen.getByRole('button', { name: 'Request AI draft' })).toBeDisabled();
});
