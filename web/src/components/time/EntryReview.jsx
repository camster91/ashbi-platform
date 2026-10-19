import { useState } from 'react';
import { Button } from '../ui';
import { cn } from '../../lib/utils';
import { dayLabel, formatHours, isPending, spokenHours } from './timesheetWeek';

/**
 * Approve or reject one time entry. Only admins get the buttons (the API
 * also refuses everyone else); a rejection needs a reason.
 */
export function ReviewActions({ entry, canReview, review }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const busy = review.busyId === entry.id;
  const label = entry.description || entry.task?.title || entry.project?.name || 'time entry';

  if (entry.reviewStatus === 'APPROVED') return <span className="text-sm font-semibold text-success">Approved</span>;
  if (entry.reviewStatus === 'REJECTED') {
    return (
      <span className="text-sm">
        <span className="font-semibold text-destructive">Rejected</span>
        {entry.rejectionReason && <span className="text-muted-foreground"> · {entry.rejectionReason}</span>}
      </span>
    );
  }
  if (!canReview) return <span className="text-sm font-medium text-muted-foreground">Pending review</span>;

  if (rejecting) {
    const fieldId = `time-reject-${entry.id}`;
    return (
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim()) review.reject(entry.id, reason.trim());
        }}
      >
        <label htmlFor={fieldId} className="text-sm font-medium text-foreground">Rejection reason</label>
        <textarea
          id={fieldId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          required
          disabled={busy}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" size="xs" disabled={!reason.trim()} loading={busy}>Confirm rejection</Button>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}>Cancel</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => setRejecting(true)} aria-label={`Reject ${label}`}>
        Reject
      </Button>
      <Button type="button" size="xs" loading={busy} onClick={() => review.approve(entry.id)} aria-label={`Approve ${label}`}>
        Approve
      </Button>
    </div>
  );
}

/** One entry as a row: hours, project, person, description, day and review state. */
export function EntryRow({ entry, canReview, review, showPerson, showDay, className }) {
  const what = entry.description || entry.task?.title;
  return (
    <li className={cn('flex flex-wrap items-center gap-3 border-t border-border/40 py-3', className)}>
      <div className="min-w-0 flex-[1_1_12rem]">
        <p className="font-semibold text-foreground">
          <span className="figure">{formatHours(entry.duration)} h</span>
          <span className="sr-only"> ({spokenHours(entry.duration)})</span>
          {' · '}{entry.project?.name || 'Unavailable project'}
        </p>
        <p className="text-sm text-muted-foreground break-words">
          {[showPerson && entry.user?.name, showDay && dayLabel(entry.dayKey), what, entry.billable ? 'billable' : 'not billable']
            .filter(Boolean).join(' · ')}
        </p>
      </div>
      <ReviewActions entry={entry} canReview={canReview} review={review} />
    </li>
  );
}

/** "Waiting for OK": this week's entries that still need an admin's approval. */
export function WaitingForApproval({ entries, canReview, review, showPerson }) {
  const pending = entries.filter(isPending);
  return (
    <section aria-labelledby="time-waiting-heading" className="min-w-0 flex-[1_1_24rem] rounded-lg border border-border/60 bg-card p-5">
      <h2 id="time-waiting-heading" className="text-lg font-semibold tracking-tight text-foreground">Waiting for OK</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {canReview
          ? 'Logged time counts as approved only after you approve it.'
          : 'An admin approves logged time before it is billed.'}
      </p>
      {pending.length === 0 ? (
        <p className="mt-3 border-t border-border/40 pt-3 text-sm text-muted-foreground">Nothing is waiting for approval this week.</p>
      ) : (
        <ul className="mt-2">
          {pending.map((entry) => (
            <EntryRow key={entry.id} entry={entry} canReview={canReview} review={review} showPerson={showPerson} showDay />
          ))}
        </ul>
      )}
    </section>
  );
}
