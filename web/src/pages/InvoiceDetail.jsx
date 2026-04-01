import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Send, DollarSign, Printer, FileText, CheckCircle,
  AlertTriangle, Edit2, Save, X, Plus, Clock, CreditCard,
  Trash2, ExternalLink, RefreshCw, Receipt,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Button, Card } from '../components/ui';

const HST_RATE = 13;

const STATUS_CONFIG = {
  DRAFT:   { label: 'Draft',   color: 'bg-muted text-muted-foreground' },
  SENT:    { label: 'Sent',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  PAID:    { label: 'Paid',    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  VOID:    { label: 'Void',    color: 'bg-gray-100 text-gray-500' },
};

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [payForm, setPayForm] = useState({ paymentMethod: 'BANK', paymentNotes: '', transactionId: '' });
  const [showPdf, setShowPdf] = useState(false);
  const pdfRef = useRef(null);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.getInvoice(id),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['invoice-payments', id],
    queryFn: () => api.getInvoicePayments(id),
    enabled: !!invoice,
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateInvoice(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      setEditing(false);
      setEditForm(null);
    },
  });

  const sendMutation = useMutation({
    mutationFn: () => api.sendInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: (data) => api.markInvoicePaid(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowMarkPaid(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteInvoice(id),
    onSuccess: () => navigate('/invoices'),
  });

  const [copyLinkMsg, setCopyLinkMsg] = useState('');
  const generatePaymentLinkMutation = useMutation({
    mutationFn: () => api.generateInvoicePaymentLink(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    },
  });

  const startEdit = () => {
    setEditForm({
      title: invoice.title || '',
      notes: invoice.notes || '',
      internalNotes: invoice.internalNotes || '',
      dueDate: invoice.dueDate ? invoice.dueDate.split('T')[0] : '',
      taxRate: invoice.taxRate || HST_RATE,
      taxType: invoice.taxType || 'HST',
      discountAmount: invoice.discountAmount || 0,
      lineItems: (invoice.lineItems || []).map(li => ({
        id: li.id,
        description: li.description,
        itemType: li.itemType || 'LABOR',
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        total: li.total,
      })),
    });
    setEditing(true);
  };

  const handleUpdate = (e) => {
    e.preventDefault();
    updateMutation.mutate({
      title: editForm.title || undefined,
      notes: editForm.notes || undefined,
      internalNotes: editForm.internalNotes || undefined,
      dueDate: editForm.dueDate || undefined,
      taxRate: parseFloat(editForm.taxRate),
      taxType: editForm.taxType,
      discountAmount: parseFloat(editForm.discountAmount) || 0,
      lineItems: editForm.lineItems.map((li, idx) => ({
        description: li.description,
        itemType: li.itemType,
        quantity: parseFloat(li.quantity) || 1,
        unitPrice: parseFloat(li.unitPrice) || 0,
        position: idx,
      })),
    });
  };

  const handlePrint = () => {
    // Open PDF in new window for printing
    api.getInvoicePdf(id).catch(() => {});
    const url = `${window.location.origin}/api/invoices/${id}/pdf`;
    const w = window.open(url, '_blank');
    if (w) setTimeout(() => w.print(), 1000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button className="mt-4" onClick={() => navigate('/invoices')}>Back to Invoices</Button>
      </div>
    );
  }

  const displayStatus = invoice.isOverdue ? 'OVERDUE' : invoice.status;
  const statusCfg = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.DRAFT;
  const isDraft = invoice.status === 'DRAFT';
  const isSent = invoice.status === 'SENT' || invoice.isOverdue;
  const isPaid = invoice.status === 'PAID';

  // Edit form calculations
  const editSubtotal = editForm
    ? editForm.lineItems.reduce((s, li) => s + (parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0), 0)
    : 0;
  const editDiscount = editForm ? parseFloat(editForm.discountAmount) || 0 : 0;
  const editDiscounted = Math.max(0, editSubtotal - editDiscount);
  const editTax = parseFloat(((editDiscounted * parseFloat(editForm?.taxRate || HST_RATE)) / 100).toFixed(2));
  const editTotal = parseFloat((editDiscounted + editTax).toFixed(2));

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/invoices')}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold font-mono">{invoice.invoiceNumber}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
              {invoice.isRecurring && (
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                  <RefreshCw className="w-3 h-3 inline mr-1" />
                  {invoice.recurringInterval}
                </span>
              )}
            </div>
            {invoice.title && <p className="text-muted-foreground mt-0.5">{invoice.title}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isDraft && (
            <>
              <Button variant="outline" size="sm" leftIcon={<Edit2 className="w-4 h-4" />} onClick={startEdit}>
                Edit
              </Button>
              {isAdmin && (
                <Button size="sm" leftIcon={<Send className="w-4 h-4" />}
                  onClick={() => sendMutation.mutate()} loading={sendMutation.isPending}>
                  Send to Client
                </Button>
              )}
            </>
          )}
          {isSent && !isPaid && (
            <Button size="sm" leftIcon={<DollarSign className="w-4 h-4" />}
              onClick={() => setShowMarkPaid(true)}>
              Mark as Paid
            </Button>
          )}
          <Button variant="outline" size="sm" leftIcon={<Printer className="w-4 h-4" />}
            onClick={handlePrint}>
            Print / PDF
          </Button>
          <a
            href={`/api/invoices/${id}/pdf`}
            download={`${invoice.invoiceNumber || 'invoice'}.pdf`}
          >
            <Button variant="outline" size="sm" leftIcon={<FileText className="w-4 h-4" />}>
              Download PDF
            </Button>
          </a>
          {invoice.stripePaymentLink ? (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">
                <CheckCircle className="w-3 h-3" /> Payment Link Active
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(invoice.stripePaymentLink);
                  setCopyLinkMsg('Copied!');
                  setTimeout(() => setCopyLinkMsg(''), 2000);
                }}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border"
                title="Copy payment link"
              >
                {copyLinkMsg || 'Copy Link'}
              </button>
            </div>
          ) : (
            invoice.status !== 'VOID' && invoice.status !== 'PAID' && (
              <Button
                variant="outline" size="sm"
                leftIcon={<CreditCard className="w-4 h-4" />}
                onClick={() => generatePaymentLinkMutation.mutate()}
                disabled={generatePaymentLinkMutation.isPending}
              >
                {generatePaymentLinkMutation.isPending ? 'Generating…' : 'Generate Payment Link'}
              </Button>
            )
          )}
          {invoice.viewToken && (
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/view/invoice/${invoice.viewToken}`)}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="Copy client link">
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          {isAdmin && !isPaid && (
            <button
              onClick={() => window.confirm(`Void ${invoice.invoiceNumber}?`) && deleteMutation.mutate()}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded" title="Void invoice">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Alert: Overdue */}
      {invoice.isOverdue && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-700 dark:text-red-400">Invoice Overdue</p>
            <p className="text-sm text-red-600 dark:text-red-500">
              Was due {formatDate(invoice.dueDate)} · {getDaysOverdue(invoice.dueDate)} days overdue
            </p>
          </div>
        </div>
      )}

      {/* Edit Mode */}
      {editing && editForm ? (
        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4">Edit Invoice</h2>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input type="text" value={editForm.title}
                  onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Due Date</label>
                <input type="date" value={editForm.dueDate}
                  onChange={(e) => setEditForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <label className="block text-sm font-medium mb-2">Line Items</label>
              <div className="space-y-1.5">
                {editForm.lineItems.map((li, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select value={li.itemType}
                      onChange={(e) => setEditForm(f => {
                        const items = [...f.lineItems];
                        items[idx] = { ...items[idx], itemType: e.target.value };
                        return { ...f, lineItems: items };
                      })}
                      className="col-span-1 px-1 py-1.5 rounded border border-border bg-background text-xs">
                      <option value="LABOR">Labor</option>
                      <option value="MATERIALS">Materials</option>
                      <option value="EXPENSE">Expense</option>
                      <option value="DISCOUNT">Discount</option>
                      <option value="CUSTOM">Custom</option>
                    </select>
                    <input type="text" value={li.description}
                      onChange={(e) => setEditForm(f => {
                        const items = [...f.lineItems];
                        items[idx] = { ...items[idx], description: e.target.value };
                        return { ...f, lineItems: items };
                      })}
                      className="col-span-4 px-2 py-1.5 rounded border border-border bg-background text-sm" required />
                    <input type="number" value={li.quantity} min="0" step="0.5"
                      onChange={(e) => setEditForm(f => {
                        const items = [...f.lineItems];
                        items[idx] = { ...items[idx], quantity: e.target.value };
                        return { ...f, lineItems: items };
                      })}
                      className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-center" />
                    <input type="number" value={li.unitPrice} min="0" step="0.01"
                      onChange={(e) => setEditForm(f => {
                        const items = [...f.lineItems];
                        items[idx] = { ...items[idx], unitPrice: e.target.value };
                        return { ...f, lineItems: items };
                      })}
                      className="col-span-2 px-2 py-1.5 rounded border border-border bg-background text-sm text-right" />
                    <span className="col-span-2 text-sm text-right font-medium">
                      {fmt((parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0))}
                    </span>
                    <button type="button"
                      onClick={() => setEditForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))}
                      className="col-span-1 text-muted-foreground hover:text-destructive text-center text-lg leading-none">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button type="button"
                onClick={() => setEditForm(f => ({ ...f, lineItems: [...f.lineItems, { description: '', itemType: 'LABOR', quantity: 1, unitPrice: 0 }] }))}
                className="text-sm text-primary hover:underline mt-2">
                + Add line item
              </button>
            </div>

            {/* Tax / Discount */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tax Type</label>
                <select value={editForm.taxType}
                  onChange={(e) => setEditForm(f => ({ ...f, taxType: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                  <option value="HST">HST</option>
                  <option value="GST">GST</option>
                  <option value="PST">PST</option>
                  <option value="NONE">None</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
                <input type="number" value={editForm.taxRate} min="0" max="30" step="0.5"
                  onChange={(e) => setEditForm(f => ({ ...f, taxRate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Discount ($)</label>
                <input type="number" value={editForm.discountAmount} min="0" step="0.01"
                  onChange={(e) => setEditForm(f => ({ ...f, discountAmount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
            </div>

            {/* Notes */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Notes (client-visible)</label>
                <textarea value={editForm.notes}
                  onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Internal Notes</label>
                <textarea value={editForm.internalNotes}
                  onChange={(e) => setEditForm(f => ({ ...f, internalNotes: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
            </div>

            {/* Total preview */}
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{fmt(editSubtotal)}</span></div>
              {editDiscount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{fmt(editDiscount)}</span></div>}
              <div className="flex justify-between text-muted-foreground"><span>{editForm.taxType} ({editForm.taxRate}%)</span><span>{fmt(editTax)}</span></div>
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Total</span><span>{fmt(editTotal)} CAD</span></div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" loading={updateMutation.isPending} leftIcon={<Save className="w-4 h-4" />}>Save Changes</Button>
              <Button variant="ghost" type="button" onClick={() => { setEditing(false); setEditForm(null); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      ) : (
        <>
          {/* Invoice View */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main invoice details */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-6">
                {/* Bill to / dates */}
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Bill To</p>
                    <p className="font-semibold text-lg">{invoice.client?.name}</p>
                    {invoice.client?.domain && <p className="text-sm text-muted-foreground">{invoice.client.domain}</p>}
                    {invoice.client?.contacts?.[0] && (
                      <p className="text-sm text-muted-foreground">{invoice.client.contacts[0].email}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Invoice Details</p>
                    <p className="font-mono font-bold text-xl">{invoice.invoiceNumber}</p>
                    <p className="text-sm text-muted-foreground mt-1">Issued: {formatDate(invoice.issueDate || invoice.createdAt)}</p>
                    {invoice.dueDate && (
                      <p className={`text-sm mt-0.5 ${invoice.isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
                        Due: {formatDate(invoice.dueDate)}
                      </p>
                    )}
                    {invoice.sentAt && <p className="text-sm text-muted-foreground mt-0.5">Sent: {formatDate(invoice.sentAt)}</p>}
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</th>
                        <th className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 text-center w-16">Qty</th>
                        <th className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 text-right w-24">Unit</th>
                        <th className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5 text-right w-24">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(invoice.lineItems || []).map((li, idx) => (
                        <tr key={li.id} className={idx % 2 === 0 ? '' : 'bg-muted/20'}>
                          <td className="px-4 py-3">
                            <div>{li.description}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{li.itemType}</div>
                          </td>
                          <td className="px-3 py-3 text-center text-muted-foreground">{li.quantity}</td>
                          <td className="px-3 py-3 text-right">{fmt(li.unitPrice)}</td>
                          <td className="px-4 py-3 text-right font-medium">{fmt(li.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="mt-4 flex justify-end">
                  <div className="w-64 space-y-1.5 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span><span>{fmt(invoice.subtotal)}</span>
                    </div>
                    {invoice.discountAmount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount</span><span>-{fmt(invoice.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground">
                      <span>{invoice.taxType} ({invoice.taxRate}%)</span><span>{fmt(invoice.tax)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg border-t border-border pt-2 mt-2">
                      <span>Total</span><span>{fmt(invoice.total)} CAD</span>
                    </div>
                    {isPaid && (
                      <div className="flex justify-between text-green-600 text-sm">
                        <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />Paid</span>
                        <span>{formatDate(invoice.paidAt)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                {invoice.notes && (
                  <div className="mt-5 pt-5 border-t border-border">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm text-muted-foreground">{invoice.notes}</p>
                  </div>
                )}
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Internal Notes */}
              {invoice.internalNotes && (
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Internal Notes</p>
                  <p className="text-sm">{invoice.internalNotes}</p>
                </Card>
              )}

              {/* Payment Method (if paid) */}
              {isPaid && (
                <Card className="p-4 border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <p className="text-sm font-semibold text-green-700 dark:text-green-400">Payment Received</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(invoice.paidAt)}</p>
                  {invoice.paymentMethod && (
                    <p className="text-xs text-muted-foreground">via {invoice.paymentMethod}</p>
                  )}
                  {invoice.paymentNotes && (
                    <p className="text-xs text-muted-foreground mt-1">{invoice.paymentNotes}</p>
                  )}
                </Card>
              )}

              {/* Payment History */}
              {payments.length > 0 && (
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Payment History</p>
                  <div className="space-y-2">
                    {payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <div>
                          <p className="font-medium">{fmt(p.amount)}</p>
                          <p className="text-xs text-muted-foreground">{p.method} · {formatDate(p.paidAt)}</p>
                          {p.transactionId && <p className="text-xs text-muted-foreground font-mono">{p.transactionId}</p>}
                          {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                        </div>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Quick Actions */}
              {invoice.stripePaymentLink && (
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Payment Link</p>
                  <a href={invoice.stripePaymentLink} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1">
                    <CreditCard className="w-3.5 h-3.5" />
                    Pay via Stripe
                  </a>
                  <button
                    onClick={() => navigator.clipboard.writeText(invoice.stripePaymentLink)}
                    className="text-xs text-muted-foreground hover:text-foreground mt-1 block">
                    Copy link
                  </button>
                </Card>
              )}

              {/* Created by */}
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Created By</p>
                <p className="text-sm">{invoice.createdBy?.name}</p>
                <p className="text-xs text-muted-foreground">{formatDate(invoice.createdAt)}</p>
                {invoice.updatedAt !== invoice.createdAt && (
                  <p className="text-xs text-muted-foreground">Updated {formatDate(invoice.updatedAt)}</p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Mark Paid Modal */}
      {showMarkPaid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Record Payment</h3>
              <button onClick={() => setShowMarkPaid(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Invoice: <span className="font-medium text-foreground">{invoice.invoiceNumber}</span></p>
                <p className="text-sm text-muted-foreground">Amount: <span className="font-semibold text-foreground">{fmt(invoice.total)}</span></p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Payment Method</label>
                <select value={payForm.paymentMethod}
                  onChange={(e) => setPayForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                  <option value="BANK">Bank Transfer / e-Transfer</option>
                  <option value="STRIPE">Stripe</option>
                  <option value="CHECK">Check</option>
                  <option value="CASH">Cash</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Transaction ID (optional)</label>
                <input type="text" value={payForm.transactionId}
                  onChange={(e) => setPayForm(f => ({ ...f, transactionId: e.target.value }))}
                  placeholder="e.g. ref #, Stripe charge ID"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                <input type="text" value={payForm.paymentNotes}
                  onChange={(e) => setPayForm(f => ({ ...f, paymentNotes: e.target.value }))}
                  placeholder="e.g. received via Interac e-Transfer"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button onClick={() => markPaidMutation.mutate(payForm)}
                loading={markPaidMutation.isPending}
                leftIcon={<CheckCircle className="w-4 h-4" />}>
                Mark as Paid
              </Button>
              <Button variant="ghost" onClick={() => setShowMarkPaid(false)}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function getDaysOverdue(dueDate) {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}
