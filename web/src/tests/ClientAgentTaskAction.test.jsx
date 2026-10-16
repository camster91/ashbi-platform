import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientAgentTaskAction from '../components/ClientAgentTaskAction';


const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['getProjects', 'prepareClientTaskAction', 'getClientTaskActionByIntent', 'getClientTaskAction', 'confirmClientTaskAction', 'listClientCommunications', 'getClientCommunication'].map((name) => [name, vi.fn()])), auth: { user: { id: 'staff', organizationId: 'org', role: 'TEAM' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const message = { subject: 'Website request' };
const project = { id: 'project1', clientId: 'client1', name: 'Website', status: 'ACTIVE' };
const pendingAction = { id: 'action1', status: 'PENDING_CONFIRMATION', expired: false, preview: { task: { title: 'Website request', description: '', priority: 'NORMAL', dueDate: null }, destination: { projectId: 'project1', projectName: 'Website', clientId: 'client1' }, source: { ...message, messageId: message.id, receivedAt: '2026-10-16T10:00:00Z' } } };
const doneAction = { ...pendingAction, status: 'EXECUTED', outcome: 'succeeded', result: { task: { id: 'task1', projectId: 'project1',  } } };
const clients = [];
function setup({ user = auth.user, clientId = 'client1', enabled = true } = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(cache);
  const element = () => <QueryClientProvider client={cache}><MemoryRouter><ClientAgentTaskAction clientId={clientId} user={user} enabled={enabled} /></MemoryRouter></QueryClientProvider>;
  const view = render(element());
  return { ...view, refresh: () => view.rerender(element()) };
}
async function preview() {
  await screen.findByRole('option', { name: 'Website' });
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Website request' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
  await screen.findByRole('region', { name: 'Task preview' });
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto);
  auth.user = { id: 'staff', organizationId: 'org', role: 'TEAM' };
  api.getProjects.mockResolvedValue({ projects: [project], total: 1 });
  api.prepareClientTaskAction.mockResolvedValue({ action: pendingAction });
  api.confirmClientTaskAction.mockResolvedValue({ action: doneAction });
  api.getClientTaskActionByIntent.mockResolvedValue({ action: pendingAction });
  api.getClientTaskAction.mockResolvedValue({ action: doneAction });
  api.listClientCommunications.mockResolvedValue({ items: [message], nextCursor: null });
  api.getClientCommunication.mockResolvedValue({ ...message, bodyText: 'Please update our website' });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });

describe('client task proposals', () => {
  it.each(['CLIENT', 'BOT'])('does not expose actions or load projects for %s', (role) => {
    setup({ user: { ...auth.user, role } });
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(api.getProjects).not.toHaveBeenCalled();
  });
  it('requires the plugin and enabled profile', () => {
    setup({ enabled: false }); expect(api.getProjects).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Task proposals')).not.toBeInTheDocument();
  });
  it('previews without executing and confirms the frozen server task explicitly', async () => {
    setup(); await preview();
    expect(api.confirmClientTaskAction).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(api.prepareClientTaskAction).toHaveBeenCalledExactlyOnceWith('client1', { input: { projectId: 'project1', title: 'Website request', description: '', priority: 'NORMAL' }, idempotencyKey: expect.any(String) });
    const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)));
    expect(Object.keys(stored).sort()).toEqual(['fingerprint', 'key']);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    expect(await screen.findByRole('link', { name: 'Open created task' })).toHaveAttribute('href', '/task/task1');
    expect(api.confirmClientTaskAction).toHaveBeenCalledExactlyOnceWith('client1', 'action1');
  });
  it('retains a reviewable preview after recent-auth cancellation', async () => {
    api.confirmClientTaskAction.mockRejectedValueOnce({ status: 403, data: { code: 'REAUTH_REQUIRED' } });
    setup(); await preview(); fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    await screen.findByText('Confirm your identity to create this task. No task was created.');
    expect(screen.getByRole('button', { name: 'Confirm create task' })).toBeEnabled();
    expect(screen.queryByText(/no longer have access/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    await screen.findByRole('link', { name: 'Open created task' });
  });
  it('recovers after reload by scoped intent without automatically creating a preview or task', async () => {
    const first = setup(); await preview();
    const key = api.prepareClientTaskAction.mock.calls[0][1].idempotencyKey;
    first.unmount(); setup();
    await screen.findByRole('region', { name: 'Task preview' });
    expect(api.getClientTaskActionByIntent).toHaveBeenCalledExactlyOnceWith('client1', key);
    expect(api.prepareClientTaskAction).toHaveBeenCalledTimes(1);
    expect(api.confirmClientTaskAction).not.toHaveBeenCalled();
  });
  it('retains the same key after uncertain preview and 404 lookup, rejecting changed inputs', async () => {
    api.prepareClientTaskAction.mockRejectedValueOnce(new Error('network'));
    api.getClientTaskActionByIntent.mockRejectedValueOnce({ status: 404 });
    const first = setup();
    await screen.findByRole('option', { name: 'Website' });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Website request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
    await screen.findByText(/preview could not be confirmed/);
    const key = api.prepareClientTaskAction.mock.calls[0][1].idempotencyKey;
    first.unmount(); setup(); await screen.findByText(/saved request could not be checked/);
    await screen.findByRole('option', { name: 'Website' });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same preview' }));
    await screen.findByText(/earlier preview is unresolved/);
    expect(api.prepareClientTaskAction).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Website request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same preview' }));
    await screen.findByRole('region', { name: 'Task preview' });
    expect(api.prepareClientTaskAction.mock.calls[1][1].idempotencyKey).toBe(key);
  });
  it('filters foreign, archived and deleted project options', async () => {
    api.getProjects.mockResolvedValue({ total: 4, projects: [project, { ...project, id: 'foreign', clientId: 'other', name: 'Foreign' }, { ...project, id: 'old', status: 'ARCHIVED', name: 'Archived' }, { ...project, id: 'deleted', deletedAt: 'today', name: 'Deleted' }] });
    setup(); await screen.findByRole('option', { name: 'Website' });
    for (const name of ['Foreign', 'Archived', 'Deleted']) expect(screen.queryByRole('option', { name })).not.toBeInTheDocument();
  });
  it('hides a private preview when the plugin is removed', async () => {
    const cache = new QueryClient();
    const view = (enabled) => <QueryClientProvider client={cache}><MemoryRouter><ClientAgentTaskAction clientId="client1" user={auth.user} enabled={enabled} /></MemoryRouter></QueryClientProvider>;
    const ui = render(view(true)); await preview(); ui.rerender(view(false));
    expect(screen.queryByRole('region', { name: 'Task preview' })).not.toBeInTheDocument();
    expect(api.confirmClientTaskAction).not.toHaveBeenCalled(); cache.clear();
  });
  it('does not show a mismatched client receipt or task link', async () => {
    api.prepareClientTaskAction.mockResolvedValue({ action: { ...doneAction, preview: { ...pendingAction.preview, destination: { ...pendingAction.preview.destination, clientId: 'other' } } } });
    setup(); await screen.findByRole('option', { name: 'Website' });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } }); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Website request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
    await waitFor(() => expect(api.prepareClientTaskAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: 'Task preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open created task' })).not.toBeInTheDocument();
  });
  it('ignores an old client response after switching clients', async () => {
    let resolve;
    api.prepareClientTaskAction.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const cache = new QueryClient();
    const element = (clientId) => <QueryClientProvider client={cache}><MemoryRouter><ClientAgentTaskAction clientId={clientId} user={auth.user} enabled /></MemoryRouter></QueryClientProvider>;
    const ui = render(element('client1')); await screen.findByRole('option', { name: 'Website' });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } }); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Website request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
    await waitFor(() => expect(api.prepareClientTaskAction).toHaveBeenCalledTimes(1));
    ui.rerender(element('client2')); await act(async () => resolve({ action: pendingAction }));
    expect(screen.queryByRole('region', { name: 'Task preview' })).not.toBeInTheDocument();
    expect(api.confirmClientTaskAction).not.toHaveBeenCalled(); cache.clear();
  });
  it('prevents double confirmation and checks uncertain outcomes before retry', async () => {
    let reject;
    api.confirmClientTaskAction.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    setup(); await preview();
    const button = screen.getByRole('button', { name: 'Confirm create task' });
    fireEvent.click(button); fireEvent.click(button); expect(api.confirmClientTaskAction).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('network')));
    expect(screen.getByRole('button', { name: 'Confirm create task' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start another task' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    await screen.findByRole('link', { name: 'Open created task' });
    expect(api.confirmClientTaskAction).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['EXECUTING', false, /outcome is not yet confirmed/],
    ['PENDING_CONFIRMATION', true, /preview has expired/],
  ])('does not confirm %s or expired previews', async (status, expired, text) => {
    api.prepareClientTaskAction.mockResolvedValue({ action: { ...pendingAction, status, expired } });
    setup(); await preview(); expect(screen.queryByRole('button', { name: 'Confirm create task' })).not.toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument(); expect(api.confirmClientTaskAction).not.toHaveBeenCalled();
  });

});
