import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';
import { Button, EmptyState, LoadingState } from './ui';

// AI approvals (#413 slice 2, docs/ai-tool-registry.md): actions an AI caller
// prepared (the ChatGPT/Codex bridge or an assistant) wait here until a person
// approves or rejects them, and every decided action keeps an immutable
// receipt. Admins see the whole workspace; others see their own actions. The
// server asks for step-up re-authentication, which ReauthDialog handles.

const PENDING_KEY = ['ai-tool-approvals'];
const RECEIPTS_KEY = ['ai-tool-receipts'];

const TOOL_LABELS = {
  create_task: 'Create task',
  create_calendar_event: 'Create calendar event',
  send_slack_message: 'Post to Slack',
};

const REJECT_REASONS = [
  ['not_needed', 'Not needed'],
  ['incorrect', 'Incorrect'],
  ['unsafe', 'Unsafe'],
  ['other', 'Other'],
];

const RECEIPT_FILTERS = [
  ['', 'All'],
  ['EXECUTED', 'Executed'],
  ['FAILED', 'Failed'],
  ['REJECTED', 'Rejected'],
  ['EXPIRED', 'Expired'],
];

const selectClass = 'px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function toolLabel(tool) {
  return TOOL_LABELS[tool] || String(tool || '').replace(/_/g, ' ');
}

/** One line describing what the action will do, from its preview. */
export function describePreview(preview) {
  if (!preview || typeof preview !== 'object') return '';
  const project = preview.project?.name ? ` in ${preview.project.name}` : '';
  if (preview.kind === 'send_slack_message') {
    return `“${preview.text}” to #${preview.mapping?.name ?? 'channel'}${project}${preview.replyTo ? ' (thread reply)' : ''}`;
  }
  if (preview.title) return `“${preview.title}”${project}`;
  return project.trim();
}

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function receiptStatus(receipt) {
  if (receipt.status === 'FAILED' && receipt.outcome === 'unknown') return 'Failed (delivery unknown — check before redoing)';
  return receipt.status.charAt(0) + receipt.status.slice(1).toLowerCase();
}

function PendingItem({ action, onDecided }) {
  const reasonId = useId();
  const [reason, setReason] = useState('not_needed');
  const label = `${toolLabel(action.tool)}: ${describePreview(action.preview)}`;
  const approve = useMutation({ mutationFn: () => api.approveAiToolAction(action.id), onSuccess: onDecided });
  const reject = useMutation({ mutationFn: () => api.rejectAiToolAction(action.id, reason), onSuccess: onDecided });
  const busy = approve.isPending || reject.isPending;
  const error = approve.error || reject.error;
  return (
    <li className="rounded-lg border border-border p-3 space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{toolLabel(action.tool)}</p>
        <p className="text-sm text-muted-foreground break-words">{describePreview(action.preview)}</p>
        <p className="text-xs text-muted-foreground">
          Requested by {action.requesterName || 'a team member'}
          {action.source === 'assistant' ? ' via the assistant' : ' via the AI bridge'}
          {' · '}
          {action.expired ? 'Expired' : `Expires ${formatWhen(action.expiresAt)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => approve.mutate()} disabled={busy || action.expired} aria-label={`Approve ${label}`}>
          Approve
        </Button>
        <label htmlFor={reasonId} className="sr-only">Reason for rejecting</label>
        <select id={reasonId} className={selectClass} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy}>
          {REJECT_REASONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => reject.mutate()} disabled={busy} aria-label={`Reject ${label}`}>
          Reject
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message || 'The action could not be updated.'}</p>}
    </li>
  );
}

export default function AiApprovals() {
  const queryClient = useQueryClient();
  const filterId = useId();
  const [status, setStatus] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const pending = useQuery({ queryKey: PENDING_KEY, queryFn: () => api.getAiToolApprovals() });
  const receipts = useQuery({ queryKey: [...RECEIPTS_KEY, status], queryFn: () => api.getAiToolReceipts({ status, limit: 25 }) });

  const onDecided = (data) => {
    const receipt = data?.action;
    setAnnouncement(receipt ? `${toolLabel(receipt.tool)} ${receiptStatus(receipt).toLowerCase()}.` : 'Action updated.');
    queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    queryClient.invalidateQueries({ queryKey: RECEIPTS_KEY });
  };

  const approvals = pending.data?.approvals ?? [];
  const receiptRows = receipts.data?.receipts ?? [];

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <section aria-labelledby="ai-approvals-pending-heading" className="space-y-2">
        <h3 id="ai-approvals-pending-heading" className="text-sm font-semibold text-foreground">Waiting for approval</h3>
        {pending.isLoading && <LoadingState compact label="Loading pending actions…" />}
        {pending.error && <QueryErrorState error={pending.error} onRetry={() => pending.refetch()} />}
        {!pending.isLoading && !pending.error && approvals.length === 0 && (
          <EmptyState title="Nothing to approve" description="Actions an AI prepares appear here before anything changes." />
        )}
        {approvals.length > 0 && (
          <ul className="space-y-2">
            {approvals.map((action) => <PendingItem key={action.id} action={action} onDecided={onDecided} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="ai-approvals-receipts-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="ai-approvals-receipts-heading" className="text-sm font-semibold text-foreground">Receipts</h3>
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-xs text-muted-foreground">Status</label>
            <select id={filterId} className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
              {RECEIPT_FILTERS.map(([value, text]) => <option key={value || 'all'} value={value}>{text}</option>)}
            </select>
          </div>
        </div>
        {receipts.isLoading && <LoadingState compact label="Loading receipts…" />}
        {receipts.error && <QueryErrorState error={receipts.error} onRetry={() => receipts.refetch()} />}
        {!receipts.isLoading && !receipts.error && receiptRows.length === 0 && (
          <p className="text-sm text-muted-foreground">No receipts yet.</p>
        )}
        {receiptRows.length > 0 && (
          <ul className="divide-y divide-border">
            {receiptRows.map((receipt) => (
              <li key={receipt.id} className="py-2 text-sm">
                <p className="font-medium text-foreground">
                  {toolLabel(receipt.tool)} — {receiptStatus(receipt)}
                </p>
                <p className="text-muted-foreground break-words">{describePreview(receipt.preview)}</p>
                <p className="text-xs text-muted-foreground">
                  Requested by {receipt.requesterName || 'a team member'}
                  {receipt.approverId ? (receipt.approvalEvidence?.requesterApproved ? ' · approved by the requester' : ' · decided by another user') : ''}
                  {receipt.errorCode ? ` · ${receipt.errorCode}` : ''}
                  {' · '}
                  {formatWhen(receipt.executedAt || receipt.rejectedAt || receipt.confirmedAt || receipt.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
