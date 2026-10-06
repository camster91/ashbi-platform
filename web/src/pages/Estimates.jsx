import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, ArrowRightLeft, Trash2, Search, Pencil, CalendarDays, Clock, Link2 } from 'lucide-react';
import { api } from '../lib/api';
import useClients from '../hooks/useClients';
import { useToast } from '../hooks/useToast';
import { Button, Card, EmptyState, LoadingState, StatusBadge } from '../components/ui';
import useAutosave from '../hooks/useAutosave';
import useIsSmUp from '../hooks/useIsSmUp';
import { invoiceTotals, lineTotal, roundMoney } from '../lib/money-totals';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import QueryErrorState from '../components/QueryErrorState';
import { formatDate, formatMoney } from '../lib/format';
import { statusLabel } from '../lib/status';

// ─── Config ───────────────────────────────────────────────────────────────────

const FILTERS = ['', 'DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'CONVERTED'];

// Estimates are in the workspace currency (CAD).
function fmt(n) {
  return formatMoney(n);
}

// Statuses staff can convert to a proposal (the API's
// ESTIMATE_CONVERTIBLE_STATUSES): approved, or sent and not yet answered.
export const CONVERTIBLE_STATUSES = ['SENT', 'APPROVED'];

/**
 * The public estimate page for this estimate, or null before it is sent.
 * The server's clientLink (built from the hub URL) wins; the browser origin
 * is only a fallback for a response without one.
 */
export function estimateClientLink(estimate, origin = window.location.origin) {
  if (!estimate || estimate.status === 'DRAFT') return null;
  if (estimate.clientLink) return estimate.clientLink;
  return estimate.viewToken ? `${origin}/portal/estimate/${estimate.viewToken}` : null;
}

/** Whether the stored link still opens (not revoked, not expired). */
export function estimateLinkUsable(estimate, now = new Date()) {
  if (!estimate?.viewToken || estimate.status === 'DRAFT' || estimate.publicAccessRevokedAt) return false;
  return !estimate.publicAccessExpiresAt || new Date(estimate.publicAccessExpiresAt) > now;
}

/**
 * The toast after sending: what really happened to the email (the API's
 * emailStatus). The estimate is sent and its link works either way.
 * @returns {{ type: 'success' | 'warning', title: string, message: string, offerLink: boolean }}
 */
export function estimateSendOutcome(result) {
  switch (result?.emailStatus) {
    case 'SENT':
      return { type: 'success', title: 'Estimate sent', message: 'The client was emailed a link to review and approve it.', offerLink: false };
    case 'NO_CLIENT_EMAIL':
      return { type: 'warning', title: 'Estimate marked as sent, but not emailed', message: 'This client has no email address. Copy the client link and share it yourself.', offerLink: true };
    case 'EMAIL_NOT_CONFIGURED':
      return { type: 'warning', title: 'Estimate marked as sent, but not emailed', message: 'Email is not set up for this workspace. Copy the client link and share it yourself.', offerLink: true };
    case 'FAILED':
      return { type: 'warning', title: 'Estimate marked as sent, but the email failed', message: 'Copy the client link and share it yourself.', offerLink: true };
    default:
      return { type: 'success', title: 'Estimate sent', message: 'Copy the client link to share it.', offerLink: true };
  }
}

const DEFAULT_TAX_RATE = 13;

// Same arithmetic as the API (computeEstimateTotals in estimate.routes.js,
// via the shared money-totals helper): each line is round2(quantity * rate),
// the subtotal is the sum of those, and tax and total round half-up to cents.
function lineAmount(li) {
  return lineTotal(parseFloat(li.quantity) || 0, parseFloat(li.rate) || 0);
}

function estimateTotals(lineItems, taxRate) {
  const { subtotal, tax, total } = invoiceTotals(lineItems.map((li) => ({ total: lineAmount(li) })), parseFloat(taxRate) || 0);
  return { subtotal, tax, total };
}

// The API stores the rate staff entered. Estimates from before it was stored
// have only the rounded tax amount: use the half-percent rate (the input's
// step) that reproduces it, else the closest two-decimal rate.
function estimateTaxRate(estimate) {
  if (estimate.taxRate !== undefined && estimate.taxRate !== null) return estimate.taxRate;
  const subtotal = Number(estimate.subtotal) || 0;
  const tax = Number(estimate.tax) || 0;
  if (subtotal <= 0) return tax > 0 ? 0 : DEFAULT_TAX_RATE;
  const exact = (tax / subtotal) * 100;
  const halfStep = Math.round(exact * 2) / 2;
  if (roundMoney((subtotal * halfStep) / 100) === roundMoney(tax)) return halfStep;
  return Math.round(exact * 100) / 100;
}

function defaultLineItem() {
  return { description: '', quantity: 1, rate: 0 };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Estimates() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState(null);
  const [estimateToDelete, setEstimateToDelete] = useState(null);
  const [estimateToConvert, setEstimateToConvert] = useState(null);

  const [form, setForm] = useState({
    clientId: '',
    title: '',
    description: '',
    taxRate: DEFAULT_TAX_RATE,
    validUntil: '',
    lineItems: [defaultLineItem()],
  });
  const draftKey = editingEstimate?.id || 'new';
  const formDraft = useAutosave('estimate', draftKey, form, 500, {
    baseUpdatedAt: editingEstimate?.updatedAt,
  });

  useEffect(() => {
    if (formDraft.draft && draftKey === 'new') setShowCreate(true);
  }, [formDraft.draft, draftKey]);

  // Queries
  const {
    data: estimatesData = { estimates: [] },
    isLoading,
    isError: estimatesError,
    error: estimatesRequestError,
    refetch: refetchEstimates,
    isFetching: estimatesFetching,
  } = useQuery({
    queryKey: ['estimates', filterStatus, searchQuery],
    queryFn: () => api.getEstimates({
      ...(filterStatus ? { status: filterStatus } : {}),
      ...(searchQuery ? { search: searchQuery } : {}),
    }),
  });

  const { data: clients } = useClients();

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => api.createEstimate(data),
    onSuccess: () => {
      void formDraft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setShowCreate(false);
      resetForm();
      toast.success('Estimate created');
    },
    onError: (err) => toast.error('Failed to create estimate', err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateEstimate(id, data),
    onSuccess: () => {
      void formDraft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setEditingEstimate(null);
      resetForm();
      toast.success('Estimate updated');
    },
    onError: (err) => toast.error('Failed to update estimate', err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteEstimate(id),
    onSuccess: (result, id) => {
      setEstimateToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      const title = estimatesData.estimates.find((estimate) => estimate.id === id)?.title || 'Estimate';
      toast.success({
        title: `${title} deleted`,
        duration: 10000,
        action: {
          label: `Undo delete ${title}`,
          onClick: async () => {
            try {
              await api.restoreTrashItem(result.trashId);
              await queryClient.invalidateQueries({ queryKey: ['estimates'] });
              toast.success('Estimate restored');
            } catch (error) {
              toast.error({
                title: 'Could not restore estimate',
                message: error.message || 'Open Trash or refresh before trying again.',
                duration: 0,
              });
              throw error;
            }
          },
        },
      });
    },
    onError: (err) => toast.error('Failed to delete estimate', err.message),
  });

  // Copies the client's estimate link. A sent estimate whose link was
  // revoked or has expired gets a fresh one first (the old one stops working).
  const copyClientLink = async (estimate) => {
    let link = estimateClientLink(estimate);
    try {
      if (!estimateLinkUsable(estimate)) {
        if (estimate.status !== 'SENT') {
          toast.error('This estimate link has expired', 'Only an estimate still awaiting an answer can get a new link.');
          return;
        }
        const fresh = await api.reissueEstimateLink(estimate.id);
        link = estimateClientLink({ ...estimate, viewToken: fresh.viewToken, clientLink: fresh.clientLink });
        queryClient.invalidateQueries({ queryKey: ['estimates'] });
      }
      if (!link) throw new Error('This estimate has no client link yet.');
      if (!navigator.clipboard?.writeText) throw new Error(`Copy it by hand: ${link}`);
      await navigator.clipboard.writeText(link);
      toast.success('Client link copied', 'Paste it into an email or message to the client.');
    } catch (err) {
      toast.error({
        title: 'Could not copy the client link',
        message: link && !String(err?.message || '').includes(link) ? `${err?.message || 'Try again.'} Link: ${link}` : (err?.message || 'Try again.'),
        duration: 0,
      });
    }
  };

  const sendMutation = useMutation({
    mutationFn: (id) => api.sendEstimate(id),
    onSuccess: (result, id) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      const outcome = estimateSendOutcome(result);
      const sent = { ...(estimatesData.estimates.find((estimate) => estimate.id === id) || {}), ...result, id };
      toast[outcome.type]({
        title: outcome.title,
        message: outcome.message,
        duration: outcome.offerLink ? 10000 : undefined,
        ...(outcome.offerLink ? { action: { label: 'Copy client link', onClick: () => copyClientLink(sent) } } : {}),
      });
    },
    onError: (err) => toast.error('Failed to send estimate', err.message),
  });

  const convertMutation = useMutation({
    mutationFn: (id) => api.convertEstimate(id),
    onSuccess: (result) => {
      setEstimateToConvert(null);
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      // Converting creates a proposal.
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      const proposalId = result?.proposal?.id;
      toast.success({
        title: 'Estimate converted to a draft proposal',
        message: 'Review it, then send it to the client.',
        ...(proposalId ? { action: { label: 'Open proposal', onClick: () => navigate(`/proposal/${proposalId}`) } } : {}),
      });
    },
    onError: (err) => toast.error('Failed to convert estimate', err.message),
  });

  // An approved estimate converts straight away; a sent one the client has
  // not answered asks first, because converting closes it to the client.
  const requestConvert = (estimate) => {
    if (estimate.status === 'SENT') {
      convertMutation.reset();
      setEstimateToConvert(estimate);
      return;
    }
    convertMutation.mutate(estimate.id);
  };

  // Form helpers
  const resetForm = () => setForm({
    clientId: '', title: '', description: '', taxRate: DEFAULT_TAX_RATE, validUntil: '',
    lineItems: [defaultLineItem()],
  });

  const updateLineItem = (idx, field, value) => setForm(f => {
    const items = [...f.lineItems];
    items[idx] = { ...items[idx], [field]: value };
    return { ...f, lineItems: items };
  });

  const addLineItem = () => setForm(f => ({
    ...f, lineItems: [...f.lineItems, defaultLineItem()],
  }));

  const removeLineItem = (idx) => setForm(f => ({
    ...f, lineItems: f.lineItems.filter((_, i) => i !== idx),
  }));

  // Computed totals
  const { subtotal: formSubtotal, tax: formTax, total: formTotal } = estimateTotals(form.lineItems, form.taxRate);

  const handleCreate = (e) => {
    e.preventDefault();
    const payload = {
      clientId: form.clientId,
      title: form.title || undefined,
      description: form.description || undefined,
      taxRate: parseFloat(form.taxRate) || 0,
      validUntil: form.validUntil || undefined,
      lineItems: form.lineItems.map(li => ({
        description: li.description,
        quantity: parseFloat(li.quantity) || 0,
        rate: parseFloat(li.rate) || 0,
      })),
    };
    createMutation.mutate(payload);
  };

  const handleUpdate = (e) => {
    e.preventDefault();
    // updateEstimateSchema: the client cannot change; an emptied
    // "Valid until" clears it (null).
    const payload = {
      title: form.title || undefined,
      description: form.description || undefined,
      taxRate: parseFloat(form.taxRate) || 0,
      validUntil: form.validUntil || null,
      lineItems: form.lineItems.map(li => ({
        description: li.description,
        quantity: parseFloat(li.quantity) || 0,
        rate: parseFloat(li.rate) || 0,
      })),
    };
    updateMutation.mutate({ id: editingEstimate.id, data: payload });
  };

  const openEdit = (estimate) => {
    setEditingEstimate(estimate);
    setForm({
      clientId: estimate.clientId || '',
      title: estimate.title || '',
      description: estimate.description || '',
      taxRate: estimateTaxRate(estimate),
      validUntil: estimate.validUntil ? estimate.validUntil.split('T')[0] : '',
      lineItems: estimate.lineItems?.length
        ? estimate.lineItems.map(li => ({
            description: li.description || '',
            quantity: li.quantity ?? 1,
            rate: li.rate ?? 0,
          }))
        : [defaultLineItem()],
    });
  };

  const cancelForm = () => {
    setShowCreate(false);
    setEditingEstimate(null);
    resetForm();
  };

  const estimates = estimatesData.estimates || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Estimates</h1>
          <p className="text-sm text-muted-foreground mt-1">Create and manage client estimates</p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setShowCreate(true); }}>
          New Estimate
        </Button>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <label htmlFor="estimate-search" className="sr-only">Search estimates</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <input
            id="estimate-search"
            type="search"
            placeholder="Search estimates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background"
          />
        </div>
        {/* Chips wrap on narrow screens instead of panning the page. */}
        <div className="flex flex-wrap gap-1 max-w-full" role="group" aria-label="Filter by status">
          {FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              aria-pressed={filterStatus === s}
              className={`min-h-11 px-3 py-1.5 text-xs rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filterStatus === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s ? statusLabel('estimate', s) : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Create / Edit Form */}
      {(showCreate || editingEstimate) && (
        <EstimateForm
          form={form}
          clients={clients}
          formSubtotal={formSubtotal}
          formTax={formTax}
          formTotal={formTotal}
          isEditing={!!editingEstimate}
          onFormChange={setForm}
          onLineItemUpdate={updateLineItem}
          onLineItemAdd={addLineItem}
          onLineItemRemove={removeLineItem}
          onSubmit={editingEstimate ? handleUpdate : handleCreate}
          onCancel={cancelForm}
          loading={editingEstimate ? updateMutation.isPending : createMutation.isPending}
          error={editingEstimate ? updateMutation.error?.message : createMutation.error?.message}
          draftState={formDraft}
        />
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingState label="Loading estimates…" compact />
        </div>
      ) : estimatesError ? (
        <QueryErrorState
          error={estimatesRequestError}
          message="Estimates could not be loaded"
          onRetry={refetchEstimates}
          isRetrying={estimatesFetching}
        />
      ) : estimates.length === 0 ? (
        <Card>
          <EmptyState
            icon={filterStatus || searchQuery ? 'search' : 'document'}
            title="No estimates found"
            description={filterStatus || searchQuery ? 'Try adjusting or clearing your filters.' : 'Create your first estimate to get started.'}
            actionLabel={filterStatus || searchQuery ? 'Clear Filters' : 'Create Estimate'}
            onAction={filterStatus || searchQuery
              ? () => { setFilterStatus(''); setSearchQuery(''); }
              : () => { resetForm(); setShowCreate(true); }}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {estimates.map((estimate) => (
            <EstimateCard
              key={estimate.id}
              estimate={estimate}
              onEdit={() => openEdit(estimate)}
              onSend={() => sendMutation.mutate(estimate.id)}
              onConvert={() => requestConvert(estimate)}
              onCopyLink={() => copyClientLink(estimate)}
              onDelete={() => { deleteMutation.reset(); setEstimateToDelete(estimate); }}
              sendLoading={sendMutation.isPending && sendMutation.variables === estimate.id}
              convertLoading={convertMutation.isPending && convertMutation.variables === estimate.id}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(estimateToDelete)}
        title="Delete estimate"
        description={estimateToDelete ? `Delete “${estimateToDelete.title || 'this estimate'}”? You can undo this action for 10 seconds.` : ''}
        confirmLabel="Delete estimate"
        onConfirm={() => estimateToDelete && deleteMutation.mutate(estimateToDelete.id)}
        onCancel={() => { deleteMutation.reset(); setEstimateToDelete(null); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />
      <ConfirmDialog
        isOpen={Boolean(estimateToConvert)}
        title="Convert to proposal"
        description={estimateToConvert
          ? `The client has not answered “${estimateToConvert.title || 'this estimate'}” yet. Converting makes a draft proposal and closes the estimate, so the client can no longer approve it from their link. You then send them the proposal.`
          : ''}
        confirmLabel="Convert to proposal"
        onConfirm={() => estimateToConvert && convertMutation.mutate(estimateToConvert.id)}
        onCancel={() => { convertMutation.reset(); setEstimateToConvert(null); }}
        pending={convertMutation.isPending}
        error={convertMutation.error?.message}
      />
    </div>
  );
}

// ─── Estimate Card ────────────────────────────────────────────────────────────

function EstimateCard({ estimate, onEdit, onSend, onConvert, onCopyLink, onDelete, sendLoading, convertLoading }) {
  const isDraft = estimate.status === 'DRAFT';
  const isSent = estimate.status === 'SENT';
  const isConverted = estimate.status === 'CONVERTED';
  const canConvert = CONVERTIBLE_STATUSES.includes(estimate.status);
  // A sent estimate can always share its link (a fresh one if it lapsed);
  // an answered one while its link still opens.
  const canCopyLink = isSent || (!isDraft && estimateLinkUsable(estimate));

  return (
    <Card className="p-4 hover:shadow-sm transition-shadow">
      {/* Mobile Layout */}
      <div className="sm:hidden space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground truncate">{estimate.title || 'Untitled'}</span>
              <StatusBadge domain="estimate" status={estimate.status} />
            </div>
            <p className="text-sm text-muted-foreground">{estimate.client?.name || 'No client'}</p>
          </div>
          <span className="text-lg font-semibold">{fmt(estimate.total)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {estimate.validUntil && (
            <span className="flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              Valid until {formatDate(estimate.validUntil, { dateOnly: true })}
            </span>
          )}
          {estimate.createdAt && (
            <span>Created {formatDate(estimate.createdAt)}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          {isDraft && (
            <Button size="sm" variant="outline" leftIcon={<Pencil className="w-3 h-3" />} onClick={onEdit}>Edit</Button>
          )}
          {isDraft && (
            <Button size="sm" variant="outline" leftIcon={<Send className="w-3 h-3" />} onClick={onSend} loading={sendLoading}>Send</Button>
          )}
          {canCopyLink && (
            <Button size="sm" variant="outline" leftIcon={<Link2 className="w-3 h-3" />} onClick={onCopyLink}>Copy client link</Button>
          )}
          {canConvert && (
            <Button size="sm" variant="outline" leftIcon={<ArrowRightLeft className="w-3 h-3" />} onClick={onConvert} loading={convertLoading}>Convert to proposal</Button>
          )}
          {isDraft && (
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive/80" leftIcon={<Trash2 className="w-3 h-3" />}>Delete</Button>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden sm:flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{estimate.title || 'Untitled'}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{estimate.client?.name || 'No client'}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="font-semibold text-foreground text-sm">{fmt(estimate.total)}</span>
            {estimate.validUntil && (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                Valid until {formatDate(estimate.validUntil, { dateOnly: true })}
              </span>
            )}
            {estimate.createdAt && (
              <span>Created {formatDate(estimate.createdAt)}</span>
            )}
          </div>
        </div>

        <StatusBadge domain="estimate" status={estimate.status} className="px-2.5 py-1" />

        <div className="flex flex-wrap items-center justify-end gap-1">
          {isDraft && (
            <Button size="sm" variant="outline" leftIcon={<Pencil className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}>
              Edit
            </Button>
          )}
          {isDraft && (
            <Button size="sm" variant="outline" leftIcon={<Send className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onSend(); }} loading={sendLoading}>
              Send
            </Button>
          )}
          {canCopyLink && (
            <Button size="sm" variant="outline" leftIcon={<Link2 className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onCopyLink(); }}>
              Copy client link
            </Button>
          )}
          {canConvert && (
            <Button size="sm" variant="outline" leftIcon={<ArrowRightLeft className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onConvert(); }} loading={convertLoading}>
              Convert to proposal
            </Button>
          )}
          {isDraft && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded" title="Delete estimate">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {isSent && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> Awaiting response
            </span>
          )}
          {isConverted && (
            <span className="text-xs text-primary flex items-center gap-1">
              <ArrowRightLeft className="w-3 h-3" /> Converted
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Create / Edit Form ───────────────────────────────────────────────────────

function EstimateForm({
  form, clients, formSubtotal, formTax, formTotal, isEditing,
  onFormChange, onLineItemUpdate, onLineItemAdd, onLineItemRemove,
  onSubmit, onCancel, loading, error, draftState,
}) {
  // One set of line-item inputs for the layout in use, so a required field is
  // never a hidden duplicate the browser cannot focus.
  const isSmUp = useIsSmUp();
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-lg font-semibold mb-5">{isEditing ? 'Edit Estimate' : 'New Estimate'}</h2>
      <DraftRecoveryNotice
        draft={draftState.draft}
        draftSavedAt={draftState.draftMeta?.draftSavedAt}
        status={draftState.status}
        lastSaved={draftState.lastSaved}
        onRecover={(recovered) => { onFormChange(recovered); draftState.setDraft(null); }}
        onDiscard={draftState.discardDraft}
        onRetry={draftState.saveNow}
      />
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Client + Title */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="estimate-client" className="block text-sm font-medium mb-1">Client *</label>
            <select
              id="estimate-client"
              value={form.clientId}
              onChange={(e) => onFormChange(f => ({ ...f, clientId: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            >
              <option value="">Select client...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="estimate-title" className="block text-sm font-medium mb-1">Title *</label>
            <input
              id="estimate-title"
              type="text"
              value={form.title}
              onChange={(e) => onFormChange(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Website Redesign Estimate"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="estimate-description" className="block text-sm font-medium mb-1">Description</label>
          <textarea
            id="estimate-description"
            value={form.description}
            onChange={(e) => onFormChange(f => ({ ...f, description: e.target.value }))}
            placeholder="Scope of work, notes, terms..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-y"
          />
        </div>

        {/* Valid Until + Tax */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="estimate-valid-until" className="block text-sm font-medium mb-1">Valid Until</label>
            <input
              id="estimate-valid-until"
              type="date"
              value={form.validUntil}
              onChange={(e) => onFormChange(f => ({ ...f, validUntil: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div>
            <label htmlFor="estimate-tax-rate" className="block text-sm font-medium mb-1">Tax Rate (%)</label>
            <input
              id="estimate-tax-rate"
              type="number"
              value={form.taxRate}
              min="0"
              max="30"
              step="0.5"
              onChange={(e) => onFormChange(f => ({ ...f, taxRate: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="13"
            />
          </div>
        </div>

        {/* Line Items */}
        <div>
          <h3 id="estimate-line-items-heading" className="text-sm font-medium mb-3">Line Items</h3>

          {/* Desktop Column Headers */}
          <div className="hidden sm:grid grid-cols-12 gap-2 mb-1 text-xs text-muted-foreground font-medium px-1">
            <span className="col-span-5">Description</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-2 text-right">Rate</span>
            <span className="col-span-2 text-right">Amount</span>
            <span className="col-span-1" />
          </div>

          <div className="space-y-2 sm:space-y-1.5">
            {form.lineItems.map((li, idx) => (
              <div key={idx}>
                {/* Desktop Row */}
                {isSmUp ? (
                <div className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => onLineItemUpdate(idx, 'description', e.target.value)}
                    placeholder="Item description"
                    aria-label={`Line item ${idx + 1} description`}
                    className="col-span-5 px-2 py-1.5 rounded border border-border bg-background text-sm"
                    required
                  />
                  <input
                    type="number"
                    value={li.quantity}
                    min="0"
                    step="0.5"
                    onChange={(e) => onLineItemUpdate(idx, 'quantity', e.target.value)}
                    aria-label={`Line item ${idx + 1} quantity`}
                    className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-center"
                  />
                  <input
                    type="number"
                    value={li.rate}
                    min="0"
                    step="0.01"
                    onChange={(e) => onLineItemUpdate(idx, 'rate', e.target.value)}
                    aria-label={`Line item ${idx + 1} rate`}
                    className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-right"
                  />
                  <span className="col-span-2 text-sm text-right font-medium">
                    {fmt(lineAmount(li))}
                  </span>
                  <button
                    type="button"
                    onClick={() => onLineItemRemove(idx)}
                    aria-label={`Remove estimate line item ${idx + 1}`}
                    className="col-span-1 min-h-11 min-w-11 text-muted-foreground hover:text-destructive text-center text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={form.lineItems.length === 1}
                  >
                    &times;
                  </button>
                </div>
                ) : (
                /* Mobile Stacked Card */
                <div className="p-3 border border-border rounded-lg bg-muted/30 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      type="text"
                      value={li.description}
                      onChange={(e) => onLineItemUpdate(idx, 'description', e.target.value)}
                      placeholder="Item description"
                      aria-label={`Line item ${idx + 1} description`}
                      className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                      required
                    />
                    <button type="button" onClick={() => onLineItemRemove(idx)}
                      aria-label={`Remove estimate line item ${idx + 1}`}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center p-2 text-muted-foreground hover:text-destructive rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={form.lineItems.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label htmlFor={`estimate-line-${idx}-qty`} className="block text-xs text-muted-foreground mb-0.5">Qty</label>
                      <input
                        id={`estimate-line-${idx}-qty`}
                        type="number"
                        value={li.quantity}
                        min="0"
                        step="0.5"
                        onChange={(e) => onLineItemUpdate(idx, 'quantity', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm text-center"
                      />
                    </div>
                    <div>
                      <label htmlFor={`estimate-line-${idx}-rate`} className="block text-xs text-muted-foreground mb-0.5">Rate</label>
                      <input
                        id={`estimate-line-${idx}-rate`}
                        type="number"
                        value={li.rate}
                        min="0"
                        step="0.01"
                        onChange={(e) => onLineItemUpdate(idx, 'rate', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                      />
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground mb-0.5">Amount</span>
                      <div className="px-2 py-1.5 text-sm font-medium">
                        {fmt(lineAmount(li))}
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>
            ))}
          </div>

          <button type="button" onClick={onLineItemAdd}
            aria-label="Add estimate line item"
            className="min-h-11 text-sm text-primary hover:underline mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            + Add line item
          </button>
        </div>

        {/* Totals */}
        <div className="rounded-lg bg-muted/50 p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{fmt(formSubtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax ({form.taxRate}%)</span>
            <span>{fmt(formTax)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base border-t border-border pt-2 mt-2">
            <span>Total</span>
            <span>{fmt(formTotal)}</span>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            {isEditing ? 'Update Estimate' : 'Create Estimate'}
          </Button>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
