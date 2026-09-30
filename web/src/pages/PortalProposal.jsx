import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sparkles,
  CheckCircle,
  XCircle,
  FileText,
  User,
  DollarSign,
  Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';
import LoadingState from '../components/ui/LoadingState';
import usePortalLightTheme from '../hooks/usePortalLightTheme';

export default function PortalProposal() {
  usePortalLightTheme();
  const { token } = useParams();
  const [action, setAction] = useState(null); // 'approve' | 'decline' | null
  const [declineReason, setDeclineReason] = useState('');
  const [declineError, setDeclineError] = useState('');
  const declineRef = useRef(null);

  useEffect(() => {
    if (action === 'decline') declineRef.current?.focus();
  }, [action]);
  const [completed, setCompleted] = useState(null); // 'approved' | 'declined'

  const { data: proposal, isLoading, error } = useQuery({
    queryKey: ['portal-proposal', token],
    queryFn: () => api.getPortalProposal(token),
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: (data) => api.respondPortalProposal(token, data),
    onSuccess: (_, variables) => {
      // The confirmation banner keys off past tense; storing the raw action
      // ('approve') made every approval render as "Proposal Declined".
      setCompleted(variables.action === 'approve' ? 'approved' : 'declined');
    },
  });

  const handleApprove = () => {
    respondMutation.mutate({ action: 'approve' });
  };

  const handleDecline = () => {
    if (!declineReason.trim()) {
      setDeclineError('Enter a reason for declining this proposal.');
      declineRef.current?.focus();
      return;
    }
    setDeclineError('');
    respondMutation.mutate({ action: 'decline', reason: declineReason.trim() });
  };

  if (isLoading) {
    return <LoadingState label="Loading proposal…" className="min-h-screen bg-background text-foreground" spinnerClassName="border-border/60 border-t-primary" />;
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Proposal Not Found</h1>
          <p className="text-muted-foreground">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const alreadyResponded = proposal.status === 'APPROVED' || proposal.status === 'DECLINED';

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
          <h1 className="text-2xl font-bold text-foreground mt-3">Proposal</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Completion confirmation */}
        {(completed || alreadyResponded) && (
          <div role="status" aria-live="polite" className={cn(
            'rounded-xl border p-6 text-center',
            (completed === 'approved' || proposal.status === 'APPROVED')
              ? 'bg-success/5 border-success/30'
              : 'bg-destructive/5 border-destructive/30'
          )}>
            {(completed === 'approved' || proposal.status === 'APPROVED') ? (
              <>
                <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                <h2 className="text-xl font-bold text-success mb-1">Proposal Approved</h2>
                <p className="text-success">Thank you for approving this proposal. We will be in touch shortly to get started.</p>
              </>
            ) : (
              <>
                <XCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
                <h2 className="text-xl font-bold text-destructive mb-1">Proposal Declined</h2>
                <p className="text-destructive">Thank you for your feedback. We appreciate your time and will follow up if needed.</p>
              </>
            )}
          </div>
        )}

        {/* Proposal title & client */}
        <div className="bg-card rounded-xl border border-border/40 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">{proposal.title}</h2>
              {proposal.clientName && (
                <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                  <User className="w-4 h-4" />
                  <span className="text-sm">{proposal.clientName}</span>
                </div>
              )}
              {proposal.createdAt && (
                <p className="text-xs text-muted-foreground mt-1">Created {formatDate(proposal.createdAt)}</p>
              )}
            </div>
            {proposal.status && !completed && (
              <span className={cn(
                'px-3 py-1 rounded-full text-xs font-semibold',
                proposal.status === 'APPROVED' ? 'bg-success/10 text-success' :
                proposal.status === 'DECLINED' ? 'bg-destructive/10 text-destructive' :
                proposal.status === 'SENT' ? 'bg-info/10 text-info' :
                'bg-muted text-muted-foreground'
              )}>
                {proposal.status}
              </span>
            )}
          </div>

          {proposal.description && (
            <p className="text-muted-foreground mt-4 leading-relaxed">{proposal.description}</p>
          )}
        </div>

        {/* Line Items */}
        <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-border/25">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Line Items</h3>
          </div>
          <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label="Proposal line items">
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
                {proposal.lineItems?.map((item, i) => (
                  <tr key={i} className="hover:bg-muted/50">
                    <td className="px-6 py-4 text-sm text-foreground">{item.description}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground text-right">{item.quantity}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground text-right">${Number(item.rate || item.unitPrice || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground text-right">${Number(item.amount || item.total || (item.quantity * (item.rate || item.unitPrice || 0))).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="border-t border-border/40 px-6 py-4 bg-muted/50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Total</span>
              <span className="text-xl font-bold text-foreground flex items-center gap-1">
                <DollarSign className="w-5 h-5" />
                {Number(proposal.total || proposal.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {!completed && !alreadyResponded && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            {action === 'decline' ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">Please let us know why you are declining:</h3>
                <label htmlFor="decline-reason" className="sr-only">Reason for declining proposal</label>
                <textarea
                  ref={declineRef}
                  id="decline-reason"
                  value={declineReason}
                  onChange={(e) => { setDeclineReason(e.target.value); setDeclineError(''); }}
                  required
                  aria-invalid={!!declineError}
                  aria-describedby={declineError ? 'decline-reason-error' : undefined}
                  placeholder="Your feedback helps us improve our proposals..."
                  className="w-full px-4 py-3 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning resize-none"
                  rows={4}
                />
                {declineError && <p id="decline-reason-error" role="alert" className="text-sm text-destructive">{declineError}</p>}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={respondMutation.isPending}
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
                  className="min-h-11 w-full sm:w-auto px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {respondMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  <CheckCircle className="w-4 h-4" />
                  Approve Proposal
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
