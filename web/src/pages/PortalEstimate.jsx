import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CheckCircle,
  XCircle,
  FileText,
  User,
  Building2,
  Loader2,
  Calendar,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';
import LoadingState from '../components/ui/LoadingState';
import usePortalLightTheme from '../hooks/usePortalLightTheme';
import StatusBadge from '../components/ui/StatusBadge';
import PortalLineItems from '../components/PortalLineItems';
import { formatMoney } from '../lib/format';

export default function PortalEstimate() {
  usePortalLightTheme();
  const { viewToken } = useParams();
  const [action, setAction] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineError, setDeclineError] = useState('');
  const [completed, setCompleted] = useState(null);

  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ['portal-estimate', viewToken],
    queryFn: () => api.getEstimateByToken(viewToken),
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: (action) => api.approveEstimateByToken(viewToken, action),
    onSuccess: (_, action) => {
      setCompleted(action === 'approve' ? 'approved' : 'declined');
    },
  });

  const handleApprove = () => {
    respondMutation.mutate('approve');
  };

  const handleDecline = () => {
    if (!declineReason.trim()) {
      setDeclineError('Enter a reason for declining this estimate.');
      return;
    }
    setDeclineError('');
    respondMutation.mutate('decline');
  };

  if (isLoading) {
    return <LoadingState label="Loading estimate…" size="lg" className="bg-background min-h-screen text-primary" spinnerClassName="border-border/40 border-t-primary" />;
  }

  if (error || !estimate) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          <FileText className="text-primary opacity-30 w-12 h-12 mx-auto mb-4" />
          <h1 className="text-primary text-2xl font-bold mb-2">Estimate Not Found</h1>
          <p className="text-muted-foreground">This link may be invalid or expired.</p>
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
  const taxRate = estimate.taxRate !== null && estimate.taxRate !== undefined ? Number(estimate.taxRate) : null;
  // Estimates are in the workspace currency (CAD); one formatter for every
  // amount so lines and totals read the same ("$1,575.00").
  const money = (value) => formatMoney(value);

  const isApproved = completed === 'approved' || estimate.status === 'APPROVED';
  const isDeclined = completed === 'declined' || estimate.status === 'DECLINED';
  const alreadyResponded = isApproved || isDeclined;
  const canRespond = estimate.status === 'SENT' && !completed;

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="bg-primary shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-accent text-xs font-semibold uppercase tracking-widest mb-1">
                Estimate
              </p>
              <h1 className="text-2xl font-bold text-primary-foreground">
                {estimate.title || estimate.estimateNumber || `EST-${estimate.id || ''}`}
              </h1>
            </div>
            <StatusBadge
              domain="estimate"
              status={estimate.status}
              audience="client"
              variant="default"
              className="px-3 py-1.5 font-semibold"
            />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Approval / Decline confirmation banner */}
        {(completed || alreadyResponded) && (
          <div role="status" aria-live="polite" className={cn(
            'rounded-xl border p-6 text-center',
            isApproved ? 'bg-success/5 border-success/30' : 'bg-destructive/5 border-destructive/30'
          )}>
            {isApproved ? (
              <>
                <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                <h2 className="text-xl font-bold text-success mb-1">Estimate Approved</h2>
                <p className="text-success">Thank you for approving this estimate. We will be in touch shortly to get started.</p>
              </>
            ) : (
              <>
                <XCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
                <h2 className="text-xl font-bold text-destructive mb-1">Estimate Declined</h2>
                <p className="text-destructive">Thank you for your feedback. We appreciate your time and will follow up if needed.</p>
              </>
            )}
          </div>
        )}

        {/* From / To / Details */}
        <div className="bg-card rounded-xl border border-border/40 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* From */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">From</p>
              <div className="flex items-center gap-2">
                <Building2 className="text-primary w-4 h-4" />
                <span className="text-primary text-sm font-semibold">
                  {estimate.agencyName || estimate.fromName || 'Ashbi Design'}
                </span>
              </div>
              {estimate.agencyEmail && (
                <p className="text-xs text-muted-foreground mt-1 ml-6">{estimate.agencyEmail}</p>
              )}
            </div>

            {/* To */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Prepared For</p>
              <div className="flex items-center gap-2">
                <User className="text-primary w-4 h-4" />
                <span className="text-primary text-sm font-semibold">
                  {estimate.clientName || estimate.toName || 'Client'}
                </span>
              </div>
              {estimate.clientEmail && (
                <p className="text-xs text-muted-foreground mt-1 ml-6">{estimate.clientEmail}</p>
              )}
            </div>
          </div>

          {/* Dates row */}
          {(estimate.createdAt || estimate.validUntil || estimate.validUntilDate) && (
            <div className="flex flex-wrap gap-4 mt-5 pt-5 border-t border-border/25">
              {estimate.createdAt && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Created {formatDate(estimate.createdAt)}</span>
                </div>
              )}
              {(estimate.validUntil || estimate.validUntilDate) && (
                <div className="text-primary flex items-center gap-1.5 text-sm">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Valid until {formatDate(estimate.validUntil || estimate.validUntilDate, { dateOnly: true })}</span>
                </div>
              )}
            </div>
          )}

          {estimate.description && (
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed border-t border-border/25 pt-4">
              {estimate.description}
            </p>
          )}
        </div>

        {/* Line Items */}
        <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-border/25">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Line Items</h3>
          </div>
          <PortalLineItems
            label="Estimate line items"
            formatAmount={money}
            items={lineItems.map((item) => {
              const quantity = Number(item.quantity || 1);
              const rate = Number(item.rate || item.unitPrice || 0);
              return { description: item.description, quantity, rate, amount: Number(item.amount || item.total || quantity * rate) };
            })}
          />

          {/* Totals */}
          <div className="border-t border-border/40 px-4 sm:px-6 py-4 space-y-2 bg-muted/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{money(subtotal)}</span>
            </div>
            {tax > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{taxRate !== null ? `Tax (${taxRate}%)` : 'Tax'}</span>
                <span className="text-foreground">{money(tax)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-3 border-t border-border/40">
              <span className="text-primary text-sm font-bold">Total</span>
              <span className="text-primary text-2xl font-bold">{money(total)}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {canRespond && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            {action === 'decline' ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">Please let us know why you are declining:</h3>
                <label htmlFor="estimate-decline-reason" className="sr-only">Reason for declining estimate</label>
                <textarea
                  id="estimate-decline-reason"
                  value={declineReason}
                  onChange={(e) => { setDeclineReason(e.target.value); setDeclineError(''); }}
                  aria-invalid={Boolean(declineError)}
                  aria-describedby={declineError ? 'estimate-decline-reason-error' : undefined}
                  placeholder="Your feedback helps us improve our estimates..."
                  className="w-full px-4 py-3 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                  rows={4}
                />
                {declineError && <p id="estimate-decline-reason-error" role="alert" className="text-sm text-destructive">{declineError}</p>}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={!declineReason.trim() || respondMutation.isPending}
                    aria-busy={respondMutation.isPending}
                    className="min-h-11 px-5 py-2.5 bg-destructive text-destructive-foreground text-sm font-medium rounded-lg hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                  >
                    {respondMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Submit Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAction(null); setDeclineReason(''); setDeclineError(''); }}
                    className="min-h-11 px-5 py-2.5 text-muted-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Cancel
                  </button>
                </div>
                {respondMutation.isError && (
                  <p role="alert" className="text-sm text-destructive">Something went wrong. Please try again.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={respondMutation.isPending}
                  aria-busy={respondMutation.isPending}
                  className="min-h-11 w-full sm:w-auto px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {respondMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  <ShieldCheck className="w-4 h-4" />
                  Approve Estimate
                </button>
                <button
                  type="button"
                  onClick={() => setAction('decline')}
                  disabled={respondMutation.isPending}
                  className="min-h-11 w-full sm:w-auto px-6 py-3 border border-border/40 text-muted-foreground text-sm font-semibold rounded-lg hover:bg-muted/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          <p className="text-xs text-muted-foreground">Powered by Ashbi Design</p>
        </div>
      </main>
    </div>
  );
}
