import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatMoney } from '../lib/format';

const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../lib/api', () => ({
  api: {
    getProposal: vi.fn(),
    getProposals: vi.fn(),
    updateProposal: vi.fn(async () => ({})),
    sendProposal: vi.fn(async () => ({ emailSent: true })),
    resendProposal: vi.fn(async () => ({ emailSent: true })),
    duplicateProposal: vi.fn(async () => ({ id: 'prop-copy' })),
    createContractFromProposal: vi.fn(async () => ({})),
    createInvoiceFromProposal: vi.fn(async () => ({ id: 'inv-1' })),
  },
}));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));
vi.mock('../hooks/useAutosave', () => ({
  default: () => ({ draft: null, clearDraft: vi.fn(), status: 'idle' }),
}));

const { default: ProposalDetail, ProposalTitle } = await import('../pages/ProposalDetail');
const { api } = await import('../lib/api');

const SENT_AT = '2026-10-15T14:02:00.000Z';

function proposal(overrides = {}) {
  return {
    id: 'prop-1',
    title: 'Booking site',
    status: 'DRAFT',
    createdAt: '2026-10-14T12:00:00.000Z',
    validUntil: '2026-11-14T12:00:00.000Z',
    client: { id: 'c-lake', name: 'Lakeside Yoga' },
    createdBy: { name: 'Cameron' },
    viewToken: 'view-token-1',
    notes: 'A new WordPress site with class booking.',
    lineItems: [
      { id: 'li-1', description: 'Design and build', quantity: 1, unitPrice: 6500, total: 6500 },
      { id: 'li-2', description: 'Copywriting', quantity: 4, unitPrice: 150, total: 600 },
    ],
    subtotal: 7100,
    discount: 0,
    total: 7100,
    taxRate: 13,
    taxType: 'HST',
    tax: 923,
    totalWithTax: 8023,
    contract: null,
    ...overrides,
  };
}

const others = [
  { id: 'prop-1', title: 'Booking site', status: 'DRAFT', client: { name: 'Lakeside Yoga' } },
  { id: 'prop-2', title: 'Brand refresh', status: 'DRAFT', client: { name: 'Brightpath Law' } },
  { id: 'prop-3', title: 'Phase 2', status: 'SENT', client: { name: 'Harbour Hotel' } },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/proposal/prop-1']}>
        <LocationProbe />
        <Routes>
          <Route path="/proposal/:id" element={<ProposalDetail />} />
          <Route path="/invoices/:id" element={<p>Invoice page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const statusPanel = () => screen.getByRole('region', { name: 'Status' });

describe('Proposal page redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProposals.mockResolvedValue(others);
  });

  it('shows the mockup header, client view and status for a draft', async () => {
    api.getProposal.mockResolvedValue(proposal());
    renderDetail();

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Booking site for Lakeside Yoga');
    expect(within(heading).getByText('for Lakeside Yoga')).toHaveClass('font-display', 'italic');

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Proposals' })).toHaveAttribute('href', '/proposals');
    expect(within(crumbs).getByText('Lakeside Yoga')).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to Client' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument();

    const preview = screen.getByRole('article', { name: 'Client view of the proposal' });
    expect(within(preview).getByText('Proposal · For Lakeside Yoga')).toBeInTheDocument();
    expect(within(preview).getByText('Design and build')).toBeInTheDocument();
    expect(within(preview).getByText('HST (13%)')).toBeInTheDocument();
    expect(within(preview).getByText(formatMoney(8023))).toBeInTheDocument();
    expect(within(preview).getByText('Approve proposal')).toBeInTheDocument();
    // A picture of the client's button, not a control on this page.
    expect(within(preview).queryByRole('button', { name: 'Approve proposal' })).not.toBeInTheDocument();

    const steps = within(statusPanel()).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent(`Done: Drafted${formatDate('2026-10-14T12:00:00.000Z')} · by Cameron`);
    expect(steps[1]).toHaveTextContent('Next: Send to the client');
    expect(steps.at(-1)).toHaveTextContent('Next: Invoice the work');
  });

  it('lists the other proposals without the current one', async () => {
    api.getProposal.mockResolvedValue(proposal());
    renderDetail();
    const panel = await screen.findByRole('region', { name: 'Other proposals' });
    await within(panel).findByRole('link', { name: 'Brightpath Law · Brand refresh' });
    expect(within(panel).getByRole('link', { name: 'Harbour Hotel · Phase 2' })).toHaveAttribute('href', '/proposal/prop-3');
    expect(within(panel).queryByRole('link', { name: /Lakeside Yoga/ })).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'All proposals' })).toHaveAttribute('href', '/proposals');
    expect(api.getProposals).toHaveBeenCalledWith({});
  });

  it('offers a retry when the other proposals fail to load', async () => {
    api.getProposal.mockResolvedValue(proposal());
    api.getProposals.mockRejectedValueOnce(new Error('down')).mockResolvedValue(others);
    renderDetail();
    const panel = await screen.findByRole('region', { name: 'Other proposals' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Retry' }));
    expect(await within(panel).findByRole('link', { name: 'Harbour Hotel · Phase 2' })).toBeInTheDocument();
  });

  it('copies the client link and sends a reminder while the client decides', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    api.getProposal.mockResolvedValue(proposal({ status: 'VIEWED', sentAt: SENT_AT, deliveryStatus: 'DELIVERED' }));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/portal/proposal/view-token-1`));
    expect(toast.success).toHaveBeenCalledWith('Client link copied');

    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    await waitFor(() => expect(api.resendProposal).toHaveBeenCalledWith('prop-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Reminder sent', expect.any(String)));

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    const steps = within(statusPanel()).getAllByRole('listitem');
    expect(steps[1]).toHaveTextContent(`Done: Sent on ${formatDate(SENT_AT)}Email delivered`);
    expect(steps[2]).toHaveTextContent('Done: Opened by the client');
    expect(steps[3]).toHaveTextContent('Next: Client approves or declines');
  });

  it('reports a failed reminder and an undelivered email', async () => {
    api.getProposal.mockResolvedValue(proposal({ status: 'SENT', sentAt: SENT_AT, deliveryStatus: 'FAILED', deliveryFailed: true }));
    api.resendProposal.mockRejectedValueOnce(new Error('Primary client email is missing'));
    renderDetail();
    expect(await screen.findByText('Email not delivered')).toBeInTheDocument();
    expect(within(statusPanel()).getAllByRole('listitem')[1]).toHaveTextContent('Stopped: Sent on');
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to send reminder', 'Primary client email is missing'));
  });

  it('says when sending did not email the client', async () => {
    api.getProposal.mockResolvedValue(proposal());
    api.sendProposal.mockResolvedValueOnce({ emailSent: false });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Client' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Proposal marked as sent', expect.stringContaining('Copy the client link')));
  });

  it('shows the signed contract and invoicing once approved', async () => {
    api.getProposal.mockResolvedValue(proposal({
      status: 'APPROVED',
      sentAt: SENT_AT,
      approvedAt: '2026-10-17T12:00:00.000Z',
      contract: { id: 'ctr-1', status: 'SIGNED', signedAt: '2026-10-18T12:00:00.000Z', clientSigName: 'Ana Reyes' },
    }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Invoice' }));
    expect(screen.queryByRole('button', { name: 'Generate Contract' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();

    const preview = screen.getByRole('article', { name: 'Client view of the proposal' });
    expect(within(preview).queryByText('Approve proposal')).not.toBeInTheDocument();
    expect(within(preview).getByText(/The client approved this proposal on/)).toBeInTheDocument();

    const steps = within(statusPanel()).getAllByRole('listitem');
    expect(steps[3]).toHaveTextContent(`Done: Approved on ${formatDate('2026-10-17T12:00:00.000Z')}`);
    expect(steps[4]).toHaveTextContent(`Done: Contract signed${formatDate('2026-10-18T12:00:00.000Z')} · by Ana Reyes`);
    expect(await screen.findByText('Invoice page')).toBeInTheDocument();
  });

  it('points a drafted contract to Contracts for e-signature', async () => {
    api.getProposal.mockResolvedValue(proposal({ status: 'APPROVED', approvedAt: '2026-10-17T12:00:00.000Z', contract: { id: 'ctr-1', status: 'DRAFT' } }));
    renderDetail();
    await screen.findByRole('button', { name: 'Create Invoice' });
    const contractStep = within(statusPanel()).getAllByRole('listitem')[4];
    expect(contractStep).toHaveTextContent('In progress: Contract drafted');
    expect(within(contractStep).getByRole('link', { name: 'Open Contracts' })).toHaveAttribute('href', '/contracts');
  });

  it('duplicates a declined proposal and opens the copy', async () => {
    api.getProposal.mockResolvedValue(proposal({ status: 'DECLINED', sentAt: SENT_AT, declinedAt: '2026-10-16T12:00:00.000Z' }));
    renderDetail();
    const preview = await screen.findByRole('article', { name: 'Client view of the proposal' });
    expect(within(preview).getByText(/The client declined this proposal/)).toBeInTheDocument();
    const steps = within(statusPanel()).getAllByRole('listitem');
    expect(steps.at(-1)).toHaveTextContent('Stopped: Declined on');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/proposal/prop-copy'));
  });

  it('edits a draft with labelled fields and saves what it shows', async () => {
    api.getProposal.mockResolvedValue(proposal({ taxRate: 0, tax: 0, totalWithTax: 7100 }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const editor = screen.getByRole('region', { name: 'Edit proposal' });
    expect(within(editor).getByLabelText('Title')).toHaveValue('Booking site');
    fireEvent.change(within(editor).getByLabelText('Line 2 unit price'), { target: { value: '200' } });
    fireEvent.change(within(editor).getByLabelText('Discount'), { target: { value: '100' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Add line item' }));
    fireEvent.change(within(editor).getByLabelText('Line 3 description'), { target: { value: 'Care plan' } });
    fireEvent.change(within(editor).getByLabelText('Line 3 unit price'), { target: { value: '250' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Remove line 1' }));
    // 4 x 200 + 1 x 250 - 100
    expect(within(editor).getByText(formatMoney(950))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateProposal).toHaveBeenCalledWith('prop-1', {
      title: 'Booking site',
      notes: 'A new WordPress site with class booking.',
      discount: 100,
      lineItems: [
        { description: 'Copywriting', quantity: 4, unitPrice: 200 },
        { description: 'Care plan', quantity: 1, unitPrice: 250 },
      ],
    }));
  });

  it('shortens a long overview until asked', async () => {
    const notes = `${'Scope paragraph. '.repeat(60)}The end.`;
    api.getProposal.mockResolvedValue(proposal({ notes }));
    renderDetail();
    const toggle = await screen.findByRole('button', { name: 'Show the full text' });
    expect(screen.queryByText(/The end\./)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(/The end\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('ProposalTitle', () => {
  it('accents the client name inside a title that already names it', () => {
    render(<h1><ProposalTitle title="Website for lakeside yoga studio" clientName="Lakeside Yoga" /></h1>);
    expect(screen.getByRole('heading')).toHaveTextContent('Website for lakeside yoga studio');
    expect(screen.getByText('lakeside yoga')).toHaveClass('font-display');
  });

  it('shows the plain title without a client', () => {
    render(<h1><ProposalTitle title="Retainer" clientName="" /></h1>);
    expect(screen.getByRole('heading')).toHaveTextContent(/^Retainer$/);
  });
});
