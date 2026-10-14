import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientAccountManager from '../components/ClientAccountManager';

const { getWorkQueue, previewClientAssistant } = vi.hoisted(() => ({ getWorkQueue: vi.fn(), previewClientAssistant: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { getWorkQueue, previewClientAssistant } }));

const queue = (overrides = {}) => ({
  generatedAt: '2026-10-14T14:00:00.000Z',
  counts: { needs_action: 2, awaiting_approval: 1, waiting_on_client: 0, at_risk: 1 },
  partial: false, failedSources: [], truncatedSources: [],
  rows: [{ id: 'task-a', type: 'task', title: 'Review designs', owner: { name: 'Bianca' }, state: 'REVIEW', nextAction: 'Review the draft', sourceUrl: '/task/task-a' }],
  ...overrides,
});

function renderManager(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return render(<ClientAccountManager clientId="client-a" clientName="Acme" role="ADMIN" {...props} />, { wrapper });
}

async function openManager() {
  fireEvent.click(screen.getByText('Account manager'));
  await waitFor(() => expect(getWorkQueue).toHaveBeenCalled());
}

beforeEach(() => { vi.resetAllMocks(); getWorkQueue.mockResolvedValue(queue()); });

describe('client account manager', () => {
  it.each([['ADMIN', 'everyone'], ['TEAM', 'me']])('loads lazily with client and %s owner scope, without generating AI', async (role, owner) => {
    renderManager({ role });
    expect(getWorkQueue).not.toHaveBeenCalled();
    await openManager();
    await screen.findByRole('link', { name: 'Review designs' });
    expect(getWorkQueue).toHaveBeenCalledExactlyOnceWith({ clientId: 'client-a', owner });
    expect(previewClientAssistant).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open client work queue' })).toHaveAttribute('href', '/queue?clientId=client-a');
    expect(screen.getByText('Owner: Bianca · State: REVIEW')).toBeInTheDocument();
    expect(screen.getByText('Review the draft')).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-14T14:00:00.000Z');
    expect(screen.getByText('Needs action').nextElementSibling).toHaveTextContent('2');
  });

  it('warns about incomplete and truncated sources even when no records were returned', async () => {
    getWorkQueue.mockResolvedValue(queue({ rows: [], partial: true, failedSources: ['invoices'], truncatedSources: ['tasks'] }));
    renderManager();
    await openManager();
    expect(await screen.findByText(/Could not load: invoices/)).toBeInTheDocument();
    expect(screen.getByText(/Source limits were reached for tasks/)).toBeInTheDocument();
    expect(screen.getByText(/Additional work may be missing/)).toBeInTheDocument();
    expect(screen.queryByText(/all clear/i)).not.toBeInTheDocument();
  });

  it('shows a safe failure and retries only on request', async () => {
    getWorkQueue.mockRejectedValueOnce(new Error('Secret server details')).mockResolvedValueOnce(queue());
    renderManager();
    await openManager();
    expect(await screen.findByRole('alert')).toHaveTextContent('Client work could not be loaded');
    expect(screen.queryByText(/Secret server/)).not.toBeInTheDocument();
    expect(getWorkQueue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry client work' }));
    await screen.findByRole('link', { name: 'Review designs' });
    expect(getWorkQueue).toHaveBeenCalledTimes(2);
  });

  it('limits visible source records and does not link unsafe URLs', async () => {
    const paths = ['/task/safe', '//evil.example', 'javascript:alert(1)', '/\\evil.example', 'https://evil.example'];
    getWorkQueue.mockResolvedValue(queue({ rows: Array.from({ length: 10 }, (_, index) => ({ id: index, type: 'task', title: `Record ${index}`, sourceUrl: paths[index % paths.length], nextAction: 'Review' })) }));
    renderManager();
    await openManager();
    const list = await screen.findByRole('list', { name: 'Client work records' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'Record 0' })).toHaveAttribute('href', '/task/safe');
    for (const index of [1, 2, 3, 4]) expect(screen.queryByRole('link', { name: `Record ${index}` })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 8 of 10 loaded records/)).toBeInTheDocument();
  });

  it('never carries the previous client data into another client query', async () => {
    const { rerender } = renderManager();
    await openManager();
    await screen.findByRole('link', { name: 'Review designs' });
    let resolveNext;
    getWorkQueue.mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    rerender(<ClientAccountManager clientId="client-b" clientName="Beta" role="ADMIN" />);
    expect(screen.queryByText('Review designs')).not.toBeInTheDocument();
    await waitFor(() => expect(getWorkQueue).toHaveBeenLastCalledWith({ clientId: 'client-b', owner: 'everyone' }));
    await act(async () => { resolveNext(queue({ rows: [] })); });
    expect(screen.queryByText('Review designs')).not.toBeInTheDocument();
    expect(await screen.findByText(/No work records were returned for this client/)).toBeInTheDocument();
  });
});
