import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CheckCircle,
  XCircle,
  FileText,
  User,
  Building2,
  DollarSign,
  Loader2,
  Calendar,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';

const statusConfig = {
  DRAFT: { label: 'Draft', color: 'bg-slate-100 text-slate-600' },
  SENT: { label: 'Pending Review', color: 'bg-indigo-100 text-indigo-700' },
  APPROVED: { label: 'Approved', color: 'bg-green-100 text-green-700' },
  DECLINED: { label: 'Declined', color: 'bg-red-100 text-red-700' },
  EXPIRED: { label: 'Expired', color: 'bg-amber-100 text-amber-700' },
};

export default function PortalEstimate() {
  const { viewToken } = useParams();
  const [action, setAction] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [completed, setCompleted] = useState(null);

  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ['portal-estimate', viewToken],
    queryFn: () => api.getEstimateByToken(viewToken),
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: (data) => api.approveEstimateByToken(viewToken, data.action),
    onSuccess: (_, variables) => {
      setCompleted(variables === 'approve' ? 'approved' : 'declined');
    },
  });

  const handleApprove = () => {
    respondMutation.mutate('approve');
  };

  const handleDecline = () => {
    if (!declineReason.trim()) return;
    respondMutation.mutate('decline');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf9f2' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#2e2958' }} />
          <p className="text-sm" style={{ color: '#2e2958' }}>Loading estimate&hellip;</p>
        </div>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf9f2' }}>
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-4" style={{ color: '#2e2958', opacity: 0.3 }} />
          <h1 className="text-2xl font-bold mb-2" style={{ color: '#2e2958' }}>Estimate Not Found</h1>
          <p className="text-slate-500">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const lineItems = estimate.lineItems || estimate.items || [];
  const subtotal = lineItems.reduce((sum, item) => {
    const qty = Number(item.quantity || 1);
    const rate = Number(item.rate || item.unitPrice || 0);
    const amount = Number(item.amount || item.total || qty * rate);
    return sum + amount;
  }, 0);
  const tax = Number(estimate.tax || estimate.taxAmount || 0);
  const total = Number(estimate.total || estimate.amount || (subtotal + tax));

  const isApproved = completed === 'approved' || estimate.status === 'APPROVED';
  const isDeclined = completed === 'declined' || estimate.status === 'DECLINED';
  const alreadyResponded = isApproved || isDeclined;
  const canRespond = estimate.status === 'SENT' && !completed;

  const status = statusConfig[estimate.status] || statusConfig.DRAFT;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf9f2' }}>
      {/* Header */}
      <header className="shadow-sm" style={{ backgroundColor: '#2e2958' }}>
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#e6f354' }}>
                Estimate
              </p>
              <h1 className="text-2xl font-bold text-white">
                {estimate.title || estimate.estimateNumber || `EST-${estimate.id || ''}`}
              </h1>
            </div>
            <span className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap',
              status.color
            )}>
              {status.label}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Approval / Decline confirmation banner */}
        {(completed || alreadyResponded) && (
          <div className={cn(
            'rounded-xl border p-6 text-center',
            isApproved ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          )}>
            {isApproved ? (
              <>
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-xl font-bold text-green-800 mb-1">Estimate Approved</h2>
                <p className="text-green-600">Thank you for approving this estimate. We will be in touch shortly to get started.</p>
              </>
            ) : (
              <>
                <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <h2 className="text-xl font-bold text-red-800 mb-1">Estimate Declined</h2>
                <p className="text-red-600">Thank you for your feedback. We appreciate your time and will follow up if needed.</p>
              </>
            )}
          </div>
        )}

        {/* From / To / Details */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* From */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">From</p>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" style={{ color: '#2e2958' }} />
                <span className="text-sm font-semibold" style={{ color: '#2e2958' }}>
                  {estimate.agencyName || estimate.fromName || 'Ashbi Design'}
                </span>
              </div>
              {estimate.agencyEmail && (
                <p className="text-xs text-slate-500 mt-1 ml-6">{estimate.agencyEmail}</p>
              )}
            </div>

            {/* To */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Prepared For</p>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" style={{ color: '#2e2958' }} />
                <span className="text-sm font-semibold" style={{ color: '#2e2958' }}>
                  {estimate.clientName || estimate.toName || 'Client'}
                </span>
              </div>
              {estimate.clientEmail && (
                <p className="text-xs text-slate-500 mt-1 ml-6">{estimate.clientEmail}</p>
              )}
            </div>
          </div>

          {/* Dates row */}
          {(estimate.createdAt || estimate.validUntil || estimate.validUntilDate) && (
            <div className="flex flex-wrap gap-4 mt-5 pt-5 border-t border-slate-100">
              {estimate.createdAt && (
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Created {formatDate(estimate.createdAt)}</span>
                </div>
              )}
              {(estimate.validUntil || estimate.validUntilDate) && (
                <div className="flex items-center gap-1.5 text-sm" style={{ color: '#2e2958' }}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>Valid until {formatDate(estimate.validUntil || estimate.validUntilDate)}</span>
                </div>
              )}
            </div>
          )}

          {estimate.description && (
            <p className="text-slate-600 mt-4 text-sm leading-relaxed border-t border-slate-100 pt-4">
              {estimate.description}
            </p>
          )}
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Line Items</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: '#2e2958' }}>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-left" style={{ color: '#e6f354' }}>Description</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-right" style={{ color: '#e6f354' }}>Qty</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-right" style={{ color: '#e6f354' }}>Rate</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-right" style={{ color: '#e6f354' }}>Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineItems.map((item, i) => {
                  const qty = Number(item.quantity || 1);
                  const rate = Number(item.rate || item.unitPrice || 0);
                  const amount = Number(item.amount || item.total || qty * rate);
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
          <div className="border-t border-slate-200 px-6 py-4 space-y-2 bg-slate-50">
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
            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <span className="text-sm font-bold" style={{ color: '#2e2958' }}>Total</span>
              <span className="text-2xl font-bold flex items-center gap-1" style={{ color: '#2e2958' }}>
                <DollarSign className="w-5 h-5" />
                {total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {canRespond && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            {action === 'decline' ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-slate-700">Please let us know why you are declining:</h3>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Your feedback helps us improve our estimates..."
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                  rows={4}
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDecline}
                    disabled={!declineReason.trim() || respondMutation.isPending}
                    className="px-5 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {respondMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Submit Decline
                  </button>
                  <button
                    onClick={() => { setAction(null); setDeclineReason(''); }}
                    className="px-5 py-2.5 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {respondMutation.isError && (
                  <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button
                  onClick={handleApprove}
                  disabled={respondMutation.isPending}
                  className="w-full sm:w-auto px-6 py-3 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
                  style={{ backgroundColor: '#2e2958' }}
                >
                  {respondMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  <ShieldCheck className="w-4 h-4" />
                  Approve Estimate
                </button>
                <button
                  onClick={() => setAction('decline')}
                  disabled={respondMutation.isPending}
                  className="w-full sm:w-auto px-6 py-3 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  Decline
                </button>
              </div>
            )}
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