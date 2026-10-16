import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Trash from '../pages/Trash';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { request: vi.fn() } }));
const row = (id, title, entity = 'TASK') => ({
  id, entity, recordId: `record-${id}`, organizationId: 'qa-org',
  data: entity === 'PROJECT' ? { name: title } : { title },
  deletedAt: '2026-10-01T12:00:00Z', expiresAt: '2026-10-31T12:00:00Z', restoredAt: null,
});
const retained = row('retained', 'Retained task');
const removable = row('removable', 'Old project', 'PROJECT');
beforeEach(() => vi.resetAllMocks());
async function openEmpty(items = [retained, removable]) {
  api.request.mockResolvedValueOnce({ items });
  render(<Trash />);
  await screen.findByRole('button', { name: `Restore ${items[0].entity === 'PROJECT' ? 'Project' : 'Task'}: ${items[0].data.title || items[0].data.name}` });
  fireEvent.click(screen.getByRole('button', { name: 'Empty Trash' }));
  return screen.getByRole('dialog');
}
function submit(dialog) { fireEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' })); }

it('keeps retained rows after HTTP 200 failure and restores the actual trash ledger id', async () => {
  const dialog = await openEmpty([retained]);
  api.request.mockResolvedValueOnce({ success: false, deleted: 0, failed: 1, failures: [{ id: retained.id, code: 'RESOURCE_LINK_RETENTION', error: 'private database detail' }] })
    .mockResolvedValueOnce({ items: [retained] });
  submit(dialog);
  await screen.findByText(/0 deleted; 1 could not be deleted/);
  expect(screen.queryByText('private database detail')).not.toBeInTheDocument();
  expect(screen.queryByText('Trash is empty')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore Task: Retained task' }));
  api.request.mockResolvedValueOnce({ success: true });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
  await screen.findByText('Trash is empty');
  expect(api.request).toHaveBeenLastCalledWith('/trash/retained/restore', { method: 'POST' });
});

it('reloads partial success, removes only proven deleted rows, and keeps a safe modal result', async () => {
  const dialog = await openEmpty();
  api.request.mockResolvedValueOnce({ success: false, deleted: 1, failed: 1, failures: [{ id: retained.id, code: 'RESOURCE_LINK_RETENTION', error: 'unsafe provider detail' }] })
    .mockResolvedValueOnce({ items: [retained] });
  submit(dialog);
  await screen.findByText(/1 deleted; 1 could not be deleted/);
  expect(screen.queryByText('Old project')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Task: Retained task' })).toBeInTheDocument();
  expect(screen.queryByText('unsafe provider detail')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('closes the modal only after a full success and authoritative empty reload', async () => {
  const dialog = await openEmpty();
  api.request.mockResolvedValueOnce({ success: true, deleted: 2, failed: 0, failures: [] })
    .mockResolvedValueOnce({ items: [] });
  submit(dialog);
  await screen.findByText('Trash is empty');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.request.mock.calls.map(([path]) => path)).toEqual(['/trash', '/trash/empty', '/trash']);
});

it('retains rows on HTTP failure and supports an explicit read-only refresh', async () => {
  const dialog = await openEmpty();
  api.request.mockRejectedValueOnce(new Error('raw SQL SECRET'));
  submit(dialog);
  await screen.findByText(/The deletion result could not be confirmed/);
  expect(screen.queryByText('raw SQL SECRET')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Project: Old project' })).toBeInTheDocument();
  api.request.mockResolvedValueOnce({ items: [retained] });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh Trash' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore Project: Old project' })).not.toBeInTheDocument());
  expect(api.request).toHaveBeenLastCalledWith('/trash');
});

it.each([null, { success: true, deleted: 2, failed: 0, failures: [] }])('does not claim empty if result or refresh is unknown (%j)', async result => {
  const dialog = await openEmpty();
  api.request.mockResolvedValueOnce(result);
  if (result) api.request.mockRejectedValueOnce(new Error('offline'));
  else api.request.mockResolvedValueOnce({ items: [retained] });
  submit(dialog);
  await screen.findByText(result ? /Trash could not be refreshed/ : /The deletion result could not be confirmed/);
  expect(screen.queryByText('Trash is empty')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('recovers from a failed post-delete reload without repeating the mutation', async () => {
  const dialog = await openEmpty();
  api.request.mockResolvedValueOnce({ success: false, deleted: 1, failed: 1, failures: [{ id: retained.id, code: 'RESOURCE_LINK_RETENTION' }] })
    .mockRejectedValueOnce(new Error('offline'));
  submit(dialog);
  await screen.findByText(/Trash could not be refreshed/);
  api.request.mockResolvedValueOnce({ items: [retained] });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh Trash' }));
  await screen.findByRole('button', { name: 'Restore Task: Retained task' });
  expect(screen.queryByRole('button', { name: 'Restore Project: Old project' })).not.toBeInTheDocument();
  expect(api.request.mock.calls.filter(([path]) => path === '/trash/empty')).toHaveLength(1);
});

it('keeps newly arrived rows visible even when the deletion response reports full success', async () => {
  const dialog = await openEmpty([retained]);
  api.request.mockResolvedValueOnce({ success: true, deleted: 1, failed: 0, failures: [] })
    .mockResolvedValueOnce({ items: [removable] });
  submit(dialog);
  await screen.findByText(/Trash has additional items/);
  expect(screen.getByRole('button', { name: 'Restore Project: Old project' })).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('uses the actual wire title/name and safely searches malformed display data', async () => {
  api.request.mockResolvedValue({ items: [retained, removable, row('malformed', { unsafe: true })] });
  render(<Trash />);
  await screen.findByRole('button', { name: 'Restore Project: Old project' });
  fireEvent.change(screen.getByPlaceholderText('Search trash...'), { target: { value: 'old project' } });
  expect(screen.getByRole('button', { name: 'Restore Project: Old project' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore Task: Retained task' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search trash...'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Restore Task: Task' })).toBeInTheDocument();
});

it('uses fixed retention guidance for permanent delete errors and leaves the row recoverable', async () => {
  api.request.mockResolvedValueOnce({ items: [retained] });
  render(<Trash />);
  fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete Task: Retained task' }));
  api.request.mockRejectedValueOnce(Object.assign(new Error('unsafe raw error'), { data: { code: 'RESOURCE_LINK_RETENTION' } }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete forever' }));
  await screen.findByText(/Items with resource links, including archived links, stay in Trash/);
  expect(screen.queryByText('unsafe raw error')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Task: Retained task' })).toBeInTheDocument();
});
