import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PortalContract from '../pages/PortalContract';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPortalContract: vi.fn(),
    signPortalContract: vi.fn(),
  },
}));

function contract(overrides = {}) {
  return {
    id: 'contract-1',
    title: 'AI systems implementation agreement',
    status: 'SENT',
    content: '<h2>Implementation terms</h2><p>Verified public contract content.</p>',
    templateType: 'PROJECT',
    client: { id: 'client-1', name: 'Example Client', email: 'client@example.test' },
    proposal: { id: 'proposal-1', title: 'AI workflow implementation', total: 1000 },
    createdBy: { name: 'Cameron Ashley' },
    signedAt: null,
    clientSigName: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

function renderContract() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/portal/contract/test-token']}>
        <Routes><Route path="/portal/contract/:token" element={<PortalContract />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('portal contract public evidence', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      clearRect: vi.fn(),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the exact public client, content, preparation date, and related proposal', async () => {
    api.getPortalContract.mockResolvedValue(contract({
      clientName: 'Stale Client',
      htmlContent: '<p>Stale fallback content.</p>',
    }));
    renderContract();

    expect(await screen.findByText('Example Client')).toBeInTheDocument();
    expect(screen.queryByText('Stale Client')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Implementation terms' })).toBeInTheDocument();
    expect(screen.getByText('Verified public contract content.')).toBeInTheDocument();
    expect(screen.queryByText('Stale fallback content.')).not.toBeInTheDocument();
    expect(screen.getByText(/Prepared Aug 20/)).toBeInTheDocument();
    expect(screen.getByText(/Related proposal: AI workflow implementation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Contract' })).toBeEnabled();
  });

  it('renders the recorded public signer and withholds signing outside the sent state', async () => {
    api.getPortalContract.mockResolvedValue(contract({
      status: 'SIGNED',
      signedAt: '2026-08-22T12:00:00.000Z',
      clientSigName: 'Jane Example',
      signerName: 'Stale Signer',
    }));
    renderContract();

    const signedHeading = await screen.findByText('Contract Signed');
    expect(signedHeading.closest('[role="status"]')).toHaveTextContent('by Jane Example');
    expect(screen.queryByText('Stale Signer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign Contract' })).not.toBeInTheDocument();
  });

  it('fails closed when an unexpected non-sent contract reaches the portal', async () => {
    api.getPortalContract.mockResolvedValue(contract({ status: 'DRAFT' }));
    renderContract();

    expect(await screen.findByRole('alert')).toHaveTextContent('This contract is not currently available for signature.');
    expect(screen.queryByRole('button', { name: 'Sign Contract' })).not.toBeInTheDocument();
  });
});
