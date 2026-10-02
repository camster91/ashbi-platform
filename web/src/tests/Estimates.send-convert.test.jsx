import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getEstimates: vi.fn(),
  sendEstimate: vi.fn(),
  convertEstimate: vi.fn(),
  reissueEstimateLink: vi.fn(),
  createEstimate: vi.fn(),
  updateEstimate: vi.fn(),
  deleteEstimate: vi.fn(),
};
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [{ id: 'c1', name: 'Acme' }] }) }));
vi.mock('../hooks/useAutosave', () => ({
  default: () => ({ draft: null, clearDraft: vi.fn(), status: 'idle', setDraft: vi.fn(), discardDraft: vi.fn(), saveNow: vi.fn() }),
}));

const { default: Estimates, estimateSendOutcome, estimateLinkUsable, estimateClientLink } = await import('../pages/Estimates');

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const base = { clientId: 'c1', client: { id: 'c1', name: 'Acme' }, lineItems: [], subtotal: 1500, tax: 75, taxRate: 5, total: 1575, createdAt: '2026-09-01T00:00:00.000Z' };
const draft = { ...base, id: 'e-draft', title: 'Draft estimate', status: 'DRAFT', viewToken: 'placeholder' };
const sent = { ...base, id: 'e-sent', title: 'Sent estimate', status: 'SENT', viewToken: 'sent-token', publicAccessExpiresAt: FUTURE, publicAccessRevokedAt: null };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Estimates />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Each estimate renders a mobile and a desktop card; the desktop one is the
// second match.
async function cardFor(title) {
  const matches = await screen.findAllByText(title);
  return matches[matches.length - 1].closest('.hidden, .sm\\:flex') || matches[matches.length - 1].parentElement.parentElement.parentElement;
}

describe('estimate send outcome', () => {
  it('only claims an email went out when it did', () => {
    expect(estimateSendOutcome({ emailStatus: 'SENT' })).toMatchObject({ type: 'success', offerLink: false });
    expect(estimateSendOutcome({ emailStatus: 'NO_CLIENT_EMAIL' })).toMatchObject({ type: 'warning', offerLink: true, message: expect.stringMatching(/no email address/) });
    expect(estimateSendOutcome({ emailStatus: 'EMAIL_NOT_CONFIGURED' })).toMatchObject({ type: 'warning', message: expect.stringMatching(/Email is not set up/) });
    expect(estimateSendOutcome({ emailStatus: 'FAILED' })).toMatchObject({ type: 'warning', title: expect.stringMatching(/email failed/) });
    for (const status of ['NO_CLIENT_EMAIL', 'EMAIL_NOT_CONFIGURED', 'FAILED']) {
      expect(estimateSendOutcome({ emailStatus: status }).message).not.toMatch(/will receive an email/);
    }
  });

  it('builds the client link and knows when it lapsed', () => {
    expect(estimateClientLink(sent, 'https://hub.test')).toBe('https://hub.test/portal/estimate/sent-token');
    expect(estimateClientLink(draft, 'https://hub.test')).toBeNull();
    // The server's link (its hub URL) wins over the browser origin.
    expect(estimateClientLink({ ...sent, clientLink: 'https://hub.ashbi.ca/portal/estimate/sent-token' }, 'http://localhost:5173'))
      .toBe('https://hub.ashbi.ca/portal/estimate/sent-token');
    expect(estimateLinkUsable(sent)).toBe(true);
    expect(estimateLinkUsable({ ...sent, publicAccessRevokedAt: '2026-09-01T00:00:00.000Z' })).toBe(false);
    expect(estimateLinkUsable({ ...sent, publicAccessExpiresAt: '2020-01-01T00:00:00.000Z' })).toBe(false);
  });
});

describe('Estimates page', () => {
  let writeText;
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    Object.values(toast).forEach((fn) => fn.mockReset());
    api.getEstimates.mockResolvedValue({ estimates: [draft, sent] });
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => { delete navigator.clipboard; });

  it('says plainly that a sent estimate was not emailed and offers the client link', async () => {
    api.sendEstimate.mockResolvedValue({
      ...draft, status: 'SENT', viewToken: 'fresh-token', publicAccessExpiresAt: FUTURE, emailSent: false, emailStatus: 'NO_CLIENT_EMAIL',
      clientLink: 'https://hub.ashbi.test/portal/estimate/fresh-token',
    });
    renderPage();
    const card = await cardFor('Draft estimate');
    fireEvent.click(within(card).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [options] = toast.warning.mock.calls[0];
    expect(options.title).toBe('Estimate marked as sent, but not emailed');
    expect(options.message).toMatch(/no email address/);
    expect(options.action.label).toBe('Copy client link');
    expect(toast.success).not.toHaveBeenCalled();

    await options.action.onClick();
    expect(writeText).toHaveBeenCalledWith('https://hub.ashbi.test/portal/estimate/fresh-token');
  });

  it('offers Copy client link and Convert to proposal on a sent estimate', async () => {
    renderPage();
    const card = await cardFor('Sent estimate');
    fireEvent.click(within(card).getByRole('button', { name: 'Copy client link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/portal/estimate/sent-token`));
    expect(toast.success).toHaveBeenCalledWith('Client link copied', expect.any(String));
    expect(within(card).getByRole('button', { name: 'Convert to proposal' })).toBeInTheDocument();
    // A draft has neither.
    const draftCard = await cardFor('Draft estimate');
    expect(within(draftCard).queryByRole('button', { name: 'Copy client link' })).not.toBeInTheDocument();
    expect(within(draftCard).queryByRole('button', { name: 'Convert to proposal' })).not.toBeInTheDocument();
  });

  it('issues a fresh link before copying when the old one lapsed', async () => {
    api.getEstimates.mockResolvedValue({ estimates: [{ ...sent, publicAccessExpiresAt: '2020-01-01T00:00:00.000Z' }] });
    api.reissueEstimateLink.mockResolvedValue({ id: 'e-sent', viewToken: 'reissued-token' });
    renderPage();
    const card = await cardFor('Sent estimate');
    fireEvent.click(within(card).getByRole('button', { name: 'Copy client link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/portal/estimate/reissued-token`));
    expect(api.reissueEstimateLink).toHaveBeenCalledWith('e-sent');
  });

  it('asks before converting a sent estimate the client has not answered', async () => {
    api.convertEstimate.mockResolvedValue({ proposal: { id: 'p1' }, estimateId: 'e-sent' });
    renderPage();
    const card = await cardFor('Sent estimate');
    fireEvent.click(within(card).getByRole('button', { name: 'Convert to proposal' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/has not answered/);
    expect(api.convertEstimate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert to proposal' }));
    await waitFor(() => expect(api.convertEstimate).toHaveBeenCalledWith('e-sent'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ label: 'Open proposal' }) })));
  });

  it('labels the search and the form fields', async () => {
    renderPage();
    expect(await screen.findByLabelText('Search estimates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Estimate' }));
    for (const label of ['Client *', 'Title *', 'Description', 'Valid Until', 'Tax Rate (%)']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // One set of line-item inputs is rendered, so no hidden required duplicate.
    expect(screen.getAllByPlaceholderText('Item description')).toHaveLength(1);
  });
});
