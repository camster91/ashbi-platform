import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sparkles,
  CheckCircle,
  FileText,
  DollarSign,
  Calendar,
  AlertCircle,
  Loader2,
  CreditCard,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';

const statusConfig = {
  DRAFT: { label: 'Draft', color: 'bg-slate-100 text-slate-600', icon: FileText },
  SENT: { label: 'Awaiting Payment', color: 'bg-blue-100 text-blue-700', icon: Clock },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  PAID: { label: 'Paid', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  CANCELLED: { label: 'Cancelled', color: 'bg-slate-100 text-slate-500', icon: FileText },
};

export default function PortalInvoice() {
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Invoice Not Found</h1>
          <p className="text-slate-500">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const status = statusConfig[invoice.status] || statusConfig.DRAFT;
  const StatusIcon = status.icon;
  const showPayButton = invoice.status === 'SENT' || invoice.status === 'OVERDUE';
  const isPaid = invoice.status === 'PAID';

  const subtotal = invoice.lineItems?.reduce((sum, item) => {
    return sum + Number(item.amount || item.total || (item.quantity * (item.rate || item.unitPrice || 0)));
  }, 0) || 0;
  const tax = Number(invoice.tax || 0);
  const total = Number(invoice.total || invoice.amount || (subtotal + tax));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-sm font-medium text-slate-500">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mt-3">Invoice</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Paid confirmation */}
        {isPaid && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-green-800 mb-1">Payment Received</h2>
            <p className="text-green-600">
              {invoice.paidAt
                ? `Paid on ${formatDate(invoice.paidAt)}`
                : 'This invoice has been paid. Thank you!'}
            </p>
          </div>
        )}

        {/* Invoice Details */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-800">
                  {invoice.invoiceNumber || invoice.number || `INV-${invoice.id}`}
                </h2>
                <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1', status.color)}>
                  <StatusIcon className="w-3 h-3" />
                  {status.label}
                </span>
              </div>
              {invoice.clientName && (
                <p className="text-sm text-slate-500 mt-1">For: {invoice.clientName}</p>
              )}
            </div>
            <div className="text-right text-sm space-y-1">
              {invoice.issueDate && (
                <div className="flex items-center gap-1.5 text-slate-500 justify-end">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Issued: {formatDate(invoice.issueDate || invoice.createdAt)}</span>
                </div>
              )}
              {invoice.dueDate && (
                <div className={cn(
                  'flex items-center gap-1.5 justify-end',
                  invoice.status === 'OVERDUE' ? 'text-red-600 font-medium' : 'text-slate-500'
                )}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>Due: {formatDate(invoice.dueDate)}</span>
                </div>
              )}
            </div>
          </div>

          {invoice.description && (
            <p className="text-slate-600 mt-4 text-sm leading-relaxed border-t border-slate-100 pt-4">
              {invoice.description}
            </p>
          )}
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Qty</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Rate</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.lineItems?.map((item, i) => {
                  const rate = Number(item.rate || item.unitPrice || 0);
                  const qty = Number(item.quantity || 1);
                  const amount = Number(item.amount || item.total || (qty * rate));
                  return (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4 text-sm text-slate-700">{item.description}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 text-right">{qty}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 text-right">${rate.toFixed(2)}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-800 text-right">${amount.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-slate-700">${subtotal.toFixed(2)}</span>
            </div>
            {tax > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span className="text-slate-700">${tax.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-xl font-bold text-slate-800 flex items-center gap-1">
                <DollarSign className="w-5 h-5" />
                {total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Pay Button */}
        {showPayButton && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            {invoice.status === 'OVERDUE' && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-100">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">This invoice is past due. Please make your payment as soon as possible.</p>
              </div>
            )}
            <button
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending}
              className="w-full px-6 py-3.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {payMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              Pay Now - ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </button>
            {payMutation.isError && (
              <p className="text-sm text-red-600 text-center mt-3">Payment initiation failed. Please try again.</p>
            )}
            <p className="text-xs text-slate-400 text-center mt-3">
              Secure payment powered by Stripe
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-slate-400">Powered by Ashbi Design</p>
        </div>
      </main>
    </div>
  );
}
