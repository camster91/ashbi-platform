import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { Activity, Clock, Filter } from 'lucide-react';

const AGENT_COLORS = {
  code: 'bg-blue-100 text-blue-800',
  ops: 'bg-orange-100 text-orange-800',
  seo: 'bg-green-100 text-green-800',
  comms: 'bg-purple-100 text-purple-800',
  creative: 'bg-pink-100 text-pink-800',
  finance: 'bg-yellow-100 text-yellow-800',
  pm: 'bg-indigo-100 text-indigo-800',
  social: 'bg-cyan-100 text-cyan-800',
  ads: 'bg-red-100 text-red-800',
  system: 'bg-muted text-muted-foreground',
};

const TYPE_ICONS = {
  TASK_STARTED: '🚀',
  TASK_COMPLETED: '✅',
  ERROR: '❌',
  INFO: 'ℹ️',
  ALERT: '⚠️',
  TASK_CREATED: '📝',
  NOTE_CREATED: '📄',
  PROJECT_CREATED: '📁',
};

const ENTITY_BADGES = {
  PROJECT: 'bg-blue-50 text-blue-700 border-blue-200',
  CLIENT: 'bg-green-50 text-green-700 border-green-200',
  INVOICE: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  TASK: 'bg-purple-50 text-purple-700 border-purple-200',
  SYSTEM: 'bg-muted text-muted-foreground border-border',
};

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
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ActivityFeedPage() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [filter, setFilter] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: () => api.getActivity({ limit: 50 }),
    refetchInterval: 60000,
  });

  const activities = Array.isArray(data) ? data : (data?.activities || data || []);

  // Listen for real-time activity events
  useEffect(() => {
    if (!socket) return;

    const handleNewActivity = () => {
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
    };

    socket.on('activity:new', handleNewActivity);
    return () => socket.off('activity:new', handleNewActivity);
  }, [socket, queryClient]);

  const filteredActivities = activities.filter((a) => {
    if (filter === 'all') return true;
    const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata || '{}') : (a.metadata || {});
    return meta.agentRole === filter;
  });

  const agentRoles = [...new Set(activities.map((a) => {
    const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata || '{}') : (a.metadata || {});
    return meta.agentRole;
  }).filter(Boolean))];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-heading font-bold text-foreground">Activity Feed</h1>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">All Agents</option>
            {agentRoles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse flex gap-4 p-4 bg-card rounded-xl border border-border">
              <div className="w-10 h-10 bg-muted rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">No activity yet</p>
          <p className="text-sm mt-1">Agent activity will appear here in real-time</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActivities.map((activity) => {
            const meta = typeof activity.metadata === 'string'
              ? JSON.parse(activity.metadata || '{}')
              : (activity.metadata || {});
            const agentRole = meta.agentRole || 'system';
            const agentColor = AGENT_COLORS[agentRole] || AGENT_COLORS.system;
            const icon = TYPE_ICONS[activity.type] || '📌';
            const entityBadge = ENTITY_BADGES[activity.entityType] || ENTITY_BADGES.SYSTEM;

            return (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-4 bg-card rounded-xl border border-border hover:border-primary/20 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg flex-shrink-0">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${agentColor}`}>
                      {agentRole}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${entityBadge}`}>
                      {activity.entityType}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {activity.entityName || activity.type}
                  </p>
                  {activity.project && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Project: {activity.project.name}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatTime(activity.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
