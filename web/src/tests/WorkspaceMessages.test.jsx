import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceMessages from '../pages/WorkspaceMessages';

const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['listWorkspaceChatChannels', 'listWorkspaceChatPeople', 'createWorkspaceChatChannel', 'getWorkspaceChatMessages', 'postWorkspaceChatMessage', 'markWorkspaceChatRead'].map((key) => [key, vi.fn()])), auth: { user: { id: 'u1', role: 'ADMIN' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const channels = [{ id: 'a', name: 'Agency', kind: 'COMPANY' }, { id: 'b', name: 'Client work', kind: 'CLIENT' }];
const message = { id: 'm1', content: 'Review the draft', author: { id: 'u2', name: 'Bianca' }, createdAt: '2026-10-14T12:00:00Z' };
function setup() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><MemoryRouter><WorkspaceMessages /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks(); auth.user = { id: 'u1', role: 'ADMIN' };
  api.listWorkspaceChatChannels.mockResolvedValue({ items: channels });
  api.listWorkspaceChatPeople.mockResolvedValue({ items: [{ id: 'u1', name: 'Cameron' }, { id: 'u2', name: 'Bianca' }] });
  api.getWorkspaceChatMessages.mockResolvedValue({ items: [message], nextCursor: null });
  api.markWorkspaceChatRead.mockResolvedValue({});
});

describe('workspace messages', () => {
  it('loads additional conversations explicitly and deduplicates overlapping pages', async () => {
    api.listWorkspaceChatChannels.mockResolvedValueOnce({ items: [channels[0]], nextCursor: 'a' }).mockResolvedValueOnce({ items: channels, nextCursor: null });
    setup(); await screen.findByRole('button', { name: /Agency/ });
    expect(api.listWorkspaceChatChannels).toHaveBeenCalledExactlyOnceWith({ limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Load more conversations' }));
    await screen.findByRole('button', { name: /Client work/ });
    expect(api.listWorkspaceChatChannels).toHaveBeenLastCalledWith({ limit: 50, after: 'a' });
    expect(screen.getAllByRole('button', { name: /Agency/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more conversations' })).not.toBeInTheDocument();
  });

  it('distinguishes direct conversations using their other members in the list and heading', async () => {
    api.listWorkspaceChatChannels.mockResolvedValue({ items: [
      { id: 'd1', kind: 'DIRECT', name: 'Direct message', members: [{ userId: 'u1', user: { id: 'u1', name: 'Cameron' } }, { userId: 'u2', user: { id: 'u2', name: 'Bianca' } }] },
      { id: 'd2', kind: 'DIRECT', members: [{ userId: 'u3', user: { id: 'u3', name: 'Alex' } }] },
      { id: 'd3', kind: 'DIRECT', name: 'Legacy conversation' },
    ] });
    setup(); fireEvent.click(await screen.findByRole('button', { name: /Bianca/ }));
    expect(screen.getByRole('heading', { name: 'Bianca' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alex/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Legacy conversation/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cameron/ })).not.toBeInTheDocument();
  });

  it('makes a newly created channel reachable even when it sorts beyond the loaded page', async () => {
    api.createWorkspaceChatChannel.mockResolvedValue({ channel: { id: 'z-new', name: 'New private conversation', kind: 'DIRECT', members: [{ userId: 'u2', user: { id: 'u2', name: 'Bianca' } }] } });
    setup(); await screen.findByRole('button', { name: /Agency/ });
    fireEvent.click(screen.getByText('New conversation'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bianca' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Team member'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await screen.findByRole('heading', { name: 'Bianca' });
    expect(screen.getByRole('button', { name: /Bianca/ })).toHaveAttribute('aria-pressed', 'true');
    expect(api.listWorkspaceChatChannels).toHaveBeenCalledTimes(2);
  });

  it('loads selected channel history, renders plain text and posts a linked reply', async () => {
    api.postWorkspaceChatMessage.mockResolvedValue({ message });
    setup();
    const channel = await screen.findByRole('button', { name: /Agency/ });
    expect(api.getWorkspaceChatMessages).not.toHaveBeenCalled();
    fireEvent.click(channel);
    await screen.findByText('Review the draft');
    expect(api.getWorkspaceChatMessages).toHaveBeenCalledWith('a', { limit: 30 });
    fireEvent.click(screen.getByRole('button', { name: /Reply to Bianca/ }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '<b>Looks good</b>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.postWorkspaceChatMessage).toHaveBeenCalledWith('a', { content: '<b>Looks good</b>', parentId: 'm1', idempotencyKey: expect.any(String) }));
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
  });

  it('preserves the draft and identical idempotency key when delivery is uncertain', async () => {
    api.postWorkspaceChatMessage.mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce({ message, duplicate: true });
    setup(); fireEvent.click(await screen.findByRole('button', { name: /Agency/ }));
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Message')).toHaveValue('Keep me');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.postWorkspaceChatMessage).toHaveBeenCalledTimes(2));
    expect(api.postWorkspaceChatMessage.mock.calls[0]).toEqual(api.postWorkspaceChatMessage.mock.calls[1]);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('blocks duplicate submissions while pending and renders message bodies as text', async () => {
    let resolve;
    api.getWorkspaceChatMessages.mockResolvedValue({ items: [{ ...message, content: '<img src=x onerror=alert(1)>' }] });
    api.postWorkspaceChatMessage.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { container } = setup(); fireEvent.click(await screen.findByRole('button', { name: /Agency/ }));
    await screen.findByText('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Send once' } });
    const form = screen.getByLabelText('Message').closest('form');
    fireEvent.submit(form); fireEvent.submit(form);
    expect(api.postWorkspaceChatMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Message')).toBeDisabled();
    await act(async () => resolve({ message }));
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('creates a direct conversation with only the selected colleague', async () => {
    api.createWorkspaceChatChannel.mockResolvedValue({ channel: channels[0] });
    auth.user.role = 'TEAM'; setup();
    await screen.findByRole('button', { name: /Agency/ });
    fireEvent.click(screen.getByText('New conversation'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bianca' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Team member'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(api.createWorkspaceChatChannel).toHaveBeenCalledWith({ kind: 'DIRECT', memberIds: ['u2'] }));
  });

  it('clears old history and ignores late responses when switching channels', async () => {
    let resolve;
    api.getWorkspaceChatMessages.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    setup(); fireEvent.click(await screen.findByRole('button', { name: /Agency/ }));
    await waitFor(() => expect(api.getWorkspaceChatMessages).toHaveBeenCalledWith('a', { limit: 30 }));
    fireEvent.click(screen.getByRole('button', { name: /Client work/ }));
    await screen.findByText('Review the draft');
    await act(async () => resolve({ items: [{ ...message, content: 'Private old channel' }] }));
    expect(screen.queryByText('Private old channel')).not.toBeInTheDocument();
  });

  it('loads older messages with the provided cursor', async () => {
    api.getWorkspaceChatMessages.mockResolvedValueOnce({ items: [message], nextCursor: 'm1' }).mockResolvedValueOnce({ items: [{ ...message, id: 'm0', content: 'Earlier message' }], nextCursor: null });
    setup(); fireEvent.click(await screen.findByRole('button', { name: /Agency/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    await screen.findByText('Earlier message');
    expect(api.getWorkspaceChatMessages).toHaveBeenLastCalledWith('a', { limit: 30, after: 'm1' });
  });

  it('creates a company channel with explicit selected members', async () => {
    api.createWorkspaceChatChannel.mockResolvedValue({ channel: channels[0] });
    setup(); await screen.findByRole('button', { name: /Agency/ });
    fireEvent.click(screen.getByText('New conversation'));
    fireEvent.change(screen.getByLabelText('Conversation type'), { target: { value: 'COMPANY' } });
    fireEvent.change(screen.getByLabelText('Channel name'), { target: { value: 'Operations' } });
    fireEvent.click(await screen.findByLabelText('Bianca'));
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(api.createWorkspaceChatChannel).toHaveBeenCalledWith({ kind: 'COMPANY', name: 'Operations', memberIds: ['u2'] }));
  });

  it('keeps team users out of company channel creation and denies guest queries', async () => {
    auth.user = { id: 'u1', role: 'TEAM' };
    const view = setup(); await screen.findByRole('button', { name: /Agency/ });
    expect(screen.queryByLabelText('Conversation type')).not.toBeInTheDocument();
    view.unmount(); vi.clearAllMocks(); auth.user = { id: 'guest', role: 'CLIENT' };
    setup(); expect(screen.getByRole('alert')).toHaveTextContent('staff only');
    expect(api.listWorkspaceChatChannels).not.toHaveBeenCalled();
  });

  it('hides history after an access error and never renders service details', async () => {
    api.getWorkspaceChatMessages.mockRejectedValue({ status: 404, message: 'private details' });
    setup(); fireEvent.click(await screen.findByRole('button', { name: /Agency/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access may have changed');
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByText(/private details/)).not.toBeInTheDocument();
  });
});
