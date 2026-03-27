import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  DollarSign,
  CheckSquare,
  AlertTriangle,
  Plus,
  Inbox,
  Clock,
  Users,
  TrendingUp,
  Calendar,
  Bell,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Card, Button } from '../components/ui';
import { formatRelativeTime, cn } from '../lib/utils';

export default function SimplifiedDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
    refetchInterval: 60000,
  });

  const { data: inboxStats } = useQuery({
    queryKey: ['inbox-stats'],
    queryFn: api.getInboxStats,
  });

  const { data: recentThreads = [] } = useQuery({
    queryKey: ['recent-threads'],
    queryFn: () => api.getThreads({ limit: 5 }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-10 w-48 bg-muted rounded" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-32 bg-muted rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-64 bg-muted rounded-xl" />
              <div className="h-64 bg-muted rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === 'ADMIN';
  const greeting = getGreeting(user?.name?.split(' ')[0] || 'there');

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{greeting}</h1>
              <p className="text-muted-foreground mt-1">
                Here's what needs your attention today
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={() => navigate('/projects?create=true')}
              >
                New Task
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/inbox/simple')}
              >
                Go to Inbox
              </Button>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => navigate('/inbox/simple')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inbox</p>
                <p className="text-2xl font-bold text-foreground">{inboxStats?.total || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {inboxStats?.needsResponse || 0} need response
                </p>
              </div>
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Inbox className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </Card>

          <Card className="p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => navigate('/projects')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Projects</p>
                <p className="text-2xl font-bold text-foreground">{dashboard?.activeProjects || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dashboard?.atRiskProjects || 0} at risk
                </p>
              </div>
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <FolderOpen className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>

          {isAdmin && (
            <Card className="p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => navigate('/invoices')}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${(dashboard?.totalOutstanding || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {dashboard?.overdueCount || 0} overdue
                  </p>
                </div>
                <div className={cn(
                  'p-2 rounded-lg',
                  dashboard?.overdueCount > 0
                    ? 'bg-red-100 dark:bg-red-900/30'
                    : 'bg-green-100 dark:bg-green-900/30'
                )}>
                  <DollarSign className={cn(
                    'w-6 h-6',
                    dashboard?.overdueCount > 0 ? 'text-red-600' : 'text-green-600'
                  )} />
                </div>
              </div>
            </Card>
          )}

          <Card className="p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => navigate('/approvals')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Approvals</p>
                <p className="text-2xl font-bold text-foreground">{dashboard?.pendingApprovals || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Awaiting your review
                </p>
              </div>
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <CheckSquare className="w-6 h-6 text-amber-600" />
              </div>
            </div>
          </Card>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Activity */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Recent Activity</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/inbox/simple')}>
                View all
              </Button>
            </div>
            
            <div className="space-y-4">
              {recentThreads.length === 0 ? (
                <div className="text-center py-8">
                  <Inbox className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No recent activity</p>
                </div>
              ) : (
                recentThreads.map(thread => (
                  <div
                    key={thread.id}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => navigate(`/thread/${thread.id}`)}
                  >
                    <div className={cn(
                      'p-2 rounded-lg',
                      thread.priority === 'CRITICAL' ? 'bg-red-100 dark:bg-red-900/30' :
                      thread.priority === 'HIGH' ? 'bg-orange-100 dark:bg-orange-900/30' :
                      'bg-blue-100 dark:bg-blue-900/30'
                    )}>
                      <Inbox className={cn(
                        'w-4 h-4',
                        thread.priority === 'CRITICAL' ? 'text-red-600' :
                        thread.priority === 'HIGH' ? 'text-orange-600' :
                        'text-blue-600'
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {thread.subject || 'No subject'}
                        </p>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatRelativeTime(thread.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {thread.from || 'Unknown sender'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Quick Actions */}
          <Card className="p-5">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
            
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/inbox/simple')}
              >
                <Inbox className="w-5 h-5" />
                <span className="text-sm">Check Inbox</span>
              </Button>
              
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/projects?create=true')}
              >
                <Plus className="w-5 h-5" />
                <span className="text-sm">New Project</span>
              </Button>
              
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/ai-chat')}
              >
                <TrendingUp className="w-5 h-5" />
                <span className="text-sm">AI Assist</span>
              </Button>
              
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/calendar')}
              >
                <Calendar className="w-5 h-5" />
                <span className="text-sm">Calendar</span>
              </Button>
              
              {isAdmin && (
                <>
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex flex-col items-center justify-center gap-2"
                    onClick={() => navigate('/invoices')}
                  >
                    <DollarSign className="w-5 h-5" />
                    <span className="text-sm">Invoices</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex flex-col items-center justify-center gap-2"
                    onClick={() => navigate('/team')}
                  >
                    <Users className="w-5 h-5" />
                    <span className="text-sm">Team</span>
                  </Button>
                </>
              )}
            </div>
            
            {/* Upcoming deadlines */}
            <div className="mt-6 pt-6 border-t border-border">
              <h3 className="text-sm font-medium text-foreground mb-3">Today's Focus</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span>Review client feedback</span>
                  <span className="text-xs text-muted-foreground ml-auto">2pm</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Send project update</span>
                  <span className="text-xs text-muted-foreground ml-auto">4pm</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span>Team sync</span>
                  <span className="text-xs text-muted-foreground ml-auto">5pm</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 18) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}