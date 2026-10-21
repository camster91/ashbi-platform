import { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Card } from '../ui';
import { formatDate, formatMoney } from '../../lib/format';
import { cn } from '../../lib/utils';

// What the client sees on the public proposal page (PortalProposal), drawn
// from the saved proposal (design: Proposals mockup, left column). It is a
// picture of that page: the approve button here is not a control.

const NOTES_PREVIEW_CHARS = 600;

function Row({ label, value, className }) {
  return (
    <div className={cn('flex justify-between gap-4', className)}>
      <dt>{label}</dt>
      <dd className="figure text-right">{value}</dd>
    </div>
  );
}

function Overview({ notes }) {
  const [expanded, setExpanded] = useState(false);
  const long = notes.length > NOTES_PREVIEW_CHARS;
  const shown = long && !expanded ? `${notes.slice(0, NOTES_PREVIEW_CHARS).trimEnd()}…` : notes;
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold text-foreground">Overview</h3>
      <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">{shown}</p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? 'Show less' : 'Show the full text'}
        </button>
      )}
    </div>
  );
}

export default function ProposalClientPreview({ doc }) {
  const decided = doc.status === 'APPROVED' || doc.status === 'DECLINED';
  return (
    <section aria-labelledby="proposal-preview-heading" className="min-w-0 space-y-2.5">
      <h2 id="proposal-preview-heading" className="text-eyebrow text-muted-foreground">
        What the client sees: one page to review and approve
      </h2>
      <Card as="article" padding="none" className="overflow-hidden rounded-lg" aria-label="Client view of the proposal">
        <div className="bg-primary px-6 pb-7 pt-8 text-primary-foreground sm:px-8">
          <p className="text-eyebrow text-primary-foreground/80">
            Proposal{doc.clientName ? ` · For ${doc.clientName}` : ''}
          </p>
          {/* Not a heading: the page h1 already names the proposal. */}
          <p className="mt-2.5 text-2xl font-semibold leading-tight tracking-tight break-words sm:text-3xl">{doc.title || 'Untitled proposal'}</p>
          {doc.validUntil && (
            <p className="mt-2 text-sm text-primary-foreground/80">Valid until {formatDate(doc.validUntil)}</p>
          )}
        </div>
        <div className="space-y-5 px-6 py-6 sm:px-8">
          {doc.notes ? <Overview notes={doc.notes} /> : null}

          <div>
            <h3 className="mb-2 text-base font-semibold text-foreground">Scope and pricing</h3>
            {doc.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items yet.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {doc.lines.map((line, index) => (
                  <div key={line.key ?? index} className="flex justify-between gap-3 border-b border-border/30 pb-2">
                    <dt className="min-w-0 break-words text-foreground">
                      {line.description || 'Untitled line'}
                      {Number(line.quantity) !== 1 && (
                        <span className="text-muted-foreground"> · <span className="figure">{line.quantity}</span> × <span className="figure">{formatMoney(line.unitPrice)}</span></span>
                      )}
                    </dt>
                    <dd className="figure shrink-0">{formatMoney(line.total)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border/40 bg-background p-4">
            <dl className="min-w-0 grow basis-56 space-y-1 text-sm">
              {(doc.discount > 0 || doc.tax > 0) && <Row label="Subtotal" value={formatMoney(doc.subtotal)} className="text-muted-foreground" />}
              {doc.discount > 0 && <Row label="Discount" value={`-${formatMoney(doc.discount)}`} className="text-muted-foreground" />}
              {doc.tax > 0 && <Row label={doc.taxLabel} value={formatMoney(doc.tax)} className="text-muted-foreground" />}
              <Row label="Total" value={formatMoney(doc.total)} className="text-base font-bold text-foreground" />
            </dl>
            {!decided && (
              <div className="flex min-h-12 w-full items-center justify-center rounded-md border border-foreground bg-accent px-5 font-mono sm:w-auto text-xs font-medium uppercase tracking-[0.1em] text-accent-foreground">
                Approve proposal
              </div>
            )}
          </div>

          {doc.status === 'APPROVED' ? (
            <p className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-3 text-sm font-semibold text-success">
              <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              The client approved this proposal{doc.approvedAt ? ` on ${formatDate(doc.approvedAt)}` : ''}.
            </p>
          ) : doc.status === 'DECLINED' ? (
            <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm font-semibold text-destructive">
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              The client declined this proposal{doc.declinedAt ? ` on ${formatDate(doc.declinedAt)}` : ''}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Approving accepts the scope and price. A contract is then drafted for the client to e-sign, and the invoice is made from this proposal. The client can also decline with a reason.
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}
