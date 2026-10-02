import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const thread = {
  id: 'thr-1',
  subject: 'Question about packaging timeline and the second round of label revisions',
  status: 'OPEN',
  priority: 'HIGH',
  client: { id: 'c1', name: 'Northwind Coffee Roasters' },
  project: null,
  createdAt: '2030-01-01T10:00:00.000Z',
  lastActivityAt: '2030-01-01T10:00:00.000Z',
  aiAnalysis: null,
  internalNotes: [],
  responses: [{ id: 'r1', status: 'DRAFT', body: 'Earlier draft', draftedBy: { name: 'Sam' } }],
  messages: [
    {
      id: 'm1',
      direction: 'INBOUND',
      senderEmail: 'olivia@northwindcoffee.com',
      senderName: 'Olivia Chen',
      bodyText: 'When can we expect the dieline?',
      receivedAt: '2030-01-01T10:00:00.000Z',
    },
  ],
};

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const api = {
  getThread: vi.fn(async () => thread),
  gmailDraftReply: vi.fn(),
  getGmailStatus: vi.fn(),
  gmailSend: vi.fn(),
  createResponse: vi.fn(),
  draftResponse: vi.fn(),
};

vi.mock('../lib/api', () => ({
  api: new Proxy({}, { get: (_target, prop) => api[prop] ?? vi.fn(async () => ({})) }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Pat Lee', role: 'TEAM' } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));

const { default: Thread, assignmentSuggestionLabel, buildGmailSendPayload, gmailConnectionLine, responseStatusLabel } = await import('../pages/Thread');

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

const hubOnlyDraft = {
  draft: 'Hi Olivia,\n\nThe dieline is coming Friday.\n\nBest,\nPat Lee\nNorthwind Studio',
  subject: 'Re: Question about packaging timeline',
  to: 'olivia@northwindcoffee.com',
  gmailThreadId: null,
  lastMessageId: null,
  notice: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getThread.mockImplementation(async () => thread);
});

describe('Gmail send payload', () => {
  it('leaves out Gmail ids for a conversation that never came from Gmail', () => {
    const payload = buildGmailSendPayload({ to: 'a@b.co', subject: 'Re: x', body: 'Hi', meta: { gmailThreadId: null, lastMessageId: null }, hubThreadId: 'thr-1' });
    expect(payload).toEqual({ to: 'a@b.co', subject: 'Re: x', body: 'Hi', hubThreadId: 'thr-1' });
    expect('threadId' in payload).toBe(false);
    expect('in_reply_to' in payload).toBe(false);
  });

  it('keeps Gmail ids when the conversation came from Gmail', () => {
    const payload = buildGmailSendPayload({ to: 'a@b.co', subject: 's', body: 'b', meta: { gmailThreadId: '18c2f0a', lastMessageId: '18c2f0b' }, hubThreadId: 'thr-1' });
    expect(payload.threadId).toBe('18c2f0a');
    expect(payload.in_reply_to).toBe('18c2f0b');
  });

  it('describes the connection without promising a mailbox that is not there', () => {
    expect(gmailConnectionLine({ checking: true })).toMatch(/Checking/);
    expect(gmailConnectionLine({ status: { connected: false } })).toMatch(/Copy the reply/);
    expect(gmailConnectionLine({ status: { connected: true, email: 'team@studio.test' } })).toBe('Sends from team@studio.test.');
    expect(gmailConnectionLine({ failed: true })).toMatch(/couldn't be checked/);
  });
});

describe('Reply via Gmail', () => {
  it('says Gmail is not connected, blocks sending and offers to copy the reply', async () => {
    api.gmailDraftReply.mockResolvedValue(hubOnlyDraft);
    api.getGmailStatus.mockResolvedValue({ connected: false, code: 'GMAIL_NOT_CONNECTED', error: "Gmail isn't connected for this workspace, so this reply can't be sent from here." });
    renderThread();

    fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    expect(await within(dialog).findByText("Gmail isn't connected")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Sends through the connected Gmail/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Send email/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /Copy reply/ })).toBeInTheDocument();
    expect(api.gmailSend).not.toHaveBeenCalled();
  });

  it('sends without null Gmail ids and signs with the person, not a fixed name', async () => {
    api.gmailDraftReply.mockResolvedValue(hubOnlyDraft);
    api.getGmailStatus.mockResolvedValue({ connected: true, email: 'team@studio.test' });
    api.gmailSend.mockResolvedValue({ success: true });
    renderThread();

    fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    expect(await within(dialog).findByText('Sends from team@studio.test.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Message').value).toContain('Pat Lee');
    expect(within(dialog).getByLabelText('Message').value).not.toContain('Cameron');

    fireEvent.click(within(dialog).getByRole('button', { name: /Send email/ }));
    await waitFor(() => expect(api.gmailSend).toHaveBeenCalledTimes(1));
    const body = api.gmailSend.mock.calls[0][0];
    expect(body).not.toHaveProperty('threadId');
    expect(body).not.toHaveProperty('in_reply_to');
    expect(body.hubThreadId).toBe('thr-1');
  });

  it('shows why the draft is a template when AI could not write it', async () => {
    api.gmailDraftReply.mockResolvedValue({
      ...hubOnlyDraft,
      notice: { code: 'AI_UNAVAILABLE', message: "AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings. A short template reply was added instead; edit it before sending." },
    });
    api.getGmailStatus.mockResolvedValue({ connected: true, email: 'team@studio.test' });
    renderThread();

    fireEvent.click(await screen.findByRole('button', { name: /Reply via Gmail/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply via Gmail' });
    expect(within(dialog).getByText(/A short template reply was added instead/)).toBeInTheDocument();
  });
});

describe('Compose response', () => {
  it('saves a draft and says exactly that, with no hard-coded approver', async () => {
    api.createResponse.mockResolvedValue({ id: 'r2', status: 'DRAFT' });
    renderThread();

    const box = await screen.findByLabelText('Response');
    expect(screen.getByText(/Nothing is sent to the client/)).toBeInTheDocument();
    expect(screen.queryByText(/Cameron/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'Friday works.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api.createResponse).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Draft saved', expect.stringMatching(/Nothing was sent/)));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/approval/i), expect.anything());
    expect(screen.getByRole('heading', { name: 'Saved drafts' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('shows the server reason when the AI draft fails', async () => {
    const failure = Object.assign(new Error("AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings."), { status: 503, data: { code: 'AI_UNAVAILABLE' } });
    api.draftResponse.mockRejectedValue(failure);
    renderThread();

    fireEvent.click(await screen.findByRole('button', { name: /AI Draft/ }));
    expect(await screen.findByText(/AI isn't set up for this workspace yet/)).toBeInTheDocument();
    expect(screen.queryByText(/^Server error$/)).not.toBeInTheDocument();
  });

  it('labels response states in plain words', () => {
    expect(responseStatusLabel('DRAFT')).toBe('Draft');
    expect(responseStatusLabel('PENDING_APPROVAL')).toBe('Waiting for approval');
  });

  it('shows AI assignment suggestions as roles, not people', () => {
    expect(assignmentSuggestionLabel('account_lead')).toBe('Account lead');
    expect(assignmentSuggestionLabel('dev')).toBe('Development');
    expect(assignmentSuggestionLabel('anyone')).toBe('Anyone');
  });
});

describe('Thread header layout', () => {
  it('stacks the title above the badges and actions on small screens', async () => {
    renderThread();
    const header = await screen.findByTestId('thread-header');
    // Column on phones, row from md up; the title is allowed to wrap.
    expect(header.className).toMatch(/\bflex-col\b/);
    expect(header.className).toMatch(/\bmd:flex-row\b/);
    const title = within(header).getByRole('heading', { level: 1 });
    expect(title.className).toMatch(/break-words/);
    const actions = within(header).getByRole('button', { name: /Resolve/ }).parentElement;
    expect(actions.className).toMatch(/\bflex-wrap\b/);
    expect(within(header).getByRole('button', { name: /Reply via Gmail/ }).className).toMatch(/min-h-11/);
  });

  it('keeps hard-coded names out of the page', () => {
    const source = fs.readFileSync(path.resolve('src/pages/Thread.jsx'), 'utf8');
    expect(source).not.toMatch(/Cameron/);
    expect(source).not.toMatch(/Ashbi Design/);
  });
});
