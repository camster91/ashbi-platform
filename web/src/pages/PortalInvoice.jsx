import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sparkles,
  CheckCircle,
  FileText,
  Calendar,
  AlertCircle,
  Loader2,
  CreditCard,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { formatInvoiceMoney, formatInvoiceDate } from '../lib/format';
import LoadingState from '../components/ui/LoadingState';
import usePortalLightTheme from '../hooks/usePortalLightTheme';
import StatusBadge from '../components/ui/StatusBadge';

function formatDate(date) {
  return formatInvoiceDate(date, { month: 'long' });
}

// The invoice's stored amounts are authoritative (the server applied the
// discount and tax); the page never recomputes or substitutes them.
export function invoiceAmounts(invoice) {
  const amount = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return {
    subtotal: amount(invoice.subtotal),
    discount: amount(invoice.discountAmount),
    tax: amount(invoice.tax),
    total: amount(invoice.total),
    // Partial payments leave a balance; the pay button charges only that.
    amountPaid: amount(invoice.amountPaid),
    balanceDue: invoice.balanceDue === undefined || invoice.balanceDue === null ? amount(invoice.total) : amount(invoice.balanceDue),
  };
}

export default function PortalInvoice() {
  usePortalLightTheme();
  const { token } = useParams();

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['portal-invoice', token],
    queryFn: () => api.getPortalInvoice(token),
    retry: false,
  });

  const payMutation = useMutation({
    mutationFn: () => api.payPortalInvoice(token),
    onSuccess: (data) => {
      if (data.url || data.checkoutUrl) {
        window.location.href = data.url || data.checkoutUrl;
      }
    },
  });

  if (isLoading) {
    return <LoadingState label="Loading invoice…" className="min-h-screen bg-background text-foreground" spinnerClassName="border-border/60 border-t-primary" />;
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Invoice Not Found</h1>
          <p className="text-muted-foreground">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === 'PAID';
  const { subtotal, discount, tax, total, amountPaid, balanceDue } = invoiceAmounts(invoice);
  // Nothing to collect on a zero (or negative) balance.
  const showPayButton = (invoice.status === 'SENT' || invoice.status === 'OVERDUE') && balanceDue > 0;
  const currency = invoice.currency;
  const taxLabel = invoice.taxType && invoice.taxType !== 'NONE'
    ? `${invoice.taxType}${invoice.taxRate != null ? ` (${invoice.taxRate}%)` : ''}`
    : 'Tax';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border/40 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-warning" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mt-3">Invoice</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Paid confirmation */}
        {isPaid && (
          <div role="status" aria-live="polite" className="rounded-xl border border-success/30 bg-success/5 p-6 text-center">
            <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
            <h2 className="text-xl font-bold text-success mb-1">Payment Received</h2>
            <p className="text-success">
              {invoice.paidAt
                ? `Paid on ${formatDate(invoice.paidAt)}`
                : 'This invoice has been paid. Thank you!'}
            </p>
          </div>
        )}

        {/* Invoice Details */}
        <div className="bg-card rounded-xl border border-border/40 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  {invoice.invoiceNumber || invoice.number || `INV-${invoice.id}`}
                </h2>
                <StatusBadge domain="invoice" status={invoice.status} audience="client" className="px-2.5 font-semibold" />
              </div>
              {invoice.clientName && (
                <p className="text-sm text-muted-foreground mt-1">For: {invoice.clientName}</p>
              )}
            </div>
            <div className="text-right text-sm space-y-1">
              {invoice.issueDate && (
                <div className="flex items-center gap-1.5 text-muted-foreground justify-end">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Issued: {formatDate(invoice.issueDate || invoice.createdAt)}</span>
                </div>
              )}
              {invoice.dueDate && (
                <div className={cn(
                  'flex items-center gap-1.5 justify-end',
                  invoice.status === 'OVERDUE' ? 'text-destructive font-medium' : 'text-muted-foreground'
                )}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>Due: {formatDate(invoice.dueDate)}</span>
                </div>
              )}
            </div>
          </div>

          {invoice.description && (
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed border-t border-border/25 pt-4">
              {invoice.description}
            </p>
          )}
        </div>

        {/* Line Items */}
        <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
          <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label="Invoice line items">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                  <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Qty</th>
                  <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Rate</th>
                  <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/25">
                {invoice.lineItems?.map((item, i) => {
                  const rate = Number(item.rate || item.unitPrice || 0);
                  const qty = Number(item.quantity || 1);
                  const amount = Number(item.amount || item.total || (qty * rate));
                  return (
                    <tr key={i} className="hover:bg-muted/50">
                      <td className="px-6 py-4 text-sm text-foreground">{item.description}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground text-right">{qty}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground text-right">{formatInvoiceMoney(rate, currency)}</td>
                      <td className="px-6 py-4 text-sm font-medium text-foreground text-right">{formatInvoiceMoney(amount, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-border/40 bg-muted/50 px-6 py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{formatInvoiceMoney(subtotal, currency)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-success">-{formatInvoiceMoney(discount, currency)}</span>
              </div>
            )}
            {tax > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{taxLabel}</span>
                <span className="text-foreground">{formatInvoiceMoney(tax, currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-xl font-bold text-foreground">{formatInvoiceMoney(total, currency)}</span>
            </div>
            {invoice.status !== 'PAID' && amountPaid > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="text-foreground">-{formatInvoiceMoney(amountPaid, currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span className="text-foreground">Balance due</span>
                  <span className="text-foreground">{formatInvoiceMoney(balanceDue, currency)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Pay Button */}
        {showPayButton && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            {invoice.status === 'OVERDUE' && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-destructive/5 border border-destructive/30">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">This invoice is past due. Please make your payment as soon as possible.</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending}
              aria-busy={payMutation.isPending}
              className="min-h-11 w-full px-6 py-3.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {payMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              Pay Now - {formatInvoiceMoney(balanceDue, currency)}
            </button>
            {payMutation.isError && (
              <p role="alert" className="text-sm text-destructive text-center mt-3">Payment initiation failed. Please try again.</p>
            )}
            <p className="text-xs text-muted-foreground text-center mt-3">
              Secure payment powered by Stripe
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-muted-foreground">Powered by Ashbi Design</p>
        </div>
      </main>
    </div>
  );
}
