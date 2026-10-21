// The signed-in client portal shell and Overview (Ashbi Hub Portal mockup):
// the ink header with the section tabs, the greeting, "Waiting on you", the
// project in focus, retainer, recent files and messages. Every request is a
// session-scoped /api/client-portal call, with no token in a URL.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fmt } from '../pages/client-portal/shared';

vi.mock('../pages/client-portal/shared', async (importOriginal) => ({
  ...(await importOriginal()),
  useProjectChat: (projectId) => ({
    messages: [{ id: `chat-${projectId}`, content: `Chat for ${projectId}`, createdAt: '2026-10-16T12:00:00Z', author: { name: 'Cameron Ashley' } }],
    connected: true, sendMessage: vi.fn(), sendError: '', sending: false,
    messagesError: '', loadingMessages: false, reloadMessages: vi.fn(), attachments: null,
  }),
}));
vi.mock('../pages/client-portal/ReviewsTab', () => ({
  default: ({ initialOpenId }) => <p>Reviews tab{initialOpenId ? ` open on ${initialOpenId}` : ''}</p>,
}));
vi.mock('../pages/client-portal/ProjectDetail', () => ({
  default: ({ projectId }) => <p>Project detail {projectId}</p>,
}));

const { default: ClientPortal } = await import('../pages/ClientPortal');

const me = {
  client: { name: 'Northwind Coffee' },
  contact: { name: 'Priya Shah', email: 'priya@example.com' },
  brand: { companyName: 'Fixture Studio', logoUrl: null },
  handoffIdentity: { organizationId: 'o1', userId: 'u1', contactId: 'c1' },
};
const projects = [
  { id: 'p1', name: 'Holiday landing page', status: 'DESIGN_DEV', endDate: '2026-11-15T12:00:00Z', updatedAt: '2026-10-16T12:00:00Z', totalTasks: 20, completedTasks: 14, progressPct: 70 },
  { id: 'p2', name: 'Care plan', status: 'ACTIVE', updatedAt: '2026-10-10T12:00:00Z', totalTasks: 4, completedTasks: 1, progressPct: 25 },
  { id: 'p3', name: 'Old site', status: 'LAUNCHED', updatedAt: '2026-09-01T12:00:00Z', totalTasks: 0, completedTasks: 0, progressPct: 0 },
];
const invoices = [
  { id: 'i1', invoiceNumber: 'INV-1042', status: 'SENT', total: 1356, amountPaid: 0, balanceDue: 1356, currency: 'CAD', dueDate: '2026-11-01T12:00:00Z', payUrl: '/portal/invoice/view-1042' },
  { id: 'i2', invoiceNumber: 'INV-1040', status: 'OVERDUE', total: 500, amountPaid: 200, balanceDue: 300, currency: 'USD', dueDate: '2026-10-01T12:00:00Z', payUrl: null },
  { id: 'i3', invoiceNumber: 'INV-1001', status: 'PAID', total: 900, amountPaid: 900, balanceDue: 0, currency: 'CAD', payUrl: null },
];
const contracts = [
  { id: 'k1', title: 'Project agreement', status: 'SENT', signToken: 'sign-k1', canReview: true },
  { id: 'k2', title: 'Old agreement', status: 'SIGNED', canReview: false, canDownload: true },
];
const reviews = [
  { id: 'r1', projectId: 'p1', projectName: 'Holiday landing page', title: 'Holiday banners', status: 'open', version: 2, openAnnotationCount: 4, nextSessionId: null },
  { id: 'r0', projectId: 'p1', projectName: 'Holiday landing page', title: 'Holiday banners', status: 'open', version: 1, openAnnotationCount: 1, nextSessionId: 'r1' },
  { id: 'r2', projectId: 'p2', projectName: 'Care plan', title: 'Footer', status: 'approved', version: 1, openAnnotationCount: 0, nextSessionId: null },
];
const documents = {
  p1: [{ id: 'd1', originalName: 'Holiday banners v2.pdf', createdAt: '2026-10-15T12:00:00Z' }, { id: 'd2', originalName: 'Page wireframe.png', createdAt: '2026-10-06T12:00:00Z' }],
  p2: [{ id: 'd3', originalName: 'Signed proposal.pdf', createdAt: '2026-09-21T12:00:00Z' }, { id: 'd4', originalName: 'Old logo.svg', createdAt: '2026-01-02T12:00:00Z' }],
  p3: [],
};
const messages = [
  { id: 'm1', content: 'Hi Priya, the banners are up for review.', createdAt: '2026-10-16T16:12:00Z', author: { name: 'Cameron Ashley' } },
];
const retainer = { hoursPerMonth: 10, hoursUsed: 6, hoursRemaining: 4, percentUsed: 60 };

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock;
let overrides;
const scrollIntoView = Element.prototype.scrollIntoView;

function routes(url) {
  const { pathname, search } = new URL(String(url), 'http://portal.test');
  const path = pathname.replace(/^\/api\/client-portal/, '');
  if (path in overrides) return overrides[path];
  if (path === '/me') return json(me);
  if (path === '/projects') return json(projects);
  if (path === '/invoices') return json(invoices);
  if (path === '/contracts') return json(contracts);
  if (path === '/retainer') return json(retainer);
  if (path === '/unread-count') return json({ recentMessages: 1, upcomingDeadlines: 2 });
  if (path === '/reviews') return json({ sessions: reviews });
  const docs = path.match(/^\/projects\/([^/]+)\/documents$/);
  if (docs) return json(documents[docs[1]] || []);
  if (path === '/projects/p1/messages' && search === '?limit=2') return json(messages);
  return json({ error: `unmocked ${pathname}${search}` }, 501);
}

beforeEach(() => {
  overrides = {};
  // jsdom has no layout; the Messages tab scrolls to its newest message.
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn((url) => routes(url));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = scrollIntoView;
});

async function renderPortal() {
  render(<MemoryRouter initialEntries={['/client-portal']}><ClientPortal /></MemoryRouter>);
  await screen.findByRole('heading', { level: 1 });
}

describe('client portal shell', () => {
  it('shows the agency, the client and the signed-in contact on the ink header', async () => {
    await renderPortal();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('cp-header');
    expect(within(header).getByText('Fixture Studio')).toBeInTheDocument();
    expect(within(header).getByText('Northwind Coffee')).toBeInTheDocument();
    expect(within(header).getByRole('img', { name: 'Signed in as Priya Shah' })).toHaveTextContent('PS');
    expect(within(header).getByRole('button', { name: 'Logout of client portal' })).toBeInTheDocument();
  });

  it('lists the portal sections as tabs in mockup order, with counts', async () => {
    await renderPortal();
    const tablist = screen.getByRole('tablist', { name: 'Portal sections' });
    expect(tablist.closest('[data-portal-nav]')).not.toBeNull();
    expect(within(tablist).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Overview', 'Projects (3)', 'Reviews', 'Files', 'Invoices (3)', 'Contracts (2)', 'Messages',
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the Files and Messages sections from their tabs', async () => {
    const user = userEvent.setup();
    await renderPortal();
    await user.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByRole('heading', { name: 'Files' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.getByText('Chat for p1')).toBeInTheDocument();
  });

  it('only calls the session-scoped portal API and never puts a token in a URL', async () => {
    await renderPortal();
    await screen.findByText('Hi Priya, the banners are up for review.');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.every(url => url.startsWith('/api/client-portal/'))).toBe(true);
    expect(urls.some(url => /token=/i.test(url))).toBe(false);
  });
});

describe('client portal overview', () => {
  it('greets the contact by first name under the date', async () => {
    await renderPortal();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Hi Priya, here’s where things stand');
    expect(within(heading).getByText('Priya')).toHaveClass('font-display', 'italic');
  });

  it('lists what is waiting on the client: open reviews, contracts to sign, then money owed, overdue first', async () => {
    await renderPortal();
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    await within(waiting).findByText('Review Holiday banners');
    const items = within(waiting).getAllByRole('listitem');
    expect(items.map(item => item.querySelector('p').textContent)).toEqual([
      'Review Holiday banners', 'Sign Project agreement', 'Pay invoice INV-1040', 'Pay invoice INV-1042',
    ]);
    // The superseded version and the approved review are not listed.
    expect(within(waiting).getAllByText('Review Holiday banners')).toHaveLength(1);
    expect(within(waiting).queryByText(/Footer/)).toBeNull();
    expect(within(waiting).getByRole('heading', { name: 'Waiting on you' }).nextSibling).toHaveTextContent('4 items');

    expect(within(items[1]).getByRole('link', { name: 'Review and sign Project agreement' })).toHaveAttribute('href', '/portal/contract/sign-k1');
    // Each balance in its own currency; the partly paid invoice shows its balance.
    expect(items[2]).toHaveTextContent(fmt(300, 'USD'));
    expect(items[2]).toHaveTextContent('overdue, was due');
    expect(items[3]).toHaveTextContent(fmt(1356, 'CAD'));
    expect(within(items[3]).getByRole('link', { name: 'View and pay invoice INV-1042' })).toHaveAttribute('href', '/portal/invoice/view-1042');
    // No pay link without a server-issued one: it points to the Invoices tab.
    expect(within(items[2]).queryByRole('link')).toBeNull();
    expect(within(items[2]).getByRole('button', { name: 'View invoice INV-1040' })).toBeInTheDocument();
  });

  it('opens the review itself from "Waiting on you"', async () => {
    const user = userEvent.setup();
    await renderPortal();
    await user.click(await screen.findByRole('button', { name: 'Review Holiday banners' }));
    expect(screen.getByRole('tab', { name: 'Reviews' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Reviews tab open on r1')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    overrides = {
      '/reviews': json({ sessions: [] }),
      '/contracts': json([]),
      '/invoices': json([]),
    };
    await renderPortal();
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    await waitFor(() => expect(waiting).toHaveTextContent('Nothing needs you right now.'));
  });

  it('never says nothing is waiting while reviews are unavailable, and the page survives', async () => {
    overrides = {
      '/reviews': json({ error: 'nope' }, 500),
      '/contracts': json([]),
      '/invoices': json([]),
    };
    await renderPortal();
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    await waitFor(() => expect(waiting).toHaveTextContent('Reviews could not be loaded.'));
    expect(waiting).not.toHaveTextContent('Nothing needs you right now.');
    expect(within(waiting).getByRole('button', { name: 'Open Reviews' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Holiday landing page' })).toBeInTheDocument();
  });

  it('never features a completed, paused or draft project as the current one', async () => {
    overrides = {
      '/projects': json([
        { id: 'done', name: 'Finished rebuild', status: 'COMPLETED', updatedAt: '2026-10-18T12:00:00Z', totalTasks: 3, completedTasks: 3, progressPct: 100 },
        { id: 'paused', name: 'Paused shop', status: 'PAUSED', updatedAt: '2026-10-17T12:00:00Z', totalTasks: 1, completedTasks: 0, progressPct: 0 },
        { id: 'draft', name: 'Draft idea', status: 'DRAFT', updatedAt: '2026-10-17T06:00:00Z', totalTasks: 0, completedTasks: 0, progressPct: 0 },
        ...projects,
      ]),
    };
    await renderPortal();
    expect(screen.getByRole('region', { name: 'Holiday landing page' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Finished rebuild' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open project\s+(Finished rebuild|Paused shop|Draft idea)/ })).toBeNull();
  });

  it('shows the project in focus with its stages, launch date and task progress', async () => {
    const user = userEvent.setup();
    await renderPortal();
    const project = screen.getByRole('region', { name: 'Holiday landing page' });
    expect(project).toHaveTextContent('Launch planned for');
    const stages = within(project).getByRole('list', { name: 'Project stages' });
    const current = within(stages).getAllByRole('listitem').find(item => item.getAttribute('aria-current') === 'step');
    expect(current).toHaveTextContent('Design & Dev');
    // An open review on this project is the client's OK to give.
    await waitFor(() => expect(current).toHaveTextContent('Needs your OK'));
    expect(project).toHaveTextContent('14 of 20 tasks done');

    await user.click(within(project).getByRole('button', { name: 'Open project Holiday landing page' }));
    expect(screen.getByRole('tab', { name: 'Projects (3)' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Project detail p1')).toBeInTheDocument();
  });

  it('lists other active projects but not launched ones', async () => {
    await renderPortal();
    expect(screen.getByRole('button', { name: /Open project\s+Care plan/ })).toBeInTheDocument();
    expect(screen.queryByText('Old site')).toBeNull();
  });

  it('shows the retainer hours on the indigo card', async () => {
    await renderPortal();
    const card = screen.getByRole('region', { name: '4h left this month' });
    expect(card).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(card).toHaveTextContent('6h of 10h used');
    expect(card).toHaveTextContent('60% of your monthly hours');
  });

  it('shows the three newest files across the latest projects', async () => {
    await renderPortal();
    const files = screen.getByRole('region', { name: 'Recent files' });
    await within(files).findByText('Holiday banners v2.pdf');
    expect(within(files).getAllByRole('listitem').map(item => item.firstChild.textContent)).toEqual([
      'Holiday banners v2.pdf', 'Page wireframe.png', 'Signed proposal.pdf',
    ]);
  });

  it('does not show a failed files request as an empty list', async () => {
    overrides = { '/projects/p2/documents': json({ error: 'nope' }, 500) };
    await renderPortal();
    const files = screen.getByRole('region', { name: 'Recent files' });
    expect(await within(files).findByText(/Recent files could not be loaded/)).toBeInTheDocument();
    expect(within(files).queryByText('No files shared yet.')).toBeNull();
  });

  it('previews the latest messages and opens that project’s conversation', async () => {
    const user = userEvent.setup();
    await renderPortal();
    const section = screen.getByRole('region', { name: 'Messages with Fixture Studio' });
    expect(await within(section).findByText('Hi Priya, the banners are up for review.')).toBeInTheDocument();
    expect(section).toHaveTextContent('Cameron Ashley');
    await user.click(within(section).getByRole('button', { name: 'Write a message' }));
    expect(screen.getByRole('tab', { name: 'Messages' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Chat for p1')).toBeInTheDocument();
  });

  it('shows outstanding money per currency, never added together', async () => {
    await renderPortal();
    expect(screen.getByText(`${fmt(1356, 'CAD')} · ${fmt(300, 'USD')}`)).toBeInTheDocument();
  });

  it('keeps the overdue banner with its link to the invoices', async () => {
    const user = userEvent.setup();
    await renderPortal();
    expect(screen.getByText('1 overdue invoice')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /View invoices.*that are overdue/ }));
    expect(screen.getByRole('tab', { name: 'Invoices (3)' })).toHaveAttribute('aria-selected', 'true');
  });
});
