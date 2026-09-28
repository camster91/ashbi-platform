import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocumentsTab from '../pages/client-portal/DocumentsTab';
import { PortalChatComposer } from '../pages/client-portal/shared';

const projects = [{ id: 'project-a', name: 'Website Redesign' }];
const doc = { id: 'doc-a', originalName: 'brief.pdf', size: 2048, createdAt: '2026-08-19T12:00:00.000Z', uploadedBy: { name: 'Dana' } };
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('client portal Documents tab failures', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('announces failed uploads in an error alert that can be dismissed', async () => {
    fetchMock.mockImplementation((url, options = {}) => {
      if (String(url).endsWith('/upload') && options.method === 'POST') return json({ error: 'nope' }, 500);
      return json([]);
    });
    render(<DocumentsTab projects={projects} token={null} />);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading documents...' })).toBeNull());

    const input = screen.getByLabelText('Choose documents to upload');
    fireEvent.change(input, { target: { files: [new File(['x'], 'huge.mov', { type: 'video/quicktime' })] } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('1 file(s) failed to upload — huge.mov');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss upload error' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces failed downloads instead of failing silently', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/download')) return json({ error: 'gone' }, 404);
      return json([doc]);
    });
    render(<DocumentsTab projects={projects} token={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Download failed (404)');
  });
});

describe('client portal busy buttons', () => {
  it('keeps a busy, disabled send button at full opacity so its label stays legible', () => {
    render(<PortalChatComposer value="Hello" onChange={() => {}} onSubmit={e => e.preventDefault()} connected sending sendError="" />);
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('aria-busy', 'true');
    expect(send).toHaveTextContent('Sending…');
    expect(send.className).toContain('disabled:opacity-100');
    expect(send.className).not.toContain('disabled:opacity-50');
  });
});
