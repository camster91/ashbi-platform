import { useState } from 'react';
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

export default function PortalProposal() {
  const { token } = useParams();
  const [action, setAction] = useState(null); // 'approve' | 'decline' | null
  const [declineReason, setDeclineReason] = useState('');
  const [completed, setCompleted] = useState(null); // 'approved' | 'declined'

  const { data: proposal, isLoading, error } = useQuery({
    queryKey: ['portal-proposal', token],
    queryFn: () => api.getPortalProposal(token),
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: (data) => api.respondPortalProposal(token, data),
    onSuccess: (_, variables) => {
      setCompleted(variables.action);
    },
  });

  const handleApprove = () => {
    respondMutation.mutate({ action: 'approve' });
  };

  const handleDecline = () => {
    if (!declineReason.trim()) return;
    respondMutation.mutate({ action: 'decline', reason: declineReason.trim() });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Proposal Not Found</h1>
          <p className="text-slate-500">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const alreadyResponded = proposal.status === 'APPROVED' || proposal.status === 'DECLINED';

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
          <h1 className="text-2xl font-bold text-slate-800 mt-3">Proposal</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Completion confirmation */}
        {(completed || alreadyResponded) && (
          <div className={cn(
            'rounded-xl border p-6 text-center',
            (completed === 'approved' || proposal.status === 'APPROVED')
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          )}>
            {(completed === 'approved' || proposal.status === 'APPROVED') ? (
              <>
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-xl font-bold text-green-800 mb-1">Proposal Approved</h2>
                <p className="text-green-600">Thank you for approving this proposal. We will be in touch shortly to get started.</p>
              </>
            ) : (
              <>
                <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <h2 className="text-xl font-bold text-red-800 mb-1">Proposal Declined</h2>
                <p className="text-red-600">Thank you for your feedback. We appreciate your time and will follow up if needed.</p>
              </>
            )}
          </div>
        )}

        {/* Proposal title & client */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{proposal.title}</h2>
              {proposal.clientName && (
                <div className="flex items-center gap-2 mt-2 text-slate-500">
                  <User className="w-4 h-4" />
                  <span className="text-sm">{proposal.clientName}</span>
                </div>
              )}
              {proposal.createdAt && (
                <p className="text-xs text-slate-400 mt-1">Created {formatDate(proposal.createdAt)}</p>
              )}
            </div>
            {proposal.status && !completed && (
              <span className={cn(
                'px-3 py-1 rounded-full text-xs font-semibold',
                proposal.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                proposal.status === 'DECLINED' ? 'bg-red-100 text-red-700' :
                proposal.status === 'SENT' ? 'bg-blue-100 text-blue-700' :
                'bg-slate-100 text-slate-600'
              )}>
                {proposal.status}
              </span>
            )}
          </div>

          {proposal.description && (
            <p className="text-slate-600 mt-4 leading-relaxed">{proposal.description}</p>
          )}
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Line Items</h3>
          </div>
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
                {proposal.lineItems?.map((item, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4 text-sm text-slate-700">{item.description}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 text-right">{item.quantity}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 text-right">${Number(item.rate || item.unitPrice || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800 text-right">${Number(item.amount || item.total || (item.quantity * (item.rate || item.unitPrice || 0))).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Total</span>
              <span className="text-xl font-bold text-slate-800 flex items-center gap-1">
                <DollarSign className="w-5 h-5" />
                {Number(proposal.total || proposal.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {!completed && !alreadyResponded && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            {action === 'decline' ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-slate-700">Please let us know why you are declining:</h3>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Your feedback helps us improve our proposals..."
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
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
                  className="w-full sm:w-auto px-6 py-3 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  {respondMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  <CheckCircle className="w-4 h-4" />
                  Approve Proposal
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
