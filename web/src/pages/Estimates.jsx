import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Send, CheckCircle, XCircle, ArrowRightLeft,
  Trash2, Eye, Search, Pencil, CalendarDays, DollarSign, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card } from '../components/ui';

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  DRAFT:    { label: 'Draft',    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-400',        icon: FileText },
  SENT:     { label: 'Sent',     color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',       icon: Send },
  APPROVED: { label: 'Approved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',   icon: CheckCircle },
  DECLINED: { label: 'Declined', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',           icon: XCircle },
  CONVERTED:{ label: 'Converted',color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',icon: ArrowRightLeft },
};

const FILTERS = ['', 'DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'CONVERTED'];

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function defaultLineItem() {
  return { description: '', quantity: 1, rate: 0 };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Estimates() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState(null);

  const [form, setForm] = useState({
    clientId: '',
    title: '',
    description: '',
    taxRate: 13,
    validUntil: '',
    lineItems: [defaultLineItem()],
  });

  // Queries
  const { data: estimatesData = { estimates: [] }, isLoading } = useQuery({
    queryKey: ['estimates', filterStatus, searchQuery],
    queryFn: () => api.getEstimates({
      ...(filterStatus ? { status: filterStatus } : {}),
      ...(searchQuery ? { search: searchQuery } : {}),
    }),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => api.createEstimate(data),
    onSuccess: () => {
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
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setEditingEstimate(null);
      resetForm();
      toast.success('Estimate updated');
    },
    onError: (err) => toast.error('Failed to update estimate', err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteEstimate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success('Estimate deleted');
    },
    onError: (err) => toast.error('Failed to delete estimate', err.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id) => api.sendEstimate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success('Estimate sent', 'Client will receive an email');
    },
    onError: (err) => toast.error('Failed to send estimate', err.message),
  });

  const convertMutation = useMutation({
    mutationFn: (id) => api.convertEstimate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success('Estimate converted to proposal');
    },
    onError: (err) => toast.error('Failed to convert estimate', err.message),
  });

  // Form helpers
  const resetForm = () => setForm({
    clientId: '', title: '', description: '', taxRate: 13, validUntil: '',
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
  const formSubtotal = form.lineItems.reduce(
    (sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0), 0
  );
  const formTax = parseFloat(((formSubtotal * parseFloat(form.taxRate || 0)) / 100).toFixed(2));
  const formTotal = parseFloat((formSubtotal + formTax).toFixed(2));

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
    updateMutation.mutate({ id: editingEstimate.id, data: payload });
  };

  const openEdit = (estimate) => {
    setEditingEstimate(estimate);
    setForm({
      clientId: estimate.clientId || '',
      title: estimate.title || '',
      description: estimate.description || '',
      taxRate: estimate.taxRate ?? 13,
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search estimates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background"
          />
        </div>
        <div className="flex gap-1">
          {FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
                filterStatus === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s || 'All'}
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
        />
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : estimates.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No estimates found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {filterStatus || searchQuery ? 'Try adjusting your filters.' : 'Create your first estimate to get started.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {estimates.map((estimate) => (
            <EstimateCard
              key={estimate.id}
              estimate={estimate}
              onEdit={() => openEdit(estimate)}
              onSend={() => sendMutation.mutate(estimate.id)}
              onConvert={() => convertMutation.mutate(estimate.id)}
              onDelete={() => {
                if (window.confirm('Delete this estimate?')) {
                  deleteMutation.mutate(estimate.id);
                }
              }}
              sendLoading={sendMutation.isPending && sendMutation.variables === estimate.id}
              convertLoading={convertMutation.isPending && convertMutation.variables === estimate.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Estimate Card ────────────────────────────────────────────────────────────

function EstimateCard({ estimate, onEdit, onSend, onConvert, onDelete, sendLoading, convertLoading }) {
  const config = STATUS_CONFIG[estimate.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = config.icon;
  const isDraft = estimate.status === 'DRAFT';
  const isApproved = estimate.status === 'APPROVED';
  const isSent = estimate.status === 'SENT';
  const isConverted = estimate.status === 'CONVERTED';

  return (
    <Card className="p-4 hover:shadow-sm transition-shadow">
      {/* Mobile Layout */}
      <div className="sm:hidden space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground truncate">{estimate.title || 'Untitled'}</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${config.color}`}>
                <StatusIcon className="w-3 h-3" />
                {config.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{estimate.client?.name || 'No client'}</p>
          </div>
          <span className="text-lg font-semibold">{fmt(estimate.total)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {estimate.validUntil && (
            <span className="flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              Valid until {formatDate(estimate.validUntil)}
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
          {isApproved && (
            <Button size="sm" variant="outline" leftIcon={<ArrowRightLeft className="w-3 h-3" />} onClick={onConvert} loading={convertLoading}>Convert</Button>
          )}
          {isDraft && (
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive" leftIcon={<Trash2 className="w-3 h-3" />}>Delete</Button>
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
                Valid until {formatDate(estimate.validUntil)}
              </span>
            )}
            {estimate.createdAt && (
              <span>Created {formatDate(estimate.createdAt)}</span>
            )}
          </div>
        </div>

        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${config.color}`}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </span>

        <div className="flex items-center gap-1">
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
          {isApproved && (
            <Button size="sm" variant="outline" leftIcon={<ArrowRightLeft className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onConvert(); }} loading={convertLoading}>
              Convert to Proposal
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
            <span className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1">
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
  onSubmit, onCancel, loading, error,
}) {
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-lg font-semibold mb-5">{isEditing ? 'Edit Estimate' : 'New Estimate'}</h2>
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Client + Title */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Client *</label>
            <select
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
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
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
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
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
            <label className="block text-sm font-medium mb-1">Valid Until</label>
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) => onFormChange(f => ({ ...f, validUntil: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
            <input
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
          <label className="text-sm font-medium mb-3 block">Line Items</label>

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
                <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => onLineItemUpdate(idx, 'description', e.target.value)}
                    placeholder="Item description"
                    className="col-span-5 px-2 py-1.5 rounded border border-border bg-background text-sm"
                    required
                  />
                  <input
                    type="number"
                    value={li.quantity}
                    min="0"
                    step="0.5"
                    onChange={(e) => onLineItemUpdate(idx, 'quantity', e.target.value)}
                    className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-center"
                  />
                  <input
                    type="number"
                    value={li.rate}
                    min="0"
                    step="0.01"
                    onChange={(e) => onLineItemUpdate(idx, 'rate', e.target.value)}
                    className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-right"
                  />
                  <span className="col-span-2 text-sm text-right font-medium">
                    {fmt((parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0))}
                  </span>
                  <button
                    type="button"
                    onClick={() => onLineItemRemove(idx)}
                    className="col-span-1 text-muted-foreground hover:text-destructive text-center text-lg leading-none"
                    disabled={form.lineItems.length === 1}
                  >
                    &times;
                  </button>
                </div>

                {/* Mobile Stacked Card */}
                <div className="sm:hidden p-3 border border-border rounded-lg bg-muted/30 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      type="text"
                      value={li.description}
                      onChange={(e) => onLineItemUpdate(idx, 'description', e.target.value)}
                      placeholder="Item description"
                      className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                      required
                    />
                    <button type="button" onClick={() => onLineItemRemove(idx)}
                      className="p-2 text-muted-foreground hover:text-destructive rounded hover:bg-muted"
                      disabled={form.lineItems.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">Qty</label>
                      <input
                        type="number"
                        value={li.quantity}
                        min="0"
                        step="0.5"
                        onChange={(e) => onLineItemUpdate(idx, 'quantity', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">Rate</label>
                      <input
                        type="number"
                        value={li.rate}
                        min="0"
                        step="0.01"
                        onChange={(e) => onLineItemUpdate(idx, 'rate', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">Amount</label>
                      <div className="px-2 py-1.5 text-sm font-medium">
                        {fmt((parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={onLineItemAdd}
            className="text-sm text-primary hover:underline mt-2">
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
            <span>{fmt(formTotal)} CAD</span>
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