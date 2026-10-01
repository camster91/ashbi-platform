import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Target, ChevronRight, ArrowRight, X, TrendingUp,
  Plus, Trash2, MoveRight, Sparkles, Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import useClients from '../hooks/useClients';
import { Card, Field, Input, LoadingState, Select } from '../components/ui';
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
        <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-card rounded-lg shadow-lg border p-3 text-sm">
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

// ── Main Page ──────────────────────────────────────────────────────────
export default function Pipeline() {
  const [expandedStage, setExpandedStage] = useState(null);
  const [showCreateDeal, setShowCreateDeal] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Track deals from lead to close</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateDeal(true)}
          className="min-h-11 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg transition-all hover:opacity-90 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Plus className="w-4 h-4" />
          New Deal
        </button>
      </div>

      <CreateDealModal
        isOpen={showCreateDeal}
        onClose={() => setShowCreateDeal(false)}
        stages={stages}
      />

      {/* Funnel visualization */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Sales Funnel
        </h2>

        {stages.length === 0 && (
          <p className="text-sm text-muted-foreground">No pipeline stages yet.</p>
        )}

        {/* Desktop: horizontal funnel */}
        <div className="hidden lg:block">
          <div className="flex items-stretch gap-0">
            {stages.map((stage, i) => {
              const isExpanded = expandedStage === stage.id;

              return (
                <div key={stage.id} className="flex items-stretch flex-1">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${stage.name} stage`}
                    onClick={() => setExpandedStage(isExpanded ? null : stage.id)}
                    className={`flex-1 relative p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isExpanded ? 'border-primary/40 shadow-lg' : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <StageIcon stage={stage} className="mx-auto mb-2" />
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground font-medium">{stage.name}</p>
                      <p className="text-2xl font-bold text-foreground mt-0.5">{stage.count}</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">{fmt(stage.value)}</p>
                    </div>
                  </button>
                  {i < stages.length - 1 && (
                    <div className="flex items-center px-1">
                      <ArrowRight className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile: vertical funnel */}
        <div className="lg:hidden space-y-3">
          {stages.map((stage, i) => {
            const isExpanded = expandedStage === stage.id;
            // Width decreases through funnel for visual effect
            const widthPct = Math.max(100 - (i * 6), 60);

            return (
              <div key={stage.id} style={{ width: `${widthPct}%` }} className="mx-auto">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${stage.name} stage`}
                  onClick={() => setExpandedStage(isExpanded ? null : stage.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isExpanded ? 'border-primary/40 shadow-lg' : 'border-border'
                  }`}
                >
                  <StageIcon stage={stage} />
                  <div className="flex-1 text-left">
                    <p className="text-xs text-muted-foreground">{stage.name}</p>
                    <p className="text-lg font-bold text-foreground">{stage.count}</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{fmt(stage.value)}</p>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Expanded stage deals */}
      {expandedStage && (
        <StageDetail
          stage={stages.find(s => s.id === expandedStage)}
          stages={stages}
          onClose={() => setExpandedStage(null)}
        />
      )}

      {/* Summary */}
      <Card className="p-6">
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

// ── Stage Detail (with deal actions) ──────────────────────────────────
function StageDetail({ stage, stages, onClose }) {
  const queryClient = useQueryClient();
  const [itemToDelete, setItemToDelete] = useState(null);

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }) => api.updatePipelineDeal(id, { stageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deletePipelineDeal(id),
    onSuccess: () => {
      setItemToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    },
  });

  const handleDelete = (deal) => {
    deleteMutation.reset();
    setItemToDelete(deal);
  };

  if (!stage) return null;

  return (
    <Card className="p-6 border-2 border-primary/40">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          {stage.name} ({stage.count})
          <span className="text-sm font-normal text-muted-foreground"> -- {fmt(stage.value)}</span>
        </h3>
        <button type="button" onClick={onClose} aria-label={`Close ${stage.name} stage`}
          className="p-1 rounded hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

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
              className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{deal.title || 'Untitled deal'}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  {deal.client?.name && (
                    <Link to={`/client/${deal.client.id}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                      {deal.client.name}
                    </Link>
                  )}
                  {deal.probability != null && <span>{deal.probability}% likely</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{fmt(deal.value ?? 0)}</span>

                {/* Hidden until hover on pointer devices, but always shown
                    while any action has keyboard focus. */}
                <div className="flex items-center gap-0.5 ml-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">
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
              </div>
            </li>
          ))}
        </ul>
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
