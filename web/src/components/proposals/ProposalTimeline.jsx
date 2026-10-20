import { Link } from 'react-router-dom';
import { Card } from '../ui';
import { formatDate } from '../../lib/format';
import { cn } from '../../lib/utils';

// The proposal's path from draft to invoice (design: Proposals mockup,
// "Status"). Each step is done, current (waiting on someone), stopped
// (declined or voided) or next. The state is said in words for screen
// readers; the dot only repeats it.

const STATE_WORDS = { done: 'Done', current: 'In progress', stopped: 'Stopped', next: 'Next' };

const DELIVERY_DETAIL = {
  ACCEPTED: 'Email accepted for delivery',
  DELIVERED: 'Email delivered',
  FAILED: 'The email was not delivered. Copy the client link to share it.',
  BOUNCED: 'The email bounced. Copy the client link to share it.',
  COMPLAINED: 'The client marked the email as spam',
};

function contractStep(proposal) {
  const contract = proposal.contract;
  const approved = proposal.status === 'APPROVED';
  if (!contract) {
    return {
      key: 'contract',
      state: 'next',
      title: 'Contract signed',
      detail: approved
        ? 'Generate the contract to send it for e-signature.'
        : 'Approval drafts a contract for the client to e-sign.',
    };
  }
  if (contract.status === 'SIGNED') {
    const signedAt = contract.signedAt || contract.clientSigDate;
    return {
      key: 'contract',
      state: 'done',
      title: 'Contract signed',
      detail: [signedAt && formatDate(signedAt), contract.clientSigName && `by ${contract.clientSigName}`].filter(Boolean).join(' · '),
    };
  }
  if (contract.status === 'VOID') {
    return { key: 'contract', state: 'stopped', title: 'Contract voided', detail: 'Open Contracts to draft a new one.', link: true };
  }
  if (contract.status === 'SENT') {
    return { key: 'contract', state: 'current', title: 'Contract sent for e-signature', detail: 'Waiting for the client to sign.', link: true };
  }
  return { key: 'contract', state: 'current', title: 'Contract drafted', detail: 'Send it from Contracts for e-signature.', link: true };
}

/** The ordered steps shown in the Status panel. */
export function proposalTimeline(proposal) {
  const { status } = proposal;
  const steps = [];

  steps.push({
    key: 'drafted',
    state: 'done',
    title: proposal.aiGenerated ? 'Drafted with AI' : 'Drafted',
    detail: [formatDate(proposal.createdAt), proposal.createdBy?.name && `by ${proposal.createdBy.name}`].filter(Boolean).join(' · '),
  });

  if (status === 'DRAFT') {
    steps.push({ key: 'sent', state: 'next', title: 'Send to the client', detail: 'They get a link to review and approve it.' });
  } else {
    steps.push({
      key: 'sent',
      state: proposal.deliveryFailed ? 'stopped' : 'done',
      title: proposal.sentAt ? `Sent on ${formatDate(proposal.sentAt)}` : 'Sent',
      detail: DELIVERY_DETAIL[proposal.deliveryStatus] || (proposal.sentToEmail ? `To ${proposal.sentToEmail}` : ''),
    });
  }

  const opened = ['VIEWED', 'APPROVED', 'DECLINED'].includes(status);
  steps.push(opened
    ? { key: 'viewed', state: 'done', title: 'Opened by the client' }
    : { key: 'viewed', state: 'next', title: 'Client opens the link' });

  if (status === 'APPROVED') {
    steps.push({ key: 'decision', state: 'done', title: proposal.approvedAt ? `Approved on ${formatDate(proposal.approvedAt)}` : 'Approved' });
  } else if (status === 'DECLINED') {
    steps.push({
      key: 'decision',
      state: 'stopped',
      title: proposal.declinedAt ? `Declined on ${formatDate(proposal.declinedAt)}` : 'Declined',
      detail: 'Duplicate it to send a revised version.',
    });
  } else {
    steps.push({ key: 'decision', state: 'next', title: 'Client approves or declines' });
  }

  if (status !== 'DECLINED') {
    steps.push(contractStep(proposal));
    steps.push({
      key: 'invoice',
      state: 'next',
      title: 'Invoice the work',
      detail: status === 'APPROVED'
        ? 'Create Invoice makes it, or opens the one already made.'
        : 'Created from this proposal once it is approved.',
    });
  }

  return steps;
}

const dotClass = {
  done: 'bg-success',
  current: 'bg-warning',
  stopped: 'bg-destructive',
  next: 'border-2 border-muted-foreground/70',
};

export default function ProposalTimeline({ proposal }) {
  const steps = proposalTimeline(proposal);
  return (
    <Card as="section" padding="none" className="rounded-lg p-5" aria-labelledby="proposal-status-heading">
      <h2 id="proposal-status-heading" className="text-lg font-semibold tracking-tight text-foreground">Status</h2>
      <ol className="mt-2.5 flex flex-col">
        {steps.map((step) => (
          <li key={step.key} className="flex gap-2.5 py-2">
            <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dotClass[step.state])} />
            <span className="sr-only">{STATE_WORDS[step.state]}: </span>
            <div className="min-w-0">
              <div className={cn('break-words', step.state === 'next' ? 'text-muted-foreground' : 'text-foreground')}>{step.title}</div>
              {step.detail && <div className="text-xs text-muted-foreground break-words">{step.detail}</div>}
              {step.link && (
                <Link
                  to="/contracts"
                  className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Open Contracts
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
