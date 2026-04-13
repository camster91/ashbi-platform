import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User,
  MessageSquare,
  CheckSquare,
  Plus,
  Edit2,
  ToggleLeft,
  ToggleRight,
  X,
  Save,
  AlertTriangle,
  UserCheck,
  Clock,
  LayoutGrid,
  BarChart3,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { Card, Button } from '../components/ui';
import CreateTeamMemberModal from '../components/CreateTeamMemberModal';

const roleColors = {
  ADMIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  MEMBER: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  BOT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const statusColor = (status) => {
  if (status === 'overloaded') return 'text-red-600 bg-red-50 dark:bg-red-900/20';
  if (status === 'busy') return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
  return 'text-green-600 bg-green-50 dark:bg-green-900/20';
};

const barColor = (status) => {
  if (status === 'overloaded') return 'bg-red-500';
  if (status === 'busy') return 'bg-amber-500';
  return 'bg-green-500';
};

export default function Team() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [view, setView] = useState('team'); // team | resources

  const { data: team = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.getTeam(),
  });

  const { data: workload = [] } = useQuery({
    queryKey: ['team-workload'],
    queryFn: () => api.getWorkload(),
  });

  const { data: allocationsData, isLoading: allocLoading } = useQuery({
    queryKey: ['team-allocations'],
    queryFn: () => api.getTeamAllocations(),
    enabled: view === 'resources',
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateTeamMember(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      setEditingMember(null);
      toast.success('Team member updated');
    },
    onError: () => toast.error('Failed to update team member'),
  });

  const handleEdit = (member) => {
    setEditingMember(member.id);
    setEditForm({ name: member.name, skills: (member.skills || []).join(', ') });
  };

  const handleToggleActive = (member) => {
    updateMutation.mutate({ id: member.id, data: { isActive: !member.isActive } });
  };

  const workloadMap = Object.fromEntries(workload.map(w => [w.id, w]));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const activeCount = team.filter(m => m.isActive).length;
  const overloadedCount = workload.filter(w => w.status === 'overloaded').length;
  const allocations = allocationsData?.allocations || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCount} active member{activeCount !== 1 ? 's' : ''}
            {overloadedCount > 0 && (
              <span className="ml-2 text-amber-600">· {overloadedCount} overloaded</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setView('team')}
              className={cn('px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition', view === 'team' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}
            >
              <LayoutGrid className="w-4 h-4" /> Team
            </button>
            <button
              onClick={() => setView('resources')}
              className={cn('px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition', view === 'resources' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}
            >
              <BarChart3 className="w-4 h-4" /> Resources
            </button>
          </div>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreateModal(true)}>
            Add Member
          </Button>
        </div>
      </div>

      <CreateTeamMemberModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          queryClient.invalidateQueries({ queryKey: ['team'] });
        }}
      />

      {view === 'team' ? (
        <>
          {/* Workload Overview */}
          {workload.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Workload</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {workload.map((member) => (
                  <Card key={member.id} className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold',
                        statusColor(member.status)
                      )}>
                        {member.name[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{member.name}</p>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-full capitalize', statusColor(member.status))}>
                          {member.status}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Utilization</span>
                          <span className={member.utilizationPercent > 80 ? 'text-amber-600 font-semibold' : ''}>
                            {member.utilizationPercent}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', barColor(member.status))}
                            style={{ width: `${Math.min(100, member.utilizationPercent)}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {member.activeThreads} threads
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckSquare className="w-3 h-3" />
                          {member.activeTasks} tasks
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Team Members */}
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Members</h2>
            <div className="space-y-2">
              {team.map((member) => {
                const load = workloadMap[member.id];
                return (
                  <Card key={member.id} className={cn('p-4', !member.isActive && 'opacity-60')}>
                    {editingMember === member.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          updateMutation.mutate({
                            id: member.id,
                            data: {
                              name: editForm.name,
                              skills: editForm.skills.split(',').map(s => s.trim()).filter(Boolean),
                            }
                          });
                        }}
                        className="flex flex-wrap items-end gap-3"
                      >
                        <div>
                          <label className="block text-xs font-medium mb-1">Name</label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="px-2 py-1.5 rounded border border-border bg-background text-sm w-40"
                            required
                          />
                        </div>
                        <div className="flex-1 min-w-40">
                          <label className="block text-xs font-medium mb-1">Skills (comma-separated)</label>
                          <input
                            type="text"
                            value={editForm.skills}
                            onChange={(e) => setEditForm({ ...editForm, skills: e.target.value })}
                            className="px-2 py-1.5 rounded border border-border bg-background text-sm w-full"
                            placeholder="e.g. design, react, shopify"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" type="submit" loading={updateMutation.isPending} leftIcon={<Save className="w-3 h-3" />}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => setEditingMember(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-semibold shrink-0">
                          {member.name[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">{member.name}</p>
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', roleColors[member.role] || roleColors.MEMBER)}>
                              {member.role}
                            </span>
                            {!member.isActive && (
                              <span className="text-xs text-muted-foreground">(inactive)</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{member.email}</p>
                          {member.skills?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {member.skills.map((skill) => (
                                <span key={skill} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {load && (
                          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              {load.activeThreads}
                            </span>
                            <span className="flex items-center gap-1">
                              <CheckSquare className="w-3 h-3" />
                              {load.activeTasks}
                            </span>
                            <span className={cn(
                              'px-2 py-0.5 rounded-full text-[10px] font-medium capitalize',
                              statusColor(load.status)
                            )}>
                              {load.status}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 ml-auto shrink-0">
                          <button
                            onClick={() => handleEdit(member)}
                            className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(member)}
                            className={cn('p-1.5 rounded', member.isActive ? 'text-green-600 hover:text-red-500' : 'text-muted-foreground hover:text-green-600')}
                            title={member.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {member.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Resource Allocation View */
        <div>
          {allocLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : allocations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No resource data available yet</p>
              <p className="text-sm mt-1">Start tracking time to see resource allocation</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Capacity overview */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Team Members</p>
                  <p className="text-2xl font-bold">{allocations.length}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Avg Utilization</p>
                  <p className="text-2xl font-bold">{allocations.length > 0 ? Math.round(allocations.reduce((s, a) => s + a.utilization, 0) / allocations.length) : 0}%</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Overloaded</p>
                  <p className="text-2xl font-bold text-red-600">{allocations.filter(a => a.utilization > 90).length}</p>
                </Card>
              </div>

              {/* Allocation bars */}
              <Card className="p-4">
                <h3 className="font-medium text-foreground mb-4">Team Allocation</h3>
                <div className="space-y-3">
                  {allocations.map(a => (
                    <div key={a.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs text-muted-foreground">{a.role}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{a.weeklyHours.toFixed(1)}h/week</span>
                          <span className={cn('px-2 py-0.5 rounded-full font-medium', a.utilization > 90 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : a.utilization > 70 ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' : 'text-green-600 bg-green-50 dark:bg-green-900/20')}>
                            {a.utilization}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', a.utilization > 90 ? 'bg-red-500' : a.utilization > 70 ? 'bg-amber-500' : 'bg-green-500')}
                          style={{ width: `${Math.min(100, a.utilization)}%` }}
                        />
                      </div>
                      {a.projects?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 ml-2">
                          {a.projects.map(p => (
                            <span key={p.project.id} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {p.project.name} ({p.taskCount})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}