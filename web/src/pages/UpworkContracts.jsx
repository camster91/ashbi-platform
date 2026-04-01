import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Plus,
  Clock,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  MessageSquare,
  Loader2,
  Pencil,
  X,
  Save,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

const statusConfig = {
  ACTIVE: { label: 'Active', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  PAUSED: { label: 'Paused', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: PauseCircle },
  COMPLETED: { label: 'Completed', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', color: 'bg-muted text-muted-foreground', icon: X },
};

const milestoneStatusConfig = {
  PENDING: { label: 'Pending', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  SUBMITTED: { label: 'Submitted', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  APPROVED: { label: 'Approved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

function ContractForm({ contract, onSave, onCancel, isPending }) {
  const [form, setForm] = useState({
    clientName: contract?.clientName || '',
    projectName: contract?.projectName || '',
    contractType: contract?.contractType || 'FIXED',
    totalBudget: contract?.totalBudget || 0,
    hourlyRate: contract?.hourlyRate || '',
    status: contract?.status || 'ACTIVE',
    currentMilestone: contract?.currentMilestone || '',
    milestoneAmount: contract?.milestoneAmount || '',
    milestoneStatus: contract?.milestoneStatus || 'PENDING',
    notes: contract?.notes || '',
    upworkUrl: contract?.upworkUrl || '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      totalBudget: parseFloat(form.totalBudget) || 0,
      hourlyRate: form.hourlyRate ? parseFloat(form.hourlyRate) : null,
      milestoneAmount: form.milestoneAmount ? parseFloat(form.milestoneAmount) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-primary/20 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">
        {contract ? 'Edit Contract' : 'Add Contract'}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={form.clientName}
          onChange={(e) => setForm(f => ({ ...f, clientName: e.target.value }))}
          placeholder="Client Name *"
          required
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <input
          value={form.projectName}
          onChange={(e) => setForm(f => ({ ...f, projectName: e.target.value }))}
          placeholder="Project Name *"
          required
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          value={form.contractType}
          onChange={(e) => setForm(f => ({ ...f, contractType: e.target.value }))}
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="FIXED">Fixed Price</option>
          <option value="HOURLY">Hourly</option>
        </select>
        <select
          value={form.status}
          onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <input
          type="number"
          value={form.totalBudget}
          onChange={(e) => setForm(f => ({ ...f, totalBudget: e.target.value }))}
          placeholder="Total Budget ($)"
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {form.contractType === 'HOURLY' && (
          <input
            type="number"
            value={form.hourlyRate}
            onChange={(e) => setForm(f => ({ ...f, hourlyRate: e.target.value }))}
            placeholder="Hourly Rate ($)"
            className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        )}
        <input
          value={form.currentMilestone}
          onChange={(e) => setForm(f => ({ ...f, currentMilestone: e.target.value }))}
          placeholder="Current Milestone (e.g. Milestone 2)"
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex gap-2">
          <input
            type="number"
            value={form.milestoneAmount}
            onChange={(e) => setForm(f => ({ ...f, milestoneAmount: e.target.value }))}
            placeholder="Milestone $ Amount"
            className="flex-1 px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <select
            value={form.milestoneStatus}
            onChange={(e) => setForm(f => ({ ...f, milestoneStatus: e.target.value }))}
            className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="PENDING">Pending</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="APPROVED">Approved</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </div>
        <input
          value={form.upworkUrl}
          onChange={(e) => setForm(f => ({ ...f, upworkUrl: e.target.value }))}
          placeholder="Upwork URL"
          className="px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <textarea
        value={form.notes}
        onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
        placeholder="Notes..."
        rows={2}
        className="w-full px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {contract ? 'Update' : 'Add Contract'}
        </button>
      </div>
    </form>
  );
}

function DraftReplyModal({ contract, onClose }) {
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await api.aiChat({
        message: `Draft a professional reply for my Upwork client. Context:
Client: ${contract.clientName}
Project: ${contract.projectName}
Contract type: ${contract.contractType} - $${contract.totalBudget || contract.hourlyRate + '/hr'}
Current milestone: ${contract.currentMilestone || 'N/A'} (${contract.milestoneStatus || 'N/A'})
Notes: ${contract.notes || 'None'}

Draft a brief, professional message checking in on progress or providing an update. Keep it warm but concise. Sign off as Cameron.`
      });
      setDraft(result.response || result.message || '');
    } catch (err) {
      setDraft(`Error generating draft: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl border border-border w-full max-w-lg mx-4 p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Draft Reply - {contract.clientName}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Project: {contract.projectName}</p>
          <p>Milestone: {contract.currentMilestone || 'N/A'} ({contract.milestoneStatus || 'N/A'})</p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors w-full justify-center"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? 'Generating...' : 'Generate AI Draft'}
        </button>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Click 'Generate AI Draft' or type your reply here..."
          rows={8}
          className="w-full px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(draft);
              onClose();
            }}
            disabled={!draft}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Copy & Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UpworkContracts() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draftReplyContract, setDraftReplyContract] = useState(null);

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['upwork-contracts'],
    queryFn: () => api.getUpworkContracts(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createUpworkContract(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upwork-contracts'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateUpworkContract(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upwork-contracts'] });
      setEditing(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.updateUpworkContract(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upwork-contracts'] }),
  });

  const activeContracts = contracts.filter(c => c.status === 'ACTIVE');
  const otherContracts = contracts.filter(c => c.status !== 'ACTIVE');
  const totalActive = activeContracts.reduce((sum, c) => sum + (c.totalBudget || 0), 0);
  const overdueCount = contracts.filter(c => c.milestoneStatus === 'OVERDUE').length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-primary" />
            Contract Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track Upwork contracts, milestones, and client communication
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditing(null); }}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Contract
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Briefcase className="w-4 h-4" />
            Active Contracts
          </div>
          <p className="text-2xl font-bold text-foreground mt-1">{activeContracts.length}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DollarSign className="w-4 h-4" />
            Active Value
          </div>
          <p className="text-2xl font-bold text-foreground mt-1">${totalActive.toLocaleString()}</p>
        </div>
        <div className={cn("bg-card rounded-xl border p-4", overdueCount > 0 ? "border-destructive/30 bg-destructive/5" : "border-border")}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className={cn("w-4 h-4", overdueCount > 0 && "text-destructive")} />
            Overdue
          </div>
          <p className={cn("text-2xl font-bold mt-1", overdueCount > 0 ? "text-destructive" : "text-foreground")}>{overdueCount}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4" />
            Total Contracts
          </div>
          <p className="text-2xl font-bold text-foreground mt-1">{contracts.length}</p>
        </div>
      </div>

      {/* Add/Edit Form */}
      {(showForm || editing) && (
        <ContractForm
          contract={editing}
          onSave={(data) => {
            if (editing) {
              updateMutation.mutate({ id: editing.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Contract Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-heading font-semibold text-foreground">
            Active Contracts ({activeContracts.length})
          </h2>
        </div>

        {activeContracts.length === 0 ? (
          <div className="p-8 text-center">
            <Briefcase className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No active contracts. Add one above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Client</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Project</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Budget</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Milestone</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Last Msg</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeContracts.map((c) => (
                  <ContractRow
                    key={c.id}
                    contract={c}
                    onEdit={() => { setEditing(c); setShowForm(false); }}
                    onDraftReply={() => setDraftReplyContract(c)}
                    onStatusChange={(status) => statusMutation.mutate({ id: c.id, status })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Completed/Other */}
      {otherContracts.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-heading font-semibold text-muted-foreground">
              Past Contracts ({otherContracts.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Client</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Project</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Budget</th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {otherContracts.map((c) => {
                  const st = statusConfig[c.status] || statusConfig.ACTIVE;
                  return (
                    <tr key={c.id} className="text-sm">
                      <td className="px-4 py-3 font-medium text-foreground">{c.clientName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.projectName}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.contractType === 'HOURLY' ? `$${c.hourlyRate}/hr` : `$${c.totalBudget?.toLocaleString()}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full', st.color)}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Draft Reply Modal */}
      {draftReplyContract && (
        <DraftReplyModal
          contract={draftReplyContract}
          onClose={() => setDraftReplyContract(null)}
        />
      )}
    </div>
  );
}

function ContractRow({ contract: c, onEdit, onDraftReply, onStatusChange }) {
  const msCfg = milestoneStatusConfig[c.milestoneStatus] || milestoneStatusConfig.PENDING;
  const daysSinceMsg = c.lastMessageDays;
  const isStale = daysSinceMsg !== null && daysSinceMsg > 3;

  return (
    <tr className={cn("text-sm", c.milestoneStatus === 'OVERDUE' && "bg-destructive/5")}>
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">{c.clientName}</div>
        {c.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{c.notes}</div>}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {c.projectName}
          {c.upworkUrl && (
            <a href={c.upworkUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">
        {c.contractType === 'HOURLY'
          ? <span>${c.hourlyRate}/hr</span>
          : <span>${c.totalBudget?.toLocaleString()}</span>
        }
      </td>
      <td className="px-4 py-3">
        {c.currentMilestone ? (
          <div>
            <div className="text-xs text-foreground">{c.currentMilestone}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full', msCfg.color)}>
                {msCfg.label}
              </span>
              {c.milestoneAmount && (
                <span className="text-xs text-muted-foreground">${c.milestoneAmount?.toLocaleString()}</span>
              )}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={cn('inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full', statusConfig.ACTIVE.color)}>
          Active
        </span>
      </td>
      <td className="px-4 py-3">
        {daysSinceMsg !== null ? (
          <span className={cn(
            "flex items-center gap-1 text-xs",
            isStale ? "text-destructive font-medium" : "text-muted-foreground"
          )}>
            <Clock className="w-3 h-3" />
            {daysSinceMsg}d ago
            {isStale && <AlertTriangle className="w-3 h-3" />}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onDraftReply}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
            title="Draft Reply"
          >
            <MessageSquare className="w-3 h-3" />
            Draft Reply
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onStatusChange('COMPLETED')}
            className="p-1.5 text-muted-foreground hover:text-green-600 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
            title="Mark Done"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
