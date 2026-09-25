import { useState } from 'react';
import Alert from '../components/ui/Alert';
import EmptyState from '../components/ui/EmptyState';
import {
  TablePageSkeleton,
  KanbanPageSkeleton,
  ListPageSkeleton,
} from '../components/ui/PageSkeleton';
import Button from '../components/ui/Button';

/**
 * DEV-only visual lab for polish primitives. Not linked in production builds.
 */
export default function UiLab() {
  const [dismissed, setDismissed] = useState(false);

  return (
    <main className="min-h-screen bg-background text-foreground p-6 md:p-10 space-y-10">
      <header className="space-y-2 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Dev only</p>
        <h1 className="font-heading text-3xl">UI polish lab</h1>
        <p className="text-muted-foreground text-sm">
          Skeleton loaders, Alert banners, and empty states used across collection pages.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" className="text-lg font-semibold">Alerts</h2>
        <div className="grid gap-3 max-w-2xl">
          <Alert variant="error" title="Something went wrong">
            Check your connection and try again. Your draft was not cleared.
          </Alert>
          <Alert variant="warning" title="Payment overdue">
            Two invoices need attention before Friday.
          </Alert>
          {!dismissed && (
            <Alert variant="success" title="Proposal sent" onDismiss={() => setDismissed(true)}>
              The client will get an email with a secure review link.
            </Alert>
          )}
          <Alert variant="info" title="Tip">
            Press ⌘K to open Quick Create from anywhere.
          </Alert>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="empty-heading">
        <h2 id="empty-heading" className="text-lg font-semibold">Empty states</h2>
        <div className="rounded-xl border border-border bg-card max-w-xl">
          <EmptyState
            icon="expense"
            title="No expenses found"
            description="Add your first expense to start tracking costs and profitability."
            actionLabel="Add Expense"
            onAction={() => {}}
          />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="skeleton-heading">
        <h2 id="skeleton-heading" className="text-lg font-semibold">Skeletons</h2>
        <div className="space-y-8">
          <div>
            <p className="text-sm text-muted-foreground mb-3">Table / list pages</p>
            <TablePageSkeleton rows={4} showStats label="Loading clients demo" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-3">Kanban / Projects</p>
            <KanbanPageSkeleton columns={3} cardsPerColumn={2} label="Loading projects demo" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-3">Card lists</p>
            <ListPageSkeleton rows={3} label="Loading team demo" />
          </div>
        </div>
      </section>

      <div className="pt-4">
        <Button variant="outline" onClick={() => { window.location.href = '/login'; }}>
          Back to login
        </Button>
      </div>
    </main>
  );
}
