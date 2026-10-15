import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientCommunications from '../components/ClientCommunications';

const { api } = vi.hoisted(() => ({ api: { listClientCommunications: vi.fn(), getClientCommunication: vi.fn() } }));
vi.mock('../lib/api', () => ({ api }));
const item = { id: 'e1', source: 'inbox', subject: 'Website request', sender: 'client@example.test', direction: 'INBOUND', receivedAt: '2026-10-14T10:00:00Z', threadId: 't1', snippet: 'Please review the website.' };
const page = (items = [item], rest = {}) => ({ items, nextCursor: null, coverage: { kind: 'stored-history', complete: false }, warnings: [], ...rest });
function setup(clientId = 'c1') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id) => <QueryClientProvider client={cache}><MemoryRouter><ClientCommunications clientId={id} /></MemoryRouter></QueryClientProvider>;
  return { ...render(view(clientId)), view };
}
beforeEach(() => { vi.resetAllMocks(); api.listClientCommunications.mockResolvedValue(page()); api.getClientCommunication.mockResolvedValue({ ...item, bodyText: 'Stored body text' }); });

describe('stored client communications', () => {
  it('loads only on open, shows coverage and loads message bodies only when expanded', async () => {
    setup(); expect(api.listClientCommunications).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText('Website request');
    expect(api.listClientCommunications).toHaveBeenCalledExactlyOnceWith('c1', { limit: 25 });
    expect(screen.getByText(/not a live mailbox connection/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open source thread' })).toHaveAttribute('href', '/thread/t1');
    expect(api.getClientCommunication).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Read stored message'));
    await screen.findByText('Stored body text');
    expect(api.getClientCommunication).toHaveBeenCalledExactlyOnceWith('c1', 'inbox', 'e1');
  });

  it('paginates equal-date records using the opaque cursor and deduplicates by source plus id', async () => {
    api.listClientCommunications.mockResolvedValueOnce(page([item], { nextCursor: 'opaque-equal-date' })).mockResolvedValueOnce(page([item, { ...item, source: 'project', subject: 'Project email', projectId: 'p1', threadId: null }, { ...item, id: 'e2', subject: 'Second email' }]));
    setup(); fireEvent.click(screen.getByText('Stored email history'));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more email' }));
    await screen.findByText('Second email');
    expect(api.listClientCommunications).toHaveBeenLastCalledWith('c1', { limit: 25, after: 'opaque-equal-date' });
    expect(screen.getAllByText('Website request')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open source project' })).toHaveAttribute('href', '/project/p1');
    expect(screen.queryByRole('button', { name: 'Load more email' })).not.toBeInTheDocument();
  });

  it('renders snippets and bodies as plain text without executing embedded HTML', async () => {
    api.listClientCommunications.mockResolvedValue(page([{ ...item, snippet: '<img src=x onerror=alert(1)>' }]));
    api.getClientCommunication.mockResolvedValue({ ...item, bodyText: '<script>private()</script>' });
    const { container } = setup(); fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText('<img src=x onerror=alert(1)>');
    fireEvent.click(screen.getByText('Read stored message'));
    await screen.findByText('<script>private()</script>');
    expect(container.querySelector('img, script')).toBeNull();
  });

  it('labels a truncated stored body without implying the message is complete', async () => {
    api.getClientCommunication.mockResolvedValue({ ...item, bodyText: 'Partial stored body', bodyTruncated: true });
    setup(); fireEvent.click(screen.getByText('Stored email history'));
    fireEvent.click(await screen.findByText('Read stored message'));
    await screen.findByText('Partial stored body');
    expect(screen.getByText(/Only part of this stored message is shown/)).toBeInTheDocument();
  });

  it('keeps partial coverage explicit and retries without exposing source error contents', async () => {
    api.listClientCommunications.mockResolvedValueOnce(page([item], { warnings: ['private database connection details'] })).mockResolvedValueOnce(page());
    setup(); fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText(/Some stored sources could not be loaded/);
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry missing sources' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry missing sources' })).not.toBeInTheDocument());
    expect(api.listClientCommunications).toHaveBeenCalledTimes(2);
  });

  it('displays permanent coverage exclusions as information without suggesting a retry can restore them', async () => {
    const exclusion = 'Project-only inbox threads are excluded by the current ownership policy.';
    api.listClientCommunications.mockResolvedValue(page([item], { coverage: { kind: 'stored-history', complete: false, exclusions: [exclusion, '<b>Stored scope only</b>'] } }));
    const { container } = setup(); fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText(exclusion);
    expect(screen.getByText('History coverage exclusions')).toBeInTheDocument();
    expect(screen.getByText('<b>Stored scope only</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry missing sources' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Some stored sources could not be loaded/)).not.toBeInTheDocument();
  });

  it('shows safe list and detail errors with explicit retry', async () => {
    api.listClientCommunications.mockRejectedValueOnce(new Error('private list details')).mockResolvedValueOnce(page());
    api.getClientCommunication.mockRejectedValueOnce(new Error('private body details')).mockResolvedValueOnce({ bodyText: 'Available again' });
    setup(); fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry email history' }));
    fireEvent.click(await screen.findByText('Read stored message'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry stored message' }));
    await screen.findByText('Available again');
    expect(screen.queryByText(/private .* details/)).not.toBeInTheDocument();
  });

  it('clears the old client and ignores a late detail response after client changes', async () => {
    let resolve;
    api.getClientCommunication.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { rerender, view } = setup(); fireEvent.click(screen.getByText('Stored email history'));
    fireEvent.click(await screen.findByText('Read stored message'));
    await waitFor(() => expect(api.getClientCommunication).toHaveBeenCalledTimes(1));
    rerender(view('c2'));
    await act(async () => resolve({ bodyText: 'Private previous client body' }));
    expect(screen.queryByText('Private previous client body')).not.toBeInTheDocument();
    expect(screen.queryByText('Website request')).not.toBeInTheDocument();
    expect(api.listClientCommunications).toHaveBeenCalledTimes(1);
    api.listClientCommunications.mockResolvedValue(page([{ ...item, subject: 'Other client email' }]));
    fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText('Other client email');
    expect(api.listClientCommunications).toHaveBeenLastCalledWith('c2', { limit: 25 });
  });

  it('does not confuse an empty stored result with complete communication history', async () => {
    api.listClientCommunications.mockResolvedValue(page([]));
    setup(); fireEvent.click(screen.getByText('Stored email history'));
    await screen.findByText(/This does not mean the client has no email history/);
    expect(api.getClientCommunication).not.toHaveBeenCalled();
  });
});
