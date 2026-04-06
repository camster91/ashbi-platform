import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Clock, CheckCircle, TrendingUp, Users, AlertCircle } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { api } from '../lib/api';
import { Card } from '../components/ui';
import { cn } from '../lib/utils';

const PIE_COLORS = {
  ON_TRACK: '#22c55e',
  NEEDS_ATTENTION: '#eab308',
  AT_RISK: '#ef4444',
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  NORMAL: '#3b82f6',
  LOW: '#6b7280',
};

const AREA_COLORS = ['#8b5cf6', '#06b6d4', '#22c55e'];

function TooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="text-muted-foreground mb-1 text-xs">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {typeof p.value === 'number' && p.name === 'Revenue'
            ? `$${p.value.toLocaleString()}`
            : p.value}
        </p>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [period, setPeriod] = useState(30);

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics-overview', period],
    queryFn: () => api.getOverview(period),
  });
  const { data: responseTimes } = useQuery({
    queryKey: ['analytics-response-times', period],
    queryFn: () => api.getResponseTimes(period),
  });
  const { data: teamAnalytics } = useQuery({
    queryKey: ['analytics-team', period],
    queryFn: () => api.getTeamAnalytics(period),
  });
  const { data: trends } = useQuery({
    queryKey: ['analytics-trends', period],
    queryFn: () => api.getAnalyticsTrends(period),
  });
  const { data: aiAccuracy } = useQuery({
    queryKey: ['analytics-ai-accuracy', period],
    queryFn: () => api.getAiAccuracy(period),
  });

  const dailyData = (trends?.daily || []).map(d => ({
    ...d,
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    revenue: Math.round(d.revenue),
  }));

  // Sparse the x-axis labels if many data points
  const tickInterval = period <= 14 ? 0 : period <= 30 ? 4 : 6;

  const projectHealthData = Object.entries(overview?.projectHealth || {}).map(([name, value]) => ({
    name: name.replace('_', ' '),
    value,
    fill: PIE_COLORS[name] || '#8b5cf6',
  }));

  const priorityData = Object.entries(overview?.priorityBreakdown || {}).map(([name, value]) => ({
    name,
    value,
    fill: PIE_COLORS[name] || '#6b7280',
  }));

  const totalProjects = projectHealthData.reduce((s, d) => s + d.value, 0);

  if (overviewLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Inbox and project performance metrics</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                period === d ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {d}d
            </button>
          ))}
        </div>
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

      {/* Thread Volume Chart */}
      {dailyData.length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">Thread Volume — Last {period} Days</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradThreads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={tickInterval} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
              <Tooltip content={<TooltipContent />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="threads" name="New Threads" stroke="#8b5cf6" fill="url(#gradThreads)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" fill="url(#gradResolved)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Response Times Bar Chart */}
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">Avg Response Time (hours)</h2>
          {responseTimes?.averageByPriority && Object.keys(responseTimes.averageByPriority).length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={Object.entries(responseTimes.averageByPriority).map(([p, h]) => ({ priority: p, hours: h }))}
                  margin={{ top: 0, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="priority" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip content={<TooltipContent />} />
                  <Bar dataKey="hours" name="Hours" radius={[4, 4, 0, 0]}>
                    {Object.keys(responseTimes.averageByPriority).map(p => (
                      <Cell key={p} fill={PIE_COLORS[p] || '#8b5cf6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="pt-3 border-t border-border flex justify-between text-sm mt-2">
                <span className="text-muted-foreground">Overall Average</span>
                <span className="font-medium text-foreground">{responseTimes.overallAverage}h</span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No response data yet</p>
          )}
        </Card>

        {/* Project Health Pie */}
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">Project Health</h2>
          {totalProjects > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={projectHealthData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {projectHealthData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {projectHealthData.map(({ name, value, fill }) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: fill }} />
                      <span className="text-foreground">{name}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-foreground">{value}</span>
                      <span className="text-muted-foreground ml-1">({Math.round((value / totalProjects) * 100)}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No project data yet</p>
          )}
        </Card>
      </div>

      {/* Priority Breakdown Pie + Revenue Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Priority Breakdown */}
        {priorityData.length > 0 && (
          <Card className="p-6">
            <h2 className="font-semibold text-foreground mb-4">Open Threads by Priority</h2>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={priorityData} cx="50%" cy="50%" outerRadius={65} paddingAngle={2} dataKey="value">
                    {priorityData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {priorityData.map(({ name, value, fill }) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: fill }} />
                      <span className="text-foreground">{name}</span>
                    </div>
                    <span className="font-semibold text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Revenue trend */}
        {dailyData.some(d => d.revenue > 0) && (
          <Card className="p-6">
            <h2 className="font-semibold text-foreground mb-4">Revenue Collected — Last {period} Days</h2>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={dailyData.filter(d => d.revenue > 0)} margin={{ top: 0, right: 10, left: -5, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval={tickInterval} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<TooltipContent />} />
                <Bar dataKey="revenue" name="Revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Period Stats */}
      <Card className="p-6">
        <h2 className="font-semibold text-foreground mb-4">Last {period} Days</h2>
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

      {/* AI Performance */}
      {aiAccuracy && (
        <Card className="p-6">
          <h2 className="font-semibold text-foreground mb-4">AI Performance ({period} days)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-3xl font-bold text-primary">{aiAccuracy.matching?.autoMatchRate || 0}%</p>
              <p className="text-sm text-muted-foreground mt-1">Auto-match Rate</p>
              <p className="text-xs text-muted-foreground">{aiAccuracy.matching?.highConfidenceMatches || 0} high-confidence</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">{aiAccuracy.matching?.totalMatched || 0}</p>
              <p className="text-sm text-muted-foreground mt-1">Threads Matched</p>
              <p className="text-xs text-muted-foreground">{aiAccuracy.matching?.needsTriage || 0} need triage</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-600">{aiAccuracy.responses?.approvalRate || 0}%</p>
              <p className="text-sm text-muted-foreground mt-1">AI Response Approval</p>
              <p className="text-xs text-muted-foreground">{aiAccuracy.responses?.approved || 0} approved</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">{aiAccuracy.responses?.aiGenerated || 0}</p>
              <p className="text-sm text-muted-foreground mt-1">AI Drafts Generated</p>
            </div>
          </div>
        </Card>
      )}

      {/* Team Performance */}
      {teamAnalytics?.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Team Performance ({period} days)</h2>
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
