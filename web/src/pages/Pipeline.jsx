import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Target, FileText, ScrollText, FolderOpen, Receipt, DollarSign,
  ChevronRight, ArrowRight, X, ExternalLink, TrendingUp,
  Plus, Trash2, MoveRight, Settings2,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card, LoadingState } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import Modal, { ModalFooter } from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const PRIMARY = '#2e2958';
const ACCENT = '#e6f354';

function fmt(n) {
  if (n == null) return '--';
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STAGE_CONFIG = {
  leads: { icon: Target, color: 'from-violet-500 to-purple-600', bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'border-violet-500/30' },
  proposals: { icon: FileText, color: 'from-blue-500 to-cyan-500', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' },
  contracts: { icon: ScrollText, color: 'from-amber-500 to-orange-500', bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30' },
  projects: { icon: FolderOpen, color: 'from-emerald-500 to-green-600', bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30' },
  invoiced: { icon: Receipt, color: 'from-pink-500 to-rose-500', bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/30' },
  paid: { icon: DollarSign, color: 'from-emerald-400 to-teal-500', bg: 'bg-teal-500/10', text: 'text-teal-500', border: 'border-teal-500/30' },
};

const CONVERSION_LABELS = {
  leadToProposal: 'Lead > Proposal',
  proposalToContract: 'Proposal > Contract',
  contractToProject: 'Contract > Project',
  invoiceToPaid: 'Invoice > Paid',
};

// ── Create Deal Modal ──────────────────────────────────────────────────
function CreateDealModal({ isOpen, onClose, stages }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({ name: '', clientId: '', value: '', stageId: '' });
  const [error, setError] = useState('');

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
    enabled: isOpen,
  });
  const clients = clientsData?.clients || clientsData || [];

  // Set default stage when stages load
  useEffect(() => {
    if (isOpen && stages.length && !formData.stageId) {
      setFormData(prev => ({ ...prev, stageId: stages[0].id || '' }));
    }
  }, [isOpen, stages]);

  const mutation = useMutation({
    mutationFn: (data) => api.createPipelineDeal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      setFormData({ name: '', clientId: '', value: '', stageId: stages[0]?.id || '' });
      setError('');
      onClose();
    },
    onError: (err) => setError(err.message || 'Failed to create deal'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Deal name is required'); return; }
    if (!formData.clientId) { setError('Client is required'); return; }
    if (!formData.stageId) { setError('Pipeline stage is required'); return; }
    mutation.mutate({
      name: formData.name,
      clientId: formData.clientId,
      value: formData.value ? Number(formData.value) : undefined,
      stageId: formData.stageId,
    });
  };

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Deal">
      <form onSubmit={handleSubmit}>
        {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deal Name *</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': ACCENT }} placeholder="Website Redesign" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
            <select name="clientId" value={formData.clientId} onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2">
              <option value="">Select a client</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Value ($)</label>
            <input type="number" name="value" value={formData.value} onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
              placeholder="5000" min="0" step="100" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
            <select name="stageId" value={formData.stageId} onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2">
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.label || s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <ModalFooter>
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: PRIMARY }}>
            {mutation.isPending ? 'Creating...' : 'Create Deal'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function isValidProbability(value) {
  if (String(value).trim() === '') return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100;
}

function StageEditor({ stage, stages }) {
  const queryClient = useQueryClient();
  const originalName = stage.label || stage.name;
  const [name, setName] = useState(originalName);
  const [probability, setProbability] = useState(String(stage.probability ?? 0));
  const [moveToStageId, setMoveToStageId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data) => api.updatePipelineStage(stage.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deletePipelineStage(stage.id, moveToStageId || undefined),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    },
  });

  const handleSave = (event) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || !isValidProbability(probability)) return;
    updateMutation.mutate({ name: normalizedName, probability: Number(probability) });
  };

  return (
    <li className="rounded-lg border p-3">
      <form onSubmit={handleSave} className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <div>
          <label htmlFor={`pipeline-stage-name-${stage.id}`} className="block text-sm font-medium mb-1">
            Stage name for {originalName}
          </label>
          <input
            id={`pipeline-stage-name-${stage.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor={`pipeline-stage-probability-${stage.id}`} className="block text-sm font-medium mb-1">
            Probability for {originalName}
          </label>
          <input
            id={`pipeline-stage-probability-${stage.id}`}
            type="number"
            min="0"
            max="100"
            value={probability}
            onChange={(event) => setProbability(event.target.value)}
            aria-invalid={!isValidProbability(probability)}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={updateMutation.isPending || !name.trim() || !isValidProbability(probability)}
          className="min-h-11 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
          aria-label={`Save ${originalName}`}
        >
          {updateMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        {stage.count} {stage.count === 1 ? 'deal' : 'deals'} in this stage
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        {stage.count > 0 ? (
          <div className="flex-1">
            <label htmlFor={`pipeline-stage-destination-${stage.id}`} className="block text-sm font-medium mb-1">
              Move deals from {originalName} to
            </label>
            <select
              id={`pipeline-stage-destination-${stage.id}`}
              value={moveToStageId}
              onChange={(event) => setMoveToStageId(event.target.value)}
              className="min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">Select a destination stage</option>
              {stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label || candidate.name}
                </option>
              ))}
            </select>
          </div>
        ) : <span />}
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={stage.count > 0 && !moveToStageId}
          aria-label={`Delete ${originalName}`}
          className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete stage
        </button>
      </div>
      {updateMutation.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {updateMutation.error.message || 'Failed to update stage'}
        </p>
      )}
      <ConfirmDialog
        isOpen={confirmDelete}
        title={`Delete ${originalName} stage`}
        description={stage.count > 0
          ? `Move ${stage.count} ${stage.count === 1 ? 'deal' : 'deals'} to the selected stage, then permanently delete ${originalName}?`
          : `Permanently delete the empty ${originalName} stage?`}
        confirmLabel={stage.count > 0
          ? `Move ${stage.count} ${stage.count === 1 ? 'deal' : 'deals'} and delete stage`
          : 'Delete stage'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => { deleteMutation.reset(); setConfirmDelete(false); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />
    </li>
  );
}

function StageManagerModal({ isOpen, onClose, stages }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [probability, setProbability] = useState('0');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data) => api.createPipelineStage(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      setName('');
      setProbability('0');
      setError('');
    },
    onError: (err) => setError(err.message || 'Failed to create stage'),
  });

  const handleCreate = (event) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Stage name is required');
      return;
    }
    if (!isValidProbability(probability)) {
      setError('Probability must be a whole number from 0 to 100');
      return;
    }
    const order = stages.length
      ? Math.max(...stages.map((stage) => Number(stage.order) || 0)) + 1
      : 0;
    createMutation.mutate({
      name: normalizedName,
      probability: Number(probability),
      order,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage pipeline stages" size="lg">
      <p className="text-sm text-muted-foreground mb-4">
        Stages are shared by the authenticated Ashbi workspace. Add only stages the team has deliberately approved.
      </p>
      {stages.length > 0 && (
        <ol className="space-y-2 mb-6" aria-label="Current pipeline stages">
          {stages.map((stage) => (
            <StageEditor key={stage.id} stage={stage} stages={stages} />
          ))}
        </ol>
      )}
      <form onSubmit={handleCreate}>
        <h3 className="font-semibold text-foreground mb-3">Add a stage</h3>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div>
            <label htmlFor="new-pipeline-stage-name" className="block text-sm font-medium mb-1">
              New stage name
            </label>
            <input
              id="new-pipeline-stage-name"
              value={name}
              onChange={(event) => { setName(event.target.value); setError(''); }}
              className="min-h-11 w-full rounded-lg border px-3 py-2"
              maxLength={100}
            />
          </div>
          <div>
            <label htmlFor="new-pipeline-stage-probability" className="block text-sm font-medium mb-1">
              Probability (%)
            </label>
            <input
              id="new-pipeline-stage-probability"
              type="number"
              min="0"
              max="100"
              value={probability}
              onChange={(event) => { setProbability(event.target.value); setError(''); }}
              aria-invalid={!isValidProbability(probability)}
              className="min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim() || !isValidProbability(probability)}
            className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: PRIMARY }}
          >
            {createMutation.isPending ? 'Adding…' : 'Add stage'}
          </button>
        </div>
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
        aria-label={`Move ${deal.name} to another stage`}
        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Move to stage">
        <MoveRight className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-48 bg-white rounded-lg shadow-lg border py-1 text-sm">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Move to</div>
          {otherStages.map(s => (
            <button key={s.id} type="button" role="menuitem"
              className="min-h-11 w-full text-left px-3 py-1.5 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onMove(deal.id, s.id); }}>
              {s.label || s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function Pipeline() {
  const [expandedStage, setExpandedStage] = useState(null);
  const [showCreateDeal, setShowCreateDeal] = useState(false);
  const [showStageManager, setShowStageManager] = useState(false);

  const {
    data,
    isLoading,
    isError: pipelineError,
    error: pipelineRequestError,
    refetch: refetchPipeline,
    isFetching: pipelineFetching,
  } = useQuery({
    queryKey: ['pipeline'],
    // There is no /reports/pipeline endpoint; the deal pipeline lives at
    // /pipeline (stages+deals) and /pipeline/analytics (conversion metrics).
    queryFn: async () => {
      const [stages, analytics] = await Promise.all([
        api.getPipelineStages(),
        api.getPipelineAnalytics().catch(() => ({})),
      ]);
      return {
        stages: Array.isArray(stages) ? stages : (stages?.stages ?? []),
        conversionRates: analytics?.conversionRates ?? {},
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
  const rates = data?.conversionRates || {};
  const hasConversionEvidence = Object.keys(rates).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Track deals from lead to payment</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowStageManager(true)}
            className="min-h-11 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="w-4 h-4" />
            Manage stages
          </button>
          <button
            type="button"
            onClick={() => setShowCreateDeal(true)}
            disabled={!stages.length}
            title={!stages.length ? 'Set up a pipeline stage first' : 'Create a deal'}
            className="min-h-11 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-all hover:opacity-90 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            style={{ backgroundColor: PRIMARY }}>
            <Plus className="w-4 h-4" />
            New Deal
          </button>
        </div>
      </div>

      <StageManagerModal
        isOpen={showStageManager}
        onClose={() => setShowStageManager(false)}
        stages={stages}
      />

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

        {!stages.length && (
          <p className="text-sm text-muted-foreground">
            Set up at least one pipeline stage before creating a deal.
          </p>
        )}

        {/* Desktop: horizontal funnel */}
        <div className="hidden lg:block">
          <div className="flex items-stretch gap-0">
            {stages.map((stage, i) => {
              const config = STAGE_CONFIG[stage.key] || STAGE_CONFIG.leads;
              const Icon = config.icon;
              const isExpanded = expandedStage === stage.key;

              return (
                <div key={stage.key} className="flex items-stretch flex-1">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${stage.label} stage`}
                    onClick={() => setExpandedStage(isExpanded ? null : stage.key)}
                    className={`flex-1 relative p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isExpanded ? `${config.border} shadow-lg` : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${config.color} flex items-center justify-center mx-auto mb-2`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground font-medium">{stage.label}</p>
                      <p className="text-2xl font-bold text-foreground mt-0.5">{stage.count}</p>
                      {stage.value != null && (
                        <p className={`text-sm font-semibold ${config.text} mt-0.5`}>{fmt(stage.value)}</p>
                      )}
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
            const config = STAGE_CONFIG[stage.key] || STAGE_CONFIG.leads;
            const Icon = config.icon;
            const isExpanded = expandedStage === stage.key;
            // Width decreases through funnel for visual effect
            const widthPct = 100 - (i * 6);

            return (
              <div key={stage.key} style={{ width: `${widthPct}%` }} className="mx-auto">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${stage.label} stage`}
                  onClick={() => setExpandedStage(isExpanded ? null : stage.key)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isExpanded ? `${config.border} shadow-lg` : 'border-border'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${config.color} flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs text-muted-foreground">{stage.label}</p>
                    <p className="text-lg font-bold text-foreground">{stage.count}</p>
                  </div>
                  {stage.value != null && (
                    <p className={`text-sm font-semibold ${config.text}`}>{fmt(stage.value)}</p>
                  )}
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Expanded stage items */}
      {expandedStage && (
        <StageDetail
          stage={stages.find(s => s.key === expandedStage)}
          stages={stages}
          config={STAGE_CONFIG[expandedStage]}
          onClose={() => setExpandedStage(null)}
        />
      )}

      {/* Conversion Rates */}
      {hasConversionEvidence ? (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Conversion Rates (All-Time)</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(CONVERSION_LABELS).map(([key, label]) => {
              const rate = rates[key];
              if (rate == null) return null;
              return (
                <div key={key} className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className={`text-xl font-bold ${rate >= 50 ? 'text-emerald-500' : rate >= 25 ? 'text-amber-500' : 'text-red-400'}`}>
                    {rate}%
                  </p>
                  <div className="w-full h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${rate >= 50 ? 'bg-emerald-500' : rate >= 25 ? 'bg-amber-500' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(rate, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Conversion evidence</h2>
          <p className="text-sm text-muted-foreground">
            Conversion rates need verified lifecycle events before they can be reported.
          </p>
        </Card>
      )}
    </div>
  );
}

// ── Stage Detail (with deal actions) ──────────────────────────────────
function StageDetail({ stage, stages, config, onClose }) {
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
  const Icon = config?.icon || Target;

  const linkFor = (item) => {
    switch (stage.key) {
      case 'leads': return null;
      case 'proposals': return `/proposal/${item.id}`;
      case 'contracts': return `/contracts`;
      case 'projects': return `/project/${item.id}`;
      case 'invoiced':
      case 'paid': return `/invoices/${item.id}`;
      default: return null;
    }
  };

  const nameFor = (item) => {
    if (item.name) return item.name;
    if (item.title) return item.title;
    if (item.invoiceNumber) return item.invoiceNumber;
    return 'Unnamed';
  };

  return (
    <Card className={`p-6 border-2 ${config?.border || 'border-border'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Icon className={`w-5 h-5 ${config?.text || 'text-primary'}`} />
          {stage.label} ({stage.count})
          {stage.value != null && <span className={`text-sm font-normal ${config?.text}`}> -- {fmt(stage.value)}</span>}
        </h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {!stage.items?.length ? (
        <p className="text-sm text-muted-foreground">No items in this stage</p>
      ) : (
        <div className="space-y-2">
          {stage.items.map((item, i) => {
            const link = linkFor(item);
            const name = nameFor(item);
            const Wrapper = link ? Link : 'div';
            const wrapperProps = link ? { to: link } : {};

            return (
              <Wrapper
                key={item.id || i}
                {...wrapperProps}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {item.clientName && <span>{item.clientName}</span>}
                    {item.status && <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{item.status}</span>}
                    {item.company && <span>{item.company}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(item.total != null || item.budget != null) && (
                    <span className={`text-sm font-semibold ${config?.text || 'text-foreground'}`}>
                      {fmt(item.total ?? item.budget)}
                    </span>
                  )}
                  {link && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}

                  {/* Action buttons — only for pipeline deals with an id */}
                  {item.id && (
                    <div className="flex items-center gap-0.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.preventDefault()}>
                      <MoveToDropdown deal={item} stages={stages} currentStageId={stage.id}
                        onMove={(id, stageId) => moveMutation.mutate({ id, stageId })} />
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(item); }}
                        aria-label={`Delete ${name}`}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-md hover:bg-red-50 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Delete deal">
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
              </Wrapper>
            );
          })}
        </div>
       )}
       <ConfirmDialog
         isOpen={Boolean(itemToDelete)}
         title="Delete pipeline item"
         description={itemToDelete ? `Permanently delete “${nameFor(itemToDelete)}”? This cannot be undone.` : ''}
         confirmLabel="Permanently delete"
         onConfirm={() => itemToDelete && deleteMutation.mutate(itemToDelete.id)}
         onCancel={() => { deleteMutation.reset(); setItemToDelete(null); }}
         pending={deleteMutation.isPending}
         error={deleteMutation.error?.message}
       />
     </Card>
  );
}
