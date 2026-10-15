import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useGmailSendIntent from '../hooks/useGmailSendIntent';
import GmailSendRecovery from '../components/GmailSendRecovery';

const { api, toast } = vi.hoisted(() => ({ api: Object.fromEntries(['getGmailSendReceipt', 'reconcileGmailSendReceipt', 'getThread', 'gmailDraftReply', 'getGmailStatus', 'gmailSend'].map((name) => [name, vi.fn()])), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-a', organizationId: 'org-a', role: 'TEAM', name: 'Cameron' } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));
const { default: Thread } = await import('../pages/Thread');
const identity = { userId: 'user-a', organizationId: 'org-a', threadId: 'thread-a' };
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Gmail send intent', () => {
  it('persists the key before dispatch, retains it on reload and stores no email fields', () => {
    const first = renderHook(() => useGmailSendIntent(identity));
    let key;
    act(() => { key = first.result.current.prepareIntent(); });
    const stored = JSON.parse(localStorage.getItem(localStorage.key(0)));
    expect(stored).toEqual({ key, status: 'PREPARED' });
    act(() => first.result.current.recordResult({ status: 'UNKNOWN', to: 'private@example.test', body: 'private email', token: 'secret', receiptId: 'r1' }));
    expect(localStorage.getItem(localStorage.key(0))).not.toMatch(/private|secret|receiptId/);
    first.unmount();
    const reopened = renderHook(() => useGmailSendIntent(identity));
    expect(reopened.result.current.status).toBe('UNKNOWN');
    act(() => expect(reopened.result.current.prepareIntent()).toBe(key));
    expect(api.getGmailSendReceipt).not.toHaveBeenCalled();
    expect(api.reconcileGmailSendReceipt).not.toHaveBeenCalled();
  });

  it('fails closed if storage throws or silently drops the intent', () => {
    const hook = renderHook(() => useGmailSendIntent(identity));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    act(() => expect(() => hook.result.current.prepareIntent()).toThrow(/Sending is blocked/));
    expect(hook.result.current.storageError).toBe(true);
    expect(hook.result.current.unresolved).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota private'); });
    act(() => expect(() => hook.result.current.prepareIntent()).toThrow(/could not be retained/));
    expect(api.getGmailSendReceipt).not.toHaveBeenCalled();
  });

  it('does not reset unknown, dispatching or accepted pending attempts', () => {
    const hook = renderHook(() => useGmailSendIntent(identity));
    let key; act(() => { key = hook.result.current.prepareIntent(); });
    for (const status of ['UNKNOWN', 'DISPATCHING', 'ACCEPTED_PENDING_RECORD']) {
      act(() => hook.result.current.recordResult({ status }));
      act(() => expect(hook.result.current.clearConfirmedIntent()).toBe(false));
      expect(hook.result.current.intent.key).toBe(key);
      expect(hook.result.current.unresolved).toBe(true);
    }
  });

  it('blocks sending when a persisted intent is corrupted instead of replacing it', () => {
    localStorage.setItem('ashbi:gmail-send-intent:org-a:user-a:thread-a', '{invalid');
    const hook = renderHook(() => useGmailSendIntent(identity));
    expect(hook.result.current.storageError).toBe(true);
    act(() => expect(() => hook.result.current.prepareIntent()).toThrow(/Sending is blocked/));
    expect(localStorage.getItem(localStorage.key(0))).toBe('{invalid');
  });

  it('allows explicit clearing of a rejected attempt', () => {
    const hook = renderHook(() => useGmailSendIntent(identity));
    act(() => { hook.result.current.prepareIntent(); hook.result.current.recordResult({ status: 'REJECTED' }); });
    expect(hook.result.current.unresolved).toBe(false);
    act(() => expect(hook.result.current.clearConfirmedIntent()).toBe(true));
    expect(localStorage.length).toBe(0);
  });

  it('allows a new key only after confirmed completion is explicitly cleared', () => {
    api.getGmailSendReceipt.mockResolvedValue({ status: 'COMPLETED', receiptId: 'r1', success: true });
    const hook = renderHook(() => useGmailSendIntent(identity));
    let key; act(() => { key = hook.result.current.prepareIntent(); });
    act(() => hook.result.current.recordResult({ status: 'COMPLETED' }));
    expect(hook.result.current.unresolved).toBe(false);
    act(() => expect(hook.result.current.prepareIntent()).toBe(key));
    act(() => expect(hook.result.current.clearConfirmedIntent()).toBe(true));
    act(() => expect(hook.result.current.prepareIntent()).not.toBe(key));
  });

  it('keeps identities isolated when switching users, organizations and threads', () => {
    const hook = renderHook((props) => useGmailSendIntent(props), { initialProps: identity });
    let first; act(() => { first = hook.result.current.prepareIntent(); });
    for (const changed of [{ ...identity, userId: 'user-b' }, { ...identity, organizationId: 'org-b' }, { ...identity, threadId: 'thread-b' }]) {
      hook.rerender(changed); expect(hook.result.current.intent).toBeNull();
      act(() => expect(hook.result.current.prepareIntent()).not.toBe(first));
    }
    hook.rerender(identity); expect(hook.result.current.intent.key).toBe(first);
  });

  it('makes receipt GET explicit and only confirmed 404 clears dispatch uncertainty', async () => {
    api.getGmailSendReceipt.mockRejectedValueOnce({ status: 503, message: 'private provider details' }).mockRejectedValueOnce({ status: 404 });
    const hook = renderHook(() => useGmailSendIntent(identity));
    act(() => { hook.result.current.prepareIntent(); hook.result.current.recordResult({ status: 'UNKNOWN' }); });
    await act(async () => hook.result.current.checkReceipt());
    expect(hook.result.current.status).toBe('UNKNOWN');
    expect(hook.result.current.error).not.toContain('private');
    await act(async () => hook.result.current.checkReceipt());
    expect(hook.result.current.status).toBe('NOT_DISPATCHED');
    act(() => expect(hook.result.current.clearConfirmedIntent()).toBe(true));
    expect(hook.result.current.intent).toBeNull();
  });

  it('reconciles only accepted pending records using the saved key', async () => {
    api.reconcileGmailSendReceipt.mockResolvedValue({ status: 'COMPLETED', success: true });
    const hook = renderHook(() => useGmailSendIntent(identity));
    let key; act(() => { key = hook.result.current.prepareIntent(); hook.result.current.recordResult({ status: 'UNKNOWN' }); });
    await act(async () => hook.result.current.reconcileReceipt());
    expect(api.reconcileGmailSendReceipt).not.toHaveBeenCalled();
    act(() => hook.result.current.recordResult({ status: 'ACCEPTED_PENDING_RECORD' }));
    await act(async () => hook.result.current.reconcileReceipt());
    expect(api.reconcileGmailSendReceipt).toHaveBeenCalledExactlyOnceWith(key);
    expect(hook.result.current.status).toBe('COMPLETED');
  });

  it('ignores a prior identity receipt response after switching threads', async () => {
    let resolve;
    api.getGmailSendReceipt.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const hook = renderHook((props) => useGmailSendIntent(props), { initialProps: identity });
    act(() => { hook.result.current.prepareIntent(); hook.result.current.recordResult({ status: 'UNKNOWN' }); });
    let request;
    act(() => { request = hook.result.current.checkReceipt(); });
    hook.rerender({ ...identity, threadId: 'thread-b' });
    await act(async () => { resolve({ status: 'COMPLETED' }); await request; });
    expect(hook.result.current.intent).toBeNull();
  });

  it('prevents duplicate receipt operations while one is pending', async () => {
    let resolve;
    api.getGmailSendReceipt.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const hook = renderHook(() => useGmailSendIntent(identity));
    act(() => hook.result.current.prepareIntent());
    let request;
    act(() => { request = hook.result.current.checkReceipt(); hook.result.current.checkReceipt(); });
    expect(api.getGmailSendReceipt).toHaveBeenCalledTimes(1);
    expect(hook.result.current.checking).toBe(true);
    await act(async () => { resolve({ status: 'DISPATCHING' }); await request; });
    expect(hook.result.current.status).toBe('DISPATCHING');
    expect(hook.result.current.checking).toBe(false);
  });
});

describe('Gmail send recovery controls', () => {
  function Recovery() { const recovery = useGmailSendIntent(identity); return <><button onClick={() => { recovery.prepareIntent(); recovery.recordResult({ status: 'UNKNOWN' }); }}>Prepare uncertain attempt</button><GmailSendRecovery recovery={recovery} /></>; }

  it('offers check-only for unknown and explicit record completion after acceptance', async () => {
    api.getGmailSendReceipt.mockResolvedValue({ status: 'ACCEPTED_PENDING_RECORD' });
    api.reconcileGmailSendReceipt.mockResolvedValue({ status: 'COMPLETED' });
    render(<Recovery />); fireEvent.click(screen.getByRole('button', { name: 'Prepare uncertain attempt' }));
    expect(screen.getByText(/may already have been sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|resend|Clear confirmed/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check delivery status' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish saving sent email' }));
    await screen.findByText('The email was sent and its Hub record is saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear confirmed send attempt' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Email delivery status' })).not.toBeInTheDocument());
  });
});

describe('Thread with real Gmail send recovery', () => {
  function renderThread() {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/thread/thread-a']}><Link to="/thread/thread-b">Open other conversation</Link><Routes><Route path="/thread/:id" element={<Thread />} /></Routes></MemoryRouter></QueryClientProvider>);
  }
  function configureThread() {
    api.getThread.mockResolvedValue({ id: 'thread-a', subject: 'Client question', status: 'OPEN', priority: 'NORMAL', client: { id: 'client-a', name: 'Client A' }, project: null, createdAt: '2026-10-15T10:00:00Z', lastActivityAt: '2026-10-15T10:00:00Z', aiAnalysis: null, internalNotes: [], responses: [], messages: [] });
    api.gmailDraftReply.mockResolvedValue({ to: 'client@example.test', subject: 'Re: Client question', draft: 'Proposed reply' });
    api.getGmailStatus.mockResolvedValue({ connected: true, email: 'team@example.test' });
  }

  it('retains unknown delivery after a full page remount and never sends or regenerates another draft automatically', async () => {
    configureThread(); api.gmailSend.mockResolvedValue({ status: 'UNKNOWN', receiptId: 'receipt-1' });
    const first = renderThread();
    fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    await within(dialog).findByText('Sends from team@example.test.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send email' }));
    await screen.findByText(/Email delivery is uncertain/);
    expect(toast.success).not.toHaveBeenCalled();
    const original = api.gmailSend.mock.calls[0][0].idempotencyKey;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(/Email delivery is uncertain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reply via Gmail/ }));
    const reopened = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    expect(within(reopened).getByRole('button', { name: 'Send email' })).toBeDisabled();
    expect(api.gmailDraftReply).toHaveBeenCalledTimes(1);
    first.unmount(); renderThread();
    await screen.findByText(/Email delivery is uncertain/);
    expect(api.gmailDraftReply).toHaveBeenCalledTimes(1);
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('ashbi:gmail-send-intent:org-a:user-a:thread-a'))).toEqual({ key: original, status: 'UNKNOWN' });
    expect(api.getGmailSendReceipt).not.toHaveBeenCalled();
  });

  it('keeps accepted delivery pending and offers record repair without another Gmail send', async () => {
    configureThread();
    api.gmailSend.mockResolvedValue({ status: 'ACCEPTED_PENDING_RECORD', receiptId: 'receipt-2' });
    api.reconcileGmailSendReceipt.mockResolvedValue({ status: 'COMPLETED', receiptId: 'receipt-2', success: true });
    renderThread(); fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    await within(dialog).findByText('Sends from team@example.test.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send email' }));
    const repair = await screen.findByRole('button', { name: 'Finish saving sent email' });
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(repair);
    await screen.findByText('The email was sent and its Hub record is saved.');
    expect(api.gmailSend).toHaveBeenCalledTimes(1);
    expect(api.reconcileGmailSendReceipt).toHaveBeenCalledTimes(1);
  });

  it('submits only one email POST for duplicate synchronous form submissions', async () => {
    configureThread();
    let resolve;
    api.gmailSend.mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderThread(); fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    await within(dialog).findByText('Sends from team@example.test.');
    const form = within(dialog).getByRole('button', { name: 'Send email' }).closest('form');
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(api.gmailSend).toHaveBeenCalledTimes(1));
    await act(async () => resolve({ status: 'UNKNOWN' }));
  });

  it('discards a late draft from another thread after navigation', async () => {
    configureThread();
    let resolve;
    api.gmailDraftReply.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderThread(); fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    await waitFor(() => expect(api.gmailDraftReply).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'Open other conversation' }));
    await waitFor(() => expect(api.getThread).toHaveBeenCalledWith('thread-b'));
    await act(async () => resolve({ to: 'other-client@example.test', subject: 'Private original thread', draft: 'Private old draft' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private old draft')).not.toBeInTheDocument();
    expect(api.gmailSend).not.toHaveBeenCalled();
  });
});
