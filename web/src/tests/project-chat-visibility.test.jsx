import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getChatMessages: vi.fn(),
    sendChatMessage: vi.fn(),
    getAttachments: vi.fn(),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Sam Staff', role: 'ADMIN' } }) }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket: null }) }));

import { api } from '../lib/api';
import ProjectChat, { VisibilityBadge } from '../components/ProjectChat';

function renderChat(projectId = 'project-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectChat key={projectId} projectId={projectId} />
    </QueryClientProvider>,
  );
}

// C3: staff must always be able to tell internal team chat from messages the
// client can read in their portal, and choose explicitly when sending.
describe('project chat visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    api.getChatMessages.mockResolvedValue([]);
    api.getAttachments.mockResolvedValue([]);
    api.sendChatMessage.mockImplementation(async (_projectId, body) => ({ id: 'm1', ...body }));
  });

  it('labels internal and client-visible messages distinctly', () => {
    const { rerender } = render(<VisibilityBadge visibility="INTERNAL" />);
    expect(screen.getByText('Internal')).toBeInTheDocument();
    rerender(<VisibilityBadge visibility="CLIENT" />);
    expect(screen.getByText('Visible to client')).toBeInTheDocument();
    rerender(<VisibilityBadge />);
    expect(screen.getByText('Internal')).toBeInTheDocument();
  });

  it('sends a client-visible message, then resets the composer to internal', async () => {
    renderChat();
    const internal = await screen.findByRole('radio', { name: /Internal \(team only\)/ });
    const toClient = screen.getByRole('radio', { name: /Visible to client/ });
    expect(internal).toBeChecked();

    fireEvent.click(toClient);
    expect(toClient).toBeChecked();
    fireEvent.change(screen.getByLabelText('Message visible to the client'), { target: { value: 'Draft is ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledWith('project-1', { content: 'Draft is ready', visibility: 'CLIENT' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Internal \(team only\)/ })).toBeChecked());
  });

  it('is keyed by project on the project page so visibility never carries across projects', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');
    expect(page).toContain('<ProjectChat key={id} projectId={id} />');
    const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
    expect(source).toContain("useState('INTERNAL')");
  });
});
