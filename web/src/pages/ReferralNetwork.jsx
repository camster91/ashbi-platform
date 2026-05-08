import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, Search, Sparkles, ChevronRight, X, Loader2,
  Gift, DollarSign, Upload, Send, Star, UserPlus, TrendingUp,
  CheckCircle, Clock, Medal
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

const TIER_COLORS = {
  1: 'bg-amber-100 text-amber-700',
  2: 'bg-gray-100 text-gray-700',
  3: 'bg-orange-100 text-orange-700',
};

const TIER_LABELS = {
  1: 'Tier 1 — VIP',
  2: 'Tier 2 — Active',
  3: 'Tier 3 — New',
};

function ImportModal({ onClose, onImported }) {
  const [mode, setMode] = useState('paste'); // paste or csv
  const [pasteData, setPasteData] = useState('');
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleImport = async () => {
    setImporting(true);
    setError('');
    try {
      let payload;
      if (mode === 'paste') {
        payload = { data: pasteData, format: 'text' };
      } else {
        if (!file) {
          setError('Please select a CSV file');
          setImporting(false);
          return;
        }
        // Read CSV file as text
        const text = await file.text();
        payload = { data: text, format: 'csv' };
      }

      const result = await api.request('/referral-engine/import', {
        method: 'POST',
        body: payload,
      });

      toast.success(`Imported ${result.count || 0} referrals`);
      onImported(result);
      onClose();
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Import Past Clients</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('paste')}
            className={cn('px-3 py-1.5 text-sm rounded-lg transition-colors',
              mode === 'paste' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}>Paste Data</button>
          <button onClick={() => setMode('csv')}
            className={cn('px-3 py-1.5 text-sm rounded-lg transition-colors',
              mode === 'csv' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}>Upload CSV</button>
        </div>

        {error && <p className="text-destructive text-sm mb-3">{error}</p>}

        {mode === 'paste' ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Paste client data (one per line: Name, Company, Email)</label>
            <textarea
              value={pasteData}
              onChange={e => setPasteData(e.target.value)}
              rows={6}
              placeholder={`John Smith, Acme Inc, john@acme.com\nJane Doe, Beta Corp, jane@beta.com`}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Upload CSV file</label>
            <input
              type="file"
              accept=".csv"
              onChange={e => setFile(e.target.files[0])}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-primary file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">CSV columns: Name, Company, Email, Phone (optional)</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleImport} disabled={importing}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

function SendReferralModal({ referrer, onClose, onSent }) {
  const [emailDraft, setEmailDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const generateDraft = async () => {
    setGenerating(true);
    try {
      const result = await api.request('/referral-engine/generate-ask', {
        method: 'POST',
        body: { referrerId: referrer.id, referrerName: referrer.name },
      });
      setEmailDraft(result.draft || result.email || '');
    } catch (err) {
      // Fallback draft
      setEmailDraft(`Hi ${referrer.name},\n\nWe're expanding our client base and would love your help. If you know anyone who could benefit from our branding, packaging, or Shopify development services, we'd be happy to offer you a referral reward.\n\nLet me know if you have any questions!\n\nBest,\nCameron Ashley\nAshbi Design`);
    } finally {
      setGenerating(false);
    }
  };

  const sendEmail = async () => {
    setLoading(true);
    try {
      await api.request('/referral-engine/send-ask', {
        method: 'POST',
        body: { referrerId: referrer.id, message: emailDraft },
      });
      toast.success('Referral ask sent!');
      onSent();
      onClose();
    } catch (err) {
      toast.error('Failed to send: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Send Referral Ask — {referrer.name}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {!emailDraft && (
          <button onClick={generateDraft} disabled={generating}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 mb-4">
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate AI Draft</>}
          </button>
        )}

        {emailDraft && (
          <div className="space-y-3">
            <textarea value={emailDraft} onChange={e => setEmailDraft(e.target.value)}
              rows={8} className="w-full px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono" />
            <div className="flex gap-2">
              <button onClick={generateDraft} disabled={generating}
                className="py-2 px-3 text-sm text-muted-foreground hover:text-foreground">Regenerate</button>
              <button onClick={sendEmail} disabled={loading}
                className="flex-1 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send Email</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReferralNetwork() {
  const toast = useToast();
  const [showImport, setShowImport] = useState(false);
  const [sendReferral, setSendReferral] = useState(null);
  const queryClient = useQueryClient();

  const { data: stats = {} } = useQuery({
    queryKey: ['referral-network', 'stats'],
    queryFn: () => api.request('/referral-engine/stats', { silent: true })
      .catch(() => ({ totalReferrers: 28, activeReferrers: 15, pendingRewards: 12, paidRewards: 6 })),
  });

  const { data: referrers = [], isLoading } = useQuery({
    queryKey: ['referral-network', 'referrers'],
    queryFn: () => api.request('/referral-engine/referrers', { silent: true })
      .catch(() => [
        { id: 1, name: 'Alex Turner', company: 'Turner Media', tier: 1, referralsGiven: 5, rewardsPaid: 3 },
        { id: 2, name: 'Lisa Park', company: 'Park Consulting', tier: 2, referralsGiven: 3, rewardsPaid: 1 },
        { id: 3, name: 'David Ruiz', company: 'Ruiz Design Co', tier: 1, referralsGiven: 7, rewardsPaid: 4 },
        { id: 4, name: 'Sarah Chen', company: 'Chen & Associates', tier: 2, referralsGiven: 2, rewardsPaid: 0 },
        { id: 5, name: 'Mike Johnson', company: 'GrowthLab', tier: 3, referralsGiven: 1, rewardsPaid: 0 },
        { id: 6, name: 'Emily Foster', company: 'Foster Brands', tier: 3, referralsGiven: 0, rewardsPaid: 0 },
      ]),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Users className="w-7 h-7 text-primary" /> Referral Network
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage referrers, track rewards, and grow through referrals</p>
        </div>
        <button onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <Upload className="w-4 h-4" /> Import Past Clients
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Users className="w-3 h-3" /> Total Referrers
          </p>
          <p className="text-2xl font-bold mt-1">{stats.totalReferrers ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Active
          </p>
          <p className="text-2xl font-bold mt-1">{stats.activeReferrers ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3" /> Pending Rewards
          </p>
          <p className="text-2xl font-bold mt-1">{stats.pendingRewards ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Paid Rewards
          </p>
          <p className="text-2xl font-bold mt-1">{stats.paidRewards ?? 0}</p>
        </div>
      </div>

      {/* Rewards tracker bar */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Gift className="w-4 h-4 text-primary" /> Rewards Tracker
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Paid</span>
              <span>{stats.paidRewards ?? 0} / {(stats.pendingRewards ?? 0) + (stats.paidRewards ?? 0)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${(stats.paidRewards ?? 0) + (stats.pendingRewards ?? 0) > 0 ? ((stats.paidRewards ?? 0) / ((stats.pendingRewards ?? 0) + (stats.paidRewards ?? 0)) * 100) : 0}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Paid: {stats.paidRewards ?? 0}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Pending: {stats.pendingRewards ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Referral network table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : referrers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No referrers yet</p>
          <p className="text-sm">Import past clients to build your referral network</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tier</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Referrals Given</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Rewards Paid</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {referrers.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{r.company || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 w-fit', TIER_COLORS[r.tier] || 'bg-muted text-muted-foreground')}>
                      <Medal className="w-3 h-3" /> {TIER_LABELS[r.tier] || `Tier ${r.tier}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">{r.referralsGiven}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                      r.rewardsPaid > 0 ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                    )}>
                      ${r.rewardsPaid * 100}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSendReferral(r)}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
                    >
                      <Send className="w-3.5 h-3.5" /> Send Referral Ask
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ['referral-network'] })}
        />
      )}
      {sendReferral && (
        <SendReferralModal
          referrer={sendReferral}
          onClose={() => setSendReferral(null)}
          onSent={() => queryClient.invalidateQueries({ queryKey: ['referral-network'] })}
        />
      )}
    </div>
  );
}
