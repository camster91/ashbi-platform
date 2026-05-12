import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Zap, Clock, Webhook, GitBranch, Plus, RefreshCw, Trash2,
  Play, Pause, ChevronDown, ChevronRight, AlertCircle, CheckCircle, XCircle
} from 'lucide-react';
import { Button, Card, Input, Badge } from '../components/ui';

const TRIGGER_TYPES = {
  SCHEDULE: { icon: Clock, color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20', label: 'Schedule' },
  WEBHOOK: { icon: Webhook, color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20', label: 'Webhook' },
  EVENT: { icon: GitBranch, color: 'text-green-600 bg-green-50 dark:bg-green-900/20', label: 'Event' }
};

const ACTION_TYPES = {
  SEND_EMAIL: { label: 'Send Email', color: 'bg-blue-100 text-blue-700' },
  CREATE_TASK: { label: 'Create Task', color: 'bg-green-100 text-green-700' },
  SEND_TELEGRAM: { label: 'Send Telegram', color: 'bg-sky-100 text-sky-700' },
  UPDATE_DEAL_STAGE: { label: 'Update Deal Stage', color: 'bg-amber-100 text-amber-700' },
  WEBHOOK_CALL: { label: 'Webhook Call', color: 'bg-purple-100 text-purple-700' },
  CONDITION: { label: 'Condition', color: 'bg-gray-100 text-gray-700' }
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
  if (!date) return 'Never';
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }) {
  const config = {
    SUCCESS: { bg: 'bg-green-100 text-green-700', icon: CheckCircle, class: 'text-green-600' },
    FAILED: { bg: 'bg-red-100 text-red-700', icon: XCircle, class: 'text-red-600' },
    PARTIAL: { bg: 'bg-amber-100 text-amber-700', icon: AlertCircle, class: 'text-amber-600' },
    RUNNING: { bg: 'bg-blue-100 text-blue-700', icon: RefreshCw, class: 'text-blue-600 animate-spin' }
  }[status] || { bg: 'bg-gray-100 text-gray-700', icon: AlertCircle, class: 'text-gray-600' };

  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${config.bg}`}>
      <Icon className={`w-3 h-3 ${config.class}`} />
      {status}
    </span>
  );
}

function WorkflowCard({ workflow, onToggle, onEdit, onDelete, onRun }) {
  const [expanded, setExpanded] = useState(false);
  const triggerConfig = TRIGGER_TYPES[workflow.triggerType] || TRIGGER_TYPES.EVENT;
  const TriggerIcon = triggerConfig.icon;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${triggerConfig.color} flex-shrink-0`}>
          <TriggerIcon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-foreground">{workflow.name}</h3>
            {workflow.enabled ? (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
            ) : (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Disabled</span>
            )}
          </div>

          {workflow.description && (
            <p className="text-sm text-muted-foreground mt-1">{workflow.description}</p>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{triggerConfig.label}</span>
            <span>{workflow.runCount} runs</span>
            <span>Last: {formatTime(workflow.lastRun)}</span>
            {workflow.lastStatus && <StatusBadge status={workflow.lastStatus} />}
          </div>

          {/* Actions preview */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {workflow.actions.slice(0, 3).map((action, i) => {
              const actionConfig = ACTION_TYPES[action.type] || ACTION_TYPES.CONDITION;
              return (
                <span key={i} className={`text-xs px-2 py-0.5 rounded-full ${actionConfig.color}`}>
                  {actionConfig.label}
                </span>
              );
            })}
            {workflow.actions.length > 3 && (
              <span className="text-xs text-muted-foreground">+{workflow.actions.length - 3} more</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onToggle(workflow)} title={workflow.enabled ? 'Disable' : 'Enable'}>
            {workflow.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onRun(workflow)} title="Run Now">
            <Play className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(workflow.id)} title="Delete" className="text-red-500 hover:text-red-600">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-2">Trigger Configuration</h4>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
            {JSON.stringify(workflow.triggerConfig, null, 2)}
          </pre>

          <h4 className="text-sm font-medium mt-4 mb-2">Actions</h4>
          <div className="space-y-2">
            {workflow.actions.map((action, i) => (
              <div key={i} className="text-xs bg-muted p-2 rounded">
                <span className="font-medium">{action.type}</span>
                <pre className="mt-1 text-muted-foreground overflow-x-auto">
                  {JSON.stringify(action.config, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function WorkflowBuilder({ workflow, onSave, onCancel }) {
  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState(workflow?.description || '');
  const [triggerType, setTriggerType] = useState(workflow?.triggerType || 'SCHEDULE');
  const [triggerConfig, setTriggerConfig] = useState(workflow?.triggerConfig || {});
  const [actions, setActions] = useState(workflow?.actions || []);
  const [enabled, setEnabled] = useState(workflow?.enabled ?? true);

  const addAction = () => {
    setActions([...actions, { type: 'SEND_EMAIL', config: {} }]);
  };

  const updateAction = (index, field, value) => {
    const updated = [...actions];
    if (field === 'type') {
      updated[index] = { type: value, config: {} };
    } else {
      updated[index] = { ...updated[index], config: { ...updated[index].config, [field]: value } };
    }
    setActions(updated);
  };

  const removeAction = (index) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ name, description, triggerType, triggerConfig, actions, enabled });
  };

  return (
    <Card className="p-5">
      <h2 className="text-lg font-medium mb-4">{workflow?.id ? 'Edit Workflow' : 'Create Workflow'}</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Daily Report Workflow"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Trigger Type</label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
            >
              <option value="SCHEDULE">Schedule (Cron)</option>
              <option value="WEBHOOK">Webhook</option>
              <option value="EVENT">Event</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Description (optional)</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this workflow do?"
          />
        </div>

        {/* Trigger Config */}
        <div>
          <label className="text-sm font-medium mb-1 block">Trigger Configuration</label>
          <div className="bg-muted p-3 rounded-md">
            {triggerType === 'SCHEDULE' && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cron Expression</label>
                <Input
                  value={triggerConfig.cronExpression || ''}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, cronExpression: e.target.value })}
                  placeholder="*/5 * * * * (every 5 minutes)"
                />
              </div>
            )}
            {triggerType === 'WEBHOOK' && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Webhook Path</label>
                <Input
                  value={triggerConfig.path || ''}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, path: e.target.value })}
                  placeholder="e.g., invoice-paid"
                />
              </div>
            )}
            {triggerType === 'EVENT' && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Event Name</label>
                <Input
                  value={triggerConfig.eventName || ''}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, eventName: e.target.value })}
                  placeholder="e.g., PROPOSAL_APPROVED"
                />
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Actions</label>
            <Button type="button" variant="outline" size="sm" onClick={addAction}>
              <Plus className="w-4 h-4 mr-1" /> Add Action
            </Button>
          </div>

          <div className="space-y-3">
            {actions.map((action, index) => (
              <div key={index} className="bg-muted p-3 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <select
                    value={action.type}
                    onChange={(e) => updateAction(index, 'type', e.target.value)}
                    className="px-2 py-1 border border-border rounded bg-background text-sm"
                  >
                    {Object.entries(ACTION_TYPES).map(([type, config]) => (
                      <option key={type} value={type}>{config.label}</option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeAction(index)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>

                {/* Action-specific config */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {action.type === 'SEND_EMAIL' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">To</label>
                        <Input
                          value={action.config.to || ''}
                          onChange={(e) => updateAction(index, 'to', e.target.value)}
                          placeholder="{{client.email}}"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Subject</label>
                        <Input
                          value={action.config.subject || ''}
                          onChange={(e) => updateAction(index, 'subject', e.target.value)}
                          placeholder="Invoice {{invoice.number}}"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">Body</label>
                        <textarea
                          value={action.config.body || ''}
                          onChange={(e) => updateAction(index, 'body', e.target.value)}
                          className="w-full px-2 py-1 border border-border rounded bg-background text-sm"
                          rows={3}
                        />
                      </div>
                    </>
                  )}
                  {action.type === 'CREATE_TASK' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Title</label>
                        <Input
                          value={action.config.title || ''}
                          onChange={(e) => updateAction(index, 'title', e.target.value)}
                          placeholder="Follow up with {{client.name}}"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Project ID</label>
                        <Input
                          value={action.config.projectId || ''}
                          onChange={(e) => updateAction(index, 'projectId', e.target.value)}
                          placeholder="Optional project ID"
                        />
                      </div>
                    </>
                  )}
                  {action.type === 'SEND_TELEGRAM' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Chat ID</label>
                        <Input
                          value={action.config.chatId || ''}
                          onChange={(e) => updateAction(index, 'chatId', e.target.value)}
                          placeholder="Telegram chat ID"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">Message</label>
                        <textarea
                          value={action.config.message || ''}
                          onChange={(e) => updateAction(index, 'message', e.target.value)}
                          className="w-full px-2 py-1 border border-border rounded bg-background text-sm"
                          rows={2}
                        />
                      </div>
                    </>
                  )}
                  {action.type === 'UPDATE_DEAL_STAGE' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Deal ID</label>
                        <Input
                          value={action.config.dealId || ''}
                          onChange={(e) => updateAction(index, 'dealId', e.target.value)}
                          placeholder="Pipeline deal ID"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Stage</label>
                        <Input
                          value={action.config.stage || ''}
                          onChange={(e) => updateAction(index, 'stage', e.target.value)}
                          placeholder="e.g., WON"
                        />
                      </div>
                    </>
                  )}
                  {action.type === 'WEBHOOK_CALL' && (
                    <>
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">URL</label>
                        <Input
                          value={action.config.url || ''}
                          onChange={(e) => updateAction(index, 'url', e.target.value)}
                          placeholder="https://..."
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Method</label>
                        <select
                          value={action.config.method || 'POST'}
                          onChange={(e) => updateAction(index, 'method', e.target.value)}
                          className="w-full px-2 py-1 border border-border rounded bg-background text-sm"
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Body</label>
                        <Input
                          value={action.config.body || ''}
                          onChange={(e) => updateAction(index, 'body', e.target.value)}
                          placeholder='{"key": "value"}'
                        />
                      </div>
                    </>
                  )}
                  {action.type === 'CONDITION' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Field</label>
                        <Input
                          value={action.config.field || ''}
                          onChange={(e) => updateAction(index, 'field', e.target.value)}
                          placeholder="e.g., status"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Operator</label>
                        <select
                          value={action.config.operator || 'equals'}
                          onChange={(e) => updateAction(index, 'operator', e.target.value)}
                          className="w-full px-2 py-1 border border-border rounded bg-background text-sm"
                        >
                          <option value="equals">equals</option>
                          <option value="not_equals">not equals</option>
                          <option value="contains">contains</option>
                          <option value="greater_than">greater than</option>
                          <option value="less_than">less than</option>
                          <option value="exists">exists</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Value</label>
                        <Input
                          value={action.config.value || ''}
                          onChange={(e) => updateAction(index, 'value', e.target.value)}
                          placeholder="Expected value"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="enabled" className="text-sm">Enable workflow immediately</label>
        </div>

        <div className="flex items-center gap-2 pt-4">
          <Button type="submit" variant="default" disabled={!name || actions.length === 0}>
            {workflow?.id ? 'Update' : 'Create'} Workflow
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ExecutionHistory({ runs }) {
  const [page, setPage] = useState(0);
  const limit = 20;
  const totalPages = Math.ceil(runs.length / limit);

  return (
    <Card>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Execution History</h2>
        <span className="text-xs text-muted-foreground">{runs.length} total runs</span>
      </div>

      {runs.length === 0 ? (
        <div className="p-8 text-center">
          <Zap className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No executions yet</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {runs.slice(page * limit, (page + 1) * limit).map((run) => (
              <div key={run.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{run.workflow?.name || 'Unknown'}</span>
                    <StatusBadge status={run.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(run.createdAt)}
                  </span>
                </div>
                {run.error && (
                  <p className="text-xs text-red-500 mt-1">Error: {run.error}</p>
                )}
                {run.triggerData && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Trigger: {JSON.stringify(run.triggerData).slice(0, 100)}
                  </p>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function Automations() {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [view, setView] = useState('workflows'); // 'workflows' | 'history'

  const queryClient = useQueryClient();

  const { data: workflowsData, isLoading: loadingWorkflows, refetch: refetchWorkflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.getWorkflows()
  });

  const { data: runsData, isLoading: loadingRuns, refetch: refetchRuns } = useQuery({
    queryKey: ['workflow-runs'],
    queryFn: () => api.getWorkflowRuns({ limit: 50 })
  });

  const workflows = workflowsData?.workflows || [];
  const runs = runsData?.runs || [];

  const createMutation = useMutation({
    mutationFn: (data) => api.createWorkflow(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['workflows']);
      setShowBuilder(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateWorkflow(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['workflows']);
      setEditingWorkflow(null);
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (id) => api.toggleWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries(['workflows'])
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteWorkflow(id),
    onSuccess: () => queryClient.invalidateQueries(['workflows'])
  });

  const runMutation = useMutation({
    mutationFn: (id) => api.runWorkflow(id, {}),
    onSuccess: () => queryClient.invalidateQueries(['workflow-runs'])
  });

  const handleSave = (data) => {
    if (editingWorkflow?.id) {
      updateMutation.mutate({ id: editingWorkflow.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (workflow) => {
    setEditingWorkflow(workflow);
    setShowBuilder(true);
  };

  const handleCancel = () => {
    setShowBuilder(false);
    setEditingWorkflow(null);
  };

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
            Create automated workflows with triggers and actions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === 'workflows' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('workflows')}
          >
            Workflows
          </Button>
          <Button
            variant={view === 'history' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('history')}
          >
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchWorkflows()}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {view === 'workflows' ? (
        <>
          {/* Create button */}
          {!showBuilder && (
            <div>
              <Button onClick={() => setShowBuilder(true)} leftIcon={<Plus className="w-4 h-4" />}>
                Create Workflow
              </Button>
            </div>
          )}

          {/* Workflow builder */}
          {showBuilder && (
            <WorkflowBuilder
              workflow={editingWorkflow}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          )}

          {/* Workflow list */}
          {!showBuilder && (
            <div className="space-y-3">
              {loadingWorkflows ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto" />
                </div>
              ) : workflows.length === 0 ? (
                <Card className="p-12 text-center">
                  <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No workflows yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Create your first workflow to automate tasks
                  </p>
                </Card>
              ) : (
                workflows.map((workflow) => (
                  <WorkflowCard
                    key={workflow.id}
                    workflow={workflow}
                    onToggle={(w) => toggleMutation.mutate(w.id)}
                    onEdit={handleEdit}
                    onDelete={(id) => {
                      if (confirm('Delete this workflow?')) {
                        deleteMutation.mutate(id);
                      }
                    }}
                    onRun={(w) => runMutation.mutate(w.id)}
                  />
                ))
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <ExecutionHistory runs={runs} />
        </>
      )}
    </div>
  );
}