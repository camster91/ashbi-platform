import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PortalAssistant from '../components/PortalAssistant';
const { assistant } = vi.hoisted(() => ({ assistant: Object.fromEntries(['list', 'create', 'byIntent', 'get', 'dispatch', 'cancel', 'recover'].map(key => [key, vi.fn()])) }));
vi.mock('../lib/portal-assistant', () => ({ portalAssistant: assistant }));
const identity = { organizationId: 'org1', userId: 'portal1', contactId: 'contact1' };
const storage = 'portal-assistant:org1:portal1:contact1:p1';
const key = '11111111-1111-4111-8111-111111111111';
const run = (extra = {}) => ({ id: 'run1', message: 'My project question', status: 'QUEUED', response: null, createdAt: '2026-10-16T10:00:00Z', startedAt: null, finishedAt: null, deadlineAt: '2026-10-16T10:01:00Z', errorCode: null, ...extra });
const listing = (items = [], extra = {}) => ({ enabled: true, name: 'Project guide', revision: 0, mode: 'PORTAL_ASSISTANT', conversation: null, items, nextCursor: null, ...extra });
const ui = props => <PortalAssistant projectId="p1" identity={identity} {...props} />;
async function open() { fireEvent.click(screen.getByText('Project AI assistant')); await screen.findByLabelText('Message to the AI assistant'); }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); assistant.list.mockResolvedValue(listing()); });

it('loads only when opened; GET/load never create or dispatch', async () => {
  render(ui()); expect(assistant.list).not.toHaveBeenCalled(); await open();
  expect(assistant.create).not.toHaveBeenCalled(); expect(assistant.dispatch).not.toHaveBeenCalled();
  expect(screen.getByText(/does not create a task or request human follow-up/)).toBeInTheDocument();
});
it('persists only an opaque scoped intent before creation and dispatches only after explicit Send', async () => {
  assistant.create.mockImplementation(async (_id, _token, body) => {
    expect(JSON.parse(localStorage.getItem(storage))).toEqual({ key: body.idempotencyKey, dispatched: false });
    expect(localStorage.getItem(storage)).not.toContain(body.message); return { run: run({ message: body.message }) };
  });
  assistant.dispatch.mockImplementation(async () => {
    expect(JSON.parse(localStorage.getItem(storage))).toMatchObject({ dispatched: true, runId: 'run1' });
    return { run: run({ status: 'SUCCEEDED', response: '<img src=x> Plain reply', finishedAt: '2026-10-16T10:00:20Z' }) };
  });
  const { container } = render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'What is next?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to AI assistant' }));
  await screen.findByText('<img src=x> Plain reply'); expect(container.querySelector('img')).toBeNull(); expect(assistant.dispatch).toHaveBeenCalledTimes(1); expect(localStorage.getItem(storage)).toBeNull();
});
it('uncertain create persists through remount and 404 recovery never resends', async () => {
  assistant.create.mockRejectedValue(Error('private provider credential')); assistant.byIntent.mockRejectedValue({ status: 404 });
  const first = render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'Private body' } }); fireEvent.click(screen.getByText('Send to AI assistant'));
  await screen.findByText(/outcome could not be confirmed/); expect(localStorage.getItem(storage)).not.toContain('Private'); first.unmount(); render(ui());
  await screen.findByRole('button', { name: 'Check saved request status' }); await screen.findByLabelText('Message to the AI assistant');
  expect(screen.getByLabelText('Message to the AI assistant')).toBeDisabled(); expect(assistant.byIntent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Check saved request status')); await waitFor(() => expect(assistant.byIntent).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(storage)).not.toBeNull(); expect(assistant.create).toHaveBeenCalledTimes(1); expect(assistant.dispatch).not.toHaveBeenCalled(); expect(screen.queryByText('private provider credential')).toBeNull();
});
it('recovered queued request needs an explicit start and cannot redispatch after uncertainty', async () => {
  localStorage.setItem(storage, JSON.stringify({ key, dispatched: false })); assistant.byIntent.mockResolvedValue({ run: run() }); assistant.dispatch.mockRejectedValue(Error('timeout'));
  render(ui()); await screen.findByText('Check saved request status'); await screen.findByLabelText('Message to the AI assistant');
  fireEvent.click(screen.getByText('Check saved request status')); await screen.findByText('Start saved request'); expect(assistant.dispatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Start saved request')); await screen.findByText(/outcome could not be confirmed/);
  expect(JSON.parse(localStorage.getItem(storage)).dispatched).toBe(true);
  fireEvent.click(screen.getByText('Reload assistant history')); await screen.findByLabelText('Message to the AI assistant');
  fireEvent.click(screen.getByText('Check saved request status')); await screen.findByText('Ready to start'); expect(screen.queryByText('Start saved request')).toBeNull(); expect(assistant.dispatch).toHaveBeenCalledTimes(1);
});
it('dispatch response missing required fields is uncertain, hides private history and retains intent', async () => {
  assistant.create.mockResolvedValue({ run: run({ message: 'Status?' }) }); assistant.dispatch.mockResolvedValue({ run: { status: 'SUCCEEDED', response: 'unverified' } });
  render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'Status?' } }); fireEvent.click(screen.getByText('Send to AI assistant'));
  await screen.findByText(/outcome could not be confirmed/); expect(assistant.dispatch).toHaveBeenCalledTimes(1); expect(localStorage.getItem(storage)).not.toBeNull(); expect(screen.queryByText('unverified')).toBeNull();
});
it('a mismatched valid creation receipt never dispatches someone else’s question', async () => {
  assistant.create.mockResolvedValue({ run: run() }); render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'My different question' } }); fireEvent.click(screen.getByText('Send to AI assistant'));
  await screen.findByText(/outcome could not be confirmed/); expect(assistant.dispatch).not.toHaveBeenCalled(); expect(localStorage.getItem(storage)).not.toBeNull();
});
it('known-run status receipt with a different id cannot clear the unresolved intent', async () => {
  localStorage.setItem(storage, JSON.stringify({ key, runId: 'run1', dispatched: true })); assistant.list.mockResolvedValue(listing([run({ status: 'RUNNING' })])); assistant.get.mockResolvedValue({ run: run({ id: 'other', status: 'CANCELLED' }) }); render(ui()); await screen.findByText('Check reply status'); fireEvent.click(screen.getByText('Check reply status'));
  await screen.findByText(/outcome could not be confirmed/); expect(localStorage.getItem(storage)).not.toBeNull(); expect(screen.queryByText('Cancelled')).toBeNull();
});
it('unavailable browser storage blocks creation before any POST', async () => {
  const store = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
  try {
    render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'Status?' } }); fireEvent.click(screen.getByText('Send to AI assistant'));
    await screen.findByText(/Browser storage could not safely track/); expect(assistant.create).not.toHaveBeenCalled(); expect(assistant.dispatch).not.toHaveBeenCalled();
  } finally { store.mockRestore(); }
});
it('other-tab new intent is not cleared by an old terminal response even while this mount remains active', async () => {
  let resolve; assistant.create.mockImplementationOnce(() => new Promise(done => { resolve = done; })); render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'Status?' } }); fireEvent.click(screen.getByText('Send to AI assistant')); await waitFor(() => expect(assistant.create).toHaveBeenCalledTimes(1));
  const newer = { key: '22222222-2222-4222-8222-222222222222', dispatched: false }; localStorage.setItem(storage, JSON.stringify(newer)); await act(async () => resolve({ run: run({ status: 'CANCELLED', message: 'Status?' }) }));
  expect(JSON.parse(localStorage.getItem(storage))).toEqual(newer); expect(assistant.dispatch).not.toHaveBeenCalled(); expect(screen.getByLabelText('Message to the AI assistant')).toBeDisabled();
});
it('failed fresh read hides previously displayed replies and blocks Send', async () => {
  assistant.list.mockResolvedValueOnce(listing([run({ status: 'SUCCEEDED', response: 'Private answer' })])).mockRejectedValueOnce({ status: 403 });
  render(ui()); await open(); await screen.findByText('Private answer'); fireEvent.click(screen.getByText('Reload assistant history'));
  await screen.findByText(/Previous replies are hidden/); expect(screen.queryByText('Private answer')).toBeNull(); expect(screen.queryByText('Send to AI assistant')).toBeNull();
});
it('disabled response renders no private history or message composer', async () => {
  assistant.list.mockResolvedValue(listing([run({ status: 'SUCCEEDED', response: 'Hidden' })], { enabled: false })); render(ui()); fireEvent.click(screen.getByText('Project AI assistant'));
  await screen.findByText(/disabled or not configured/); expect(screen.queryByText('Hidden')).toBeNull(); expect(screen.queryByLabelText('Message to the AI assistant')).toBeNull(); expect(assistant.dispatch).not.toHaveBeenCalled();
});
it.each([{ projectId: 'p2' }, { identity: { ...identity, contactId: 'contact2' } }, { token: 'new-token' }])('authority switch clears private state and ignores late old responses %j', async (props) => {
  let resolve; assistant.list.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(listing());
  const view = render(ui()); fireEvent.click(screen.getByText('Project AI assistant')); await waitFor(() => expect(assistant.list).toHaveBeenCalledTimes(1)); view.rerender(ui(props));
  await act(async () => resolve(listing([run({ status: 'SUCCEEDED', response: 'Old private answer' })])));
  expect(screen.queryByText('Old private answer')).toBeNull(); expect(screen.queryByLabelText('Message to the AI assistant')).toBeNull();
});
it('late old POST cannot clear a new mount intent for the same principal', async () => {
  let resolve; assistant.create.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'Status?' } }); fireEvent.click(screen.getByText('Send to AI assistant')); await waitFor(() => expect(assistant.create).toHaveBeenCalledTimes(1)); first.unmount();
  const newer = { key: '22222222-2222-4222-8222-222222222222', dispatched: false }; localStorage.setItem(storage, JSON.stringify(newer)); render(ui());
  await act(async () => resolve({ run: run({ status: 'CANCELLED', message: 'Status?' }) })); expect(JSON.parse(localStorage.getItem(storage))).toEqual(newer); expect(assistant.dispatch).not.toHaveBeenCalled();
});
it('only explicit cancellation mutates pending run and a confirmed terminal receipt clears its intent', async () => {
  localStorage.setItem(storage, JSON.stringify({ key, dispatched: true, runId: 'run1' })); assistant.list.mockResolvedValue(listing([run({ status: 'RUNNING' })])); assistant.cancel.mockResolvedValue({ run: run({ status: 'CANCELLED' }) });
  render(ui()); await screen.findByText('Cancel reply'); expect(assistant.cancel).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Cancel reply')); await screen.findByText('Cancelled'); expect(localStorage.getItem(storage)).toBeNull();
});
it('expired reconciliation is explicit and UNKNOWN remains frozen without another provider dispatch', async () => {
  localStorage.setItem(storage, JSON.stringify({ key, dispatched: true, runId: 'run1' })); assistant.list.mockResolvedValue(listing([run({ status: 'RUNNING', deadlineAt: '2020-01-01T00:00:00Z' })])); assistant.recover.mockResolvedValue({ run: run({ status: 'UNKNOWN' }) });
  render(ui()); await screen.findByText('Reconcile expired request'); expect(assistant.recover).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Reconcile expired request')); await screen.findByText('Outcome unknown'); expect(localStorage.getItem(storage)).not.toBeNull(); expect(screen.getByText('Send to AI assistant')).toBeDisabled(); expect(assistant.dispatch).not.toHaveBeenCalled();
});
it('fresh same-ID UNKNOWN read allows explicit new empty question without retrying old run or deleting its history', async () => {
  assistant.create.mockResolvedValue({ run: run({ message: 'Old draft' }) }); assistant.dispatch.mockResolvedValue({ run: run({ message: 'Old draft', status: 'UNKNOWN' }) }); assistant.get.mockResolvedValue({ run: run({ message: 'Old draft', status: 'UNKNOWN' }) });
  render(ui()); await open(); fireEvent.change(screen.getByLabelText('Message to the AI assistant'), { target: { value: 'Old draft' } }); fireEvent.click(screen.getByText('Send to AI assistant'));
  await screen.findByText('Outcome unknown'); expect(screen.queryByText('Continue with a new question')).toBeNull(); expect(localStorage.getItem(storage)).not.toBeNull(); expect(screen.getByLabelText('Message to the AI assistant')).toHaveValue('Old draft');
  fireEvent.click(screen.getByText('Check reply status')); await screen.findByText('Continue with a new question'); expect(localStorage.getItem(storage)).not.toBeNull();
  fireEvent.click(screen.getByText('Continue with a new question')); expect(localStorage.getItem(storage)).toBeNull(); expect(screen.getByLabelText('Message to the AI assistant')).toHaveValue(''); expect(screen.getByLabelText('Message to the AI assistant')).not.toBeDisabled(); expect(screen.getByText('Outcome unknown')).toBeInTheDocument(); expect(assistant.create).toHaveBeenCalledTimes(1); expect(assistant.dispatch).toHaveBeenCalledTimes(1);
});
it.each([404, 403, 503])('failed fresh UNKNOWN read (%s) never permits resetting the held intent', async status => {
  localStorage.setItem(storage, JSON.stringify({ key, runId: 'run1', dispatched: true })); assistant.list.mockResolvedValue(listing([run({ status: 'UNKNOWN' })])); assistant.get.mockRejectedValue({ status }); render(ui()); await screen.findByText('Outcome unknown'); fireEvent.click(screen.getByText('Check reply status'));
  await screen.findByText(/outcome could not be confirmed/); expect(localStorage.getItem(storage)).not.toBeNull(); expect(screen.queryByText('Continue with a new question')).toBeNull(); expect(assistant.dispatch).not.toHaveBeenCalled();
});
it('explicit continuation cannot clear another tab’s newer intent after terminal confirmation', async () => {
  localStorage.setItem(storage, JSON.stringify({ key, runId: 'run1', dispatched: true })); assistant.list.mockResolvedValue(listing([run({ status: 'UNKNOWN' })])); assistant.get.mockResolvedValue({ run: run({ status: 'UNKNOWN' }) }); render(ui()); await screen.findByText('Outcome unknown'); fireEvent.click(screen.getByText('Check reply status')); await screen.findByText('Continue with a new question');
  const newer = { key: '22222222-2222-4222-8222-222222222222', dispatched: false }; localStorage.setItem(storage, JSON.stringify(newer)); fireEvent.click(screen.getByText('Continue with a new question'));
  expect(JSON.parse(localStorage.getItem(storage))).toEqual(newer); expect(screen.getByLabelText('Message to the AI assistant')).toBeDisabled(); expect(assistant.dispatch).not.toHaveBeenCalled(); expect(assistant.create).not.toHaveBeenCalled();
});
it('a late fresh terminal read after principal switch cannot authorize continuation or clear old intent', async () => {
  localStorage.setItem(storage, JSON.stringify({ key, runId: 'run1', dispatched: true })); assistant.list.mockResolvedValue(listing([run({ status: 'UNKNOWN' })])); let resolve; assistant.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(ui()); await screen.findByText('Outcome unknown'); fireEvent.click(screen.getByText('Check reply status')); await waitFor(() => expect(assistant.get).toHaveBeenCalledTimes(1)); view.rerender(ui({ identity: { ...identity, contactId: 'new-contact' } }));
  await act(async () => resolve({ run: run({ status: 'UNKNOWN' }) })); expect(localStorage.getItem(storage)).not.toBeNull(); expect(screen.queryByText('Continue with a new question')).toBeNull(); expect(screen.queryByText('Outcome unknown')).toBeNull();
});
