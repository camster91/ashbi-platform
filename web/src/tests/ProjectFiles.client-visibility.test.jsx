import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getAttachments: vi.fn(),
    setAttachmentClientVisibility: vi.fn(),
  },
}));

const auth = { user: { id: 'u-sam', role: 'TEAM' } };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { api } = await import('../lib/api');
const { default: ProjectFiles } = await import('../components/project/ProjectFiles');

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProjectFiles projectId="p1" /></QueryClientProvider>);
}

const recording = { id: 'a-1', originalName: 'screen-recording.webm', mimeType: 'video/webm', size: 2048, createdAt: '2026-09-30T12:00:00.000Z', uploadedBy: { id: 'u-sam', name: 'Sam' }, clientVisible: false };
const brief = { id: 'a-2', originalName: 'brief.pdf', mimeType: 'application/pdf', size: 1024, createdAt: '2026-09-30T12:00:00.000Z', uploadedBy: { id: 'u-casey', name: 'Casey' }, clientVisible: true };

describe('project files client visibility', () => {
  afterEach(() => { vi.clearAllMocks(); auth.user = { id: 'u-sam', role: 'TEAM' }; });

  it('lists project files with their client visibility', async () => {
    api.getAttachments.mockResolvedValue([recording, brief]);
    renderPanel();
    const toggles = await screen.findAllByRole('checkbox', { name: 'Visible to client' });
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).not.toBeChecked();
    expect(toggles[1]).toBeChecked();
    expect(api.getAttachments).toHaveBeenCalledWith('PROJECT', 'p1');
  });

  it('shares a file with the client and refreshes the list', async () => {
    const user = userEvent.setup();
    api.getAttachments.mockResolvedValueOnce([recording]).mockResolvedValue([{ ...recording, clientVisible: true }]);
    api.setAttachmentClientVisibility.mockResolvedValue({ ...recording, clientVisible: true });
    renderPanel();
    await user.click(await screen.findByRole('checkbox', { name: 'Visible to client' }));
    expect(api.setAttachmentClientVisibility).toHaveBeenCalledWith('a-1', true);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Visible to client' })).toBeChecked());
  });

  it('disables the toggle, with the reason, for staff who neither uploaded the file nor are admins', async () => {
    api.getAttachments.mockResolvedValue([recording, brief]);
    renderPanel();
    const toggles = await screen.findAllByRole('checkbox', { name: 'Visible to client' });
    expect(toggles[0]).toBeEnabled();
    expect(toggles[1]).toBeDisabled();
    expect(toggles[1]).toHaveAccessibleDescription('Only the uploader or an admin can change this.');
  });

  it('lets an admin change any file', async () => {
    auth.user = { id: 'u-admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([recording, brief]);
    renderPanel();
    const toggles = await screen.findAllByRole('checkbox', { name: 'Visible to client' });
    for (const toggle of toggles) expect(toggle).toBeEnabled();
  });

  it('announces a failed change', async () => {
    const user = userEvent.setup();
    auth.user = { id: 'u-admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([brief]);
    api.setAttachmentClientVisibility.mockRejectedValue(new Error('Only the uploader or an admin can change who sees this file'));
    renderPanel();
    await user.click(await screen.findByRole('checkbox', { name: 'Visible to client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the uploader or an admin');
  });
});
