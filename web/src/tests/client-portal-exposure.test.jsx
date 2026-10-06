import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { clientPortalSource } from './helpers/clientPortalSource';

// The client-facing views show no internal health rating, AI summary, pinned
// staff notes or task descriptions, and the task board has a column for every
// status the server returns, including tasks waiting on the client.

vi.mock('../pages/client-portal/shared', async (importOriginal) => ({
  ...(await importOriginal()),
  useProjectChat: () => ({
    messages: [], connected: false, sendMessage: vi.fn(), sendError: '', sending: false,
    messagesError: '', loadingMessages: false, reloadMessages: vi.fn(), attachments: { items: [], clear: vi.fn() },
  }),
}));

const { default: ProjectDetail } = await import('../pages/client-portal/ProjectDetail');

const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const task = (id, status) => ({ id, title: `Task ${id}`, status, priority: 'NORMAL', assignee: { name: 'Sam' } });

describe('client portal project detail', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn((url) => {
      const path = String(url);
      if (path.endsWith('/tasks')) {
        return json({
          tasks: [],
          columns: {
            WAITING_CLIENT: [task('w', 'WAITING_CLIENT')],
            TODO: [task('t', 'TODO')],
            IN_PROGRESS: [task('u', 'WAITING_US')],
            REVIEW: [task('r', 'REVIEW')],
            BLOCKED: [],
            DONE: [],
          },
        });
      }
      if (path.endsWith('/documents')) return json([]);
      return json({ id: 'p-1', name: 'Website', status: 'DESIGN_DEV', progressPct: 10, milestones: [], revisionRounds: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a "Waiting on you" column and every other status column', async () => {
    render(<ProjectDetail projectId="p-1" token={null} onBack={() => {}} />);
    const waiting = await screen.findByText('Waiting on you');
    const column = waiting.closest('.cp-kanban-col');
    expect(within(column).getByText('Task w')).toBeInTheDocument();
    for (const label of ['To Do', 'In Progress', 'In Review', 'Blocked', 'Done']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const title of ['Task t', 'Task u', 'Task r']) expect(screen.getByText(title)).toBeInTheDocument();
  });
});

describe('client-facing sources', () => {
  const portal = clientPortalSource();
  const publicPortal = readFileSync(resolve(process.cwd(), 'src/pages/Portal.jsx'), 'utf8');

  it('never render the internal AI summary, health or pinned notes', () => {
    for (const source of [portal, publicPortal]) {
      expect(source).not.toMatch(/aiSummary/);
      expect(source).not.toMatch(/\.health\b/);
      expect(source).not.toMatch(/pinnedNotes/);
    }
  });

  it('never render internal task descriptions', () => {
    expect(portal).not.toMatch(/task\.description/);
  });
});
