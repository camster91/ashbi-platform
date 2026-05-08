import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Zap, Clock, FileText, FileSignature, AlertTriangle, CheckCircle,
  ArrowRight, RefreshCw, Plus, Play, Pause, Power, Trash2,
  Settings, History, Layers, X, Code, List
} from 'lucide-react';
import { Button, Card } from '../components/ui';

const TRIGGER_CONFIG = {
  PROPOSAL_APPROVED: {
    icon: CheckCircle,
    color: 'text-green-600 bg-green-50 dark:bg-green-900/20',
    label: 'Proposal Approved'
  },
  CONTRACT_SIGNED: {
    icon: FileSignature,
    color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
    label: 'Contract Signed'
  },
  INVOICE_OVERDUE: {
    icon: Clock,
    color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20',
    label: 'Invoice Overdue'
  },
  INVOICE_OVERDUE_7D: {
    icon: AlertTriangle,
    color: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    label: 'Invoice 7+ Days Overdue'
  }
};

const TRIGGER_TYPES = [
  { value: 'schedule', label: 'Schedule (Cron)', icon: Clock },
  { value: 'webhook', label: 'Webhook', icon: Code },
  { value: 'event:proposal_approved', label: 'Event: Proposal Approved', icon: FileText },
  { value: 'event:contract_signed', label: 'Event: Contract Signed', icon: FileSignature },
  { value: 'event:new_lead', label: 'Event: New Lead', icon: Zap },
  { value: 'event:invoice_overdue', label: 'Event: Invoice Overdue', icon: AlertTriangle },
];

const ACTION_TYPES = [
  { value: 'send_email', label: 'Send Email' },
  { value: 'create_task', label: 'Create Task' },
  { value: 'send_notification', label: 'Send Notification' },
  { value: 'update_deal_stage', label: 'Update Deal Stage' },
  { value: 'trigger_hermes', label: 'Trigger Hermes Agent' },
  { value: 'log_activity', label: 'Log Activity' },
];

function formatTime(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString({
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function ActionBadge({ action }) {
  const colors = {
    created: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    reminded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    escalated: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[action] || 'bg-muted text-muted-foreground'}`}>
      {action}
    </span>
  );
}

function StatusBadge({ status }) {
  const styles = {
    SUCCESS: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    RUNNING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

// ==================== WORKFLOW FORM MODAL ====================

function WorkflowForm({ workflow, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = !!workflow;

  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState(workflow?.description || '');
  const [trigger, setTrigger] = useState(workflow?.trigger || 'event:new_lead');
  const [triggerConfig, setTriggerConfig] = useState(workflow?.triggerConfig || {});
  const [conditions, setConditions] = useState(workflow?.conditions || []);
  const [actions, setActions] = useState(workflow?.actions || []);
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data) => api.createWorkflow(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workflows'] }); onClose(); },
    onError: (err) => setError(err.message || 'Failed to create workflow'),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateWorkflow(workflow.id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workflows'] }); onClose(); },
    onError: (err) => setError(err.message || 'Failed to update workflow'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }

    const data = { name, description: description || null, trigger, triggerConfig, conditions, actions };
    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  };

  const addCondition = () => setConditions([...conditions, { field: '', operator: 'eq', value: '' }]);
  const updateCondition = (i, key, val) => {
    const updated = [...conditions];
    updated[i] = { ...updated[i], [key]: val };
    setConditions(updated);
  };
  const removeCondition = (i) => setConditions(conditions.filter((_, idx) => idx !== i));

  const addAction = () => setActions([...actions, { type: 'send_email', config: {} }]);
  const updateAction = (i, key, val) => {
    const updated = [...actions];
    if (key === 'type') updated[i] = { ...updated[i], type: val, config: {} };
    else updated[i] = { ...updated[i], config: { ...updated[i].config, [key]: val } };
    setActions(updated);
  };
  const removeAction = (i) => setActions(actions.filter((_, idx) => idx !== i));

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Workflow' : 'Create Workflow'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg">{error}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
              placeholder="e.g., Auto-follow-up on new lead" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
              placeholder="What does this workflow do?" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Trigger</label>
            <select value={trigger} onChange={e => setTrigger(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm">
              {TRIGGER_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {trigger === 'schedule' && (
            <div>
              <label className="block text-sm font-medium mb-1">Cron Expression</label>
              <input type="text"
                value={triggerConfig.cron || ''}
                onChange={e => setTriggerConfig({ ...triggerConfig, cron: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-mono"
                placeholder="* * * * *" />
              <p className="text-xs text-muted-foreground mt-1">Minute Hour Day Month Weekday</p>
            </div>
          )}

          {trigger === 'webhook' && (
            <div>
              <label className="block text-sm font-medium mb-1">Webhook Path</label>
              <input type="text"
                value={triggerConfig.webhook_path || ''}
                onChange={e => setTriggerConfig({ ...triggerConfig, webhook_path: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-mono"
                placeholder="/hooks/my-workflow" />
            </div>
          )}

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Conditions</label>
              <button type="button" onClick={addCondition}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {conditions.length === 0 && (
              <p className="text-xs text-muted-foreground">No conditions — always runs when triggered</p>
            )}
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input type="text" value={c.field} onChange={e => updateCondition(i, 'field', e.target.value)}
                  placeholder="field" className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs" />
                <select value={c.operator} onChange={e => updateCondition(i, 'operator', e.target.value)}
                  className="px-2 py-1.5 rounded border border-border bg-background text-xs">
                  {['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'not_in'].map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                <input type="text" value={c.value} onChange={e => updateCondition(i, 'value', e.target.value)}
                  placeholder="value" className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs" />
                <button type="button" onClick={() => removeCondition(i)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Actions</label>
              <button type="button" onClick={addAction}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {actions.length === 0 && (
              <p className="text-xs text-muted-foreground">No actions configured</p>
            )}
            {actions.map((a, i) => (
              <div key={i} className="border border-border rounded-lg p-3 mb-2 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={a.type} onChange={e => updateAction(i, 'type', e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs">
                    {ACTION_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeAction(i)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {a.type === 'send_email' && (
                  <div className="space-y-1">
                    <input type="text" value={a.config.to || ''} onChange={e => updateAction(i, 'to', e.target.value)}
                      placeholder="To (email or {{contactEmail}})" className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                    <input type="text" value={a.config.subject || ''} onChange={e => updateAction(i, 'subject', e.target.value)}
                      placeholder="Subject" className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                    <textarea value={a.config.body || ''} onChange={e => updateAction(i, 'body', e.target.value)}
                      placeholder="Body (use {{variable}} for template)" rows={3}
                      className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                  </div>
                )}

                {a.type === 'create_task' && (
                  <div className="space-y-1">
                    <input type="text" value={a.config.title || ''} onChange={e => updateAction(i, 'title', e.target.value)}
                      placeholder="Task title ({{variable}} templates ok)" className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                    <select value={a.config.priority || 'NORMAL'} onChange={e => updateAction(i, 'priority', e.target.value)}
                      className="w-full px-2 py-1 rounded border border-border bg-background text-xs">
                      <option value="NORMAL">Normal Priority</option>
                      <option value="HIGH">High Priority</option>
                      <option value="CRITICAL">Critical</option>
                    </select>
                  </div>
                )}

                {a.type === 'send_notification' && (
                  <div className="space-y-1">
                    <input type="text" value={a.config.title || ''} onChange={e => updateAction(i, 'title', e.target.value)}
                      placeholder="Notification title" className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                    <textarea value={a.config.message || ''} onChange={e => updateAction(i, 'message', e.target.value)}
                      placeholder="Message (use {{variable}} for template)" rows={2}
                      className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                  </div>
                )}

                {a.type === 'update_deal_stage' && (
                  <div>
                    <input type="text" value={a.config.stage || ''} onChange={e => updateAction(i, 'stage', e.target.value)}
                      placeholder="Target stage (e.g., Qualified, Won)" className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                  </div>
                )}

                {a.type === 'trigger_hermes' && (
                  <div>
                    <input type="text" value={a.config.hermesAction || ''} onChange={e => updateAction(i, 'hermesAction', e.target.value)}
                      placeholder="Hermes action (e.g., run_workflow)" className="w-full px-2 py-1 rounded border border-border bg-background text-xs" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== WORKFLOW RUNS PANEL ====================

function WorkflowRuns({ workflowId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-runs', workflowId],
    queryFn: () => api.getWorkflowRuns(workflowId),
    refetchInterval: 15000,
  });

  const runs = data?.runs || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-lg font-semibold">Execution History</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading...
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No runs yet</div>
          ) : (
            <div className="space-y-3">
              {runs.map(run => (
                <div key={run.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-muted-foreground">{formatTime(run.startedAt)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{run.durationMs ? `${run.durationMs}ms` : ''}</span>
                  </div>
                  {run.error && <p className="text-xs text-red-500 mt-1">{run.error}</p>}
                  {run.actions?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {run.actions.map((a, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          <span className={`w-1.5 h-1.5 rounded-full ${a.status === 'SUCCESS' ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span className="text-muted-foreground">{a.type}:</span>
                          <span>{a.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN PAGE ====================

export default function Automations() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('workflows');
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [viewingRuns, setViewingRuns] = useState(null);
  const limit = 25;

  const { data: workflows, isLoading: wfLoading, error: wfError } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.getWorkflows(),
    refetchInterval: 30000,
  });

  const { data: history, isLoading: histLoading, error: histError, refetch } = useQuery({
    queryKey: ['automation-history', page],
    queryFn: () => api.getAutomationHistory(page * limit, limit),
    refetchInterval: 60000,
  });

  const toggleMutation = useMutation({
    mutationFn: (id) => api.toggleWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const testRunMutation = useMutation({
    mutationFn: (id) => api.testRunWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const automations = history?.automations || [];
  const total = history?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const wfList = workflows || [];
  const activeCount = wfList.filter(w => w.isActive && !w.isPaused).length;
  const pausedCount = wfList.filter(w => w.isPaused).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Workflow Automations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visual trigger → action workflows for automated operations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} leftIcon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditingWorkflow(null); setShowForm(true); }} leftIcon={<Plus className="w-4 h-4" />}>
            New Workflow
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50 dark:bg-green-900/20">
              <Play className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-lg font-bold text-green-600">{activeCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
              <Pause className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Paused</p>
              <p className="text-lg font-bold text-yellow-600">{pausedCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Total Workflows</p>
              <p className="text-lg font-bold">{wfList.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20">
              <History className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">History Events</p>
              <p className="text-lg font-bold">{total}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('workflows')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'workflows' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Settings className="w-4 h-4 inline mr-1.5" />Workflows
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <List className="w-4 h-4 inline mr-1.5" />History
        </button>
      </div>

      {/* Workflows Tab */}
      {tab === 'workflows' && (
        <Card>
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Workflow Definitions</h2>
          </div>

          {wfLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading...
            </div>
          ) : wfError ? (
            <div className="p-8 text-center text-red-500">Failed to load workflows</div>
          ) : wfList.length === 0 ? (
            <div className="p-12 text-center">
              <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No workflows yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first workflow to automate repetitive tasks.
              </p>
              <Button size="sm" className="mt-4" onClick={() => { setEditingWorkflow(null); setShowForm(true); }}>
                <Plus className="w-4 h-4 mr-1" /> Create Workflow
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {wfList.map(wf => {
                const triggerType = TRIGGER_TYPES.find(t => t.value === wf.trigger);
                const TriggerIcon = triggerType?.icon || Zap;
                return (
                  <div key={wf.id} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`p-2 rounded-lg ${wf.isActive && !wf.isPaused ? 'bg-green-50 dark:bg-green-900/20' : 'bg-muted'}`}>
                          <TriggerIcon className={`w-5 h-5 ${wf.isActive && !wf.isPaused ? 'text-green-600' : 'text-muted-foreground'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{wf.name}</span>
                            {wf.isActive && !wf.isPaused ? (
                              <span className="text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded">Active</span>
                            ) : wf.isPaused ? (
                              <span className="text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 px-1.5 py-0.5 rounded">Paused</span>
                            ) : (
                              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Inactive</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Trigger: {triggerType?.label || wf.trigger}
                            {wf.triggerConfig?.cron && <span className="ml-2 font-mono">({wf.triggerConfig.cron})</span>}
                          </p>
                          {wf.description && <p className="text-xs text-muted-foreground mt-0.5">{wf.description}</p>}
                          <p className="text-xs text-muted-foreground mt-1">
                            {wf._count?.runs || wf.runCount || 0} runs
                            {wf.lastRunAt && <span> · Last: {formatTime(wf.lastRunAt)}</span>}
                            {wf.lastRunStatus && (
                              <span className={`ml-1 ${wf.lastRunStatus === 'SUCCESS' ? 'text-green-500' : 'text-red-500'}`}>
                                ({wf.lastRunStatus})
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleMutation.mutate(wf.id)}
                          disabled={toggleMutation.isPending}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                          title={wf.isActive ? 'Pause' : 'Activate'}>
                          <Power className={`w-4 h-4 ${wf.isActive ? 'text-green-500' : ''}`} />
                        </button>
                        <button
                          onClick={() => testRunMutation.mutate(wf.id)}
                          disabled={testRunMutation.isPending}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-blue-500"
                          title="Test Run">
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setViewingRuns(wf.id)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-purple-500"
                          title="Run History">
                          <History className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setEditingWorkflow(wf); setShowForm(true); }}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Edit">
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { if (confirm('Delete this workflow?')) deleteMutation.mutate(wf.id); }}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500"
                          title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <>
          {/* Active Rules Summary */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Active Rules</h2>
            <div className="space-y-3">
              {[
                { icon: CheckCircle, color: 'text-green-500', trigger: 'Proposal Approved', action: 'Auto-create draft contract + notify admin' },
                { icon: FileSignature, color: 'text-blue-500', trigger: 'Contract Signed', action: 'Auto-create project + welcome email + notify admin' },
                { icon: Clock, color: 'text-yellow-500', trigger: 'Invoice Overdue', action: 'Send reminder email + notify admin' },
                { icon: AlertTriangle, color: 'text-red-500', trigger: 'Invoice 7+ Days Overdue', action: 'Send escalation email + flag client AT_RISK' },
              ].map(({ icon: Icon, color, trigger, action }) => (
                <div key={trigger} className="flex items-center gap-3 text-sm">
                  <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                  <span className="text-muted-foreground">{trigger}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                  <span className="text-foreground">{action}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* History */}
          <Card>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Automation History
                {total > 0 && <span className="text-muted-foreground font-normal ml-2">({total} total)</span>}
              </h2>
            </div>

            {histLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading...
              </div>
            ) : histError ? (
              <div className="p-8 text-center text-red-500">Failed to load automation history</div>
            ) : automations.length === 0 ? (
              <div className="p-12 text-center">
                <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No automation events yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Automations will appear here when proposals are approved, contracts are signed, or invoices become overdue.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {automations.map((event) => {
                  const trigger = event.metadata?.trigger || 'UNKNOWN';
                  const config = TRIGGER_CONFIG[trigger] || {
                    icon: Zap,
                    color: 'text-muted-foreground bg-muted',
                    label: trigger
                  };
                  const Icon = config.icon;

                  return (
                    <div key={event.id} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={`p-1.5 rounded-lg ${config.color} mt-0.5`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{config.label}</span>
                            <ActionBadge action={event.action} />
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {event.entityType} <span className="font-medium text-foreground">{event.entityName}</span>
                            {event.metadata?.clientName && (
                              <span> for {event.metadata.clientName}</span>
                            )}
                            {event.metadata?.daysOverdue && (
                              <span className="text-red-500"> ({event.metadata.daysOverdue} days overdue)</span>
                            )}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                          {formatTime(event.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-border flex items-center justify-between">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed">
                  Previous
                </button>
                <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed">
                  Next
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Modals */}
      {showForm && <WorkflowForm workflow={editingWorkflow} onClose={() => { setShowForm(false); setEditingWorkflow(null); }} />}
      {viewingRuns && <WorkflowRuns workflowId={viewingRuns} onClose={() => setViewingRuns(null)} />}
    </div>
  );
}
