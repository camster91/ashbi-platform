import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  Clock,
  CheckCircle,
  TrendingUp,
  Users,
  AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api';
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Threads"
          value={overview?.summary?.totalThreads || 0}
          icon={MessageSquare}
        />
        <StatCard
          label="Open Threads"
          value={overview?.summary?.openThreads || 0}
          icon={AlertCircle}
          highlight={overview?.summary?.openThreads > 10}
        />
        <StatCard
          label="Resolution Rate"
          value={`${overview?.summary?.resolutionRate || 0}%`}
          icon={CheckCircle}
        />
        <StatCard
          label="Pending Approval"
          value={overview?.summary?.pendingResponses || 0}
          icon={Clock}
        />
      </div>

      {/* Period Stats */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="font-semibold mb-4">Last 30 Days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-3xl font-bold text-primary">
              {overview?.period?.newThreads || 0}
            </p>
            <p className="text-sm text-gray-500">New Threads</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-green-600">
              {overview?.period?.resolvedThreads || 0}
            </p>
            <p className="text-sm text-gray-500">Resolved Threads</p>
          </div>
          <div>
            <p className="text-3xl font-bold">
              {overview?.summary?.activeProjects || 0}
            </p>
            <p className="text-sm text-gray-500">Active Projects</p>
          </div>
          <div>
            <p className="text-3xl font-bold">
              {overview?.summary?.totalClients || 0}
            </p>
            <p className="text-sm text-gray-500">Active Clients</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Response Times */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="font-semibold mb-4">Response Times (hours)</h2>
          {responseTimes?.averageByPriority ? (
            <div className="space-y-4">
              {Object.entries(responseTimes.averageByPriority).map(
                ([priority, hours]) => (
                  <div key={priority}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{priority}</span>
                      <span>{hours}h avg</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          priority === 'CRITICAL'
                            ? 'bg-red-500'
                            : priority === 'HIGH'
                            ? 'bg-orange-500'
                            : priority === 'NORMAL'
                            ? 'bg-blue-500'
                            : 'bg-gray-400'
                        )}
                        style={{
                          width: `${Math.min(100, (hours / 48) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )
              )}
              <div className="pt-4 border-t">
                <div className="flex justify-between">
                  <span className="text-gray-500">Overall Average</span>
                  <span className="font-medium">
                    {responseTimes.overallAverage}h
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">No response data yet</p>
          )}
        </div>

        {/* Project Health */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="font-semibold mb-4">Project Health</h2>
          {overview?.projectHealth ? (
            <div className="space-y-4">
              <HealthBar
                label="On Track"
                count={overview.projectHealth.ON_TRACK || 0}
                total={
                  (overview.projectHealth.ON_TRACK || 0) +
                  (overview.projectHealth.NEEDS_ATTENTION || 0) +
                  (overview.projectHealth.AT_RISK || 0)
                }
                color="green"
              />
              <HealthBar
                label="Needs Attention"
                count={overview.projectHealth.NEEDS_ATTENTION || 0}
                total={
                  (overview.projectHealth.ON_TRACK || 0) +
                  (overview.projectHealth.NEEDS_ATTENTION || 0) +
                  (overview.projectHealth.AT_RISK || 0)
                }
                color="yellow"
              />
              <HealthBar
                label="At Risk"
                count={overview.projectHealth.AT_RISK || 0}
                total={
                  (overview.projectHealth.ON_TRACK || 0) +
                  (overview.projectHealth.NEEDS_ATTENTION || 0) +
                  (overview.projectHealth.AT_RISK || 0)
                }
                color="red"
              />
            </div>
          ) : (
            <p className="text-gray-500">No project data yet</p>
          )}
        </div>
      </div>

      {/* Team Performance */}
      {teamAnalytics && teamAnalytics.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="font-semibold">Team Performance (30 days)</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-6 py-3 font-medium">Member</th>
                <th className="px-6 py-3 font-medium">Role</th>
                <th className="px-6 py-3 font-medium">Active Threads</th>
                <th className="px-6 py-3 font-medium">Responses Created</th>
                <th className="px-6 py-3 font-medium">Threads Resolved</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {teamAnalytics.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-medium">
                        {member.name[0]}
                      </div>
                      <span className="font-medium">{member.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-gray-600">{member.role}</td>
                  <td className="px-6 py-3">{member.activeThreads}</td>
                  <td className="px-6 py-3">{member.responsesCreated}</td>
                  <td className="px-6 py-3">
                    <span className="text-green-600 font-medium">
                      {member.threadsResolved}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Priority Breakdown */}
      {overview?.priorityBreakdown && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="font-semibold mb-4">Open Threads by Priority</h2>
          <div className="flex items-center gap-4">
            {Object.entries(overview.priorityBreakdown).map(
              ([priority, count]) => (
                <div
                  key={priority}
                  className={cn(
                    'flex-1 p-4 rounded-lg text-center',
                    priority === 'CRITICAL'
                      ? 'bg-red-50'
                      : priority === 'HIGH'
                      ? 'bg-orange-50'
                      : priority === 'NORMAL'
                      ? 'bg-blue-50'
                      : 'bg-gray-50'
                  )}
                >
                  <p
                    className={cn(
                      'text-2xl font-bold',
                      priority === 'CRITICAL'
                        ? 'text-red-600'
                        : priority === 'HIGH'
                        ? 'text-orange-600'
                        : priority === 'NORMAL'
                        ? 'text-blue-600'
                        : 'text-gray-600'
                    )}
                  >
                    {count}
                  </p>
                  <p className="text-sm text-gray-500">{priority}</p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, highlight }) {
  return (
    <div
      className={cn(
        'p-4 rounded-lg bg-white shadow',
        highlight && 'ring-2 ring-orange-200'
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className="w-8 h-8 text-gray-400" />
      </div>
    </div>
  );
}

function HealthBar({ label, count, total, color }) {
  const colors = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span>
          {count} ({Math.round(percentage)}%)
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', colors[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
