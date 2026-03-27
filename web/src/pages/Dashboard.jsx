import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  DollarSign,
  CheckSquare,
  AlertTriangle,
  Plus,
  Receipt,
  ClipboardList,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui';
import { formatRelativeTime, cn } from '../lib/utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
    refetchInterval: 60000,
  });

  const { data: myTasks = [] } = useQuery({
    queryKey: ['my-tasks'],
    queryFn: () => api.getMyTasks(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === 'ADMIN';
  const greeting = getGreeting(user?.name?.split(' ')[0] || 'there');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">{greeting}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's what's happening across your projects
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          className="p-4 cursor-pointer hover:border-primary/30 transition-colors"
          onClick={() => navigate('/projects')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <FolderOpen className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Projects</p>
              <p className="text-xl font-semibold">{dashboard?.activeProjects || 0}</p>
            </div>
          </div>
        </Card>

        {isAdmin && (
          <Card
            className="p-4 cursor-pointer hover:border-primary/30 transition-colors"
            onClick={() => navigate('/invoices')}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-lg',
                dashboard?.overdueCount > 0
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-green-100 dark:bg-green-900/30'
              )}>
                <DollarSign className={cn(
                  'w-5 h-5',
                  dashboard?.overdueCount > 0 ? 'text-red-600' : 'text-green-600'
                )} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-xl font-semibold">
                  ${(dashboard?.totalOutstanding || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                {dashboard?.overdueCount > 0 && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {dashboard.overdueCount} overdue
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card className="p-4 cursor-pointer hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <CheckSquare className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tasks Due This Week</p>
              <p className="text-xl font-semibold">{dashboard?.tasksDueThisWeek || 0}</p>
            </div>
          </div>
        </Card>

        {!isAdmin && (
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <ClipboardList className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">My Tasks</p>
                <p className="text-xl font-semibold">{myTasks.length}</p>
              </div>
            </div>
          </Card>
        )}

        {isAdmin && (
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <ClipboardList className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">My Tasks</p>
                <p className="text-xl font-semibold">{myTasks.length}</p>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => navigate('/projects?create=true')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Project
        </button>
        {isAdmin && (
          <button
            onClick={() => navigate('/invoices?create=true')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <Receipt className="w-3.5 h-3.5" /> New Invoice
          </button>
        )}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Tasks */}
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground">My Tasks</h2>
            <Link to="/inbox" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {myTasks.length > 0 ? (
            <ul className="divide-y divide-border">
              {myTasks.slice(0, 8).map(task => (
                <li key={task.id}>
                  <Link
                    to={`/task/${task.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.project?.name || 'No project'}
                      </p>
                    </div>
                    {task.dueDate && (
                      <span className={cn(
                        'text-xs ml-2 flex items-center gap-1',
                        new Date(task.dueDate) < new Date() ? 'text-red-500' : 'text-muted-foreground'
                      )}>
                        <Clock className="w-3 h-3" />
                        {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No tasks assigned to you
            </div>
          )}
        </Card>

        {/* Recent Activity */}
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Recent Activity</h2>
          </div>
          {dashboard?.recentActivity?.length > 0 ? (
            <ul className="divide-y divide-border">
              {dashboard.recentActivity.slice(0, 8).map(activity => (
                <li key={activity.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-semibold text-primary">
                        {activity.user?.name?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{activity.user?.name}</span>{' '}
                        <span className="text-muted-foreground">{formatActivityAction(activity.action)}</span>
                      </p>
                      {activity.project && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {activity.project.name}
                          {activity.project.client ? ` - ${activity.project.client.name}` : ''}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(activity.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No recent activity
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

function formatActivityAction(action) {
  const map = {
    TASK_CREATED: 'created a task',
    TASK_COMPLETED: 'completed a task',
    TASK_UPDATED: 'updated a task',
    CHAT_MESSAGE: 'sent a message',
    NOTE_CREATED: 'added a note',
    REVISION_CREATED: 'started a revision round',
    REVISION_APPROVED: 'approved a revision',
    PROJECT_CREATED: 'created a project',
    PROJECT_UPDATED: 'updated a project',
    THREAD_RESOLVED: 'resolved a thread',
    RESPONSE_APPROVED: 'approved a response',
    RESPONSE_SENT: 'sent a response',
    MILESTONE_CREATED: 'created a milestone',
    MILESTONE_COMPLETED: 'completed a milestone',
  };
  return map[action] || action?.toLowerCase().replace(/_/g, ' ') || '';
}
