import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import WorkQueue from '../pages/WorkQueue';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getWorkQueue: vi.fn(),
    getClients: vi.fn(),
  },
}));

const authState = { user: { id: 'u1', name: 'Ada Admin', role: 'ADMIN' } };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }));

const row = (overrides) => ({
  type: 'task',
  id: 't1',
  title: 'Write homepage copy',
  sourceUrl: '/task/t1',
  client: { id: 'c1', name: 'Acme' },
  project: { id: 'p1', name: 'Acme site' },
  owner: { id: 'u2', name: 'Tom Team', role: null },
  state: 'PENDING',
  nextAction: 'Start the task',
  dueAt: null,
  ageDays: 2,
  view: 'needs_action',
  ...overrides,
});

const QUEUE = {
  view: null,
  rows: [
    row(),
    row({ type: 'invoice', id: 'i1', title: 'Invoice INV-7', sourceUrl: '/invoices/i1', state: 'OVERDUE', nextAction: 'Payment overdue: send a reminder or call the client', view: 'at_risk' }),
    row({ type: 'approval', id: 'a1', title: 'Send launch email', sourceUrl: '/approvals', owner: { id: null, name: 'Admins', role: 'ADMIN' }, state: 'PENDING', nextAction: 'Approve or reject this email', view: 'awaiting_approval' }),
  ],
  counts: { needs_action: 1, awaiting_approval: 1, waiting_on_client: 0, at_risk: 1 },
  total: 3,
  sources: ['tasks', 'approvals', 'reviews', 'proposals', 'contracts', 'invoices'],
  partial: false,
  failedSources: [],
  truncatedSources: [],
  generatedAt: '2026-09-30T12:00:00.000Z',
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderQueue(path = '/queue') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/queue" element={<><WorkQueue /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 'u1', name: 'Ada Admin', role: 'ADMIN' };
});

describe('WorkQueue page', () => {
  it('shows four named tabs with counts, and rows that link to their source records', async () => {
    const user = userEvent.setup();
    api.getWorkQueue.mockResolvedValue(QUEUE);
    api.getClients.mockResolvedValue({ clients: [{ id: 'c1', name: 'Acme' }] });
    renderQueue();

    const tablist = screen.getByRole('tablist', { name: 'Queue views' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent.replace(/\d+$/, ''))).toEqual(['Needs action', 'Awaiting approval', 'Waiting on client', 'At risk']);
    await waitFor(() => expect(within(tabs[0]).getByText('1')).toBeInTheDocument());
    expect(within(tabs[2]).getByText('0')).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0].id);

    // Admins default to everyone's queue.
    expect(api.getWorkQueue).toHaveBeenCalledWith({ owner: 'everyone', clientId: undefined });

    const link = screen.getByRole('link', { name: /Task: Write homepage copy/ });
    expect(link).toHaveAttribute('href', '/task/t1');
    expect(screen.queryByText('Invoice INV-7')).not.toBeInTheDocument();

    await user.click(tabs[3]);
    expect(await screen.findByRole('link', { name: /Invoice: Invoice INV-7/ })).toHaveAttribute('href', '/invoices/i1');
    expect(screen.getByTestId('location')).toHaveTextContent('/queue?view=at_risk');

    await user.click(screen.getByRole('link', { name: /Invoice: Invoice INV-7/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/invoices/i1');
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    const user = userEvent.setup();
    api.getWorkQueue.mockResolvedValue(QUEUE);
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue();

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Awaiting approval/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Awaiting approval/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /At risk/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Needs action/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /At risk/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Needs action/ })).toHaveFocus();
  });

  it('lets admins filter by owner and client through named controls', async () => {
    const user = userEvent.setup();
    api.getWorkQueue.mockResolvedValue(QUEUE);
    api.getClients.mockResolvedValue({ clients: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Globex' }] });
    renderQueue();

    // Client options are read under their own key, past the route's default page of 50.
    expect(api.getClients).toHaveBeenCalledWith({ limit: 200 });

    const ownerSelect = screen.getByLabelText('Owner');
    expect(ownerSelect).toHaveValue('everyone');
    await user.selectOptions(ownerSelect, 'me');
    await waitFor(() => expect(api.getWorkQueue).toHaveBeenCalledWith({ owner: 'me', clientId: undefined }));
    expect(screen.getByTestId('location')).toHaveTextContent('owner=me');

    const clientSelect = screen.getByLabelText('Client');
    await screen.findByRole('option', { name: 'Globex' });
    await user.selectOptions(clientSelect, 'c2');
    await waitFor(() => expect(api.getWorkQueue).toHaveBeenCalledWith({ owner: 'me', clientId: 'c2' }));
    expect(screen.getByTestId('location')).toHaveTextContent('clientId=c2');
  });

  it('hides the Owner filter from non-admins, whose tasks are always their own', async () => {
    authState.user = { id: 'u2', name: 'Tom Team', role: 'TEAM' };
    api.getWorkQueue.mockResolvedValue(QUEUE);
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue('/queue?owner=me');

    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument();
    expect(screen.getByTestId('queue-scope-note')).toHaveTextContent('tasks assigned to you');
    await waitFor(() => expect(api.getWorkQueue).toHaveBeenCalledWith({ owner: 'everyone', clientId: undefined }));
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
  });

  it('keeps a deep-linked client selected when it is not among the loaded options', async () => {
    api.getWorkQueue.mockResolvedValue(QUEUE);
    api.getClients.mockResolvedValue({ clients: [{ id: 'c1', name: 'Acme' }] });
    renderQueue('/queue?clientId=c999');

    await screen.findByRole('option', { name: 'Acme' });
    const clientSelect = screen.getByLabelText('Client');
    expect(clientSelect).toHaveValue('c999');
    expect(screen.getByRole('option', { name: 'Selected client' })).toBeInTheDocument();
    expect(api.getWorkQueue).toHaveBeenCalledWith({ owner: 'everyone', clientId: 'c999' });
  });

  it('shows calendar due dates without a time and expiry moments with one', async () => {
    const user = userEvent.setup();
    api.getWorkQueue.mockResolvedValue({
      ...QUEUE,
      rows: [
        row({ id: 't9', dueAt: '2026-10-05T00:00:00.000Z', dueKind: 'date' }),
        row({ type: 'approval', id: 'a9', title: 'Expiring approval', sourceUrl: '/approvals', view: 'awaiting_approval', dueAt: '2026-10-05T12:00:00.000Z', dueKind: 'timestamp' }),
      ],
    });
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue();

    const taskLink = await screen.findByRole('link', { name: /Task: Write homepage copy/ });
    expect(taskLink).toHaveTextContent('Due Oct 5, 2026');
    expect(taskLink.textContent).not.toMatch(/Due Oct 5, 2026,/);
    await user.click(screen.getByRole('tab', { name: /Awaiting approval/ }));
    const approvalLink = await screen.findByRole('link', { name: /Approval: Expiring approval/ });
    expect(approvalLink.textContent).toMatch(/Due Oct 5, 2026, \d{1,2}:\d{2}/);
  });

  it('shows an empty state for a view with no rows', async () => {
    api.getWorkQueue.mockResolvedValue(QUEUE);
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue('/queue?view=waiting_on_client');
    expect(await screen.findByText('Waiting on client: all clear')).toBeInTheDocument();
    expect(screen.getByText('Nothing is waiting on a client.')).toBeInTheDocument();
  });

  it('labels a partial queue, keeps loaded rows, and retries the read', async () => {
    const user = userEvent.setup();
    api.getWorkQueue
      .mockResolvedValueOnce({ ...QUEUE, partial: true, failedSources: ['invoices'] })
      .mockResolvedValueOnce(QUEUE);
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue();

    expect(await screen.findByText('Some queue sources did not load: Invoices')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Write homepage copy/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry Invoices' }));
    await waitFor(() => expect(screen.queryByText('Some queue sources did not load: Invoices')).not.toBeInTheDocument());
    expect(api.getWorkQueue).toHaveBeenCalledTimes(2);
  });

  it('shows the error state with a retry when the queue cannot load', async () => {
    api.getWorkQueue.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue();
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows a named loading state first', () => {
    api.getWorkQueue.mockReturnValue(new Promise(() => {}));
    api.getClients.mockResolvedValue({ clients: [] });
    renderQueue();
    expect(screen.getByRole('status', { name: 'Loading queue…' })).toBeInTheDocument();
  });
});

describe('WorkQueue navigation', () => {
  it('is routed at /queue and linked next to Dashboard in the shell', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
    expect(app).toContain('path="/queue"');
    expect(layout).toMatch(/name: 'Dashboard', href: '\/dashboard'[^\n]*\n\s*\{ name: 'Daily Queue', href: '\/queue'/);
    expect(layout).toContain("{ label: 'Daily Queue', icon: ListTodo, href: '/queue' }");
  });
});
