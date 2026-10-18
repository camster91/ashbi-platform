import { useEffect, useState, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, Printer, FileText, CheckCircle, AlertTriangle, Plus,
  Edit2, Save, CreditCard, Trash2, ExternalLink, RefreshCw, Copy, Info,
} from 'lucide-react';
import { api } from '../lib/api';
import useAutosave from '../hooks/useAutosave';
import useIsSmUp from '../hooks/useIsSmUp';
import { invoiceTotals, lineTotal } from '../lib/money-totals';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Button, Card, Field, Input, LoadingState, Select, StatusBadge, Textarea } from '../components/ui';
import { buttonStyles } from '../components/ui/Button';
import Modal, { ModalFooter } from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import QueryErrorState from '../components/QueryErrorState';
import { buildInvoiceUpdatePayload, INVOICE_CURRENCY_OPTIONS, INVOICE_RECURRING_INTERVALS } from '../lib/invoice-payloads';
import { DEFAULT_LOCALE, formatInvoiceMoney, formatInvoiceDate, toDateInputValue } from '../lib/format';
import { invoiceBalanceDue, invoiceDisplayStatus, isOpenInvoice, recurrenceSummary, recurrenceWord, taxTypeLabel } from '../lib/invoice-status';
import { cn } from '../lib/utils';

// Ashbi Hub invoice page (design: Invoice mockup). Details, line items and
// payment/schedule panels on the left; on the right, a preview of what the
// client sees on the pay page. A draft switches the same panels into its
// edit form.

const HST_RATE = 13;
const INITIAL_PAYMENT_FORM = { paymentMethod: 'BANK', paymentNotes: '', transactionId: '', amount: '' };
const LINE_ITEM_TYPES = [
  { value: 'LABOR', label: 'Labor' },
  { value: 'MATERIALS', label: 'Materials' },
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'DISCOUNT', label: 'Discount' },
  { value: 'CUSTOM', label: 'Custom' },
];
const TAX_TYPE_OPTIONS = [
  { value: 'HST', label: 'HST' },
  { value: 'GST', label: 'GST' },
  { value: 'PST', label: 'PST' },
  { value: 'TAX', label: 'Tax' },
  { value: 'NONE', label: 'None' },
];

const panelHeaderClass = 'px-5 pt-4 pb-3 flex flex-wrap items-baseline justify-between gap-2';
const panelTitleClass = 'text-lg font-semibold tracking-tight text-foreground';
const panelBodyClass = 'px-5 pb-5';
const thClass = 'py-2 text-eyebrow text-muted-foreground font-normal';
const smallLinkClass = 'inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:no-underline';
const cellInputClass = 'min-h-11 text-sm';

// Whether the invoice has nothing left to pay (a $0 total, or fully covered).
export function nothingOwed(balanceDue) {
  return Number.isFinite(Number(balanceDue)) && Math.round(Number(balanceDue) * 100) <= 0;
}

// Why the entered payment amount cannot be submitted, or null. It must be a
// positive amount no larger than the balance due; with nothing owed, 0
// closes the invoice as paid.
export function paymentAmountError(amount, balanceDue) {
  const value = Number(amount);
  if (amount === '' || amount === null || amount === undefined || !Number.isFinite(value)) return 'Enter the amount received';
  // Money is recorded in cents: 12.345 would be silently rounded.
  if (/\.\d{3,}/.test(String(amount).trim())) return 'Use dollars and cents only (at most 2 decimal places)';
  if (nothingOwed(balanceDue)) return Math.round(value * 100) === 0 ? null : 'Nothing is owed on this invoice. Enter 0 to mark it paid.';
  if (value <= 0) return 'The amount must be greater than zero';
  if (Number.isFinite(Number(balanceDue)) && Math.round(value * 100) > Math.round(Number(balanceDue) * 100)) return 'The amount is more than the balance due';
  return null;
}

// The mark-paid body always carries the amount explicitly (rounded to cents),
// so what is recorded is exactly what the dialog showed.
export function buildPaymentPayload(form) {
  const { amount, ...rest } = form;
  return { ...rest, amount: Math.round(Number(amount) * 100) / 100 };
}

// Values must match the API's mark-paid enum; CHEQUE is canonical and legacy
// rows may still hold CHECK.
export const PAYMENT_METHOD_OPTIONS = [
  { value: 'BANK', label: 'Bank Transfer / e-Transfer' },
  { value: 'STRIPE', label: 'Stripe' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Other' },
];
const PAYMENT_METHOD_LABELS = {
  ...Object.fromEntries(PAYMENT_METHOD_OPTIONS.map(({ value, label }) => [value, label])),
  TRANSFER: 'Bank Transfer / e-Transfer',
  CHECK: 'Cheque',
};
export function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method;
}

/** "HST 13%", "Tax 5%", "No tax": the tax line's label. */
export function taxLineLabel(taxType, taxRate) {
  const name = taxTypeLabel(taxType);
  if (name === 'No tax') return name;
  return taxRate === null || taxRate === undefined || taxRate === '' ? name : `${name} ${taxRate}%`;
}

/** "Priya" from "Priya Shah": who the client preview is addressed to. */
export function previewViewerName(invoice) {
  const name = String(invoice?.client?.contacts?.[0]?.name || '').trim();
  return name ? name.split(/\s+/)[0] : null;
}

function fmt(n, currency) {
  return formatInvoiceMoney(n, currency);
}

// "1,200.00": a bare amount for table cells, where the currency is in the
// heading or the total line (as on the mockup).
const plainNumber = new Intl.NumberFormat(DEFAULT_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function plain(n) {
  return plainNumber.format(Number(n) || 0);
}

function formatDate(date) {
  return formatInvoiceDate(date, { month: 'long' });
}

function shortDate(date) {
  return formatInvoiceDate(date);
}

function Panel({ id, title, action, children, className }) {
  return (
    <Card as="section" padding="none" className={cn('rounded-lg', className)} aria-labelledby={id}>
      <div className={panelHeaderClass}>
        <h2 id={id} className={panelTitleClass}>{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function DetailItem({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-foreground break-words">{children}</dd>
    </div>
  );
}

function TotalRow({ label, value, className }) {
  return (
    <div className={cn('flex justify-between gap-4', className)}>
      <dt>{label}</dt>
      <dd className="figure text-right">{value}</dd>
    </div>
  );
}

// What the client sees on the public pay page (PortalInvoice), drawn from
// the stored invoice, or from the edit form while a draft is being edited.
function ClientPreview({ invoice, doc, viewer, clientInvoiceUrl, showPayPageLink }) {
  const isPaid = invoice.status === 'PAID';
  const isVoid = invoice.status === 'VOID';
  const balance = doc.balanceDue;
  return (
    <aside aria-labelledby="invoice-preview-heading" className="space-y-2.5 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="invoice-preview-heading" className="text-eyebrow text-muted-foreground">
          {viewer ? `What ${viewer} sees` : 'What the client sees'}
        </h2>
        {showPayPageLink && (
          <a href={clientInvoiceUrl} target="_blank" rel="noopener noreferrer" className={cn(smallLinkClass, '-my-3 -mr-2')}>
            Open pay page <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
      <Card padding="none" className="rounded-lg overflow-hidden">
        <div className="bg-primary text-primary-foreground px-6 py-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold tracking-tight break-words">{doc.title || 'Invoice'}</div>
            {invoice.client?.name && <div className="text-xs text-primary-foreground/80 break-words">For {invoice.client.name}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-eyebrow text-primary-foreground/80">Invoice</div>
            <div className="figure font-medium">{invoice.invoiceNumber}</div>
          </div>
        </div>
        <div className="px-6 pt-5 pb-6 space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-eyebrow text-muted-foreground">Billed to</dt>
              <dd className="font-semibold text-foreground break-words">{invoice.client?.name || '—'}</dd>
              {invoice.client?.contacts?.[0]?.name && <dd className="text-foreground break-words">{invoice.client.contacts[0].name}</dd>}
            </div>
            <div className="min-w-0">
              <dt className="text-eyebrow text-muted-foreground">Due</dt>
              <dd className="font-semibold text-foreground">{doc.dueDate ? shortDate(doc.dueDate) : 'Upon receipt'}</dd>
              <dd className="text-muted-foreground">Issued {shortDate(doc.issueDate)}</dd>
            </div>
          </dl>

          <dl className="space-y-2 text-sm">
            {doc.lines.map((line, index) => (
              <div key={line.key ?? index} className="flex justify-between gap-3">
                <dt className="min-w-0 break-words text-foreground">
                  {line.description || 'Untitled line'}
                  {Number(line.quantity) !== 1 && (
                    <span className="text-muted-foreground"> · <span className="figure">{line.quantity}</span> × <span className="figure">{plain(line.unitPrice)}</span></span>
                  )}
                </dt>
                <dd className="figure shrink-0">{plain(line.total)}</dd>
              </div>
            ))}
            {doc.discount > 0 && <TotalRow label="Discount" value={`-${plain(doc.discount)}`} className="text-muted-foreground" />}
            {doc.tax > 0 && <TotalRow label={doc.taxLabel} value={plain(doc.tax)} className="text-muted-foreground" />}
            <TotalRow
              label={isPaid ? 'Total' : 'Total due'}
              value={fmt(doc.total, doc.currency)}
              className="border-t border-border/60 pt-2.5 text-base font-bold"
            />
            {!isPaid && doc.amountPaid > 0 && (
              <>
                <TotalRow label="Paid so far" value={`-${fmt(doc.amountPaid, doc.currency)}`} className="text-muted-foreground" />
                <TotalRow label="Balance due" value={fmt(balance, doc.currency)} className="font-semibold" />
              </>
            )}
          </dl>

          {isPaid ? (
            <p className="flex items-center justify-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-3 text-sm font-semibold text-success">
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              {invoice.paidAt ? `Paid on ${formatDate(invoice.paidAt)}` : 'Payment received'}
            </p>
          ) : isVoid ? (
            <p className="rounded-md border border-border/60 bg-muted/50 px-3 py-3 text-center text-sm text-muted-foreground">This invoice is void. The client can no longer pay it.</p>
          ) : balance > 0 ? (
            <div className="space-y-2">
              {/* A picture of the pay button, not a control: paying happens on the pay page. */}
              <div className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-foreground bg-accent px-4 font-mono text-xs font-medium uppercase tracking-[0.1em] text-accent-foreground">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Pay Now - {fmt(balance, doc.currency)}
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {invoice.status === 'DRAFT'
                  ? 'The client can pay by card (Stripe) once you send the invoice.'
                  : 'Card payments go through Stripe.'}
              </p>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">Nothing is owed on this invoice.</p>
          )}
        </div>
      </Card>
    </aside>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [issueDateError, setIssueDateError] = useState(null);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [payForm, setPayForm] = useState(INITIAL_PAYMENT_FORM);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const paymentAmountRef = useRef(null);
  // The edit form renders one set of line-item inputs for the layout in use.
  const isSmUp = useIsSmUp();

  // The payment dialog opens on the amount (what staff check or change),
  // not on its close button.
  useEffect(() => {
    if (!showMarkPaid) return;
    paymentAmountRef.current?.focus();
    paymentAmountRef.current?.select?.();
  }, [showMarkPaid]);

  const {
    data: invoice,
    isLoading,
    isError: invoiceError,
    error: invoiceRequestError,
    refetch: refetchInvoice,
    isFetching: invoiceFetching,
  } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.getInvoice(id),
  });
  const formDraft = useAutosave('invoice', id, editing ? editForm : null, 500, { baseUpdatedAt: invoice?.updatedAt });

  useEffect(() => {
    if (!formDraft.draft) return;
    setEditForm(formDraft.draft);
    setEditing(true);
  }, [formDraft.draft]);

  const {
    data: payments = [],
    isError: paymentsError,
    error: paymentsRequestError,
    refetch: refetchPayments,
    isFetching: paymentsFetching,
  } = useQuery({
    queryKey: ['invoice-payments', id],
    queryFn: () => api.getInvoicePayments(id),
    enabled: !!invoice,
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateInvoice(id, data),
    onSuccess: () => {
      void formDraft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      setEditing(false);
      setEditForm(null);
      toast.success('Invoice updated');
    },
    onError: () => toast.error('Failed to update invoice'),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.sendInvoice(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      // Say what really happened: the email only goes out when delivery is
      // configured and accepted.
      if (result?.emailSent === false) {
        toast.warning('Invoice marked as sent, but no email went out', 'Copy the client link below and share it yourself.', 8000);
      } else {
        toast.success('Invoice sent', 'The client was emailed a link to view and pay it.');
      }
    },
    onError: () => toast.error('Failed to send invoice'),
  });

  const markPaidMutation = useMutation({
    mutationFn: (data) => api.markInvoicePaid(id, buildPaymentPayload(data)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowMarkPaid(false);
      setPayForm(INITIAL_PAYMENT_FORM);
      toast.success(result?.status === 'PAID' ? 'Invoice marked as paid' : 'Payment recorded');
    },
    onError: () => toast.error('Failed to record payment'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteInvoice(id),
    onSuccess: (result) => {
      setShowVoidConfirm(false);
      toast.success({
        title: `${invoice.invoiceNumber} voided`,
        duration: 10000,
        action: {
          label: `Undo void ${invoice.invoiceNumber}`,
          expiresAt: result.undoExpiresAt,
          onClick: async () => {
            try {
              await api.undoInvoiceVoid(id);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['invoice', id] }),
                queryClient.invalidateQueries({ queryKey: ['invoices'] }),
              ]);
              navigate(`/invoices/${id}`);
              toast.success(`${invoice.invoiceNumber} restored`);
            } catch (error) {
              toast.error({
                title: error.status === 410 ? 'Invoice void undo expired' : 'Could not restore invoice',
                message: error.message,
                duration: 0,
              });
              if (error.status !== 410) throw error;
            }
          },
        },
      });
      navigate('/invoices');
    },
    onError: (error) => toast.error('Failed to void invoice', error.message),
  });

  const openMarkPaid = () => {
    markPaidMutation.reset();
    setPayForm((form) => ({ ...form, amount: String(invoice?.balanceDue ?? invoice?.total ?? '') }));
    setShowMarkPaid(true);
  };

  const closeMarkPaid = () => {
    if (markPaidMutation.isPending) return;
    markPaidMutation.reset();
    setShowMarkPaid(false);
  };

  const [copyLinkMsg, setCopyLinkMsg] = useState('');
  const generatePaymentLinkMutation = useMutation({
    mutationFn: () => api.generateInvoicePaymentLink(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (error) => toast.error('Failed to generate payment link', error.message),
  });

  const startEdit = () => {
    setEditForm({
      title: invoice.title || '',
      notes: invoice.notes || '',
      internalNotes: invoice.internalNotes || '',
      issueDate: toDateInputValue(invoice.issueDate || invoice.createdAt),
      dueDate: toDateInputValue(invoice.dueDate),
      currency: invoice.currency || 'CAD',
      taxRate: invoice.taxRate ?? HST_RATE,
      taxType: invoice.taxType || 'HST',
      discountAmount: invoice.discountAmount || 0,
      isRecurring: Boolean(invoice.isRecurring),
      recurringInterval: invoice.recurringInterval || 'MONTHLY',
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

  const cancelEdit = () => { setEditing(false); setEditForm(null); setIssueDateError(null); };

  const handleUpdate = (e) => {
    e.preventDefault();
    // A cleared issue date must not save as "no change": stop and say so.
    if (!editForm.issueDate) {
      setIssueDateError('Enter an issue date.');
      return;
    }
    setIssueDateError(null);
    // Shared with the API contract test so the UI payload always validates.
    updateMutation.mutate(buildInvoiceUpdatePayload(editForm, {
      issueDate: toDateInputValue(invoice.issueDate || invoice.createdAt),
      isRecurring: invoice.isRecurring,
      recurringInterval: invoice.recurringInterval,
    }));
  };

  const handlePrint = () => {
    // Open PDF in new window for printing
    api.getInvoicePdf(id).catch(() => {});
    const url = `${window.location.origin}/api/invoices/${id}/pdf`;
    const w = window.open(url, '_blank');
    if (w) setTimeout(() => w.print(), 1000);
  };

  if (isLoading) {
    return <LoadingState label="Loading invoice…" className="min-h-96" />;
  }

  if (invoiceError) {
    return (
      <QueryErrorState
        error={invoiceRequestError}
        message="Invoice details could not be loaded"
        onRetry={refetchInvoice}
        isRetrying={invoiceFetching}
      />
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

  const displayStatus = invoiceDisplayStatus(invoice);
  const repeats = recurrenceSummary(invoice);
  const isDraft = invoice.status === 'DRAFT';
  const isVoid = invoice.status === 'VOID';
  const sourceBacked = Boolean(invoice.sourceBilling || invoice.billingSources);
  const canManage = isAdmin || !sourceBacked;
  // Sent, viewed by the client, or overdue: payable and resendable.
  const isSent = isOpenInvoice(invoice) || invoice.isOverdue;
  const isPaid = invoice.status === 'PAID';
  // An invoice with recorded payments cannot be voided (the API answers 409).
  const hasPayments = invoice.amountPaid > 0;
  const amountError = paymentAmountError(payForm.amount, invoice.balanceDue ?? invoice.total);
  // Clients pay from the public invoice page, which creates or refreshes a
  // Stripe Checkout session on demand; stored Checkout URLs expire in 24h.
  const clientInvoiceUrl = invoice.viewToken && (isSent || isPaid)
    ? `${window.location.origin}/portal/invoice/${invoice.viewToken}`
    : null;
  const isEditing = Boolean(editing && editForm && canManage);
  const contact = invoice.client?.contacts?.[0];
  const viewer = previewViewerName(invoice);
  const showSourceRelease = isAdmin && isVoid && invoice.billingSources && !invoice.billingSourcesReleasedAt;
  const canVoid = isAdmin && !isPaid && !hasPayments;

  // Edit form calculations
  // The API's arithmetic (lib/money-totals.js), so the preview is what is billed.
  const editDiscount = editForm ? parseFloat(editForm.discountAmount) || 0 : 0;
  const editLines = (editForm?.lineItems || []).map((li) => ({
    quantity: parseFloat(li.quantity) || 1,
    unitPrice: parseFloat(li.unitPrice) || 0,
  }));
  const { subtotal: editSubtotal, tax: editTax, total: editTotal } = invoiceTotals(
    editLines.map((li) => ({ total: lineTotal(li.quantity, li.unitPrice) })),
    parseFloat(editForm?.taxRate || HST_RATE),
    editDiscount,
  );

  const updateLine = (idx, field, value) => setEditForm(f => {
    const items = [...f.lineItems];
    items[idx] = { ...items[idx], [field]: value };
    return { ...f, lineItems: items };
  });
  const removeLine = (idx) => setEditForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }));
  const addLine = () => setEditForm(f => ({ ...f, lineItems: [...f.lineItems, { description: '', itemType: 'LABOR', quantity: 1, unitPrice: 0 }] }));

  // What the client preview shows: the saved invoice, or the form being edited.
  const previewDoc = isEditing
    ? {
      title: editForm.title || invoice.title,
      currency: editForm.currency || 'CAD',
      issueDate: editForm.issueDate || invoice.issueDate || invoice.createdAt,
      dueDate: editForm.dueDate || null,
      lines: editForm.lineItems.map((li, idx) => ({
        key: li.id || `new-${idx}`,
        description: li.description,
        quantity: editLines[idx].quantity,
        unitPrice: editLines[idx].unitPrice,
        total: lineTotal(editLines[idx].quantity, editLines[idx].unitPrice),
      })),
      discount: editDiscount,
      tax: editTax,
      taxLabel: taxLineLabel(editForm.taxType, editForm.taxRate),
      total: editTotal,
      amountPaid: 0,
      balanceDue: editTotal,
    }
    : {
      title: invoice.title,
      currency: invoice.currency,
      issueDate: invoice.issueDate || invoice.createdAt,
      dueDate: invoice.dueDate,
      lines: (invoice.lineItems || []).map((li) => ({ key: li.id, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })),
      discount: Number(invoice.discountAmount) || 0,
      tax: Number(invoice.tax) || 0,
      taxLabel: taxLineLabel(invoice.taxType, invoice.taxRate),
      total: Number(invoice.total) || 0,
      amountPaid: Number(invoice.amountPaid) || 0,
      balanceDue: invoiceBalanceDue(invoice),
    };

  const copyPayLink = () => {
    navigator.clipboard.writeText(clientInvoiceUrl || '');
    setCopyLinkMsg('Copied!');
    setTimeout(() => setCopyLinkMsg(''), 2000);
  };

  return (
    <div className="space-y-5 max-w-[1240px] mx-auto">
      <nav aria-label="Breadcrumb" className="text-eyebrow text-muted-foreground">
        <Link to="/invoices" className="rounded-sm hover:text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Invoices</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{invoice.invoiceNumber}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="figure text-3xl font-medium tracking-tight text-foreground break-all">{invoice.invoiceNumber}</h1>
            <StatusBadge domain="invoice" status={displayStatus} size="md" className="font-semibold" />
            {repeats && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-sm font-semibold text-secondary-foreground">
                <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {repeats}
              </span>
            )}
          </div>
          {invoice.title && <p className="text-muted-foreground break-words">{invoice.title}</p>}
          {!isPaid && invoice.amountPaid > 0 && (
            <p className="text-sm text-muted-foreground">
              <span className="figure font-semibold text-foreground">{fmt(invoice.balanceDue, invoice.currency)}</span> left to pay of <span className="figure">{fmt(invoice.total, invoice.currency)}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showSourceRelease && <Button variant="outline" onClick={() => navigate(`/invoices/unbilled?release=${invoice.id}`)}>Review source release</Button>}
          {isEditing ? (
            <>
              <Button type="submit" form="invoice-edit-form" loading={updateMutation.isPending} leftIcon={<Save className="w-4 h-4" />} variant="outline">
                Save draft
              </Button>
              <Button variant="ghost" type="button" onClick={cancelEdit}>Cancel</Button>
            </>
          ) : (
            isDraft && canManage && (
              <Button variant="outline" leftIcon={<Edit2 className="w-4 h-4" />} onClick={startEdit}>Edit</Button>
            )
          )}
          <Button variant="outline" leftIcon={<Printer className="w-4 h-4" />} onClick={handlePrint}>Print</Button>
          <a
            href={`/api/invoices/${id}/pdf`}
            download={`${invoice.invoiceNumber || 'invoice'}.pdf`}
            className={buttonStyles({ variant: 'outline' })}
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            Download PDF
          </a>
          {canVoid && (
            <Button variant="danger-outline" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => { deleteMutation.reset(); setShowVoidConfirm(true); }}>
              Void invoice
            </Button>
          )}
          {isDraft && canManage && isAdmin && (
            <Button leftIcon={<Send className="w-4 h-4" />} onClick={() => sendMutation.mutate()} loading={sendMutation.isPending}>
              Send invoice
            </Button>
          )}
          {isSent && !isPaid && canManage && (
            <Button leftIcon={<CheckCircle className="w-4 h-4" />} onClick={openMarkPaid}>
              Record payment
            </Button>
          )}
        </div>
      </div>

      {invoice.isOverdue && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-semibold text-destructive">Invoice Overdue</p>
            <p className="text-destructive">Was due {formatDate(invoice.dueDate)} · {getDaysOverdue(invoice.dueDate)} days overdue</p>
          </div>
        </div>
      )}
      {isDraft && !isEditing && (
        <div className="flex items-start gap-2.5 rounded-lg border border-secondary bg-secondary/40 px-4 py-3 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p>This invoice is a draft. Check the lines, then send.</p>
        </div>
      )}

      {isAdmin && invoice.billingSources && (
        <Card padding="none" className="rounded-lg px-5 py-1 [overflow-wrap:anywhere]">
          <details>
            <summary className="min-h-11 flex items-center cursor-pointer font-semibold">Original billed work</summary>
            <div className="space-y-3 pb-4 pt-1 text-sm">
              <p>Original draft: <span className="figure">{fmt(invoice.billingSources.totals?.total, invoice.billingSources.currency)}</span> · {invoice.billingSources.taxType} {invoice.billingSources.taxRate}%</p>
              <p>{invoice.billingSourcesReleasedAt ? `Sources released ${formatDate(invoice.billingSourcesReleasedAt)}. Original history is retained.` : 'Sources remain reserved for this invoice.'}</p>
              <p className="text-muted-foreground">Later invoice edits do not replace this original source record.</p>
              {invoice.billingSources.lineItems?.map(line => <div key={`${line.source.kind}:${line.source.id}`} className="border-t border-border/40 pt-3 space-y-1">
                <p>{line.description} · {line.quantity} × {fmt(line.unitPrice, invoice.billingSources.currency)} · {fmt(line.total, invoice.billingSources.currency)}</p>
                <p className="text-muted-foreground">{line.source.kind}: {line.source.id} · {line.source.project?.name || 'Client expense'} · {line.source.user?.name || ''} · {formatDate(line.source.date)}</p>
              </div>)}
            </div>
          </details>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 items-start">
        {isEditing ? (
          <form id="invoice-edit-form" onSubmit={handleUpdate} className="space-y-4 min-w-0" aria-label={`Edit ${invoice.invoiceNumber}`}>
            <DraftRecoveryNotice
              draft={formDraft.draft}
              draftSavedAt={formDraft.draftMeta?.draftSavedAt}
              status={formDraft.status}
              lastSaved={formDraft.lastSaved}
              onRecover={(recovered) => { setEditForm(recovered); formDraft.setDraft(null); }}
              onDiscard={formDraft.discardDraft}
              onRetry={formDraft.saveNow}
            />

            <Panel id="invoice-details-heading" title="Details">
              <div className={cn(panelBodyClass, 'grid grid-cols-1 sm:grid-cols-2 gap-4')}>
                <div className="space-y-1.5">
                  <span className="block text-sm font-medium text-foreground">Client</span>
                  <p className="flex min-h-11 items-center rounded-lg border border-border/60 bg-muted/50 px-3 text-sm text-foreground">{invoice.client?.name || '—'}</p>
                </div>
                <fieldset className="space-y-1.5 min-w-0">
                  <legend className="mb-1.5 text-sm font-medium text-foreground">Currency</legend>
                  <div className="flex overflow-hidden rounded-lg border border-border">
                    {INVOICE_CURRENCY_OPTIONS.map((code) => {
                      const checked = (editForm.currency || 'CAD') === code;
                      return (
                        <label
                          key={code}
                          className={cn(
                            'flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 border-l border-border first:border-l-0 font-mono text-xs tracking-[0.08em] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring',
                            checked ? 'bg-foreground text-background' : 'bg-card text-foreground',
                            sourceBacked && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <input
                            type="radio"
                            name="invoice-edit-currency"
                            value={code}
                            checked={checked}
                            disabled={sourceBacked}
                            onChange={() => setEditForm(f => ({ ...f, currency: code }))}
                            className="m-0 accent-accent"
                          />
                          {code}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <Field label="Title" id="invoice-edit-title">
                  <Input value={editForm.title} onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </Field>
                <div className="hidden sm:block" aria-hidden="true" />
                <Field label="Issue date" id="invoice-edit-issue-date" required error={issueDateError}>
                  <Input type="date" value={editForm.issueDate || ''} onChange={(e) => { setIssueDateError(null); setEditForm(f => ({ ...f, issueDate: e.target.value })); }} />
                </Field>
                <Field label="Due date" id="invoice-edit-due-date" hint="Leave blank for due upon receipt.">
                  <Input type="date" value={editForm.dueDate} onChange={(e) => setEditForm(f => ({ ...f, dueDate: e.target.value }))} />
                </Field>
              </div>
            </Panel>

            <Panel id="invoice-lines-heading" title="Line items">
              <div className={panelBodyClass}>
                {isSmUp ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-left">
                          <th scope="col" className={cn(thClass, 'pr-2 w-32')}>Type</th>
                          <th scope="col" className={cn(thClass, 'px-2')}>Description</th>
                          <th scope="col" className={cn(thClass, 'px-2 w-20 text-right')}>Qty</th>
                          <th scope="col" className={cn(thClass, 'px-2 w-28 text-right')}>Rate</th>
                          <th scope="col" className={cn(thClass, 'px-2 w-28 text-right')}>Amount</th>
                          <th scope="col" className={cn(thClass, 'pl-2 w-12')}><span className="sr-only">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {editForm.lineItems.map((li, idx) => (
                          <tr key={idx} className="border-t border-border/40 align-middle">
                            <td className="py-2 pr-2">
                              <Select aria-label={`Line ${idx + 1} type`} value={li.itemType} onChange={(e) => updateLine(idx, 'itemType', e.target.value)} options={LINE_ITEM_TYPES} className={cellInputClass} />
                            </td>
                            <td className="py-2 px-2">
                              <Input aria-label={`Line ${idx + 1} description`} value={li.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className={cellInputClass} required />
                            </td>
                            <td className="py-2 px-2">
                              <Input aria-label={`Line ${idx + 1} quantity`} type="number" min="0" step="0.5" value={li.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className={cn(cellInputClass, 'figure text-right')} />
                            </td>
                            <td className="py-2 px-2">
                              <Input aria-label={`Line ${idx + 1} rate`} type="number" min="0" step="0.01" value={li.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)} className={cn(cellInputClass, 'figure text-right')} />
                            </td>
                            <td className="py-2 px-2 figure text-right">{plain(lineTotal(editLines[idx].quantity, editLines[idx].unitPrice))}</td>
                            <td className="py-2 pl-2 text-right">
                              <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${idx + 1}`} onClick={() => removeLine(idx)} className="px-2 text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {editForm.lineItems.map((li, idx) => (
                      <li key={idx} className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 space-y-2">
                            <Input aria-label={`Line ${idx + 1} description`} placeholder="Description" value={li.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className={cellInputClass} required />
                            <Select aria-label={`Line ${idx + 1} type`} value={li.itemType} onChange={(e) => updateLine(idx, 'itemType', e.target.value)} options={LINE_ITEM_TYPES} className={cellInputClass} />
                          </div>
                          <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${idx + 1}`} onClick={() => removeLine(idx)} className="px-2 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Field label="Qty" labelClassName="text-xs text-muted-foreground" id={`invoice-line-${idx}-qty`}>
                            <Input type="number" min="0" step="0.5" value={li.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className={cn(cellInputClass, 'figure')} />
                          </Field>
                          <Field label="Rate" labelClassName="text-xs text-muted-foreground" id={`invoice-line-${idx}-rate`}>
                            <Input type="number" min="0" step="0.01" value={li.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)} className={cn(cellInputClass, 'figure')} />
                          </Field>
                          <div className="space-y-1.5">
                            <span className="block text-xs text-muted-foreground">Amount</span>
                            <p className="figure flex min-h-11 items-center text-sm font-medium">{plain(lineTotal(editLines[idx].quantity, editLines[idx].unitPrice))}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addLine} className="border-dashed">
                    Add line
                  </Button>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Tax type" id="invoice-edit-tax-type">
                    <Select value={editForm.taxType} onChange={(e) => setEditForm(f => ({ ...f, taxType: e.target.value }))} options={TAX_TYPE_OPTIONS} />
                  </Field>
                  <Field label="Tax rate (%)" id="invoice-edit-tax-rate">
                    <Input type="number" min="0" max="30" step="0.5" value={editForm.taxRate} onChange={(e) => setEditForm(f => ({ ...f, taxRate: e.target.value }))} />
                  </Field>
                  <Field label={`Discount (${editForm.currency || 'CAD'})`} id="invoice-edit-discount">
                    <Input type="number" min="0" step="0.01" value={editForm.discountAmount} onChange={(e) => setEditForm(f => ({ ...f, discountAmount: e.target.value }))} />
                  </Field>
                </div>

                <dl className="ml-auto mt-4 max-w-72 space-y-1.5 text-sm" aria-label="Totals">
                  <TotalRow label={<span className="text-muted-foreground">Subtotal</span>} value={plain(editSubtotal)} />
                  {editDiscount > 0 && <TotalRow label={<span className="text-muted-foreground">Discount</span>} value={`-${plain(editDiscount)}`} />}
                  <TotalRow label={<span className="text-muted-foreground">{taxLineLabel(editForm.taxType, editForm.taxRate)}</span>} value={plain(editTax)} />
                  <TotalRow label={`Total ${editForm.currency || 'CAD'}`} value={fmt(editTotal, editForm.currency)} className="border-t border-border/60 pt-2 text-base font-bold" />
                </dl>
              </div>
            </Panel>

            <Panel id="invoice-payment-heading" title="Payment and schedule">
              <div className={cn(panelBodyClass, 'space-y-4')}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(editForm.isRecurring)}
                      disabled={sourceBacked}
                      onChange={(e) => setEditForm(f => ({ ...f, isRecurring: e.target.checked, recurringInterval: f.recurringInterval || 'MONTHLY' }))}
                      className="h-4.5 w-4.5 accent-primary"
                    />
                    Repeat this invoice
                  </label>
                  {editForm.isRecurring && (
                    <Select
                      aria-label="Repeat every"
                      value={editForm.recurringInterval || 'MONTHLY'}
                      onChange={(e) => setEditForm(f => ({ ...f, recurringInterval: e.target.value }))}
                      options={INVOICE_RECURRING_INTERVALS.map((value) => ({ value, label: recurrenceWord(value).replace(/^./, (c) => c.toUpperCase()) }))}
                      className="w-auto"
                    />
                  )}
                  {sourceBacked && <p className="text-xs text-muted-foreground">Reviewed work is billed once, so it cannot repeat.</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Note to client" id="invoice-edit-notes" hint="Shown on the invoice.">
                    <Textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                  </Field>
                  <Field label="Internal notes" id="invoice-edit-internal-notes" hint="Only your team sees these.">
                    <Textarea rows={2} value={editForm.internalNotes} onChange={(e) => setEditForm(f => ({ ...f, internalNotes: e.target.value }))} />
                  </Field>
                </div>
              </div>
            </Panel>
          </form>
        ) : (
          <div className="space-y-4 min-w-0">
            <Panel id="invoice-details-heading" title="Details">
              <dl className={cn(panelBodyClass, 'grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm')}>
                <DetailItem label="Client">
                  {invoice.client?.id
                    ? <Link to={`/client/${invoice.client.id}`} className="font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{invoice.client.name}</Link>
                    : <span className="font-semibold">{invoice.client?.name || '—'}</span>}
                  {invoice.client?.domain && <span className="block text-muted-foreground">{invoice.client.domain}</span>}
                  {contact?.email && <span className="block text-muted-foreground break-all">{contact.email}</span>}
                </DetailItem>
                <DetailItem label="Currency"><span className="figure">{invoice.currency || 'CAD'}</span></DetailItem>
                <DetailItem label="Issue date">{formatDate(invoice.issueDate || invoice.createdAt)}</DetailItem>
                <DetailItem label="Due date">
                  {invoice.dueDate
                    ? <span className={cn(invoice.isOverdue && 'font-semibold text-destructive')}>{formatDate(invoice.dueDate)}</span>
                    : 'Upon receipt'}
                </DetailItem>
                <DetailItem label="Sent">{invoice.sentAt ? formatDate(invoice.sentAt) : 'Not sent yet'}</DetailItem>
                <DetailItem label="Created by">
                  {invoice.createdBy?.name || '—'}
                  <span className="block text-muted-foreground">{formatDate(invoice.createdAt)}</span>
                  {invoice.updatedAt !== invoice.createdAt && <span className="block text-muted-foreground">Updated {formatDate(invoice.updatedAt)}</span>}
                </DetailItem>
              </dl>
            </Panel>

            <Panel id="invoice-lines-heading" title="Line items">
              <div className={panelBodyClass}>
                {/* Keyboard users can scroll the table sideways on narrow screens. */}
                <div className="overflow-x-auto focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm" tabIndex={0} role="region" aria-label="Line items table">
                  <table className="w-full min-w-[480px] text-sm">
                    <caption className="sr-only">Line items in {invoice.currency || 'CAD'}</caption>
                    <thead>
                      <tr className="text-left">
                        <th scope="col" className={cn(thClass, 'pr-2')}>Description</th>
                        <th scope="col" className={cn(thClass, 'px-2 w-20 text-right')}>Qty</th>
                        <th scope="col" className={cn(thClass, 'px-2 w-28 text-right')}>Rate</th>
                        <th scope="col" className={cn(thClass, 'pl-2 w-28 text-right')}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(invoice.lineItems || []).map((li) => (
                        <tr key={li.id} className="border-t border-border/40 align-top">
                          <td className="py-3 pr-2">
                            <div className="font-semibold text-foreground break-words">{li.description}</div>
                            {li.itemType && <div className="text-muted-foreground">{LINE_ITEM_TYPES.find(t => t.value === li.itemType)?.label || li.itemType}</div>}
                          </td>
                          <td className="py-3 px-2 figure text-right">{li.quantity}</td>
                          <td className="py-3 px-2 figure text-right">{plain(li.unitPrice)}</td>
                          <td className="py-3 pl-2 figure text-right">{plain(li.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(invoice.lineItems || []).length === 0 && <p className="py-3 text-sm text-muted-foreground">No line items yet.</p>}
                </div>

                <dl className="ml-auto mt-4 max-w-72 space-y-1.5 text-sm" aria-label="Totals">
                  <TotalRow label={<span className="text-muted-foreground">Subtotal</span>} value={plain(invoice.subtotal)} />
                  {invoice.discountAmount > 0 && <TotalRow label={<span className="text-muted-foreground">Discount</span>} value={`-${plain(invoice.discountAmount)}`} />}
                  <TotalRow label={<span className="text-muted-foreground">{taxLineLabel(invoice.taxType, invoice.taxRate)}</span>} value={plain(invoice.tax)} />
                  <TotalRow label={`Total ${invoice.currency || 'CAD'}`} value={fmt(invoice.total, invoice.currency)} className="border-t border-border/60 pt-2 text-base font-bold" />
                  {!isPaid && invoice.amountPaid > 0 && (
                    <>
                      <TotalRow label="Paid so far" value={`-${fmt(invoice.amountPaid, invoice.currency)}`} className="text-success" />
                      <TotalRow label="Balance due" value={fmt(invoice.balanceDue, invoice.currency)} className="font-semibold" />
                    </>
                  )}
                  {isPaid && (
                    <TotalRow
                      label={<span className="flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />Paid</span>}
                      value={formatDate(invoice.paidAt)}
                      className="text-success"
                    />
                  )}
                </dl>
              </div>
            </Panel>

            <Panel id="invoice-payment-heading" title="Payment and schedule">
              <div className={cn(panelBodyClass, 'space-y-4 text-sm')}>
                {isPaid && (
                  <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3">
                    <p className="flex items-center gap-2 font-semibold text-success">
                      <CheckCircle className="h-4 w-4" aria-hidden="true" /> Payment received
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {formatDate(invoice.paidAt)}
                      {invoice.paymentMethod && <> · via {paymentMethodLabel(invoice.paymentMethod)}</>}
                    </p>
                    {invoice.paymentNotes && <p className="mt-1 text-muted-foreground">{invoice.paymentNotes}</p>}
                  </div>
                )}
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  <DetailItem label="Card (Stripe)">
                    {invoice.stripePaymentLink ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                          <CheckCircle className="h-3 w-3" aria-hidden="true" /> Payment link active
                        </span>
                        <button
                          type="button"
                          onClick={copyPayLink}
                          className={cn(smallLinkClass, '-my-2')}
                          title="Copy the client's pay link (public invoice page)"
                          disabled={!clientInvoiceUrl}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          {copyLinkMsg || 'Copy link'}
                        </button>
                      </span>
                    ) : canManage && !isVoid && !isPaid ? (
                      <Button
                        variant="outline" size="sm"
                        leftIcon={<CreditCard className="w-4 h-4" />}
                        onClick={() => generatePaymentLinkMutation.mutate()}
                        disabled={generatePaymentLinkMutation.isPending}
                      >
                        {generatePaymentLinkMutation.isPending ? 'Generating…' : 'Generate payment link'}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">No payment link</span>
                    )}
                  </DetailItem>
                  {!isPaid && !isVoid && (
                    <DetailItem label="Bank transfer, e-Transfer, cheque or cash">
                      <span className="text-muted-foreground">Record it with Record payment when it arrives.</span>
                    </DetailItem>
                  )}
                  <DetailItem label="Repeats">{repeats || 'Does not repeat'}</DetailItem>
                  {(invoice.reminderSentAt || invoice.overdueEscalatedAt) && (
                    <DetailItem label="Reminders">
                      {invoice.reminderSentAt && <span className="block">Last reminder sent {formatDate(invoice.reminderSentAt)}</span>}
                      {invoice.overdueEscalatedAt && <span className="block text-muted-foreground">Escalated {formatDate(invoice.overdueEscalatedAt)}</span>}
                    </DetailItem>
                  )}
                </dl>
                {(invoice.notes || invoice.internalNotes) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/40 pt-4">
                    {invoice.notes && (
                      <div>
                        <h3 className="text-eyebrow text-muted-foreground">Note to client</h3>
                        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{invoice.notes}</p>
                      </div>
                    )}
                    {invoice.internalNotes && (
                      <div className="rounded-lg border border-accent bg-accent/25 p-3">
                        <h3 className="text-eyebrow text-foreground">Internal notes</h3>
                        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{invoice.internalNotes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>

            {(paymentsError || payments.length > 0) && (
              <Panel id="invoice-payments-heading" title="Payment history">
                {paymentsError ? (
                  <div className={panelBodyClass}>
                    <QueryErrorState
                      error={paymentsRequestError}
                      message="Payment history could not be loaded"
                      onRetry={refetchPayments}
                      isRetrying={paymentsFetching}
                    />
                  </div>
                ) : (
                  <div className={cn(panelBodyClass, 'overflow-x-auto focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm')} tabIndex={0} role="region" aria-label="Payment history table">
                    <table className="w-full min-w-[440px] text-sm">
                      <thead>
                        <tr className="text-left">
                          <th scope="col" className={cn(thClass, 'pr-2')}>Date</th>
                          <th scope="col" className={cn(thClass, 'px-2')}>Method</th>
                          <th scope="col" className={cn(thClass, 'pl-2 text-right')}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id} className="border-t border-border/40 align-top">
                            <td className="py-3 pr-2 text-foreground">{formatDate(p.paidAt)}</td>
                            <td className="py-3 px-2">
                              <span className="text-foreground">{paymentMethodLabel(p.method)}</span>
                              {p.transactionId && <span className="block figure text-xs text-muted-foreground break-all">{p.transactionId}</span>}
                              {p.notes && <span className="block text-xs text-muted-foreground">{p.notes}</span>}
                            </td>
                            <td className="py-3 pl-2 figure text-right text-foreground">{fmt(p.amount, invoice.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}
          </div>
        )}

        <div className="space-y-3 min-w-0">
          <ClientPreview
            invoice={invoice}
            doc={previewDoc}
            viewer={viewer}
            clientInvoiceUrl={clientInvoiceUrl}
            showPayPageLink={Boolean(clientInvoiceUrl && isSent)}
          />
          {invoice.viewToken && (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/invoice/${invoice.viewToken}`)}
              className={cn(smallLinkClass, '-ml-2')}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy client link
            </button>
          )}
        </div>
      </div>

      {/* Mark Paid Modal */}
      <Modal
        isOpen={showMarkPaid}
        onClose={closeMarkPaid}
        title="Record payment"
        size="sm"
        showCloseButton={!markPaidMutation.isPending}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (paymentAmountError(payForm.amount, invoice.balanceDue ?? invoice.total)) return;
            markPaidMutation.mutate(payForm);
          }}
          className="space-y-4"
        >
          <div>
            <p className="text-sm text-muted-foreground">Invoice: <span className="font-medium text-foreground">{invoice.invoiceNumber}</span></p>
            <p className="text-sm text-muted-foreground">Balance due: <span className="font-semibold text-foreground">{fmt(invoice.balanceDue ?? invoice.total, invoice.currency)}</span></p>
          </div>
          <div>
            <label htmlFor="invoice-payment-amount" className="block text-sm font-medium mb-1">Amount received</label>
            <input
              ref={paymentAmountRef}
              id="invoice-payment-amount"
              type="number"
              inputMode="decimal"
              min={nothingOwed(invoice.balanceDue) ? '0' : '0.01'}
              step="0.01"
              max={invoice.balanceDue ?? invoice.total}
              value={payForm.amount}
              onChange={(event) => setPayForm((form) => ({ ...form, amount: event.target.value }))}
              disabled={markPaidMutation.isPending}
              aria-invalid={Boolean(amountError)}
              aria-describedby="invoice-payment-amount-hint"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-base"
            />
            <p id="invoice-payment-amount-hint" className={`mt-1 text-xs ${amountError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {amountError || (nothingOwed(invoice.balanceDue)
                ? 'Nothing is owed. Recording this marks the invoice paid.'
                : 'Less than the balance records a partial payment; the invoice stays open.')}
            </p>
          </div>
          <div>
            <label htmlFor="invoice-payment-method" className="block text-sm font-medium mb-1">Payment method</label>
            <select
              id="invoice-payment-method"
              value={payForm.paymentMethod}
              onChange={(event) => setPayForm((form) => ({ ...form, paymentMethod: event.target.value }))}
              disabled={markPaidMutation.isPending}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-base"
            >
              {PAYMENT_METHOD_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="invoice-payment-transaction" className="block text-sm font-medium mb-1">Transaction ID <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              id="invoice-payment-transaction"
              type="text"
              value={payForm.transactionId}
              onChange={(event) => setPayForm((form) => ({ ...form, transactionId: event.target.value }))}
              disabled={markPaidMutation.isPending}
              placeholder="Reference or Stripe charge ID"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-base"
            />
          </div>
          <div>
            <label htmlFor="invoice-payment-notes" className="block text-sm font-medium mb-1">Notes <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              id="invoice-payment-notes"
              type="text"
              value={payForm.paymentNotes}
              onChange={(event) => setPayForm((form) => ({ ...form, paymentNotes: event.target.value }))}
              disabled={markPaidMutation.isPending}
              placeholder="Received via Interac e-Transfer"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-base"
            />
          </div>
          {markPaidMutation.error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {markPaidMutation.error.message || 'Payment could not be recorded. Your entries are still available; review them and try again.'}
            </p>
          )}
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={closeMarkPaid} disabled={markPaidMutation.isPending}>Cancel</Button>
            <Button
              type="submit"
              loading={markPaidMutation.isPending}
              disabled={markPaidMutation.isPending || Boolean(amountError)}
              leftIcon={<CheckCircle className="w-4 h-4" />}
            >
              {markPaidMutation.isPending ? 'Marking as paid…' : 'Record payment'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      <ConfirmDialog
        isOpen={showVoidConfirm}
        title="Void invoice"
        description={`Void ${invoice.invoiceNumber}? You can undo this action for 10 seconds.`}
        confirmLabel="Void invoice"
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => { deleteMutation.reset(); setShowVoidConfirm(false); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />
    </div>
  );
}

function getDaysOverdue(dueDate) {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}
