import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Plus,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Edit2,
  X,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

function HoursBar({ percentUsed }) {
  const color =
    percentUsed >= 100 ? 'bg-red-500' :
    percentUsed >= 80  ? 'bg-amber-500' :
    percentUsed >= 60  ? 'bg-yellow-400' :
    'bg-green-500';
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(percentUsed, 100)}%` }}
      />
    </div>
  );
}

export default function Retainers() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [logHoursFor, setLogHoursFor] = useState(null);

  const { data: retainers = [], isLoading, refetch } = useQuery({
    queryKey: ['retainers'],
    queryFn: () => api.getAllRetainers(),
    select: (data) => data.atRisk !== undefined ? [...(data.atRisk || [])] : data,
  });

  const { data: allRetainers = [], isLoadingAll } = useQuery({
    queryKey: ['all-retainers'],
    queryFn: async () => {
      // We need all retainers, not just at-risk ones — use the list endpoint
      const res = await fetch('/api/retainer', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createRetainerPlan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-retainers'] });
      setShowCreate(false);
      setCreateForm({ clientId: '', tier: 'custom', hoursPerMonth: 20, monthlyAmountUsd: '', monthlyAmountCad: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ clientId, data }) => api.updateRetainerPlan(clientId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-retainers'] });
      setEditingId(null);
    },
  });

  const logHoursMutation = useMutation({
    mutationFn: ({ clientId, data }) => api.logRetainerHours(clientId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-retainers'] });
      setLogHoursFor(null);
      setLogForm({ hours: '', description: '' });
    },
  });

  const [createForm, setCreateForm] = useState({
    clientId: '', tier: 'custom', hoursPerMonth: 20, monthlyAmountUsd: '', monthlyAmountCad: ''
  });
  const [editForm, setEditForm] = useState({});
  const [logForm, setLogForm] = useState({ hours: '', description: '' });

  const handleEdit = (plan) => {
    setEditingId(plan.clientId);
    setEditForm({
      tier: plan.tier,
      hoursPerMonth: plan.hoursPerMonth,
      monthlyAmountUsd: plan.monthlyAmountUsd || '',
      monthlyAmountCad: plan.monthlyAmountCad || '',
    });
  };

  const totalMrr = allRetainers.reduce((sum, r) => sum + (r.monthlyAmountUsd || 0), 0);
  const atRiskCount = allRetainers.filter(r => r.scopeCreepRisk).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Retainers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track monthly retainer hours and scope for each client
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} leftIcon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </Button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            Add Retainer
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {allRetainers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Retainers</p>
            <p className="text-2xl font-bold mt-1">{allRetainers.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Revenue (USD)</p>
            <p className="text-2xl font-bold mt-1">${totalMrr.toLocaleString()}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Scope Creep Risk</p>
              {atRiskCount > 0 && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            </div>
            <p className={`text-2xl font-bold mt-1 ${atRiskCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {atRiskCount} / {allRetainers.length}
            </p>
          </Card>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Add Retainer Plan</h2>
            <button onClick={() => setShowCreate(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(createForm); }} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Client</label>
                <select
                  value={createForm.clientId}
                  onChange={(e) => setCreateForm({ ...createForm, clientId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  required
                >
                  <option value="">Select client...</option>
                  {clients.filter(c => !allRetainers.find(r => r.clientId === c.id)).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Hours / Month</label>
                <input
                  type="number"
                  min="1"
                  value={createForm.hoursPerMonth}
                  onChange={(e) => setCreateForm({ ...createForm, hoursPerMonth: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Monthly Rate (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.monthlyAmountUsd}
                  onChange={(e) => setCreateForm({ ...createForm, monthlyAmountUsd: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  placeholder="e.g. 2000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Monthly Rate (CAD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.monthlyAmountCad}
                  onChange={(e) => setCreateForm({ ...createForm, monthlyAmountCad: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  placeholder="e.g. 2700"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={createMutation.isPending} leftIcon={<Save className="w-4 h-4" />}>
                Save Plan
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Retainer List */}
      {isLoadingAll ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : allRetainers.length === 0 ? (
        <Card className="p-12 text-center">
          <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No retainer plans</h3>
          <p className="text-sm text-muted-foreground mt-1">Add a retainer plan to track client hours and scope.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {allRetainers.map((plan) => (
            <Card key={plan.id} className="p-5">
              {editingId === plan.clientId ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateMutation.mutate({ clientId: plan.clientId, data: editForm });
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Hours/Month</label>
                      <input
                        type="number" min="1"
                        value={editForm.hoursPerMonth}
                        onChange={(e) => setEditForm({ ...editForm, hoursPerMonth: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Rate USD</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={editForm.monthlyAmountUsd}
                        onChange={(e) => setEditForm({ ...editForm, monthlyAmountUsd: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Rate CAD</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={editForm.monthlyAmountCad}
                        onChange={(e) => setEditForm({ ...editForm, monthlyAmountCad: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button size="sm" type="submit" loading={updateMutation.isPending}>Save</Button>
                    <Button size="sm" variant="outline" type="button"
                      onClick={() => updateMutation.mutate({ clientId: plan.clientId, data: { resetHours: true } })}>
                      Reset Hours
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <Link to={`/client/${plan.clientId}`} className="text-sm font-semibold text-foreground hover:text-primary">
                        {plan.client?.name || plan.clientId}
                      </Link>
                      {plan.monthlyAmountUsd && (
                        <span className="ml-2 text-xs text-muted-foreground">${plan.monthlyAmountUsd?.toLocaleString()}/mo USD</span>
                      )}
                      {plan.monthlyAmountCad && (
                        <span className="ml-2 text-xs text-muted-foreground">${plan.monthlyAmountCad?.toLocaleString()}/mo CAD</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {plan.scopeCreepRisk ? (
                        <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Scope Risk
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">
                          <CheckCircle className="w-3 h-3" /> On Track
                        </span>
                      )}
                      <button onClick={() => handleEdit(plan)} className="p-1 text-muted-foreground hover:text-foreground rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {plan.hoursUsed} / {plan.hoursPerMonth} hours used
                      </span>
                      <span className={plan.percentUsed >= 80 ? 'text-amber-600 font-semibold' : ''}>
                        {plan.percentUsed}%
                      </span>
                    </div>
                    <HoursBar percentUsed={plan.percentUsed} />
                    <p className="text-xs text-muted-foreground">
                      {plan.hoursRemaining >= 0 ? `${plan.hoursRemaining} hours remaining` : `${Math.abs(plan.hoursRemaining)} hours over budget`}
                      {plan.daysInCycle !== undefined && ` · Day ${plan.daysInCycle} of cycle`}
                    </p>
                  </div>

                  {/* Log Hours */}
                  {logHoursFor === plan.clientId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        logHoursMutation.mutate({ clientId: plan.clientId, data: logForm });
                      }}
                      className="flex gap-2 items-end"
                    >
                      <div>
                        <label className="block text-xs font-medium mb-1">Hours</label>
                        <input
                          type="number" min="0.25" step="0.25"
                          value={logForm.hours}
                          onChange={(e) => setLogForm({ ...logForm, hours: e.target.value })}
                          className="w-20 px-2 py-1.5 rounded border border-border bg-background text-sm"
                          required
                          autoFocus
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium mb-1">Description</label>
                        <input
                          type="text"
                          value={logForm.description}
                          onChange={(e) => setLogForm({ ...logForm, description: e.target.value })}
                          className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                          placeholder="What was done?"
                        />
                      </div>
                      <Button size="sm" type="submit" loading={logHoursMutation.isPending}>Log</Button>
                      <Button size="sm" variant="ghost" type="button" onClick={() => setLogHoursFor(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setLogHoursFor(plan.clientId)}
                      className="text-xs text-primary hover:underline"
                    >
                      + Log hours
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
