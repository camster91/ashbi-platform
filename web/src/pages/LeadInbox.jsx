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
const EMPTY_STAGES = [];

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

const DISQUALIFICATION_REASONS = {
  BUDGET_MISMATCH: 'Budget mismatch',
  TIMING_MISMATCH: 'Timing mismatch',
  SERVICE_MISMATCH: 'Service mismatch',
  NO_CONTACT_PATH: 'No valid contact path',
  NOT_PURSUING: 'Not pursuing',
  OTHER: 'Other evidenced reason',
};

const FOLLOW_UP_STATUSES = new Set(['REVIEWING', 'QUALIFIED', 'NURTURE']);

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

function toLocalDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const part = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function growthReviewDefaults(now = new Date()) {
  const monday = new Date(now);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  friday.setHours(17, 0, 0, 0);
  const weekOf = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return { weekOf, dueDate: toLocalDateTimeInput(friday) };
}

function isOverdue(lead) {
  return FOLLOW_UP_STATUSES.has(lead.status)
    && lead.nextActionDueAt
    && new Date(lead.nextActionDueAt).getTime() < Date.now();
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
  const [summaryDays, setSummaryDays] = useState('30');
  const [selectedId, setSelectedId] = useState(null);
  const [reviewStatus, setReviewStatus] = useState('REVIEWING');
  const [qualificationNotes, setQualificationNotes] = useState('');
  const [qualificationReasonCode, setQualificationReasonCode] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDueAt, setNextActionDueAt] = useState('');
  const [confirmConversion, setConfirmConversion] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);
  const [confirmPromotion, setConfirmPromotion] = useState(false);
  const [promotion, setPromotion] = useState({ name: '', stageId: '', value: '', currency: '' });
  const [showGrowthReview, setShowGrowthReview] = useState(false);
  const [growthReview, setGrowthReview] = useState(() => ({
    projectId: '',
    assigneeId: '',
    action: '',
    sourceCoverageReviewed: false,
    currenciesSeparated: false,
    missingAttributionDisclosed: false,
    externalActionState: 'NOT_REQUIRED',
    ...growthReviewDefaults(),
  }));
  const [growthTask, setGrowthTask] = useState(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const listQuery = useQuery({
    queryKey: ['qualified-leads', statusFilter],
    queryFn: () => api.getQualifiedLeads(statusFilter ? { status: statusFilter } : {}),
    refetchInterval: 60000,
  });
  const leads = listQuery.data?.leads || [];
  const summaryQuery = useQuery({
    queryKey: ['lead-acquisition-summary', summaryDays],
    queryFn: () => api.getLeadAcquisitionSummary(summaryDays ? { days: summaryDays } : {}),
    refetchInterval: 60000,
  });
  const summary = summaryQuery.data;
  const growthProjectsQuery = useQuery({
    queryKey: ['projects', 'growth-review'],
    queryFn: () => api.getProjects().then((response) => response?.projects ?? []),
    enabled: showGrowthReview,
  });
  const growthTeamQuery = useQuery({
    queryKey: ['team', 'growth-review'],
    queryFn: () => api.getTeam(),
    enabled: showGrowthReview,
  });
  const growthProjects = growthProjectsQuery.data || [];
  const growthOwners = (growthTeamQuery.data || []).filter((member) => member.isActive && ['ADMIN', 'TEAM'].includes(member.role));

  useEffect(() => {
    if (selectedId && !leads.some((lead) => lead.id === selectedId)) setSelectedId(null);
  }, [leads, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['qualified-lead', selectedId],
    queryFn: () => api.getQualifiedLead(selectedId),
    enabled: Boolean(selectedId),
  });
  const selected = detailQuery.data;

  const stagesQuery = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.getPipelineStages(),
    enabled: Boolean(selectedId && showPromotion),
  });
  const stages = stagesQuery.data || EMPTY_STAGES;

  useEffect(() => {
    if (!selected) return;
    setReviewStatus(selected.status === 'CONVERTED' ? 'QUALIFIED' : selected.status);
    setQualificationNotes(selected.qualificationNotes || '');
    setQualificationReasonCode(selected.qualificationReasonCode || '');
    setNextAction(selected.nextAction || '');
    setNextActionDueAt(toLocalDateTimeInput(selected.nextActionDueAt));
    setShowPromotion(false);
    setConfirmPromotion(false);
    setPromotion({ name: '', stageId: '', value: '', currency: '' });
  }, [selected]);

  useEffect(() => {
    if (!showPromotion || !selected) return;
    setPromotion((current) => ({
      ...current,
      name: current.name || `${selected.company || selected.name} ${SERVICE_LABELS[selected.serviceLine] || 'engagement'}`,
      stageId: current.stageId || stages[0]?.id || '',
      currency: current.currency || selected.budgetCurrency || '',
    }));
  }, [selected, showPromotion, stages]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['qualified-leads'] }),
      queryClient.invalidateQueries({ queryKey: ['qualified-lead', selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['lead-acquisition-summary'] }),
    ]);
  };

  const reviewMutation = useMutation({
    mutationFn: () => api.updateLeadQualification(selectedId, {
      status: reviewStatus,
      qualificationNotes,
      qualificationReasonCode: reviewStatus === 'DISQUALIFIED' ? qualificationReasonCode : null,
      nextAction: FOLLOW_UP_STATUSES.has(reviewStatus) ? nextAction.trim() : null,
      nextActionDueAt: FOLLOW_UP_STATUSES.has(reviewStatus) && nextActionDueAt ? new Date(nextActionDueAt).toISOString() : null,
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

  const promoteMutation = useMutation({
    mutationFn: () => api.promoteQualifiedLead(selectedId, {
      name: promotion.name.trim(),
      stageId: promotion.stageId,
      value: promotion.value === '' ? undefined : Number(promotion.value),
      currency: promotion.currency,
    }),
    onSuccess: async (result) => {
      setConfirmPromotion(false);
      setShowPromotion(false);
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      toast.success(
        result.idempotent ? 'Pipeline deal already linked' : 'Inquiry added to pipeline',
        'The client and currency-labelled deal are linked to the original inquiry.',
      );
    },
  });

  const growthTaskMutation = useMutation({
    mutationFn: () => api.createWeeklyGrowthReviewTask({
      projectId: growthReview.projectId,
      assigneeId: growthReview.assigneeId,
      weekOf: growthReview.weekOf,
      action: growthReview.action.trim(),
      dueDate: new Date(growthReview.dueDate).toISOString(),
      sourceCoverageReviewed: growthReview.sourceCoverageReviewed,
      currenciesSeparated: growthReview.currenciesSeparated,
      missingAttributionDisclosed: growthReview.missingAttributionDisclosed,
      externalActionState: growthReview.externalActionState,
    }),
    onSuccess: (result) => {
      setGrowthTask(result.task);
      setShowGrowthReview(false);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(
        result.idempotent ? 'Weekly growth task already exists' : 'Weekly growth task created',
        'The action, owner, due date, and recorded acquisition evidence are together in the Hub.',
      );
    },
  });

  const canReviewPromotion = Boolean(
    promotion.name.trim()
    && promotion.stageId
    && ['CAD', 'USD'].includes(promotion.currency)
    && (promotion.value === '' || (Number.isFinite(Number(promotion.value)) && Number(promotion.value) >= 0)),
  );
  const hasDecisionEvidence = !['QUALIFIED', 'NURTURE', 'DISQUALIFIED'].includes(reviewStatus)
    || qualificationNotes.trim().length >= 10;
  const canSaveReview = hasDecisionEvidence
    && (!FOLLOW_UP_STATUSES.has(reviewStatus) || (nextAction.trim() && nextActionDueAt))
    && (reviewStatus !== 'DISQUALIFIED' || Boolean(qualificationReasonCode));
  const growthWeekIsMonday = growthReview.weekOf
    && new Date(`${growthReview.weekOf}T00:00:00.000Z`).getUTCDay() === 1;
  const growthWeekStart = growthReview.weekOf ? new Date(`${growthReview.weekOf}T00:00:00.000Z`) : null;
  const growthDueDate = growthReview.dueDate ? new Date(growthReview.dueDate) : null;
  const growthDueWithinWeek = Boolean(growthWeekStart && growthDueDate
    && growthDueDate >= growthWeekStart
    && growthDueDate < new Date(growthWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000));
  const canCreateGrowthTask = Boolean(
    summary
    && growthReview.projectId
    && growthReview.assigneeId
    && growthWeekIsMonday
    && growthReview.action.trim().length >= 10
    && growthDueWithinWeek
    && growthReview.sourceCoverageReviewed
    && growthReview.currenciesSeparated
    && growthReview.missingAttributionDisclosed,
  );

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

      <section aria-labelledby="acquisition-evidence-heading" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="acquisition-evidence-heading" className="text-lg font-heading font-semibold text-foreground">Acquisition evidence</h2>
            <p className="text-sm text-muted-foreground">Counts reflect recorded Hub data; missing attribution is shown, not assumed.</p>
          </div>
          <div>
            <label htmlFor="acquisition-window" className="mb-1 block text-sm font-medium text-foreground">Reporting window</label>
            <select
              id="acquisition-window"
              value={summaryDays}
              onChange={(event) => setSummaryDays(event.target.value)}
              className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="">All recorded time</option>
            </select>
          </div>
        </div>
        {summaryQuery.isError ? (
          <QueryErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} compact />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total inquiries</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary?.total ?? '—'}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Source captured</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {summary ? `${summary.attribution.sourceCaptured} / ${summary.total}` : '—'}
              </p>
              {summary?.attribution.sourceMissing > 0 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{summary.attribution.sourceMissing} missing attribution</p>
              )}
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Follow-up overdue</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary?.followUp.overdue ?? '—'}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Unscheduled active leads</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary?.followUp.unscheduled ?? '—'}</p>
            </Card>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Follow-up gaps always cover all active leads, regardless of the acquisition reporting window.</p>
        {summary && (
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="p-4">
              <h3 className="font-semibold text-foreground">Demand by service</h3>
              <ul className="mt-3 space-y-2">
                {summary.byServiceLine.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{SERVICE_LABELS[item.key] || item.key}</span>
                    <span className="font-semibold text-foreground">{item.count}</span>
                  </li>
                ))}
                {summary.byServiceLine.length === 0 && <li className="text-sm text-muted-foreground">No recorded demand in this window.</li>}
              </ul>
            </Card>
            <Card className="p-4">
              <h3 className="font-semibold text-foreground">Lead sources</h3>
              <ul className="mt-3 space-y-2">
                {summary.bySource.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{item.key === 'UNATTRIBUTED' ? 'Unattributed' : item.key}</span>
                    <span className="font-semibold text-foreground">{item.count}</span>
                  </li>
                ))}
                {summary.bySource.length === 0 && <li className="text-sm text-muted-foreground">No recorded sources in this window.</li>}
              </ul>
            </Card>
            <Card className="p-4">
              <h3 className="font-semibold text-foreground">Current stages</h3>
              <ul className="mt-3 space-y-2">
                {summary.byStatus.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{STATUS_LABELS[item.key] || item.key}</span>
                    <span className="font-semibold text-foreground">{item.count}</span>
                  </li>
                ))}
                {summary.byStatus.length === 0 && <li className="text-sm text-muted-foreground">No recorded stages in this window.</li>}
              </ul>
            </Card>
          </div>
        )}
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold text-foreground">Weekly growth action</h3>
              <p className="mt-1 text-sm text-muted-foreground">Turn this review into one owned Hub task with fresh 30-day and 90-day evidence.</p>
            </div>
            {!showGrowthReview && !growthTask && (
              <Button variant="outline" onClick={() => setShowGrowthReview(true)}>Plan weekly action</Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Internal task only. This does not send outreach, publish content, change ad spend, or call a provider.</p>

          {growthTask && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">This week’s growth action is recorded.</p>
              <Link to={`/task/${growthTask.id}`} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Open task in the Hub<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          )}

          {showGrowthReview && (
            <form
              className="mt-4 grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => { event.preventDefault(); growthTaskMutation.mutate(); }}
            >
              <div>
                <label htmlFor="growth-review-project" className="mb-1 block text-sm font-medium text-foreground">Growth project</label>
                <select id="growth-review-project" value={growthReview.projectId} onChange={(event) => setGrowthReview((current) => ({ ...current, projectId: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="">Select the Hub project</option>
                  {growthProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="growth-review-owner" className="mb-1 block text-sm font-medium text-foreground">Owner</label>
                <select id="growth-review-owner" value={growthReview.assigneeId} onChange={(event) => setGrowthReview((current) => ({ ...current, assigneeId: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="">Select one owner</option>
                  {growthOwners.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="growth-review-week" className="mb-1 block text-sm font-medium text-foreground">Week of Monday</label>
                <input id="growth-review-week" type="date" value={growthReview.weekOf} onChange={(event) => setGrowthReview((current) => ({ ...current, weekOf: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                {!growthWeekIsMonday && <p className="mt-1 text-xs text-destructive">Choose the Monday that starts the review week.</p>}
              </div>
              <div>
                <label htmlFor="growth-review-due" className="mb-1 block text-sm font-medium text-foreground">Due</label>
                <input id="growth-review-due" type="datetime-local" value={growthReview.dueDate} onChange={(event) => setGrowthReview((current) => ({ ...current, dueDate: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="growth-review-action" className="mb-1 block text-sm font-medium text-foreground">One acquisition action</label>
                <textarea id="growth-review-action" rows={3} maxLength={500} value={growthReview.action} onChange={(event) => setGrowthReview((current) => ({ ...current, action: event.target.value }))} placeholder="Prepare one evidence-backed case study for approval" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
              </div>
              <fieldset className="space-y-3 sm:col-span-2">
                <legend className="text-sm font-medium text-foreground">Review evidence</legend>
                <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
                  <input id="growth-review-source-coverage" type="checkbox" checked={growthReview.sourceCoverageReviewed} onChange={(event) => setGrowthReview((current) => ({ ...current, sourceCoverageReviewed: event.target.checked }))} className="mt-1 h-4 w-4" />
                  <span>I reviewed source coverage against recorded evidence.</span>
                </label>
                <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
                  <input id="growth-review-missing-attribution" type="checkbox" checked={growthReview.missingAttributionDisclosed} onChange={(event) => setGrowthReview((current) => ({ ...current, missingAttributionDisclosed: event.target.checked }))} className="mt-1 h-4 w-4" />
                  <span>I preserved and disclosed missing attribution instead of guessing it.</span>
                </label>
                <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
                  <input id="growth-review-currencies" type="checkbox" checked={growthReview.currenciesSeparated} onChange={(event) => setGrowthReview((current) => ({ ...current, currenciesSeparated: event.target.checked }))} className="mt-1 h-4 w-4" />
                  <span>I reviewed monetary pipeline and revenue evidence without combining currencies.</span>
                </label>
              </fieldset>
              <div className="sm:col-span-2">
                <label htmlFor="growth-review-external-state" className="mb-1 block text-sm font-medium text-foreground">External action gate</label>
                <select id="growth-review-external-state" value={growthReview.externalActionState} onChange={(event) => setGrowthReview((current) => ({ ...current, externalActionState: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="NOT_REQUIRED">No external action required</option>
                  <option value="PENDING">Approval still pending</option>
                  <option value="APPROVED">Separately approved</option>
                  <option value="DECLINED">Declined</option>
                </select>
              </div>
              {(growthProjectsQuery.isError || growthTeamQuery.isError || growthTaskMutation.isError) && (
                <p role="alert" className="sm:col-span-2 text-sm text-destructive">{growthTaskMutation.error?.message || growthProjectsQuery.error?.message || growthTeamQuery.error?.message}</p>
              )}
              <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => setShowGrowthReview(false)}>Cancel</Button>
                <Button type="submit" loading={growthTaskMutation.isPending} disabled={!canCreateGrowthTask}>Create growth task</Button>
              </div>
            </form>
          )}
        </Card>
      </section>

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
                      {isOverdue(lead) && <span className="font-semibold text-destructive">Follow-up overdue</span>}
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
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account owner</dt><dd className="mt-1 text-sm text-foreground">{selected.accountOwner?.name || 'Owner unavailable'}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attribution</dt><dd className="mt-1 text-sm text-foreground">{[selected.source, selected.medium, selected.campaign].filter(Boolean).join(' · ') || 'Source not captured'}</dd><dd className="mt-1 break-all text-xs text-muted-foreground">{selected.landingPage}</dd></div>
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
                    {reviewStatus === 'DISQUALIFIED' && (
                      <div>
                        <label htmlFor="qualification-reason" className="mb-1 block text-sm font-medium text-foreground">Reason</label>
                        <select id="qualification-reason" value={qualificationReasonCode} onChange={(event) => setQualificationReasonCode(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="">Select an evidenced reason</option>
                          {Object.entries(DISQUALIFICATION_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                    )}
                    {FOLLOW_UP_STATUSES.has(reviewStatus) && (
                      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
                        <div>
                          <label htmlFor="next-action" className="mb-1 block text-sm font-medium text-foreground">Next human action</label>
                          <input id="next-action" value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={500} placeholder="Schedule discovery with the decision maker" className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        </div>
                        <div>
                          <label htmlFor="next-action-due" className="mb-1 block text-sm font-medium text-foreground">Due</label>
                          <input id="next-action-due" type="datetime-local" value={nextActionDueAt} onChange={(event) => setNextActionDueAt(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        </div>
                      </div>
                    )}
                    {(reviewMutation.isError || convertMutation.isError) && <p role="alert" className="text-sm text-destructive">{reviewMutation.error?.message || convertMutation.error?.message}</p>}
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                      <Button variant="outline" onClick={() => reviewMutation.mutate()} loading={reviewMutation.isPending} disabled={!canSaveReview}>Save decision</Button>
                      <Button onClick={() => setConfirmConversion(true)} disabled={selected.status !== 'QUALIFIED'}>Convert to client</Button>
                    </div>
                    {selected.status !== 'QUALIFIED' && <p className="text-xs text-muted-foreground">Save this inquiry as Qualified before converting it to a client.</p>}
                  </div>
                )}

                {selected.convertedDeal ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300">This inquiry is linked to a pipeline deal.</p>
                    <Link to="/pipeline" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Open {selected.convertedDeal.title}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                ) : ['QUALIFIED', 'CONVERTED'].includes(selected.status) ? (
                  <div className="space-y-4 rounded-xl border border-border p-4">
                    {!showPromotion ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Sales pipeline</h3>
                          <p className="mt-1 text-sm text-muted-foreground">Create a deliberate, currency-labelled opportunity linked to this inquiry.</p>
                        </div>
                        <Button onClick={() => setShowPromotion(true)}>Add to pipeline</Button>
                      </div>
                    ) : stagesQuery.isLoading ? (
                      <LoadingState label="Loading pipeline stages…" />
                    ) : stagesQuery.isError ? (
                      <QueryErrorState error={stagesQuery.error} message="Pipeline stages could not be loaded" onRetry={stagesQuery.refetch} isRetrying={stagesQuery.isFetching} />
                    ) : stages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Set up a pipeline stage before promoting this inquiry.</p>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label htmlFor="inquiry-deal-name" className="mb-1 block text-sm font-medium text-foreground">Deal name</label>
                          <input id="inquiry-deal-name" value={promotion.name} onChange={(event) => setPromotion((current) => ({ ...current, name: event.target.value }))} maxLength={200} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                        </div>
                        <div>
                          <label htmlFor="inquiry-deal-stage" className="mb-1 block text-sm font-medium text-foreground">Pipeline stage</label>
                          <select id="inquiry-deal-stage" value={promotion.stageId} onChange={(event) => setPromotion((current) => ({ ...current, stageId: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                            <option value="">Select a stage</option>
                            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label || stage.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="inquiry-deal-value" className="mb-1 block text-sm font-medium text-foreground">Value</label>
                          <input id="inquiry-deal-value" type="number" min="0" step="100" value={promotion.value} onChange={(event) => setPromotion((current) => ({ ...current, value: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                        </div>
                        <div>
                          <label htmlFor="inquiry-deal-currency" className="mb-1 block text-sm font-medium text-foreground">Currency</label>
                          <select id="inquiry-deal-currency" value={promotion.currency} onChange={(event) => setPromotion((current) => ({ ...current, currency: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                            <option value="">Select currency</option>
                            <option value="CAD">CAD</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        {promoteMutation.isError && <p role="alert" className="text-sm text-destructive sm:col-span-2">{promoteMutation.error?.message}</p>}
                        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
                          <Button variant="outline" onClick={() => setShowPromotion(false)}>Cancel</Button>
                          <Button onClick={() => setConfirmPromotion(true)} disabled={!canReviewPromotion}>Review pipeline promotion</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
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
      <ConfirmDialog
        isOpen={confirmPromotion}
        title="Add qualified inquiry to pipeline?"
        description={`This will ${selected?.convertedClientId ? 'reuse the linked client and create one deal' : 'create or reuse one client and create one deal'} for ${promotion.value === '' ? '$0' : `$${Number(promotion.value).toLocaleString('en-CA')}`} ${promotion.currency}. It will not send a message, proposal, contract, or invoice.`}
        confirmLabel={selected?.convertedClientId ? 'Create deal' : 'Create client and deal'}
        onConfirm={() => promoteMutation.mutate()}
        onCancel={() => { if (!promoteMutation.isPending) setConfirmPromotion(false); }}
        pending={promoteMutation.isPending}
        error={promoteMutation.error?.message}
        destructive={false}
      />
    </div>
  );
}
