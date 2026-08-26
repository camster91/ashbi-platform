import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, CheckCircle2, Mail, Target, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card, LoadingState } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUSES = ['NEW', 'REVIEWING', 'QUALIFIED', 'NURTURE', 'DISQUALIFIED', 'CONVERTED'];

const STATUS_LABELS = {
  NEW: 'New',
  REVIEWING: 'Reviewing',
  QUALIFIED: 'Qualified',
  NURTURE: 'Nurture',
  DISQUALIFIED: 'Not a fit',
  CONVERTED: 'Converted',
};

const STATUS_STYLES = {
  NEW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  REVIEWING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  QUALIFIED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  NURTURE: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  DISQUALIFIED: 'bg-muted text-muted-foreground',
  CONVERTED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
};

const SERVICE_LABELS = {
  brand_packaging: 'Brand and packaging',
  web_commerce: 'Website and commerce',
  custom_platform: 'Custom platform',
  ai_automation: 'AI and automation',
  managed_support: 'Managed support',
  unknown: 'Needs discovery',
};

function formatDate(value) {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatBudget(lead) {
  if (!lead.budgetBand || !lead.budgetCurrency) return 'Not provided';
  const labels = {
    under_5k: 'Under 5k',
    '5k_10k': '5k–10k',
    '10k_25k': '10k–25k',
    '25k_plus': '25k+',
    not_sure: 'Not sure',
    prefer_not_to_say: 'Prefer not to say',
  };
  return `${labels[lead.budgetBand] || lead.budgetBand} ${lead.budgetCurrency}`;
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.NEW}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function LeadInbox() {
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [reviewStatus, setReviewStatus] = useState('REVIEWING');
  const [qualificationNotes, setQualificationNotes] = useState('');
  const [confirmConversion, setConfirmConversion] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const listQuery = useQuery({
    queryKey: ['qualified-leads', statusFilter],
    queryFn: () => api.getQualifiedLeads(statusFilter ? { status: statusFilter } : {}),
    refetchInterval: 60000,
  });
  const leads = listQuery.data?.leads || [];

  useEffect(() => {
    if (selectedId && !leads.some((lead) => lead.id === selectedId)) setSelectedId(null);
  }, [leads, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['qualified-lead', selectedId],
    queryFn: () => api.getQualifiedLead(selectedId),
    enabled: Boolean(selectedId),
  });
  const selected = detailQuery.data;

  useEffect(() => {
    if (!selected) return;
    setReviewStatus(selected.status === 'CONVERTED' ? 'QUALIFIED' : selected.status);
    setQualificationNotes(selected.qualificationNotes || '');
  }, [selected]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['qualified-leads'] }),
      queryClient.invalidateQueries({ queryKey: ['qualified-lead', selectedId] }),
    ]);
  };

  const reviewMutation = useMutation({
    mutationFn: () => api.updateLeadQualification(selectedId, {
      status: reviewStatus,
      qualificationNotes,
    }),
    onSuccess: async () => {
      await refresh();
      toast.success('Inquiry updated', 'The human qualification decision was saved.');
    },
  });

  const convertMutation = useMutation({
    mutationFn: () => api.convertQualifiedLead(selectedId),
    onSuccess: async (result) => {
      setConfirmConversion(false);
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(
        result.idempotent ? 'Client already linked' : 'Client created',
        result.reusedClient ? 'The inquiry is linked to the existing client record.' : 'The client and primary contact are ready in the Hub.',
      );
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Target className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold uppercase tracking-wide">Growth</span>
          </div>
          <h1 className="mt-1 text-2xl font-heading font-bold text-foreground">Inquiry review</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review Ashbi.ca inquiries before they become clients or sales work.</p>
        </div>
        <div>
          <label htmlFor="inquiry-status-filter" className="mb-1 block text-sm font-medium text-foreground">View</label>
          <select
            id="inquiry-status-filter"
            value={statusFilter}
            onChange={(event) => { setStatusFilter(event.target.value); setSelectedId(null); }}
            className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All inquiries</option>
            {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </div>
      </div>

      {listQuery.isLoading ? (
        <LoadingState label="Loading inquiries…" />
      ) : listQuery.isError ? (
        <QueryErrorState
          error={listQuery.error}
          message="Inquiries could not be loaded"
          onRetry={listQuery.refetch}
          isRetrying={listQuery.isFetching}
        />
      ) : leads.length === 0 ? (
        <Card className="py-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 font-medium text-foreground">No inquiries match this view</p>
          <p className="mt-1 text-sm text-muted-foreground">New website inquiries will appear here after the intake connection is enabled.</p>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
              {leads.length} {leads.length === 1 ? 'inquiry' : 'inquiries'} in this view
            </div>
            <div className="max-h-[65vh] overflow-y-auto">
              {leads.map((lead) => {
                const active = selectedId === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    aria-expanded={active}
                    onClick={() => setSelectedId(lead.id)}
                    className={`min-h-11 w-full border-b border-border px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{lead.company || lead.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{lead.name} · {SERVICE_LABELS[lead.serviceLine] || lead.serviceLine}</p>
                      </div>
                      <StatusBadge status={lead.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatBudget(lead)}</span>
                      <span>{formatDate(lead.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="min-h-[28rem]">
            {!selectedId ? (
              <div className="flex min-h-[24rem] items-center justify-center text-center text-muted-foreground">
                <div><UserRound className="mx-auto h-10 w-10 opacity-30" aria-hidden="true" /><p className="mt-3">Select an inquiry to review its evidence.</p></div>
              </div>
            ) : detailQuery.isLoading ? (
              <LoadingState label="Loading inquiry details…" />
            ) : detailQuery.isError ? (
              <QueryErrorState error={detailQuery.error} message="Inquiry details could not be loaded" onRetry={detailQuery.refetch} isRetrying={detailQuery.isFetching} />
            ) : selected ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{selected.company || selected.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{SERVICE_LABELS[selected.serviceLine] || selected.serviceLine}</p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>

                <dl className="grid gap-4 sm:grid-cols-2">
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</dt><dd className="mt-1 text-sm text-foreground">{selected.name}</dd><dd className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Mail className="h-4 w-4" aria-hidden="true" />{selected.email}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</dt><dd className="mt-1 flex items-center gap-1.5 text-sm text-foreground"><Building2 className="h-4 w-4" aria-hidden="true" />{selected.company || 'Not provided'}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget</dt><dd className="mt-1 text-sm text-foreground">{formatBudget(selected)}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timing</dt><dd className="mt-1 text-sm text-foreground">{selected.timing || 'Not provided'}</dd></div>
                </dl>

                <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
                  <div><h3 className="text-sm font-semibold text-foreground">Business context</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{selected.businessContext}</p></div>
                  <div><h3 className="text-sm font-semibold text-foreground">Requested outcome</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{selected.requestedOutcome}</p></div>
                </div>

                {selected.status === 'CONVERTED' && selected.convertedClient ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">This inquiry is linked to a client.</p>
                    <Link to={`/client/${selected.convertedClient.id}`} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Open {selected.convertedClient.name}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4 border-t border-border pt-5">
                    <div>
                      <label htmlFor="qualification-status" className="mb-1 block text-sm font-medium text-foreground">Qualification decision</label>
                      <select id="qualification-status" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {STATUSES.filter((status) => status !== 'CONVERTED').map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qualification-notes" className="mb-1 block text-sm font-medium text-foreground">Internal qualification notes</label>
                      <textarea id="qualification-notes" value={qualificationNotes} onChange={(event) => setQualificationNotes(event.target.value)} maxLength={5000} rows={5} placeholder="Record evidence, fit, concerns, and the next human action." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </div>
                    {(reviewMutation.isError || convertMutation.isError) && <p role="alert" className="text-sm text-destructive">{reviewMutation.error?.message || convertMutation.error?.message}</p>}
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                      <Button variant="outline" onClick={() => reviewMutation.mutate()} loading={reviewMutation.isPending}>Save decision</Button>
                      <Button onClick={() => setConfirmConversion(true)} disabled={selected.status !== 'QUALIFIED'}>Convert to client</Button>
                    </div>
                    {selected.status !== 'QUALIFIED' && <p className="text-xs text-muted-foreground">Save this inquiry as Qualified before converting it to a client.</p>}
                  </div>
                )}
              </div>
            ) : null}
          </Card>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmConversion}
        title="Convert qualified inquiry?"
        description="This creates or reuses one client record, creates a primary contact when needed, and permanently links the inquiry. It does not send a message or create a proposal."
        confirmLabel="Convert to client"
        onConfirm={() => convertMutation.mutate()}
        onCancel={() => { if (!convertMutation.isPending) setConfirmConversion(false); }}
        pending={convertMutation.isPending}
        error={convertMutation.error?.message}
        destructive={false}
      />
    </div>
  );
}
