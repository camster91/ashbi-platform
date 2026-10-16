import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunicationTaskDialog from '../components/CommunicationTaskDialog';
import ClientCommunications from '../components/ClientCommunications';

const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['getProjects', 'prepareCommunicationTask', 'getCommunicationTaskByIntent', 'getCommunicationTaskAction', 'confirmCommunicationTask', 'listClientCommunications', 'getClientCommunication'].map((name) => [name, vi.fn()])), auth: { user: { id: 'staff', organizationId: 'org', role: 'TEAM' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const message = { id: 'email1', source: 'inbox', subject: 'Website request', threadId: 'thread1', sender: 'client@example.test' };
const project = { id: 'project1', clientId: 'client1', name: 'Website', status: 'ACTIVE' };
const pendingAction = { id: 'action1', status: 'PENDING_CONFIRMATION', expired: false, preview: { task: { title: 'Website request', description: '', priority: 'NORMAL', dueDate: null }, destination: { projectId: 'project1', projectName: 'Website', clientId: 'client1' }, source: { ...message, messageId: message.id, receivedAt: '2026-10-16T10:00:00Z' } } };
const doneAction = { ...pendingAction, status: 'EXECUTED', outcome: 'succeeded', result: { task: { id: 'task1', projectId: 'project1', sourceThreadId: 'thread1' } } };
const clients = [];
function setup({ list = false, user = auth.user, source = message } = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(cache);
  const element = () => <QueryClientProvider client={cache}><MemoryRouter>{list ? <ClientCommunications clientId="client1" /> : <CommunicationTaskDialog clientId="client1" message={source} user={user} onClose={vi.fn()} />}</MemoryRouter></QueryClientProvider>;
  const view = render(element());
  return { ...view, refresh: () => view.rerender(element()) };
}
async function preview() {
  await screen.findByRole('option', { name: 'Website' });
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
  await screen.findByRole('region', { name: 'Task preview' });
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto);
  auth.user = { id: 'staff', organizationId: 'org', role: 'TEAM' };
  api.getProjects.mockResolvedValue({ projects: [project], total: 1 });
  api.prepareCommunicationTask.mockResolvedValue({ action: pendingAction });
  api.confirmCommunicationTask.mockResolvedValue({ action: doneAction });
  api.getCommunicationTaskByIntent.mockResolvedValue({ action: pendingAction });
  api.getCommunicationTaskAction.mockResolvedValue({ action: doneAction });
  api.listClientCommunications.mockResolvedValue({ items: [message], nextCursor: null });
  api.getClientCommunication.mockResolvedValue({ ...message, bodyText: 'Please update our website' });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });

describe('email to task confirmation', () => {
  it('keeps the preview available after cancelling reauthentication without claiming access was revoked', async () => {
    api.confirmCommunicationTask.mockRejectedValueOnce({ status: 403, data: { code: 'REAUTH_REQUIRED' } });
    setup(); await preview();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    await screen.findByText('Confirm your identity to create this task. No task was created.');
    expect(screen.getByRole('region', { name: 'Task preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm create task' })).toBeEnabled();
    expect(screen.queryByText(/no longer have access/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    await screen.findByRole('link', { name: 'Open created task' });
    expect(api.confirmCommunicationTask).toHaveBeenCalledTimes(2);
    expect(api.prepareCommunicationTask).toHaveBeenCalledTimes(1);
  });
  it('shows Create task only after an inbox message is expanded, and prepares without creating', async () => {
    setup({ list: true });
    fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText(message.subject);
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
    expect(api.prepareCommunicationTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Read stored message'));
    fireEvent.click(await screen.findByRole('button', { name: 'Create task' }));
    await preview();
    expect(api.confirmCommunicationTask).not.toHaveBeenCalled();
    expect(api.prepareCommunicationTask).toHaveBeenCalledExactlyOnceWith('client1', 'email1', { input: { projectId: 'project1', title: message.subject, description: '', priority: 'NORMAL' }, idempotencyKey: expect.any(String) });
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    expect(await screen.findByRole('link', { name: 'Open created task' })).toHaveAttribute('href', '/task/task1');
    expect(screen.getAllByRole('link', { name: 'Open source thread' }).some((link) => link.getAttribute('href') === '/thread/thread1')).toBe(true);
    expect(api.confirmCommunicationTask).toHaveBeenCalledExactlyOnceWith('client1', 'email1', 'action1');
  });
  it.each(['CLIENT', 'BOT'])('does not offer task creation to %s', async (role) => {
    auth.user.role = role; setup({ list: true }); fireEvent.click(screen.getByText('Stored email history'));
    fireEvent.click(await screen.findByText('Read stored message')); await screen.findByText('Please update our website');
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
    expect(api.getProjects).not.toHaveBeenCalled();
  });
  it('keeps project email read-only', async () => {
    api.listClientCommunications.mockResolvedValue({ items: [{ ...message, source: 'project' }] });
    setup({ list: true }); fireEvent.click(screen.getByText('Stored email history'));
    fireEvent.click(await screen.findByText('Read stored message')); await screen.findByText('Please update our website');
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
  });
  it('filters foreign/inactive projects and respects the source project', async () => {
    api.getProjects.mockResolvedValue({ total: 3, projects: [project, { ...project, id: 'foreign', clientId: 'other', name: 'Foreign' }, { ...project, id: 'inactive', status: 'COMPLETED', name: 'Old' }] });
    setup({ source: { ...message, projectId: 'project1' } });
    await screen.findByRole('option', { name: 'Website' });
    expect(api.getProjects).toHaveBeenCalledExactlyOnceWith({ clientId: 'client1', limit: 200, offset: 0 });
    expect(screen.queryByRole('option', { name: 'Foreign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Old' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toBeDisabled();
    expect(screen.getByLabelText('Project')).toHaveValue('project1');
  });
  it('blocks creation without active projects', async () => {
    api.getProjects.mockResolvedValue({ projects: [], total: 0 }); setup();
    await screen.findByText(/no active projects/);
    expect(screen.getByRole('button', { name: 'Preview task' })).toBeDisabled();
  });
  it('retains an uncertain prepare across reload and a 404 lookup without generating another key', async () => {
    api.prepareCommunicationTask.mockRejectedValue(new Error('network details'));
    api.getCommunicationTaskByIntent.mockRejectedValue({ status: 404 });
    const first = setup();
    await screen.findByRole('option', { name: 'Website' }); fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
    await screen.findByText(/preview could not be confirmed/);
    const saved = sessionStorage.getItem(sessionStorage.key(0));
    expect(saved).not.toContain('Website'); expect(saved).not.toContain('client@example');
    const key = api.prepareCommunicationTask.mock.calls[0][2].idempotencyKey;
    first.unmount(); setup();
    await screen.findByText(/saved request could not be checked/);
    expect(api.getCommunicationTaskByIntent).toHaveBeenCalledExactlyOnceWith('client1', 'email1', key);
    expect(api.prepareCommunicationTask).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed input' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same preview' }));
    await screen.findByText(/Restore the same task details/);
    expect(api.prepareCommunicationTask).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(sessionStorage.key(0))).toBe(saved);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: message.subject } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same preview' }));
    await waitFor(() => expect(api.prepareCommunicationTask).toHaveBeenCalledTimes(2));
    expect(api.prepareCommunicationTask.mock.calls[1][2].idempotencyKey).toBe(key);
  });
  it('reads a recovered preview without automatically confirming', async () => {
    const first = setup(); await preview(); first.unmount(); setup();
    await screen.findByRole('region', { name: 'Task preview' });
    expect(api.prepareCommunicationTask).toHaveBeenCalledTimes(1);
    expect(api.getCommunicationTaskByIntent).toHaveBeenCalledTimes(1);
    expect(api.confirmCommunicationTask).not.toHaveBeenCalled();
  });
  it('requires receipt readback after a lost confirmation, prevents double clicks and recovers the task', async () => {
    let reject;
    api.confirmCommunicationTask.mockImplementation(() => new Promise((resolve, fail) => { reject = fail; }));
    setup(); await preview();
    const button = screen.getByRole('button', { name: 'Confirm create task' });
    fireEvent.click(button); fireEvent.click(button);
    expect(api.confirmCommunicationTask).toHaveBeenCalledTimes(1);
    reject(new Error('network'));
    await screen.findByText(/Task creation could not be confirmed/);
    expect(screen.getByRole('button', { name: 'Confirm create task' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByRole('link', { name: 'Open created task' })).toHaveAttribute('href', '/task/task1');
    expect(api.getCommunicationTaskAction).toHaveBeenCalledExactlyOnceWith('client1', 'email1', 'action1');
    expect(api.confirmCommunicationTask).toHaveBeenCalledTimes(1);
  });
  it('hides preview after access is denied', async () => {
    api.confirmCommunicationTask.mockRejectedValue({ status: 403 }); setup(); await preview();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    await screen.findByText(/no longer have access/);
    expect(screen.queryByRole('region', { name: 'Task preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start another task' })).not.toBeInTheDocument();
  });
  it('does not release an unknown failed receipt but allows a deliberate new task after success', async () => {
    api.confirmCommunicationTask.mockResolvedValue({ action: { ...pendingAction, status: 'FAILED', outcome: 'unknown' } });
    setup(); await preview(); fireEvent.click(screen.getByRole('button', { name: 'Confirm create task' }));
    await screen.findByText(/outcome is not yet confirmed/);
    expect(screen.queryByRole('button', { name: 'Start another task' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start another task' }));
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });
  it('paginates only this client and includes canonical active delivery phases', async () => {
    api.getProjects.mockResolvedValueOnce({ total: 201, projects: Array.from({ length: 200 }, (_, index) => ({ ...project, id: `p${index}`, status: 'ON_HOLD' })) }).mockResolvedValueOnce({ total: 201, projects: [{ ...project, status: 'DESIGN_DEV' }] });
    setup(); await screen.findByRole('option', { name: 'Website' });
    expect(api.getProjects.mock.calls).toEqual([[{ clientId: 'client1', limit: 200, offset: 0 }], [{ clientId: 'client1', limit: 200, offset: 200 }]]);
    expect(screen.getByLabelText('Project').options).toHaveLength(2);
  });
  it('does not write if recoverable browser storage is unavailable', async () => {
    setup(); await screen.findByRole('option', { name: 'Website' });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'project1' } });
    const store = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Unavailable'); });
    fireEvent.click(screen.getByRole('button', { name: 'Preview task' }));
    await screen.findByText(/cannot safely recover/);
    expect(api.prepareCommunicationTask).not.toHaveBeenCalled(); store.mockRestore();
  });
  it('does not recover an attempt from a different staff session', async () => {
    const first = setup(); await preview(); first.unmount();
    setup({ user: { id: 'other-staff', organizationId: 'org', role: 'TEAM' } });
    await screen.findByRole('option', { name: 'Website' });
    expect(api.getCommunicationTaskByIntent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Preview task' })).toBeInTheDocument();
  });
  it('allows a deliberate new preview after server-confirmed expiry without executing the old request', async () => {
    api.prepareCommunicationTask.mockResolvedValue({ action: { ...pendingAction, expired: true } });
    setup(); await preview();
    expect(screen.queryByRole('button', { name: 'Confirm create task' })).not.toBeInTheDocument();
    expect(api.confirmCommunicationTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start another task' }));
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByRole('button', { name: 'Preview task' })).toBeInTheDocument();
  });

  it('closes task controls when the current session loses its staff role', async () => {
    const view = setup({ list: true });
    fireEvent.click(screen.getByText('Stored email history'));
    fireEvent.click(await screen.findByText('Read stored message'));
    fireEvent.click(await screen.findByRole('button', { name: 'Create task' }));
    await screen.findByRole('dialog', { name: 'Create task from email' });
    auth.user.role = 'CLIENT'; view.refresh();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.prepareCommunicationTask).not.toHaveBeenCalled();
    expect(api.confirmCommunicationTask).not.toHaveBeenCalled();
  });

});
