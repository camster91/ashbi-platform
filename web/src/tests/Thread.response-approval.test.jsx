import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseThread = {
  id: 'thr-1',
  subject: 'Packaging timeline',
  status: 'OPEN',
  priority: 'HIGH',
  client: { id: 'c1', name: 'Northwind Coffee Roasters' },
  project: null,
  createdAt: '2030-01-01T10:00:00.000Z',
  lastActivityAt: '2030-01-01T10:00:00.000Z',
  aiAnalysis: null,
  internalNotes: [],
  messages: [{ id: 'm1', direction: 'INBOUND', senderEmail: 'olivia@northwindcoffee.com', senderName: 'Olivia', bodyText: 'When?', receivedAt: '2030-01-01T10:00:00.000Z' }],
};

let thread;
let role = 'TEAM';
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const api = {
  getThread: vi.fn(async () => thread),
  submitResponse: vi.fn(async () => ({})),
  updateResponse: vi.fn(async () => ({})),
  approveResponse: vi.fn(async () => ({})),
  rejectResponse: vi.fn(async () => ({})),
  gmailDraftReply: vi.fn(),
  getGmailStatus: vi.fn(async () => ({ connected: true })),
  gmailSend: vi.fn(async () => ({ success: true })),
  markResponseSent: vi.fn(async () => ({})),
};

vi.mock('../lib/api', () => ({
  api: new Proxy({}, { get: (_target, prop) => api[prop] ?? vi.fn(async () => ({})) }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Pat Lee', role } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));

const { default: Thread } = await import('../pages/Thread');

function renderThread() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/thread/thr-1']}>
        <Routes>
          <Route path="/thread/:id" element={<Thread />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function withResponse(response) {
  thread = { ...baseThread, responses: [{ id: 'r1', threadId: 'thr-1', draftedBy: { name: 'Sam' }, body: 'Hi Olivia, Friday.', ...response }] };
}

async function savedDrafts() {
  const heading = await screen.findByRole('heading', { name: 'Saved drafts' });
  return within(heading.closest('div').parentElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'TEAM';
});

describe('response approval on a conversation', () => {
  it('lets the writer ask for approval on a draft', async () => {
    withResponse({ status: 'DRAFT' });
    renderThread();
    fireEvent.click((await savedDrafts()).getByRole('button', { name: 'Ask for approval' }));
    await waitFor(() => expect(api.submitResponse).toHaveBeenCalledWith('r1'));
    expect(toast.success).toHaveBeenCalledWith('Sent for approval', expect.stringContaining('Nothing was sent'));
  });

  it('shows why a draft was returned and edits it in place', async () => {
    withResponse({ status: 'REJECTED', rejectionReason: 'Confirm the date first' });
    renderThread();
    const drafts = await savedDrafts();
    expect(drafts.getByText('Confirm the date first')).toBeInTheDocument();
    expect(drafts.getByRole('button', { name: 'Ask for approval again' })).toBeInTheDocument();

    fireEvent.click(drafts.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit saved draft' })).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Response' });
    expect(box).toHaveValue('Hi Olivia, Friday.');
    fireEvent.change(box, { target: { value: 'Hi Olivia, Friday the 12th.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateResponse).toHaveBeenCalledWith('r1', { body: 'Hi Olivia, Friday the 12th.' }));
  });

  it('tells a non-admin who decides, and gives an admin Approve and Return', async () => {
    withResponse({ status: 'PENDING_APPROVAL' });
    const { unmount } = renderThread();
    const drafts = await savedDrafts();
    expect(drafts.getByText(/An admin will approve it/)).toBeInTheDocument();
    expect(drafts.queryByRole('button', { name: /Approve reply/ })).toBeNull();
    unmount();

    role = 'ADMIN';
    renderThread();
    const adminDrafts = await savedDrafts();
    fireEvent.click(adminDrafts.getByRole('button', { name: 'Approve reply to Packaging timeline' }));
    await waitFor(() => expect(api.approveResponse).toHaveBeenCalledWith('r1'));
  });

  it('requires a reason to return a reply', async () => {
    role = 'ADMIN';
    withResponse({ status: 'PENDING_APPROVAL' });
    renderThread();
    fireEvent.click((await savedDrafts()).getByRole('button', { name: 'Return reply to Packaging timeline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return to the writer' });
    const submit = within(dialog).getByRole('button', { name: 'Return reply' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should change/ }), { target: { value: 'Too formal' } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.rejectResponse).toHaveBeenCalledWith('r1', 'Too formal'));
  });

  it('sends the approved text unchanged and marks the draft sent', async () => {
    withResponse({ status: 'APPROVED', approvedBy: { name: 'Alex' } });
    api.gmailDraftReply.mockResolvedValue({
      draft: 'Hi Olivia, Friday.', subject: 'Re: Packaging timeline', to: 'olivia@northwindcoffee.com',
      responseId: 'r1', gmailThreadId: null, lastMessageId: null, notice: null,
    });
    renderThread();
    const drafts = await savedDrafts();
    expect(drafts.getByText('Approved by Alex. Not sent yet.')).toBeInTheDocument();
    fireEvent.click(drafts.getByRole('button', { name: 'Send via Gmail' }));
    await waitFor(() => expect(api.gmailDraftReply).toHaveBeenCalledWith('thr-1', 'r1'));

    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    const message = within(dialog).getByRole('textbox', { name: 'Message' });
    expect(message).toHaveAttribute('readonly');
    expect(within(dialog).getByText(/This is the approved text/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Send email' })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send email' }));
    await waitFor(() => expect(api.markResponseSent).toHaveBeenCalledWith('r1'));
  });

  it('says so when the email went out but the draft could not be marked sent', async () => {
    withResponse({ status: 'APPROVED' });
    api.gmailDraftReply.mockResolvedValue({ draft: 'Hi', subject: 'Re: x', to: 'olivia@northwindcoffee.com', responseId: 'r1', notice: null });
    api.markResponseSent.mockRejectedValueOnce(new Error('Network down'));
    renderThread();
    fireEvent.click((await savedDrafts()).getByRole('button', { name: 'Send via Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Send email' })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send email' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The email was sent, but the saved draft still shows Approved', 'Network down'));
  });
});
