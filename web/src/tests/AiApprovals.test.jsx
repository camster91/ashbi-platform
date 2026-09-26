import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getAiToolApprovals: vi.fn(),
    getAiToolReceipts: vi.fn(),
    approveAiToolAction: vi.fn(),
    rejectAiToolAction: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: AiApprovals, describePreview } = await import('../components/AiApprovals');

const PENDING = {
  id: 'a1', tool: 'send_slack_message', source: 'assistant', status: 'PENDING_CONFIRMATION', requesterName: 'Team A',
  expired: false, expiresAt: '2026-09-26T12:10:00.000Z',
  preview: { kind: 'send_slack_message', project: { id: 'p1', name: 'Website' }, mapping: { name: 'web' }, text: 'Shipped' },
};
const RECEIPT = {
  id: 'r1', tool: 'create_task', status: 'FAILED', outcome: 'unknown', errorCode: 'ACTION_EXECUTION_FAILED', requesterName: 'Team A',
  approverId: 'admin-a', approvalEvidence: { requesterApproved: false }, createdAt: '2026-09-26T12:00:00.000Z',
  preview: { kind: 'create_task', project: { name: 'Website' }, title: 'Draft copy' },
};

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><AiApprovals /></QueryClientProvider>);
}

describe('Settings → AI approvals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describes previews in plain language', () => {
    expect(describePreview(PENDING.preview)).toBe('“Shipped” to #web in Website');
    expect(describePreview(RECEIPT.preview)).toBe('“Draft copy” in Website');
    expect(describePreview(null)).toBe('');
  });

  it('lists pending actions and approves with an accessible, specific button', async () => {
    api.getAiToolApprovals.mockResolvedValue({ approvals: [PENDING] });
    api.getAiToolReceipts.mockResolvedValue({ receipts: [RECEIPT] });
    api.approveAiToolAction.mockResolvedValue({ action: { ...PENDING, status: 'EXECUTED' } });
    renderSection();

    const approve = await screen.findByRole('button', { name: 'Approve Post to Slack: “Shipped” to #web in Website' });
    expect(screen.getByText(/via the assistant/)).toBeTruthy();
    expect(await screen.findByText(/delivery unknown/)).toBeTruthy();
    fireEvent.click(approve);
    await waitFor(() => expect(api.approveAiToolAction).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Post to Slack executed/));
  });

  it('rejects with the chosen reason', async () => {
    api.getAiToolApprovals.mockResolvedValue({ approvals: [PENDING] });
    api.getAiToolReceipts.mockResolvedValue({ receipts: [] });
    api.rejectAiToolAction.mockResolvedValue({ action: { ...PENDING, status: 'REJECTED' } });
    renderSection();

    fireEvent.change(await screen.findByLabelText('Reason for rejecting'), { target: { value: 'unsafe' } });
    fireEvent.click(screen.getByRole('button', { name: /^Reject Post to Slack/ }));
    await waitFor(() => expect(api.rejectAiToolAction).toHaveBeenCalledWith('a1', 'unsafe'));
  });

  it('filters receipts by status and shows an empty queue', async () => {
    api.getAiToolApprovals.mockResolvedValue({ approvals: [] });
    api.getAiToolReceipts.mockResolvedValue({ receipts: [] });
    renderSection();

    expect(await screen.findByText('Nothing to approve')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FAILED' } });
    await waitFor(() => expect(api.getAiToolReceipts).toHaveBeenLastCalledWith({ status: 'FAILED', limit: 25 }));
  });

  it('surfaces an approval error as an alert', async () => {
    api.getAiToolApprovals.mockResolvedValue({ approvals: [PENDING] });
    api.getAiToolReceipts.mockResolvedValue({ receipts: [] });
    api.approveAiToolAction.mockRejectedValue(Object.assign(new Error('AI features are turned off for this workspace.'), { status: 503 }));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /^Approve/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/turned off/);
  });
});
