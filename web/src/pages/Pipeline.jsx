import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Target, ChevronRight, ArrowRight, TrendingUp,
  Plus, Trash2, MoveRight, Sparkles, Loader2, Settings2,
} from 'lucide-react';
import { api } from '../lib/api';
import useClients from '../hooks/useClients';
import { Button, Card, Field, Input, LoadingState, Select } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import Modal, { ModalFooter } from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatMoney } from '../lib/format';


function fmt(n) {
  if (n == null) return '--';
  return formatMoney(n, undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * GET /pipeline returns the organization's stages as
 * `{ id, name, color, probability, order, deals: [...] }`. Add the derived
 * deal count and total value the board shows; anything malformed becomes an
 * empty stage list rather than a crash.
 */
export function normalizePipelineStages(data) {
  const list = Array.isArray(data) ? data : (Array.isArray(data?.stages) ? data.stages : []);
  return list
    .filter((stage) => stage && stage.id)
    .map((stage) => {
      const deals = Array.isArray(stage.deals) ? stage.deals : [];
      return {
        ...stage,
        deals,
        count: deals.length,
        value: deals.reduce((sum, deal) => sum + (Number(deal.value) || 0), 0),
      };
    });
}

const EMPTY_DEAL = { title: '', clientId: '', value: '', stageId: '' };

// ── Create Deal Modal ──────────────────────────────────────────────────
function CreateDealModal({ isOpen, onClose, stages }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(EMPTY_DEAL);
  const [error, setError] = useState('');

  const { data: clients, isSuccess: clientsLoaded } = useClients({ enabled: isOpen });

  // Set default stage when stages load
  useEffect(() => {
    if (isOpen && stages.length) {
      setFormData(prev => (prev.stageId ? prev : { ...prev, stageId: stages[0].id || '' }));
    }
  }, [isOpen, stages]);

  const mutation = useMutation({
    mutationFn: (data) => api.createPipelineDeal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      setFormData({ ...EMPTY_DEAL, stageId: stages[0]?.id || '' });
      setError('');
      onClose();
    },
    onError: (err) => setError(err.message || 'Failed to create deal'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim()) { setError('Deal name is required'); return; }
    // PipelineDeal.clientId is required in the data model.
    if (!formData.clientId) { setError('Choose the client this deal is for'); return; }
    if (!formData.stageId) { setError('Choose a stage'); return; }
    mutation.mutate({
      title: formData.title.trim(),
      clientId: formData.clientId,
      stageId: formData.stageId,
      ...(formData.value !== '' ? { value: Number(formData.value) } : {}),
    });
  };

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const noClients = clientsLoaded && clients.length === 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Deal">
      <form onSubmit={handleSubmit} noValidate>
        {error && <div role="alert" className="mb-4 p-3 text-sm text-destructive bg-destructive/5 rounded-lg">{error}</div>}
        <div className="space-y-4">
          <Field label="Deal name" required id="deal-title">
            <Input type="text" name="title" value={formData.title} onChange={handleChange}
              placeholder="Website Redesign" autoFocus />
          </Field>
          <Field
            label="Client"
            required
            id="deal-client"
            hint={noClients ? 'Add a client first: every deal belongs to a client.' : undefined}
          >
            <Select name="clientId" value={formData.clientId} onChange={handleChange}>
              <option value="">Select a client</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          {noClients && (
            <Link to="/clients" className="text-sm text-primary underline">Go to Clients</Link>
          )}
          <Field label="Value ($)" id="deal-value">
            <Input type="number" name="value" value={formData.value} onChange={handleChange}
              placeholder="5000" min="0" step="100" />
          </Field>
          <Field label="Stage" required id="deal-stage">
            <Select name="stageId" value={formData.stageId} onChange={handleChange}>
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <ModalFooter>
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-lg">Cancel</button>
          <button type="submit" disabled={mutation.isPending || noClients}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50">
            {mutation.isPending ? 'Creating...' : 'Create Deal'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ── Move-to dropdown (inline) ──────────────────────────────────────────
function MoveToDropdown({ deal, stages, currentStageId, onMove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const otherStages = stages.filter(s => s.id !== currentStageId);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        aria-expanded={open}
        aria-label={`Move ${deal.title} to another stage`}
        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Move to stage">
        <MoveRight className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-48 bg-card rounded-lg shadow-lg border py-1 text-sm">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Move to</div>
          {otherStages.map(s => (
            <button key={s.id} type="button" role="menuitem"
              className="min-h-11 w-full text-left px-3 py-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onMove(deal.id, s.id); }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AI Score Popover ───────────────────────────────────────────────────
function AIScoreButton({ deal, stageLabel }) {
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!show) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  const fetchScore = async (e) => {
    e.stopPropagation();
    if (score) { setShow(v => !v); return; }
    setLoading(true);
    setShow(true);
    try {
      const res = await api.aiChat({
        message: `Rate this deal's likelihood of closing on a scale of 1-10 based on: title="${deal.title}", value=${deal.value ?? 'unknown'}, stage="${stageLabel}". Give a brief reasoning in 1-2 sentences. Format: Score: X/10 - Reasoning`,
      });
      setScore(typeof res === 'string' ? res : res?.reply || res?.message || res?.content || JSON.stringify(res));
    } catch {
      setScore('AI scoring unavailable');
    }
    setLoading(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={fetchScore}
        aria-expanded={show}
        aria-label={`Show AI lead score for ${deal.title}`}
        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="AI Lead Score">
        {loading ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          : <Sparkles className="w-4 h-4 text-brand-lime" />}
      </button>
      {show && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[min(16rem,calc(100vw-2rem))] bg-card rounded-lg shadow-lg border p-3 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Scoring...
            </div>
          ) : (
            <p className="text-muted-foreground whitespace-pre-wrap">{score}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stage chip ─────────────────────────────────────────────────────────
// Each stage carries its own colour (PipelineStage.color), so the chip is
// painted from the data rather than from a fixed palette.
function StageIcon({ stage, className = '' }) {
  return (
    <div
      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-primary ${className}`}
      style={stage.color ? { backgroundColor: stage.color } : undefined}
      aria-hidden="true"
    >
      <Target className="w-5 h-5 text-white" />
    </div>
  );
}

function dealCountLabel(count) {
  return `${count} ${count === 1 ? 'deal' : 'deals'}`;
}

const WIDE_SCREEN_QUERY = '(min-width: 1024px)';

function isWideScreen() {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.(WIDE_SCREEN_QUERY).matches);
  } catch {
    return false;
  }
}

/**
 * Which stages start open. On a wide screen every stage shows its deals. On a
 * phone the stages are collapsible and one starts open: the first stage that
 * has deals, else the first stage.
 */
export function defaultOpenStageIds(stages, wide) {
  if (!stages.length) return [];
  if (wide) return stages.map((stage) => stage.id);
  const first = stages.find((stage) => stage.count > 0) || stages[0];
  return [first.id];
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function Pipeline() {
  // null until the user opens or closes a stage; until then the defaults
  // above apply (they depend on the stages, which load asynchronously).
  const [openStageIds, setOpenStageIds] = useState(null);
  const [wide] = useState(isWideScreen);
  const [showCreateDeal, setShowCreateDeal] = useState(false);
  const [showManageStages, setShowManageStages] = useState(false);

  const {
    data,
    isLoading,
    isError: pipelineError,
    error: pipelineRequestError,
    refetch: refetchPipeline,
    isFetching: pipelineFetching,
  } = useQuery({
    queryKey: ['pipeline'],
    // /pipeline returns the stages with their deals (default stages are
    // created on an organization's first read); /pipeline/analytics returns
    // the totals.
    queryFn: async () => {
      const [stages, analytics] = await Promise.all([
        api.getPipelineStages(),
        api.getPipelineAnalytics().catch(() => null),
      ]);
      return {
        stages: normalizePipelineStages(stages),
        analytics,
      };
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
        <LoadingState label="Loading pipeline data…" />
      </div>
    );
  }

  if (pipelineError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
        <QueryErrorState
          error={pipelineRequestError}
          message="Pipeline data could not be loaded"
          onRetry={refetchPipeline}
          isRetrying={pipelineFetching}
        />
      </div>
    );
  }

  const stages = data?.stages || [];
  const analytics = data?.analytics;
  const totalDeals = stages.reduce((sum, stage) => sum + stage.count, 0);
  const totalValue = stages.reduce((sum, stage) => sum + stage.value, 0);
  const summary = [
    { key: 'deals', label: 'Deals', value: String(analytics?.totalDeals ?? totalDeals) },
    { key: 'value', label: 'Pipeline value', value: fmt(analytics?.totalPipelineValue ?? totalValue) },
    { key: 'probability', label: 'Average win probability', value: `${Math.round(analytics?.averageWinProbability ?? 0)}%` },
    { key: 'win', label: 'Win rate', value: `${Math.round(analytics?.winRate ?? 0)}%` },
  ];

  const openIds = openStageIds ?? defaultOpenStageIds(stages, wide);
  const toggleStage = (stageId) => {
    setOpenStageIds(
      openIds.includes(stageId) ? openIds.filter((id) => id !== stageId) : [...openIds, stageId],
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Track deals from lead to close</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowManageStages(true)}
            className="min-h-11 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border bg-card text-foreground rounded-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Settings2 className="w-4 h-4" aria-hidden="true" />
            Manage stages
          </button>
          <button
            type="button"
            onClick={() => setShowCreateDeal(true)}
            className="min-h-11 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg transition-all hover:opacity-90 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Deal
          </button>
        </div>
      </div>

      <CreateDealModal
        isOpen={showCreateDeal}
        onClose={() => setShowCreateDeal(false)}
        stages={stages}
      />

      <ManageStagesModal
        isOpen={showManageStages}
        onClose={() => setShowManageStages(false)}
        stages={stages}
      />

      {/* Funnel overview — wide screens only; on phones each stage's header
          below already shows its count and value. */}
      {stages.length > 0 && (
        <Card className="hidden p-6 lg:block">
          <h2 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
            Sales Funnel
          </h2>
          <div className="flex items-stretch gap-0">
            {stages.map((stage, i) => (
              <div key={stage.id} className="flex items-stretch flex-1">
                <div className="flex-1 p-4 rounded-xl border-2 border-border">
                  <StageIcon stage={stage} className="mx-auto mb-2" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground font-medium">{stage.name}</p>
                    <p className="text-2xl font-bold text-foreground mt-0.5">{stage.count}</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{fmt(stage.value)}</p>
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <div className="flex items-center px-1">
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50" aria-hidden="true" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Deals, grouped by stage */}
      {stages.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">No pipeline stages yet. Use Manage stages to add one.</p>
        </Card>
      ) : (
        <section aria-label="Deals by stage" className="space-y-3">
          {stages.map((stage) => (
            <StageSection
              key={stage.id}
              stage={stage}
              stages={stages}
              isOpen={openIds.includes(stage.id)}
              onToggle={() => toggleStage(stage.id)}
            />
          ))}
        </section>
      )}

      {/* Summary */}
      <Card className="p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Pipeline summary</h2>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {summary.map(({ key, label, value }) => (
            <div key={key} className="text-center p-3 rounded-lg bg-muted/50">
              <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
              <dd className="text-xl font-bold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

// ── Stage section (collapsible, with deal actions) ────────────────────
function StageSection({ stage, stages, isOpen, onToggle }) {
  const queryClient = useQueryClient();
  const [itemToDelete, setItemToDelete] = useState(null);
  const toggleRef = useRef(null);
  const panelId = `pipeline-stage-${stage.id}`;

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }) => api.updatePipelineDeal(id, { stageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deletePipelineDeal(id),
    onSuccess: () => {
      setItemToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      // The deleted deal's row (and its trigger) is gone: land on the stage.
      requestAnimationFrame(() => toggleRef.current?.focus());
    },
  });

  const handleDelete = (deal) => {
    deleteMutation.reset();
    setItemToDelete(deal);
  };

  return (
    <Card padding="none">
      <h2 className="text-base font-semibold text-foreground">
        <button
          ref={toggleRef}
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
          className="flex w-full min-h-11 items-center gap-3 rounded-xl p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-4"
        >
          <StageIcon stage={stage} />
          <span className="min-w-0 flex-1">
            <span className="block break-words">{stage.name}</span>
            <span className="block text-sm font-normal text-muted-foreground">
              {dealCountLabel(stage.count)} · {fmt(stage.value)}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className={`w-5 h-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`}
          />
        </button>
      </h2>

      {isOpen && (
        <div id={panelId} className="px-3 pb-3 sm:px-4 sm:pb-4">
          {moveMutation.isError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {moveMutation.error?.message || 'The deal could not be moved'}
            </p>
          )}

          {!stage.deals.length ? (
            <p className="text-sm text-muted-foreground">No deals in this stage</p>
          ) : (
            <ul className="space-y-2" aria-label={`${stage.name} deals`}>
              {stage.deals.map((deal) => (
                <li
                  key={deal.id}
                  // Phones: name and value on the first line, client and
                  // likelihood below, actions on their own row. From sm up the
                  // value and actions move to the right of the details.
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                >
                  <p className="col-start-1 row-start-1 text-sm font-medium text-foreground break-words">
                    {deal.title || 'Untitled deal'}
                  </p>
                  <span className="col-start-2 row-start-1 text-right text-sm font-semibold text-foreground whitespace-nowrap sm:row-span-2 sm:self-center">
                    {fmt(deal.value ?? 0)}
                  </span>
                  <div className="col-span-2 col-start-1 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-span-1">
                    {deal.client?.name && (
                      <Link to={`/client/${deal.client.id}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        {deal.client.name}
                      </Link>
                    )}
                    {deal.probability != null && <span>{deal.probability}% likely</span>}
                  </div>

                  {/* Always shown on touch screens. From lg up the actions
                      appear on hover, and whenever one has keyboard focus. */}
                  <div className="col-span-2 col-start-1 row-start-3 -mb-1 flex items-center justify-end gap-0.5 transition-opacity sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mb-0 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-within:opacity-100">
                    <MoveToDropdown deal={deal} stages={stages} currentStageId={stage.id}
                      onMove={(id, stageId) => moveMutation.mutate({ id, stageId })} />
                    <AIScoreButton deal={deal} stageLabel={stage.name} />
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(deal); }}
                      aria-label={`Delete ${deal.title}`}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-md hover:bg-destructive/5 hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Delete deal">
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(itemToDelete)}
        title="Delete pipeline item"
        description={itemToDelete ? `Permanently delete “${itemToDelete.title || 'this deal'}”? This cannot be undone.` : ''}
        confirmLabel="Permanently delete"
        onConfirm={() => itemToDelete && deleteMutation.mutate(itemToDelete.id)}
        onCancel={() => { deleteMutation.reset(); setItemToDelete(null); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />
    </Card>
  );
}

// ── Manage stages (add, rename, delete) ───────────────────────────────
// PipelineStage.order is validated to 0–1000 (pipelineStageCreateSchema).
export const STAGE_ORDER_MAX = 1000;

const clampOrder = (value) => Math.min(STAGE_ORDER_MAX, Math.max(0, Math.round(Number(value) || 0)));
const clampProbability = (value) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

/** By default a new stage goes before the first closed-won (100%) stage, else last. */
export function defaultInsertBeforeId(stages) {
  return stages.find((stage) => Number(stage.probability) >= 100)?.id || '';
}

/**
 * Where a new stage goes and the win probability it starts with. Before an
 * existing stage: that stage's order (it and the later stages move down one)
 * and the probability halfway between its neighbours. At the end: after the
 * last stage, with the last stage's probability (50% for the first stage).
 */
export function planNewStage(stages, beforeStageId) {
  const index = beforeStageId ? stages.findIndex((stage) => stage.id === beforeStageId) : -1;
  if (index === -1) {
    const last = stages[stages.length - 1];
    return {
      order: clampOrder(stages.reduce((max, stage) => Math.max(max, Number(stage.order) || 0), -1) + 1),
      probability: last ? clampProbability(last.probability) : 50,
      shifts: [],
    };
  }
  const target = stages[index];
  const previous = stages[index - 1];
  const previousProbability = previous ? Number(previous.probability) || 0 : 0;
  return {
    order: clampOrder(target.order),
    probability: clampProbability((previousProbability + (Number(target.probability) || 0)) / 2),
    shifts: stages.slice(index).map((stage) => ({ id: stage.id, order: clampOrder((Number(stage.order) || 0) + 1) })),
  };
}

function StageRow({ stage, index }) {
  const queryClient = useQueryClient();
  // Keyed by id and name by the caller, so a rename from elsewhere resets it.
  const [name, setName] = useState(stage.name);

  const renameMutation = useMutation({
    mutationFn: (nextName) => api.updatePipelineStage(stage.id, { name: nextName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  const trimmed = name.trim();
  const changed = trimmed !== stage.name;
  const inputId = `stage-name-${stage.id}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && changed) renameMutation.mutate(trimmed);
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="min-w-0 flex-1 basis-40">
        <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground mb-1">
          Stage {index + 1} name
        </label>
        <Input
          id={inputId}
          value={name}
          maxLength={100}
          onChange={(e) => { setName(e.target.value); renameMutation.reset(); }}
          className="min-h-11"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={!trimmed || !changed} loading={renameMutation.isPending}>
        Rename
      </Button>
      {renameMutation.isError && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {renameMutation.error?.message || 'The stage could not be renamed'}
        </p>
      )}
    </form>
  );
}

function DeleteStagePanel({ stage, stages, onDone }) {
  const queryClient = useQueryClient();
  const otherStages = stages.filter((s) => s.id !== stage.id);
  const [moveToStageId, setMoveToStageId] = useState(otherStages[0]?.id || '');
  // The API refuses (409) to delete a stage that still has deals unless it is
  // told where to move them; a deal may have been added since the list loaded.
  const [needsDestination, setNeedsDestination] = useState(stage.count > 0);

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePipelineStage(stage.id, needsDestination ? moveToStageId : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      onDone({ deleted: true });
    },
    onError: (err) => {
      if (err?.status === 409) {
        setNeedsDestination(true);
        queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      }
    },
  });

  const noDestination = needsDestination && otherStages.length === 0;

  return (
    <div role="group" aria-labelledby={`delete-stage-${stage.id}`} className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p id={`delete-stage-${stage.id}`} className="text-sm font-medium text-foreground">
        Delete “{stage.name}”?
      </p>
      {needsDestination ? (
        noDestination ? (
          <p className="text-sm text-muted-foreground">
            This stage still has deals and there is no other stage to move them to. Add another stage first.
          </p>
        ) : (
          <Field
            label={stage.count > 0 ? `Move its ${dealCountLabel(stage.count)} to` : 'Move its deals to'}
            id={`move-deals-${stage.id}`}
          >
            <Select value={moveToStageId} onChange={(e) => setMoveToStageId(e.target.value)}>
              {otherStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        )
      ) : (
        <p className="text-sm text-muted-foreground">This stage has no deals.</p>
      )}
      {deleteMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteMutation.error?.status === 409
            ? 'This stage has deals now. Choose where to move them, then delete again.'
            : deleteMutation.error?.message || 'The stage could not be deleted'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => deleteMutation.mutate()}
          loading={deleteMutation.isPending}
          disabled={noDestination || (needsDestination && !moveToStageId)}
        >
          {needsDestination ? 'Move deals and delete' : 'Delete stage'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone({ deleted: false })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddStageForm({ stages, inputRef }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  // null until the visitor picks; until then, before the "Won" stage.
  const [placement, setPlacement] = useState(null);
  const beforeId = placement ?? defaultInsertBeforeId(stages);

  const createMutation = useMutation({
    mutationFn: async (stageName) => {
      const plan = planNewStage(stages, beforeId);
      // Make room first, so the new stage sorts before the chosen one.
      for (const shift of plan.shifts) {
        await api.updatePipelineStage(shift.id, { order: shift.order });
      }
      return api.createPipelineStage({ name: stageName, order: plan.order, probability: plan.probability });
    },
    onSuccess: () => {
      setName('');
      setPlacement(null);
    },
    // Shifted orders may have been saved even when the create failed.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  const trimmed = name.trim();

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (trimmed) createMutation.mutate(trimmed); }}
      className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
    >
      <div className="min-w-0 flex-1 basis-40">
        <label htmlFor="new-stage-name" className="block text-sm font-medium text-foreground mb-1">
          New stage name
        </label>
        <Input
          ref={inputRef}
          id="new-stage-name"
          value={name}
          maxLength={100}
          placeholder="e.g. Negotiation"
          onChange={(e) => { setName(e.target.value); createMutation.reset(); }}
          className="min-h-11"
        />
      </div>
      {stages.length > 0 && (
        <div className="min-w-0 flex-1 basis-40">
          <label htmlFor="new-stage-position" className="block text-sm font-medium text-foreground mb-1">
            Place it
          </label>
          <Select id="new-stage-position" value={beforeId} onChange={(e) => setPlacement(e.target.value)}>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>Before {stage.name}</option>
            ))}
            <option value="">At the end</option>
          </Select>
        </div>
      )}
      <Button type="submit" size="sm" leftIcon={<Plus className="w-4 h-4" />} disabled={!trimmed} loading={createMutation.isPending}>
        Add stage
      </Button>
      {createMutation.isError && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {createMutation.error?.message || 'The stage could not be added'}
        </p>
      )}
    </form>
  );
}

function ManageStagesModal({ isOpen, onClose, stages }) {
  const [deletingId, setDeletingId] = useState(null);
  const deleting = stages.find((s) => s.id === deletingId) || null;
  const newStageInputRef = useRef(null);

  // After a delete the stage's row is gone, so focus moves to adding a stage;
  // after Cancel it goes back to the stage's own delete button.
  const finishDelete = (stageId, { deleted }) => {
    setDeletingId(null);
    requestAnimationFrame(() => {
      const target = deleted ? newStageInputRef.current : document.getElementById(`delete-stage-trigger-${stageId}`);
      target?.focus();
    });
  };

  const close = () => { setDeletingId(null); onClose(); };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Manage stages">
      <div className="space-y-4">
        {stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stages yet.</p>
        ) : (
          <ul className="space-y-4" aria-label="Pipeline stages">
            {stages.map((stage, index) => (
              <li key={stage.id} className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <StageRow key={`${stage.id}:${stage.name}`} stage={stage} index={index} />
                  </div>
                  <button
                    id={`delete-stage-trigger-${stage.id}`}
                    type="button"
                    onClick={() => setDeletingId(stage.id)}
                    aria-label={`Delete ${stage.name} stage`}
                    title="Delete stage"
                    className="min-h-11 min-w-11 inline-flex shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{dealCountLabel(stage.count)}</p>
                {deleting?.id === stage.id && (
                  <DeleteStagePanel
                    key={stage.id}
                    stage={stage}
                    stages={stages}
                    onDone={(result) => finishDelete(stage.id, result)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <AddStageForm stages={stages} inputRef={newStageInputRef} />
      </div>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={close}>Done</Button>
      </ModalFooter>
    </Modal>
  );
}
