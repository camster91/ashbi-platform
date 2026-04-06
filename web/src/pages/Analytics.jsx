import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Clock, CheckCircle, TrendingUp, Users, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui';
import { cn } from '../lib/utils';

export default function Analytics() {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.getOverview(30),
  });
  const { data: responseTimes } = useQuery({
    queryKey: ['analytics-response-times'],
    queryFn: () => api.getResponseTimes(30),
  });
  const { data: teamAnalytics } = useQuery({
    queryKey: ['analytics-team'],
    queryFn: () => api.getTeamAnalytics(30),
  });

  if (overviewLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const totalProjects = (overview?.projectHealth?.ON_TRACK || 0) +
    (overview?.projectHealth?.NEEDS_ATTENTION || 0) +
    (overview?.projectHealth?.AT_RISK || 0);

  const priorityColors = {
    CRITICAL: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    HIGH: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20',
    NORMAL: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
    LOW: 'text-muted-foreground bg-muted',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Inbox and project performance metrics</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Threads" value={overview?.summary?.totalThreads || 0} icon={MessageSquare} />
        <StatCard
          label="Open Threads"
          value={overview?.summary?.openThreads || 0}
          icon={AlertCircle}
          highlight={overview?.summary?.openThreads > 10}
        />
        <StatCard label="Resolution Rate" value={`${overview?.summary?.resolutionRate || 0}%`} icon={CheckCircle} />
        <StatCard label="Pending Approval" value={overview?.summary?.pendingResponses || 0} icon={Clock} />
      </div>

      {/* Period Stats */}
      <Card className="p-6">
        <h2 className="font-semibold text-foreground mb-4">Last 30 Days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { value: overview?.period?.newThreads || 0, label: 'New Threads', color: 'text-primary' },
            { value: overview?.period?.resolvedThreads || 0, label: 'Resolved Threads', color: 'text-green-600' },
            { value: overview?.summary?.activeProjects || 0, label: 'Active Projects', color: 'text-foreground' },
            { value: overview?.summary?.totalClients || 0, label: 'Active Clients', color: 'text-foreground' },
          ].map(({ value, label, color }) => (
            <div key={label}>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
              <p className="text-sm text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Response Times */}
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">Response Times (hours)</h2>
          {responseTimes?.averageByPriority && Object.keys(responseTimes.averageByPriority).length > 0 ? (
            <div className="space-y-4">
              {Object.entries(responseTimes.averageByPriority).map(([priority, hours]) => (
                <div key={priority}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-foreground">{priority}</span>
                    <span className="text-muted-foreground">{hours}h avg</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        priority === 'CRITICAL' ? 'bg-red-500' :
                        priority === 'HIGH' ? 'bg-orange-500' :
                        priority === 'NORMAL' ? 'bg-blue-500' : 'bg-muted-foreground/50'
                      )}
                      style={{ width: `${Math.min(100, (hours / 48) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-border flex justify-between text-sm">
                <span className="text-muted-foreground">Overall Average</span>
                <span className="font-medium text-foreground">{responseTimes.overallAverage}h</span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No response data yet</p>
          )}
        </Card>

        {/* Project Health */}
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">Project Health</h2>
          {totalProjects > 0 ? (
            <div className="space-y-4">
              <HealthBar label="On Track" count={overview?.projectHealth?.ON_TRACK || 0} total={totalProjects} color="green" />
              <HealthBar label="Needs Attention" count={overview?.projectHealth?.NEEDS_ATTENTION || 0} total={totalProjects} color="yellow" />
              <HealthBar label="At Risk" count={overview?.projectHealth?.AT_RISK || 0} total={totalProjects} color="red" />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No project data yet</p>
          )}
        </Card>
      </div>

      {/* Priority Breakdown */}
      {overview?.priorityBreakdown && Object.keys(overview.priorityBreakdown).length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">Open Threads by Priority</h2>
          <div className="flex items-center gap-4 flex-wrap">
            {Object.entries(overview.priorityBreakdown).map(([priority, count]) => (
              <div key={priority} className={`flex-1 min-w-[100px] p-4 rounded-lg text-center ${priorityColors[priority] || 'bg-muted text-muted-foreground'}`}>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-sm mt-0.5">{priority}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Team Performance */}
      {teamAnalytics?.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Team Performance (30 days)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Member</th>
                  <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Threads</th>
                  <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Responses</th>
                  <th className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {teamAnalytics.map((member) => (
                  <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-medium">
                          {member.name?.[0]}
                        </div>
                        <span className="font-medium text-foreground">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{member.role}</td>
                    <td className="px-6 py-3 text-sm text-foreground">{member.activeThreads}</td>
                    <td className="px-6 py-3 text-sm text-foreground">{member.responsesCreated}</td>
                    <td className="px-6 py-3 text-sm font-medium text-green-600">{member.threadsResolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, highlight }) {
  return (
    <Card className={cn('p-4', highlight && 'ring-2 ring-orange-400/50')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
        </div>
        <Icon className="w-8 h-8 text-muted-foreground/40" />
      </div>
    </Card>
  );
}

function HealthBar({ label, count, total, color }) {
  const barColors = { green: 'bg-green-500', yellow: 'bg-yellow-400', red: 'bg-red-500' };
  const percentage = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">{count} ({Math.round(percentage)}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColors[color])} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
