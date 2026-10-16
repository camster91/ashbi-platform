import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PortalTeamRequests from '../components/PortalTeamRequests';
import ProjectHumanHandoffs from '../components/ProjectHumanHandoffs';

const { portalHandoffs, api, auth } = vi.hoisted(() => ({ portalHandoffs: { list: vi.fn(), create: vi.fn(), recover: vi.fn() }, api: { listPortalHandoffs: vi.fn(), transitionPortalHandoff: vi.fn() }, auth: { user: { id: 'u1', organizationId: 'o1', role: 'TEAM' } } }));
vi.mock('../lib/portal-handoffs', () => ({ portalHandoffs }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const identity = { organizationId: 'o1', userId: 'portal1', contactId: 'contact1' };
const row = { id: 'r1', projectId: 'p1', question: 'Can we review the draft?', status: 'PENDING', revision: 1, ownerId: null, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z' };
function setup(element) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (child) => <QueryClientProvider client={cache}>{child}</QueryClientProvider>;
  return { ...render(view(element)), view, cache };
}
const portal = (props = {}) => <PortalTeamRequests projectId="p1" identity={identity} {...props} />;
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks(); auth.user = { id: 'u1', organizationId: 'o1', role: 'TEAM' };
  portalHandoffs.list.mockResolvedValue({ items: [], nextCursor: null });
  api.listPortalHandoffs.mockResolvedValue({ items: [row], nextCursor: null });
});

describe('portal human questions', () => {
  it('persists an opaque scoped key before explicit submission and renders saved questions as plaintext', async () => {
    portalHandoffs.create.mockImplementation(async (_project, _token, body) => {
      const saved = JSON.parse(localStorage.getItem(localStorage.key(0)));
      expect(saved).toEqual({ key: body.idempotencyKey, status: 'PREPARED' });
      expect(JSON.stringify(saved)).not.toContain(body.question);
      portalHandoffs.list.mockResolvedValue({ items: [{ ...row, question: body.question }], nextCursor: null });
      return { request: { ...row, question: body.question } };
    });
    const { container } = setup(portal());
    await screen.findByText('You have not submitted any requests for this project.');
    expect(portalHandoffs.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: '<img src=x> Please review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    await screen.findByText('<img src=x> Please review');
    expect(container.querySelector('img')).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(screen.getByText('Waiting for the team')).toBeInTheDocument();
  });

  it('freezes unknown submissions through remount and recovers only by explicit intent lookup', async () => {
    portalHandoffs.create.mockRejectedValue(new Error('private provider details'));
    const first = setup(portal()); await screen.findByLabelText('Your question');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Private question body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    await screen.findByText(/Submission could not be confirmed/);
    const stored = JSON.parse(localStorage.getItem(localStorage.key(0)));
    expect(stored.status).toBe('UNKNOWN'); expect(JSON.stringify(stored)).not.toContain('Private');
    first.unmount(); setup(portal());
    await screen.findByRole('button', { name: 'Check submission status' });
    expect(screen.getByLabelText('Your question')).toBeDisabled();
    expect(portalHandoffs.create).toHaveBeenCalledTimes(1);
    expect(portalHandoffs.recover).not.toHaveBeenCalled();
    portalHandoffs.recover.mockResolvedValue({ request: row });
    fireEvent.click(screen.getByRole('button', { name: 'Check submission status' }));
    await screen.findByText(/Your request is saved for the team/);
    expect(portalHandoffs.recover).toHaveBeenCalledWith('p1', undefined, stored.key);
    expect(localStorage.length).toBe(0);
  });

  it('fails closed on unavailable storage without sending a question', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    setup(portal()); await screen.findByLabelText('Your question');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    await screen.findByText(/Browser storage could not retain/);
    expect(portalHandoffs.create).not.toHaveBeenCalled(); spy.mockRestore();
  });

  it('deduplicates own-request pagination and requires server identity', async () => {
    portalHandoffs.list.mockResolvedValueOnce({ items: [row], nextCursor: 'r1' }).mockResolvedValueOnce({ items: [row, { ...row, id: 'r2', question: 'Other request' }], nextCursor: null });
    setup(portal()); fireEvent.click(await screen.findByRole('button', { name: 'Load more requests' }));
    await screen.findByText('Other request'); expect(screen.getAllByText(row.question)).toHaveLength(1);
    expect(portalHandoffs.list).toHaveBeenLastCalledWith('p1', undefined, 'r1');
  });

  it('clears visible question state and ignores a late prior-project callback', async () => {
    let resolve;
    portalHandoffs.create.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { rerender, view } = setup(portal()); await screen.findByLabelText('Your question');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Private A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    await waitFor(() => expect(portalHandoffs.create).toHaveBeenCalledTimes(1));
    rerender(view(portal({ projectId: 'p2' })));
    await act(async () => resolve({ request: row }));
    expect(screen.getByLabelText('Your question')).toHaveValue('');
    expect(screen.queryByText(/Your request is saved/)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(localStorage.key(0))).status).toBe('PREPARED');
    rerender(view(portal({ identity: { ...identity, contactId: 'replacement' } })));
    expect(screen.getByLabelText('Your question')).toBeEnabled();
    rerender(view(portal({ identity: undefined })));
    expect(screen.getByText(/Sign in again/)).toBeInTheDocument();
  });

  it('keeps unknown attempts frozen after a failed by-intent lookup and never replays a POST', async () => {
    portalHandoffs.create.mockRejectedValue({ status: 503 });
    portalHandoffs.recover.mockRejectedValue({ status: 404 });
    setup(portal()); await screen.findByLabelText('Your question');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check submission status' }));
    await screen.findByText(/The saved request could not be confirmed/);
    expect(screen.getByLabelText('Your question')).toBeDisabled();
    expect(portalHandoffs.create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(localStorage.key(0))).status).toBe('UNKNOWN');
  });

  it('hides previously loaded questions after an authority error', async () => {
    portalHandoffs.list.mockResolvedValueOnce({ items: [row], nextCursor: 'r1' }).mockRejectedValue({ status: 401 });
    setup(portal()); await screen.findByText(row.question);
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(row.question)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
  });

  it.each([
    { id: 'r1', projectId: 'p1' },
    { ...row, status: 'QUEUED' },
    { ...row, updatedAt: 'invalid date' },
    { ...row, question: '' },
  ])('keeps an incomplete or invalid 200 receipt unresolved: %j', async (request) => {
    portalHandoffs.create.mockResolvedValue({ request });
    setup(portal()); await screen.findByLabelText('Your question');
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'My question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    await screen.findByText(/Submission could not be confirmed/);
    expect(JSON.parse(localStorage.getItem(localStorage.key(0))).status).toBe('UNKNOWN');
    expect(screen.getByLabelText('Your question')).toBeDisabled();
    expect(screen.queryByText(/Your request is saved for the team/)).not.toBeInTheDocument();
  });

  it.each(['post-success', 'post-error', 'recover-success', 'recover-error'])('does not replace or clear another tab intent after late %s', async (operation) => {
    const storageKey = 'portal-team-request:o1:portal1:contact1:p1';
    const key1 = '11111111-1111-4111-8111-111111111111';
    const key2 = '22222222-2222-4222-8222-222222222222';
    let resolve, reject;
    const deferred = () => new Promise((done, fail) => { resolve = done; reject = fail; });
    const recovering = operation.startsWith('recover');
    if (recovering) { localStorage.setItem(storageKey, JSON.stringify({ key: key1, status: 'UNKNOWN' })); portalHandoffs.recover.mockImplementation(deferred); }
    else portalHandoffs.create.mockImplementation(deferred);
    setup(portal()); await screen.findByLabelText('Your question');
    if (recovering) fireEvent.click(await screen.findByRole('button', { name: 'Check submission status' }));
    else {
      fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Original question' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' }));
    }
    await waitFor(() => expect(recovering ? portalHandoffs.recover : portalHandoffs.create).toHaveBeenCalledTimes(1));
    act(() => { localStorage.setItem(storageKey, JSON.stringify({ key: key2, status: 'UNKNOWN' })); window.dispatchEvent(new StorageEvent('storage', { key: storageKey })); });
    await act(async () => { if (operation.endsWith('success')) resolve({ request: row }); else reject({ status: 503 }); });
    expect(JSON.parse(localStorage.getItem(storageKey))).toEqual({ key: key2, status: 'UNKNOWN' });
    expect(screen.getByLabelText('Your question')).toBeDisabled();
    expect(screen.queryByText(/Your request is saved for the team/)).not.toBeInTheDocument();
  });

  it.each(['post', 'recover'])('does not clear a remounted new intent after an old %s completes', async (operation) => {
    const storageKey = 'portal-team-request:o1:portal1:contact1:p1';
    const key1 = '11111111-1111-4111-8111-111111111111';
    const key2 = '22222222-2222-4222-8222-222222222222';
    let resolve;
    if (operation === 'recover') { localStorage.setItem(storageKey, JSON.stringify({ key: key1, status: 'UNKNOWN' })); portalHandoffs.recover.mockImplementation(() => new Promise((done) => { resolve = done; })); }
    else portalHandoffs.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = setup(portal()); await screen.findByLabelText('Your question');
    if (operation === 'recover') fireEvent.click(await screen.findByRole('button', { name: 'Check submission status' }));
    else { fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Original question' } }); fireEvent.click(screen.getByRole('button', { name: 'Send question to the team' })); }
    await waitFor(() => expect(operation === 'recover' ? portalHandoffs.recover : portalHandoffs.create).toHaveBeenCalledTimes(1));
    first.unmount(); localStorage.setItem(storageKey, JSON.stringify({ key: key2, status: 'UNKNOWN' })); setup(portal());
    await act(async () => resolve({ request: row }));
    expect(JSON.parse(localStorage.getItem(storageKey))).toEqual({ key: key2, status: 'UNKNOWN' });
    expect(screen.getByLabelText('Your question')).toBeDisabled();
    expect(screen.queryByText(/Your request is saved for the team/)).not.toBeInTheDocument();
  });
});

describe('staff human handoffs', () => {
  it('loads lazily and claims using the server revision', async () => {
    api.transitionPortalHandoff.mockImplementation(async () => { api.listPortalHandoffs.mockResolvedValue({ items: [{ ...row, status: 'CLAIMED', revision: 2, ownerId: 'u1' }], nextCursor: null }); return { request: { ...row, status: 'CLAIMED', revision: 2, ownerId: 'u1' } }; });
    setup(<ProjectHumanHandoffs projectId="p1" />);
    expect(api.listPortalHandoffs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Client questions for the team'));
    fireEvent.click(await screen.findByRole('button', { name: 'Claim request' }));
    await screen.findByText('Claimed · Assigned to you');
    expect(api.transitionPortalHandoff).toHaveBeenCalledWith('r1', 'claim', { revision: 1 });
    expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeEnabled();
  });

  it('blocks stale CAS retries until explicit reload and hides cached records on lost authority', async () => {
    api.transitionPortalHandoff.mockRejectedValueOnce({ status: 409 });
    setup(<ProjectHumanHandoffs projectId="p1" />); fireEvent.click(screen.getByText('Client questions for the team'));
    fireEvent.click(await screen.findByRole('button', { name: 'Claim request' }));
    await screen.findByText(/This request changed/);
    expect(screen.getByRole('button', { name: 'Claim request' })).toBeDisabled();
    api.listPortalHandoffs.mockRejectedValue({ status: 403, message: 'private database error' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload client questions' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(row.question)).not.toBeInTheDocument();
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
  });

  it('offers resolve only to the owner or admin and admin-only explicit requeue reason', async () => {
    api.listPortalHandoffs.mockResolvedValue({ items: [{ ...row, status: 'CLAIMED', ownerId: 'u2', revision: 4 }], nextCursor: null });
    const { rerender, view } = setup(<ProjectHumanHandoffs projectId="p1" />); fireEvent.click(screen.getByText('Client questions for the team'));
    await screen.findByText(row.question); expect(screen.queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to unassigned' })).not.toBeInTheDocument();
    auth.user.role = 'ADMIN'; rerender(view(<ProjectHumanHandoffs projectId="p1" />));
    fireEvent.click(screen.getByText('Client questions for the team'));
    await screen.findByRole('button', { name: 'Mark resolved' });
    api.transitionPortalHandoff.mockResolvedValue({ request: row });
    fireEvent.change(screen.getByLabelText('Requeue reason for request r1'), { target: { value: 'OWNER_UNAVAILABLE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return to unassigned' }));
    await waitFor(() => expect(api.transitionPortalHandoff).toHaveBeenCalledWith('r1', 'requeue', { revision: 4, reason: 'OWNER_UNAVAILABLE' }));
    auth.user.role = 'CLIENT'; rerender(view(<ProjectHumanHandoffs projectId="p1" />));
    expect(screen.queryByText(row.question)).not.toBeInTheDocument();
  });

  it('uses the refreshed revision after a CAS conflict and explicit reload', async () => {
    api.transitionPortalHandoff.mockRejectedValueOnce({ status: 409 }).mockResolvedValueOnce({ request: { ...row, revision: 3 } });
    setup(<ProjectHumanHandoffs projectId="p1" />); fireEvent.click(screen.getByText('Client questions for the team'));
    fireEvent.click(await screen.findByRole('button', { name: 'Claim request' }));
    await screen.findByText(/This request changed/);
    api.listPortalHandoffs.mockResolvedValue({ items: [{ ...row, revision: 2 }], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Reload client questions' }));
    await screen.findByText('Latest requests loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Claim request' }));
    await waitFor(() => expect(api.transitionPortalHandoff).toHaveBeenLastCalledWith('r1', 'claim', { revision: 2 }));
  });
});
