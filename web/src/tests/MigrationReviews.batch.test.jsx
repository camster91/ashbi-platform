import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MigrationReviews from '../pages/MigrationReviews';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getMigrationReviewPackets: vi.fn(),
    recordMigrationReviewDecision: vi.fn(),
    exportMigrationReviewDecision: vi.fn(),
    importProjectLinkReview: vi.fn(),
    importTaskDispositionReview: vi.fn(),
    importProjectDispositionReview: vi.fn(),
    importFinancialExceptionReview: vi.fn(),
    importActiveProjectOutcomeReview: vi.fn(),
  },
}));

function reviewPacket() {
  return {
    id: 'packet-1',
    kind: 'NOTION_BONSAI_PROJECT_LINK',
    generation: 1,
    generationCount: 1,
    sourcePreparedAt: '2026-08-28T01:02:00.000Z',
    sourceReviewSha256: 'a'.repeat(64),
    superseded: false,
    summary: { approved: 0, rejected: 0, pending: 2 },
    candidates: [
      {
        candidateId: 'project-link:exact:1',
        decision: 'PENDING',
        recommendation: 'APPROVAL_READY',
        reasonCode: 'EXACT_UNIQUE_PROJECT_TITLE',
        tier: 'EXACT_TITLE',
        risk: 'LOW',
        notionProject: 'Project A',
        notionStatus: 'Active',
        bonsaiProject: 'Project A',
        bonsaiStatus: 'active',
      },
      {
        candidateId: 'project-link:blocked:2',
        decision: 'PENDING',
        recommendation: 'APPROVAL_READY',
        reasonCode: 'LIVE_EVIDENCE_STRENGTHENED',
        tier: 'SUGGESTED',
        risk: 'HIGH',
        notionProject: 'Project B',
        notionStatus: 'Active',
        bonsaiProject: 'Possible Project B',
        bonsaiStatus: 'active',
      },
    ],
  };
}

describe('Migration review batch approvals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const packet = reviewPacket();
    api.getMigrationReviewPackets.mockResolvedValue({ packets: [packet] });
    api.recordMigrationReviewDecision.mockResolvedValue({
      packet: {
        ...packet,
        summary: { approved: 1, rejected: 0, pending: 1 },
        candidates: packet.candidates.map(candidate => candidate.candidateId === 'project-link:exact:1'
          ? { ...candidate, decision: 'APPROVED' }
          : candidate),
      },
    });
  });

  it('selects only approval-ready visible candidates and requires accessible confirmation', async () => {
    render(<MigrationReviews />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select low/medium approval-ready' }));
    expect(screen.getByRole('button', { name: 'Approve selected (1)' })).toBeEnabled();
    expect(screen.getByLabelText('Select Project A')).toBeChecked();
    expect(screen.queryByLabelText('Select Project B')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' }));
    expect(api.recordMigrationReviewDecision).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Approve 1 selected candidate?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve 1' }));
    await waitFor(() => expect(api.recordMigrationReviewDecision).toHaveBeenCalledWith(
      'packet-1',
      'project-link:exact:1',
      expect.objectContaining({ decision: 'APPROVED', reviewNote: null }),
    ));
    expect(await screen.findByText(
      (_, element) => element?.textContent === '1 approved · 0 rejected · 1 pending',
      { selector: 'p' },
    )).toBeInTheDocument();
  });

  it.each([
    {
      kind: 'NOTION_BONSAI_TASK_DISPOSITION',
      heading: 'Task disposition review',
      candidate: { candidateId: 'task-disposition:1', title: 'Example task', project: 'Example project' },
    },
    {
      kind: 'NOTION_BONSAI_PROJECT_DISPOSITION',
      heading: 'Project disposition review',
      candidate: { candidateId: 'project-disposition:1', project: 'Example project', company: 'Example Client' },
    },
    {
      kind: 'BONSAI_ACTIVE_PROJECT_OUTCOME',
      heading: 'Active project outcome review',
      candidate: { candidateId: 'active-project-outcome:1', project: 'Example project', company: 'Example Client', taskCount: 1 },
    },
    {
      kind: 'BONSAI_FINANCIAL_EXCEPTION',
      heading: 'Financial exception review',
      candidate: {
        candidateId: 'financial-exception:invoice:1',
        exceptionKind: 'NON_PAID_INVOICE',
        sourceId: 'invoice-1',
        invoiceNumber: 'INV-001',
        company: 'Example Client',
        status: 'draft',
        amount: 100,
        currency: 'CAD',
      },
    },
  ])('does not offer batch approval for $heading', async ({ kind, heading, candidate }) => {
    const packet = {
      ...reviewPacket(),
      id: `${kind.toLowerCase()}-packet-1`,
      kind,
      candidates: [{
        ...candidate,
        decision: 'PENDING',
        recommendation: 'APPROVAL_READY',
        reasonCode: 'EVIDENCE_REVIEW_READY',
      }],
      summary: { approved: 0, rejected: 0, pending: 1 },
    };
    api.getMigrationReviewPackets.mockResolvedValue({ packets: [packet] });

    render(<MigrationReviews />);

    await screen.findByRole('heading', { name: heading });
    expect(screen.queryByRole('button', { name: 'Select low/medium approval-ready' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve selected (0)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve recommendation' })).toBeEnabled();
  });
});
