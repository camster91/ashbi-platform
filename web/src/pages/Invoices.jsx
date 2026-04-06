import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Receipt, Plus, Send, DollarSign, Clock, CheckCircle, AlertTriangle,
  ExternalLink, CreditCard, FileText, Filter, Search, Download,
  TrendingUp, ArrowUpRight, MoreVertical, Trash2, Eye, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Button, Card } from '../components/ui';

const HST_RATE = 13;

const STATUS_CONFIG = {
  DRAFT:   { label: 'Draft',   color: 'bg-muted text-muted-foreground',                                              icon: Receipt },
  SENT:    { label: 'Sent',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',            icon: Send },
  PAID:    { label: 'Paid',    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',        icon: CheckCircle },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',               icon: AlertTriangle },
  VOID:    { label: 'Void',    color: 'bg-muted text-muted-foreground',              icon: Receipt },
};

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Invoices() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';

  // Support ?create=true&clientId=... from nav
  const [searchParams] = useSearchParams();
  const initCreate = searchParams.get('create') === 'true';
  const initClientId = searchParams.get('clientId') || '';

  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(initCreate);
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'collections'

  const [form, setForm] = useState({
    clientId: initClientId,
    projectId: '',
    title: '',
    notes: '',
    dueDate: '',
    taxRate: HST_RATE,
    taxType: 'HST',
    discountAmount: 0,
    isRecurring: false,
    recurringInterval: 'MONTHLY',
    lineItems: [{ description: '', itemType: 'LABOR', quantity: 1, unitPrice: 0 }],
  });

  // Queries
  const { data: invoiceData = { invoices: [], stats: {} }, isLoading } = useQuery({
    queryKey: ['invoices', filterStatus, searchQuery],
    queryFn: () => api.getInvoices({
      ...(filterStatus ? { status: filterStatus } : {}),
      ...(searchQuery ? { search: searchQuery } : {}),
    }),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects ? api.getProjects() : Promise.resolve([]),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['line-item-templates'],
    queryFn: () => api.getLineItemTemplates(),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => api.createInvoice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowCreate(false);
      resetForm();
      toast.success('Invoice created');
    },
    onError: (err) => toast.error('Failed to create invoice', err.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id) => api.sendInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice sent', 'Client will receive an email');
    },
    onError: (err) => toast.error('Failed to send invoice', err.message),
  });

  const markPaidMutation = useMutation({
    mutationFn: ({ id, data }) => api.markInvoicePaid(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice marked as paid');
    },
    onError: (err) => toast.error('Failed to update invoice', err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteInvoice(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });

  // Form helpers
  const resetForm = () => setForm({
    clientId: '', projectId: '', title: '', notes: '', dueDate: '',
    taxRate: HST_RATE, taxType: 'HST', discountAmount: 0,
    isRecurring: false, recurringInterval: 'MONTHLY',
    lineItems: [{ description: '', itemType: 'LABOR', quantity: 1, unitPrice: 0 }],
  });

  const addLineItem = () => setForm(f => ({
    ...f,
    lineItems: [...f.lineItems, { description: '', itemType: 'LABOR', quantity: 1, unitPrice: 0 }],
  }));

  const updateLineItem = (idx, field, value) => setForm(f => {
    const updated = [...f.lineItems];
    updated[idx] = { ...updated[idx], [field]: value };
    return { ...f, lineItems: updated };
  });

  const removeLineItem = (idx) => setForm(f => ({
    ...f,
    lineItems: f.lineItems.filter((_, i) => i !== idx),
  }));

  const applyTemplate = (template) => setForm(f => ({
    ...f,
    lineItems: [...f.lineItems, {
      description: template.description,
      itemType: template.itemType,
      quantity: 1,
      unitPrice: template.unitPrice,
    }],
  }));

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate({
      clientId: form.clientId,
      projectId: form.projectId || undefined,
      title: form.title || undefined,
      notes: form.notes || undefined,
      dueDate: form.dueDate || undefined,
      taxRate: parseFloat(form.taxRate),
      taxType: form.taxType,
      discountAmount: parseFloat(form.discountAmount) || 0,
      isRecurring: form.isRecurring,
      recurringInterval: form.isRecurring ? form.recurringInterval : undefined,
      lineItems: form.lineItems.map(li => ({
        description: li.description,
        itemType: li.itemType,
        quantity: parseFloat(li.quantity) || 1,
        unitPrice: parseFloat(li.unitPrice) || 0,
      })),
    });
  };

  // Calculated totals for create form
  const formSubtotal = form.lineItems.reduce(
    (sum, li) => sum + (parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0), 0
  );
  const formDiscount = parseFloat(form.discountAmount) || 0;
  const formDiscounted = Math.max(0, formSubtotal - formDiscount);
  const formTax = parseFloat(((formDiscounted * parseFloat(form.taxRate)) / 100).toFixed(2));
  const formTotal = parseFloat((formDiscounted + formTax).toFixed(2));

  const invoices = invoiceData.invoices || [];
  const stats = invoiceData.stats || {};

  // Sort: overdue first, then sent, then draft, then paid, then void
  const PRIORITY = { OVERDUE: 0, SENT: 1, DRAFT: 2, PAID: 3, VOID: 4 };
  const sortedInvoices = [...invoices].sort((a, b) => {
    const aS = a.isOverdue ? 'OVERDUE' : a.status;
    const bS = b.isOverdue ? 'OVERDUE' : b.status;
    return (PRIORITY[aS] ?? 5) - (PRIORITY[bS] ?? 5);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Track payments and billing</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" leftIcon={<Download className="w-4 h-4" />}
            onClick={() => exportToCSV(invoices)}>
            Export CSV
          </Button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            New Invoice
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[['list', 'All Invoices'], ['collections', 'Collections Dashboard']].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'collections' ? (
        <CollectionsDashboard stats={stats} invoices={invoices} onMarkPaid={(id) => markPaidMutation.mutate({ id })} />
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Outstanding" value={fmt(stats.totalOutstanding || 0)} icon={DollarSign} color="blue" />
            <StatCard label="Paid (all time)" value={fmt(stats.paid?.amount || 0)} icon={CheckCircle} color="green" />
            <StatCard label="Overdue" value={stats.overdue?.count || 0} sub={stats.overdue?.count > 0 ? fmt(stats.overdue?.amount || 0) : undefined} icon={AlertTriangle} color="red" />
            <StatCard label="Draft" value={stats.draft?.count || 0} sub={fmt(stats.draft?.amount || 0)} icon={FileText} color="gray" />
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search invoices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background"
              />
            </div>
            <div className="flex gap-1">
              {['', 'DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID'].map((s) => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
                    filterStatus === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}>
                  {s || 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Create Form */}
          {showCreate && (
            <InvoiceCreateForm
              form={form}
              clients={clients}
              projects={projects}
              templates={templates}
              formSubtotal={formSubtotal}
              formDiscount={formDiscount}
              formTax={formTax}
              formTotal={formTotal}
              onFormChange={setForm}
              onLineItemUpdate={updateLineItem}
              onLineItemAdd={addLineItem}
              onLineItemRemove={removeLineItem}
              onApplyTemplate={applyTemplate}
              onSubmit={handleCreate}
              onCancel={() => { setShowCreate(false); resetForm(); }}
              loading={createMutation.isPending}
              error={createMutation.error?.message}
            />
          )}

          {/* Invoice List */}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : sortedInvoices.length === 0 ? (
            <Card className="p-12 text-center">
              <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No invoices found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {filterStatus || searchQuery ? 'Try adjusting your filters.' : 'Create your first invoice to get started.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {sortedInvoices.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  isAdmin={isAdmin}
                  onView={() => navigate(`/invoices/${invoice.id}`)}
                  onSend={() => sendMutation.mutate(invoice.id)}
                  onMarkPaid={() => markPaidMutation.mutate({ id: invoice.id, data: { paymentMethod: 'BANK' } })}
                  onDelete={() => {
                    if (window.confirm(`Void invoice ${invoice.invoiceNumber}?`)) {
                      deleteMutation.mutate(invoice.id);
                    }
                  }}
                  sendLoading={sendMutation.isPending && sendMutation.variables === invoice.id}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Invoice Row ─────────────────────────────────────────────────────────────
function InvoiceRow({ invoice, isAdmin, onView, onSend, onMarkPaid, onDelete, sendLoading }) {
  const displayStatus = invoice.isOverdue ? 'OVERDUE' : invoice.status;
  const config = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.DRAFT;
  const StatusIcon = config.icon;
  const [showMenu, setShowMenu] = useState(false);

  return (
    <Card className={`p-4 hover:shadow-sm transition-shadow cursor-pointer ${invoice.isOverdue ? 'border-red-500/30' : ''}`}>
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0" onClick={onView}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono font-semibold text-foreground">{invoice.invoiceNumber}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{invoice.client?.name}</span>
            {invoice.title && <span className="text-xs text-muted-foreground truncate">— {invoice.title}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="font-semibold text-foreground text-sm">{fmt(invoice.total)}</span>
            {invoice.dueDate && (
              <span className={`flex items-center gap-1 ${invoice.isOverdue ? 'text-red-500' : ''}`}>
                <Clock className="w-3 h-3" />
                {invoice.isOverdue ? `${getDaysOverdue(invoice.dueDate)}d overdue` : `Due ${formatDate(invoice.dueDate)}`}
              </span>
            )}
            {invoice.paidAt && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-3 h-3" />
                Paid {formatDate(invoice.paidAt)}
              </span>
            )}
            <span className="text-muted-foreground/60">
              {invoice._count?.lineItems} item{invoice._count?.lineItems !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.color}`}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </span>

        <div className="flex items-center gap-1">
          {invoice.status === 'DRAFT' && isAdmin && (
            <Button size="sm" variant="outline" leftIcon={<Send className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onSend(); }}
              loading={sendLoading}>
              Send
            </Button>
          )}
          {(invoice.status === 'SENT' || invoice.isOverdue) && (
            <Button size="sm" variant="outline" leftIcon={<DollarSign className="w-3 h-3" />}
              onClick={(e) => { e.stopPropagation(); onMarkPaid(); }}>
              Mark Paid
            </Button>
          )}
          {invoice.stripePaymentLink && (
            <a href={invoice.stripePaymentLink} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-muted-foreground hover:text-foreground rounded"
              onClick={(e) => e.stopPropagation()} title="Stripe payment link">
              <CreditCard className="w-4 h-4" />
            </a>
          )}
          <button onClick={(e) => { e.stopPropagation(); onView(); }}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="View">
            <Eye className="w-4 h-4" />
          </button>
          {isAdmin && invoice.status !== 'PAID' && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded" title="Void invoice">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Create Form ─────────────────────────────────────────────────────────────
function InvoiceCreateForm({
  form, clients, projects, templates,
  formSubtotal, formDiscount, formTax, formTotal,
  onFormChange, onLineItemUpdate, onLineItemAdd, onLineItemRemove,
  onApplyTemplate, onSubmit, onCancel, loading, error
}) {
  const clientProjects = projects.filter(p => p.clientId === form.clientId);

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-5">New Invoice</h2>
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Client / Project / Title */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Client *</label>
            <select
              value={form.clientId}
              onChange={(e) => onFormChange(f => ({ ...f, clientId: e.target.value, projectId: '' }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required>
              <option value="">Select client...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Project (optional)</label>
            <select
              value={form.projectId}
              onChange={(e) => onFormChange(f => ({ ...f, projectId: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              disabled={!form.clientId}>
              <option value="">No project</option>
              {clientProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice Title (optional)</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => onFormChange(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Monthly Retainer – April 2026"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Due Date</label>
            <input type="date" value={form.dueDate}
              onChange={(e) => onFormChange(f => ({ ...f, dueDate: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tax</label>
            <div className="flex gap-2">
              <select value={form.taxType}
                onChange={(e) => onFormChange(f => ({ ...f, taxType: e.target.value,
                  taxRate: e.target.value === 'HST' ? 13 : e.target.value === 'GST' ? 5 : e.target.value === 'NONE' ? 0 : f.taxRate
                }))}
                className="w-28 px-2 py-2 rounded-lg border border-border bg-background text-sm">
                <option value="HST">HST</option>
                <option value="GST">GST</option>
                <option value="PST">PST</option>
                <option value="NONE">None</option>
              </select>
              <input type="number" value={form.taxRate} min="0" max="30" step="0.5"
                onChange={(e) => onFormChange(f => ({ ...f, taxRate: e.target.value }))}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="Rate %" />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Line Items</label>
            {templates.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {templates.slice(0, 4).map(t => (
                  <button key={t.id} type="button"
                    onClick={() => onApplyTemplate(t)}
                    className="text-xs px-2 py-1 rounded border border-border bg-muted hover:bg-muted/80 text-muted-foreground">
                    + {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 mb-1 text-xs text-muted-foreground font-medium px-1">
            <span className="col-span-1">Type</span>
            <span className="col-span-4">Description</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-2 text-right">Unit Price</span>
            <span className="col-span-2 text-right">Total</span>
            <span className="col-span-1" />
          </div>

          <div className="space-y-1.5">
            {form.lineItems.map((li, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select value={li.itemType}
                  onChange={(e) => onLineItemUpdate(idx, 'itemType', e.target.value)}
                  className="col-span-1 px-1 py-1.5 rounded border border-border bg-background text-xs">
                  <option value="LABOR">Labor</option>
                  <option value="MATERIALS">Materials</option>
                  <option value="EXPENSE">Expense</option>
                  <option value="DISCOUNT">Discount</option>
                  <option value="CUSTOM">Custom</option>
                </select>
                <input type="text" value={li.description}
                  onChange={(e) => onLineItemUpdate(idx, 'description', e.target.value)}
                  placeholder="Description"
                  className="col-span-4 px-2 py-1.5 rounded border border-border bg-background text-sm"
                  required />
                <input type="number" value={li.quantity} min="0" step="0.5"
                  onChange={(e) => onLineItemUpdate(idx, 'quantity', e.target.value)}
                  className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-center" />
                <input type="number" value={li.unitPrice} min="0" step="0.01"
                  onChange={(e) => onLineItemUpdate(idx, 'unitPrice', e.target.value)}
                  className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-right" />
                <span className="col-span-2 text-sm text-right font-medium">
                  {fmt((parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0))}
                </span>
                <button type="button" onClick={() => onLineItemRemove(idx)}
                  className="col-span-1 text-muted-foreground hover:text-destructive text-center text-lg leading-none">
                  ×
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={onLineItemAdd}
            className="text-sm text-primary hover:underline mt-2">
            + Add line item
          </button>
        </div>

        {/* Discount */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Discount ($)</label>
            <input type="number" value={form.discountAmount} min="0" step="0.01"
              onChange={(e) => onFormChange(f => ({ ...f, discountAmount: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <input type="text" value={form.notes}
              onChange={(e) => onFormChange(f => ({ ...f, notes: e.target.value }))}
              placeholder="Payment terms, references..."
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          </div>
        </div>

        {/* Recurring */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isRecurring}
              onChange={(e) => onFormChange(f => ({ ...f, isRecurring: e.target.checked }))}
              className="rounded" />
            <span>Recurring invoice</span>
          </label>
          {form.isRecurring && (
            <select value={form.recurringInterval}
              onChange={(e) => onFormChange(f => ({ ...f, recurringInterval: e.target.value }))}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm">
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUALLY">Annually</option>
            </select>
          )}
        </div>

        {/* Totals Preview */}
        <div className="rounded-lg bg-muted/50 p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{fmt(formSubtotal)}</span>
          </div>
          {formDiscount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Discount</span>
              <span>-{fmt(formDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">{form.taxType} ({form.taxRate}%)</span>
            <span>{fmt(formTax)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base border-t border-border pt-2 mt-2">
            <span>Total</span>
            <span>{fmt(formTotal)} CAD</span>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" loading={loading}>Create Invoice</Button>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Collections Dashboard ────────────────────────────────────────────────────
function CollectionsDashboard({ stats, invoices, onMarkPaid }) {
  const overdue = invoices.filter(i => i.isOverdue || (i.status === 'SENT' && i.dueDate && new Date(i.dueDate) < new Date()));

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <BigStat label="Total Outstanding" value={fmt((stats.sent?.amount || 0) + (stats.overdue?.amount || 0))}
          sub={`${(stats.sent?.count || 0) + (stats.overdue?.count || 0)} invoices`} color="blue" />
        <BigStat label="Overdue" value={fmt(stats.overdue?.amount || 0)}
          sub={`${stats.overdue?.count || 0} invoices`} color="red" urgent={stats.overdue?.count > 0} />
        <BigStat label="Paid (all time)" value={fmt(stats.paid?.amount || 0)}
          sub={`${stats.paid?.count || 0} invoices`} color="green" />
        <BigStat label="Draft / Unbilled" value={fmt(stats.draft?.amount || 0)}
          sub={`${stats.draft?.count || 0} invoices`} color="gray" />
      </div>

      {/* Overdue Invoices */}
      {overdue.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Overdue Invoices ({overdue.length})
          </h2>
          <div className="space-y-2">
            {overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).map(inv => (
              <Card key={inv.id} className="p-4 border-red-200 dark:border-red-900/30">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{inv.invoiceNumber}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-sm">{inv.client?.name}</span>
                    </div>
                    <div className="text-xs text-red-500 mt-0.5">
                      {getDaysOverdue(inv.dueDate)} days overdue · Due {formatDate(inv.dueDate)}
                    </div>
                  </div>
                  <span className="text-lg font-semibold">{fmt(inv.total)}</span>
                  <Button size="sm" onClick={() => onMarkPaid(inv.id)}
                    leftIcon={<DollarSign className="w-3 h-3" />}>
                    Mark Paid
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {overdue.length === 0 && (
        <Card className="p-8 text-center">
          <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="font-medium">All clear!</p>
          <p className="text-sm text-muted-foreground mt-1">No overdue invoices. 🎉</p>
        </Card>
      )}
    </div>
  );
}

// ─── Stat Cards ───────────────────────────────────────────────────────────────
const COLOR_MAP = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30',
  green: 'bg-green-100 text-green-600 dark:bg-green-900/30',
  red: 'bg-red-100 text-red-600 dark:bg-red-900/30',
  gray: 'bg-muted text-muted-foreground',
};

function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${COLOR_MAP[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

function BigStat({ label, value, sub, color, urgent }) {
  return (
    <Card className={`p-5 ${urgent ? 'border-red-400/40 dark:border-red-700/40' : ''}`}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${urgent ? 'text-red-500' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function getDaysOverdue(dueDate) {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function exportToCSV(invoices) {
  const headers = ['Invoice #', 'Client', 'Title', 'Status', 'Issue Date', 'Due Date', 'Subtotal', 'Tax', 'Total', 'Paid At'];
  const rows = invoices.map(inv => [
    inv.invoiceNumber,
    inv.client?.name || '',
    inv.title || '',
    inv.isOverdue ? 'OVERDUE' : inv.status,
    inv.issueDate ? formatDate(inv.issueDate) : '',
    inv.dueDate ? formatDate(inv.dueDate) : '',
    inv.subtotal?.toFixed(2),
    inv.tax?.toFixed(2),
    inv.total?.toFixed(2),
    inv.paidAt ? formatDate(inv.paidAt) : '',
  ]);

  const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoices-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
