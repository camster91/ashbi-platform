import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClient = vi.fn();
const getRetainerList = vi.fn();
const getClientActivity = vi.fn();
const updateClient = vi.fn();
const inviteClientToPortal = vi.fn();
const getTimeEntrySummary = vi.fn();
const getTimeEntries = vi.fn();
const getAttachments = vi.fn();
const getCredentials = vi.fn();
const auth = { user: { id: 'u1', role: 'ADMIN' } };

vi.mock('../lib/api', () => ({
  api: {
    getClient: (...args) => getClient(...args),
    getClientInsights: vi.fn(async () => null),
    getRetainerList: (...args) => getRetainerList(...args),
    getClientActivity: (...args) => getClientActivity(...args),
    updateClient: (...args) => updateClient(...args),
    inviteClientToPortal: (...args) => inviteClientToPortal(...args),
    getTimeEntrySummary: (...args) => getTimeEntrySummary(...args),
    getTimeEntries: (...args) => getTimeEntries(...args),
    getAttachments: (...args) => getAttachments(...args),
    getCredentials: (...args) => getCredentials(...args),
    attachmentFileUrl: (filename) => `/api/attachments/uploads/${filename}`,
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
// Staff panels have their own tests; here they only need to be present.
vi.mock('../components/ClientAccountManager', () => ({ default: () => <p>Account manager panel</p> }));
vi.mock('../components/ClientServicePanels', () => ({ default: () => <p>Saved reports panel</p> }));
vi.mock('../components/ClientCommunications', () => ({ default: () => <p>Stored messages panel</p> }));

const { default: Client } = await import('../pages/Client');

function client(overrides = {}) {
  return {
    id: 'c1', name: 'Acme Corporation With A Long Name', status: 'ACTIVE', createdAt: '2025-03-10T12:00:00Z',
    contacts: [], projects: [], threads: [],
    invoices: [{
      id: 'i1', invoiceNumber: 'INV-1', title: 'Care plan', status: 'SENT', total: 1130, amountPaid: 300, balanceDue: 830, currency: 'CAD', isOverdue: false,
    }],
    totalRevenue: 0, revenueByCurrency: {}, revenueCurrency: null,
    outstandingBalance: 830, outstandingCurrency: 'CAD', outstandingByCurrency: { CAD: 830 },
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.search}</output>;
}

function renderClient(path = '/client/c1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/client/:id" element={<><Client /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.user = { id: 'u1', role: 'ADMIN' };
  getClient.mockReset();
  getRetainerList.mockReset().mockResolvedValue([]);
  getClientActivity.mockReset().mockResolvedValue({ items: [], nextBefore: null });
  updateClient.mockReset();
  inviteClientToPortal.mockReset();
  getTimeEntrySummary.mockReset().mockResolvedValue({ byProject: [], byUser: null, totalMinutes: 0 });
  getTimeEntries.mockReset().mockResolvedValue({ entries: [], totals: {} });
  getAttachments.mockReset().mockResolvedValue([]);
  getCredentials.mockReset().mockResolvedValue([]);
});

describe('client page money', () => {
  it('shows the outstanding balance after payments, and the partly paid invoice', async () => {
    getClient.mockResolvedValue(client());
    renderClient();
    const numbers = await screen.findByRole('region', { name: 'Client numbers' });
    expect(within(numbers).getByText('Outstanding').nextSibling).toHaveTextContent('$830.00');
    expect(screen.queryByText('$1,130.00 outstanding')).not.toBeInTheDocument();
    expect(screen.getByText('Partly paid')).toBeInTheDocument();
    expect(screen.getByText('$830.00 left to pay')).toBeInTheDocument();
  });

  it('lists each currency apart when the client owes in several', async () => {
    getClient.mockResolvedValue(client({ outstandingBalance: null, outstandingCurrency: null, outstandingByCurrency: { CAD: 830, USD: 99 } }));
    renderClient();
    expect(await screen.findByText('$830.00 · US$99.00')).toBeInTheDocument();
  });

  it('works out how many days the client usually takes to pay', async () => {
    getClient.mockResolvedValue(client({
      invoices: [
        { id: 'a', invoiceNumber: 'INV-2', status: 'PAID', total: 100, amountPaid: 100, currency: 'CAD', sentAt: '2026-09-01T00:00:00Z', paidAt: '2026-09-05T00:00:00Z' },
        { id: 'b', invoiceNumber: 'INV-3', status: 'PAID', total: 100, amountPaid: 100, currency: 'CAD', issueDate: '2026-08-01T00:00:00Z', paidAt: '2026-08-07T00:00:00Z' },
        { id: 'c', invoiceNumber: 'INV-4', status: 'PAID', total: 100, amountPaid: 100, currency: 'CAD', sentAt: '2026-07-01T00:00:00Z', paidAt: '2026-07-21T00:00:00Z' },
      ],
    }));
    renderClient();
    const numbers = await screen.findByRole('region', { name: 'Client numbers' });
    expect(within(numbers).getByText('Usually pays in').nextSibling).toHaveTextContent('6 days');
  });

  it('shows the retainer card for this client only', async () => {
    getClient.mockResolvedValue(client());
    getRetainerList.mockResolvedValue([
      { id: 'r0', clientId: 'other', serviceDescription: 'Someone else', hoursPerMonth: 10, hoursUsed: 1, currency: 'CAD', monthlyAmountCad: 500 },
      { id: 'r1', clientId: 'c1', serviceDescription: 'Monthly care plan', hoursPerMonth: 20, hoursUsed: 4.5, currency: 'CAD', monthlyAmountCad: 1200, billingDay: 1, retainerStatus: 'ACTIVE' },
    ]);
    renderClient();
    const card = await screen.findByRole('region', { name: 'Monthly care plan' });
    expect(card).toHaveTextContent('$1,200.00 a month');
    expect(card).toHaveTextContent('4.5 of 20 hours used');
    expect(screen.queryByText('Someone else')).not.toBeInTheDocument();
  });
});

describe('client page layout', () => {
  it('lets the header wrap so the status stays on screen, with the full name as the heading', async () => {
    getClient.mockResolvedValue(client());
    renderClient();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Acme Corporation With A Long Name' });
    expect(heading.parentElement.className).toContain('min-w-0');
    expect(heading.closest('.flex-wrap')).not.toBeNull();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Client since March 2025/)).toBeInTheDocument();
    expect(screen.getByText('Bills in CAD')).toBeInTheDocument();
  });

  it('opens a tab from the address and keeps the choice in it', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client({
      projects: [
        { id: 'p1', name: 'Holiday landing page', status: 'DESIGN_DEV', health: 'ON_TRACK', _count: { tasks: 10, threads: 2 } },
        { id: 'p2', name: 'Old site', status: 'LAUNCHED', health: 'ON_TRACK', _count: { tasks: 3, threads: 0 } },
      ],
    }));
    renderClient('/client/c1?tab=projects&conversationId=x1');
    expect(await screen.findByRole('tab', { name: /Projects/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Old site/ })).toHaveAttribute('href', '/project/p2');

    await user.click(screen.getByRole('tab', { name: /Overview/ }));
    expect(screen.getByLabelText('location')).toHaveTextContent('?conversationId=x1');
    // Overview lists open projects only.
    expect(screen.getByRole('link', { name: /Holiday landing page/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Old site/ })).not.toBeInTheDocument();
    expect(screen.getByText('Account manager panel')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    expect(screen.getByLabelText('location')).toHaveTextContent('tab=invoices');
    expect(screen.getByRole('link', { name: 'INV-1' })).toHaveAttribute('href', '/invoices/i1');
  });

  it('shows team members no money and makes no retainer request', async () => {
    auth.user = { id: 'u2', role: 'TEAM' };
    getClient.mockResolvedValue(client());
    renderClient('/client/c1?tab=invoices');
    expect(await screen.findByRole('tab', { name: /Overview/, selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Invoices/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument();
    expect(screen.queryByText('INV-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New invoice/ })).not.toBeInTheDocument();
    expect(getRetainerList).not.toHaveBeenCalled();
    expect(screen.getByText('Account manager panel')).toBeInTheDocument();
  });
});

const projectsFixture = [
  { id: 'p1', name: 'Holiday landing page', status: 'DESIGN_DEV', _count: { tasks: 10, threads: 2 } },
  { id: 'p2', name: 'Old site', status: 'LAUNCHED', _count: { tasks: 3, threads: 0 } },
];

const MONEY_ITEMS = [
  { id: 'payment:pay1', kind: 'payment', at: '2026-10-03T09:00:00Z', title: 'INV-1036', amount: 1356, currency: 'CAD', method: 'STRIPE', href: '/invoices/i1' },
  { id: 'invoice-sent:i2', kind: 'invoice_sent', at: '2026-10-01T09:00:00Z', title: 'INV-1042', amount: 1356, currency: 'CAD', href: '/invoices/i2' },
];
const WORK_ITEMS = [
  { id: 'thread:t1', kind: 'conversation', at: '2026-10-16T09:00:00Z', title: 'Holiday banner sizes', project: { id: 'p1', name: 'Holiday landing page' }, href: '/thread/t1' },
  { id: 'activity:a1', kind: 'file', type: 'FILE_UPLOADED', at: '2026-10-15T09:00:00Z', title: 'banners.zip', actor: { id: 'u3', name: 'Bianca' }, project: { id: 'p1', name: 'Holiday landing page' }, href: '/project/p1' },
];

describe('client activity', () => {
  it('shows one timeline with conversations, project work and, for admins, payments; and pages back', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client());
    getClientActivity
      .mockResolvedValueOnce({ items: [...WORK_ITEMS, MONEY_ITEMS[0]], nextBefore: '2026-10-03T09:00:00.000Z' })
      .mockResolvedValueOnce({ items: [MONEY_ITEMS[1]], nextBefore: null });
    renderClient();
    const feed = await screen.findByRole('region', { name: 'Activity' });
    expect(await within(feed).findByRole('link', { name: /Holiday banner sizes/ })).toHaveAttribute('href', '/thread/t1');
    expect(within(feed).getByText('Bianca uploaded banners.zip')).toBeInTheDocument();
    expect(within(feed).getByText('Payment received on INV-1036')).toBeInTheDocument();
    expect(within(feed).getByText(/\$1,356\.00 by card \(Stripe\)/)).toBeInTheDocument();
    expect(getClientActivity).toHaveBeenCalledWith('c1', { limit: 8, before: undefined });

    await user.click(within(feed).getByRole('button', { name: 'Show older activity' }));
    expect(await within(feed).findByText('INV-1042 sent')).toBeInTheDocument();
    expect(getClientActivity).toHaveBeenLastCalledWith('c1', { limit: 8, before: '2026-10-03T09:00:00.000Z' });
    expect(within(feed).queryByRole('button', { name: 'Show older activity' })).not.toBeInTheDocument();
  });

  it('never shows invoice or payment items to team members, even if a response had them', async () => {
    auth.user = { id: 'u2', role: 'TEAM' };
    getClient.mockResolvedValue(client());
    getClientActivity.mockResolvedValue({ items: [...WORK_ITEMS, ...MONEY_ITEMS], nextBefore: null });
    renderClient();
    const feed = await screen.findByRole('region', { name: 'Activity' });
    expect(await within(feed).findByText('Bianca uploaded banners.zip')).toBeInTheDocument();
    expect(within(feed).queryByText(/INV-10/)).not.toBeInTheDocument();
    expect(within(feed).queryByText(/\$1,356/)).not.toBeInTheDocument();
  });

  it('says so when the activity cannot be loaded, with a retry', async () => {
    getClient.mockResolvedValue(client());
    getClientActivity.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }));
    renderClient();
    const feed = await screen.findByRole('region', { name: 'Activity' });
    expect(await within(feed).findByText('Activity could not be loaded')).toBeInTheDocument();
    expect(within(feed).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('client note', () => {
  it('adds a note from the header and shows it once saved', async () => {
    const user = userEvent.setup();
    let saved = null;
    getClient.mockImplementation(async () => client({ clientNotes: saved }));
    updateClient.mockImplementation(async (_id, data) => { saved = data.clientNotes; return { id: 'c1', clientNotes: saved }; });
    renderClient('/client/c1?tab=projects');
    await user.click(await screen.findByRole('button', { name: /Add note/ }));
    // Opening the note from another tab goes back to Overview, where it lives.
    expect(screen.getByRole('tab', { name: /Overview/, selected: true })).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Note' });
    expect(field).toHaveFocus();
    await user.type(field, '  Priya prefers short updates on Fridays.  ');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(updateClient).toHaveBeenCalledWith('c1', { clientNotes: 'Priya prefers short updates on Fridays.' });
    const note = await screen.findByRole('region', { name: 'Pinned note' });
    expect(within(note).getByText('Priya prefers short updates on Fridays.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
  });

  it('keeps the text and explains when saving fails', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client({ clientNotes: 'Old note' }));
    updateClient.mockRejectedValue(Object.assign(new Error('Request failed'), { status: 500 }));
    renderClient();
    const note = await screen.findByRole('region', { name: 'Pinned note' });
    await user.click(within(note).getByRole('button', { name: 'Edit pinned note' }));
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(field);
    await user.type(field, 'New note');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The note was not saved');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('New note');
  });

  it('will not save a note over the length limit, and clears an emptied note', async () => {
    const user = userEvent.setup();
    let saved = 'Old note';
    getClient.mockImplementation(async () => client({ clientNotes: saved }));
    updateClient.mockImplementation(async (_id, data) => { saved = data.clientNotes; return { id: 'c1', clientNotes: saved }; });
    renderClient();
    await user.click(await screen.findByRole('button', { name: /Edit note/ }));
    const field = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(field);
    await user.click(field);
    await user.paste('x'.repeat(10_001));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();

    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Clear note' }));
    expect(updateClient).toHaveBeenCalledWith('c1', { clientNotes: null });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pinned note' })).not.toBeInTheDocument());
  });
});

describe('client portal access', () => {
  it('invites a contact with the existing invitation flow and shows the result', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client({ contacts: [{ id: 'k1', name: 'Priya Shah', email: 'priya@northwind.example', isPrimary: true }] }));
    inviteClientToPortal.mockResolvedValue({ invitationId: 'inv1', email: 'priya@northwind.example', expiresAt: '2026-10-24T12:00:00Z', inviteLink: 'https://hub.example/client/invite?token=abc' });
    renderClient();
    await user.click(await screen.findByRole('button', { name: /Client portal/ }));
    const dialog = screen.getByRole('dialog', { name: 'Client portal' });
    await user.click(within(dialog).getByRole('button', { name: 'Invite Priya Shah (priya@northwind.example) to the portal' }));
    expect(inviteClientToPortal).toHaveBeenCalledWith('c1', 'priya@northwind.example');
    expect(await within(dialog).findByText('Invitation sent to priya@northwind.example')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Invitation link' })).toHaveValue('https://hub.example/client/invite?token=abc');
  });

  it('checks a typed address and shows why the server refused it', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client());
    inviteClientToPortal.mockRejectedValue(Object.assign(new Error('Active invitation already exists for this email'), { status: 400 }));
    renderClient();
    await user.click(await screen.findByRole('button', { name: /Client portal/ }));
    const dialog = screen.getByRole('dialog', { name: 'Client portal' });
    const email = within(dialog).getByRole('textbox', { name: 'Invite someone else' });
    await user.type(email, 'not-an-email');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(inviteClientToPortal).not.toHaveBeenCalled();
    expect(email).toHaveAttribute('aria-invalid', 'true');

    await user.clear(email);
    await user.type(email, 'marco@northwind.example');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(inviteClientToPortal).toHaveBeenCalledWith('c1', 'marco@northwind.example');
    expect(await within(dialog).findByText('Active invitation already exists for this email.')).toBeInTheDocument();
  });
});

describe('client time, files and logins', () => {
  it('shows this month\'s hours on this client\'s projects only, and the Time tab', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client({ projects: projectsFixture }));
    getTimeEntrySummary.mockResolvedValue({
      byProject: [
        { project: { id: 'p1', name: 'Holiday landing page' }, totalMinutes: 600, billableMinutes: 540, entries: 4 },
        { project: { id: 'p2', name: 'Old site' }, totalMinutes: 270, billableMinutes: 0, entries: 1 },
        { project: { id: 'other', name: 'Someone else' }, totalMinutes: 6000, billableMinutes: 6000, entries: 9 },
      ],
    });
    getTimeEntries.mockImplementation(async (projectId) => ({
      entries: projectId === 'p1'
        ? [{ id: 'e1', projectId: 'p1', description: 'Banner layouts', duration: 90, date: '2026-10-15T00:00:00Z', billable: true, hourlyRate: 150, user: { id: 'u3', name: 'Bianca' } }]
        : [],
    }));
    renderClient();
    const numbers = await screen.findByRole('region', { name: 'Client numbers' });
    const tile = within(numbers).getByText(/^Hours in /);
    await waitFor(() => expect(tile.nextSibling).toHaveTextContent('14.5 h'));
    const [range] = getTimeEntrySummary.mock.calls[0];
    expect(new Date(range.startDate).getDate()).toBe(1);

    await user.click(screen.getByRole('tab', { name: 'Time' }));
    expect(screen.getByLabelText('location')).toHaveTextContent('tab=time');
    expect(await screen.findByText('Banner layouts')).toBeInTheDocument();
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
    expect(screen.queryByText('Someone else')).not.toBeInTheDocument();
    expect(screen.queryByText(/150/)).not.toBeInTheDocument();
  });

  it('lists the files of the client\'s projects with download links', async () => {
    getClient.mockResolvedValue(client({ projects: projectsFixture }));
    getAttachments.mockImplementation(async (_type, projectId) => (projectId === 'p1'
      ? [{ id: 'f1', originalName: 'banners.zip', filename: 'stored-1.zip', size: 2048, createdAt: '2026-10-15T00:00:00Z', clientVisible: true, uploadedBy: { name: 'Bianca' } }]
      : [{ id: 'f2', originalName: 'old-logo.svg', filename: 'stored-2.svg', size: 512, createdAt: '2026-01-15T00:00:00Z', clientVisible: false, uploadedBy: { name: 'Cam' } }]));
    renderClient('/client/c1?tab=files');
    const download = await screen.findByRole('link', { name: 'Download banners.zip' });
    expect(download).toHaveAttribute('href', '/api/attachments/uploads/stored-1.zip');
    expect(screen.getByRole('link', { name: 'Download old-logo.svg' })).toBeInTheDocument();
    expect(getAttachments).toHaveBeenCalledWith('PROJECT', 'p1');
    expect(getAttachments).toHaveBeenCalledWith('PROJECT', 'p2');
    expect(screen.getByText('In the client portal')).toBeInTheDocument();
  });

  it('lists logins by name and address only, linking to the vault for secrets', async () => {
    getClient.mockResolvedValue(client());
    getCredentials.mockResolvedValue([{ id: 'cr1', label: 'Shopify admin', category: 'OTHER', url: 'https://northwind.myshopify.com/admin', username: 'priya@northwind.example', password: '********', notes: 'Backup code 123456', updatedAt: '2026-10-01T00:00:00Z' }]);
    renderClient('/client/c1?tab=logins');
    expect(await screen.findByText('Shopify admin')).toBeInTheDocument();
    expect(getCredentials).toHaveBeenCalledWith({ clientId: 'c1' });
    expect(screen.getByRole('link', { name: /northwind\.myshopify\.com/ })).toHaveAttribute('href', 'https://northwind.myshopify.com/admin');
    expect(screen.getByRole('link', { name: /Open in the vault/ })).toHaveAttribute('href', '/credentials?clientId=c1');
    expect(screen.queryByText(/priya@northwind\.example/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backup code/)).not.toBeInTheDocument();
    expect(screen.queryByText('********')).not.toBeInTheDocument();
  });

  it('gives team members Time and Files but no Logins, portal invitations or credentials request', async () => {
    auth.user = { id: 'u2', role: 'TEAM' };
    getClient.mockResolvedValue(client({ projects: projectsFixture }));
    renderClient('/client/c1?tab=logins');
    expect(await screen.findByRole('tab', { name: /Overview/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Time' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Logins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Client portal/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add note/ })).toBeInTheDocument();
    expect(screen.getByText(/^Your hours in /)).toBeInTheDocument();
    expect(getCredentials).not.toHaveBeenCalled();
    expect(inviteClientToPortal).not.toHaveBeenCalled();
  });
});
