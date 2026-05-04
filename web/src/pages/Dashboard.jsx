import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  DollarSign,
  CheckSquare,
  AlertTriangle,
  Plus,
  Receipt,
  ArrowRight,
  Clock,
  Bell,
  Activity,
  TrendingUp,
  ShieldAlert,
  Users,
  Zap,
  Eye,
  CircleDot,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { Card } from '../components/ui';
import { formatRelativeTime, cn } from '../lib/utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notifications: liveNotifications } = useSocket();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.getDashboardStats(),
    refetchInterval: 30000,
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
            <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map(i => (
            <div key={i} className="h-80 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === 'ADMIN';
  const greeting = getGreeting(user?.name?.split(' ')[0] || 'there');

  // Merge live WebSocket notifications with server-fetched ones
  const allNotifications = mergeNotifications(
    stats?.unreadNotifications || [],
    liveNotifications
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">{greeting}</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">
            Agency command center — everything at a glance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/projects?create=true')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-all shadow-md active:scale-95"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>
          {isAdmin && (
            <button
              onClick={() => navigate('/invoices?create=true')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-card border border-border text-foreground rounded-full hover:bg-muted transition-all active:scale-95"
            >
              <Receipt className="w-4 h-4" /> New Invoice
            </button>
          )}
        </div>
      </div>

      {/* ─── Row 1: Live Numbers ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* MRR */}
        {isAdmin && (
          <StatCard
            icon={TrendingUp}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-100 dark:bg-emerald-900/30"
            label="MRR"
            value={`$${(stats?.mrr || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            onClick={() => navigate('/revenue')}
          />
        )}

        {/* Outstanding Invoices */}
        {isAdmin && (
          <StatCard
            icon={DollarSign}
            iconColor={stats?.overdueCount > 0 ? 'text-red-600' : 'text-green-600'}
            iconBg={stats?.overdueCount > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'}
            label="Outstanding"
            value={`$${(stats?.totalOutstanding || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            subtitle={stats?.overdueCount > 0 ? (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {stats.overdueCount} overdue (${(stats.overdueAmount || 0).toLocaleString()})
              </span>
            ) : null}
            onClick={() => navigate('/invoices')}
          />
        )}

        {/* Active Projects */}
        <StatCard
          icon={FolderOpen}
          iconColor="text-blue-600"
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          label="Active Projects"
          value={stats?.activeProjects || 0}
          onClick={() => navigate('/projects')}
        />

        {/* Pending Approvals */}
        <StatCard
          icon={ShieldAlert}
          iconColor={stats?.pendingApprovals > 0 ? 'text-red-600' : 'text-muted-foreground'}
          iconBg={stats?.pendingApprovals > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-muted'}
          label="Pending Approvals"
          value={stats?.pendingApprovals || 0}
          badge={stats?.pendingApprovals > 0 ? stats.pendingApprovals : null}
          onClick={() => navigate('/approvals')}
        />

        {/* Tasks (non-admin gets 2 extra cards) */}
        {!isAdmin && (
          <>
            <StatCard
              icon={CheckSquare}
              iconColor="text-orange-600"
              iconBg="bg-orange-100 dark:bg-orange-900/30"
              label="My Tasks"
              value={myTasks.length}
              onClick={() => navigate('/inbox')}
            />
            <StatCard
              icon={Bell}
              iconColor="text-purple-600"
              iconBg="bg-purple-100 dark:bg-purple-900/30"
              label="Notifications"
              value={allNotifications.length}
              badge={allNotifications.length > 0 ? allNotifications.length : null}
            />
          </>
        )}
      </div>

      {/* ─── Row 2: Activity Feed + Notification Center ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Feed */}
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground">Activity Feed</h2>
            </div>
            <Link to="/activity" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {stats?.recentActivity?.length > 0 ? (
            <ul className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {stats.recentActivity.map(activity => (
                <li key={activity.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
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
                        {activity.entityName && (
                          <span className="text-foreground font-medium"> {activity.entityName}</span>
                        )}
                      </p>
                      {activity.project && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {activity.project.name}
                          {activity.project.client ? ` · ${activity.project.client.name}` : ''}
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

        {/* Notification Center */}
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground">Notifications</h2>
              {allNotifications.length > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {allNotifications.length}
                </span>
              )}
            </div>
          </div>
          {allNotifications.length > 0 ? (
            <ul className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {allNotifications.map(notif => (
                <li key={notif.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <NotificationIcon type={notif.type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{notif.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatRelativeTime(notif.createdAt)}
                      </p>
                    </div>
                    {!notif.read && (
                      <CircleDot className="w-3 h-3 text-blue-500 flex-shrink-0 mt-1" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">
              All caught up — no unread notifications
            </div>
          )}
        </Card>
      </div>

      {/* ─── Row 3: Client Health Grid ─── */}
      {isAdmin && stats?.clientHealth?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Client Health</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {stats.clientHealth.map(client => (
              <ClientHealthCard key={client.id} client={client} navigate={navigate} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Row 4: My Tasks (compact) ─── */}
      {myTasks.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-foreground">My Tasks</h2>
            </div>
            <Link to="/inbox" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {myTasks.slice(0, 6).map(task => (
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
        </Card>
      )}
    </div>
  );
}

/* ─── Stat Card Component ─── */
function StatCard({ icon: Icon, iconColor, iconBg, label, value, subtitle, badge, onClick }) {
  return (
    <div
      className={cn(
        'p-5 rounded-2xl bg-card border border-border/60 transition-all relative group hover-lift',
        onClick && 'cursor-pointer hover:border-primary/20 shadow-sm'
      )}
      onClick={onClick}
    >
      {badge && (
        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-lg border-2 border-background animate-pulse">
          {badge}
        </span>
      )}
      <div className="flex flex-col gap-4">
        <div className={cn('p-2.5 rounded-xl w-fit transition-transform group-hover:scale-110 duration-200', iconBg)}>
          <Icon className={cn('w-5 h-5', iconColor)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold mt-0.5 tracking-tight text-foreground">{value}</p>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

/* ─── Client Health Card ─── */
function ClientHealthCard({ client, navigate }) {
  const healthColors = {
    ON_TRACK: 'border-l-emerald-500',
    NEEDS_ATTENTION: 'border-l-amber-500',
    AT_RISK: 'border-l-red-500',
  };

  const retainerBadge = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    AT_RISK: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    PAUSED: 'bg-muted text-muted-foreground',
    CANCELLED: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <Card
      className={cn(
        'p-4 border-l-4 cursor-pointer hover:border-primary/30 transition-colors',
        healthColors[client.healthStatus] || 'border-l-border'
      )}
      onClick={() => navigate(`/clients/${client.id}`)}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-sm text-foreground truncate flex-1">{client.name}</h3>
        <span className="text-lg font-bold ml-2" title="Health Score">
          {client.healthScore}
        </span>
      </div>

      <div className="space-y-1.5">
        {client.retainerStatus && (
          <span className={cn(
            'inline-block text-xs px-2 py-0.5 rounded-full font-medium',
            retainerBadge[client.retainerStatus] || 'bg-muted text-muted-foreground'
          )}>
            {client.retainerStatus.replace('_', ' ')}
            {client.monthlyAmount > 0 && ` · $${client.monthlyAmount.toLocaleString()}/mo`}
          </span>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{client.activeProjects} active project{client.activeProjects !== 1 ? 's' : ''}</span>
          {client.lastActivity && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(client.lastActivity)}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─── Notification Icon ─── */
function NotificationIcon({ type }) {
  const config = {
    APPROVAL_NEEDED: { icon: ShieldAlert, color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-900/30' },
    ALERT: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
    TASK_OVERDUE: { icon: Clock, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
    THREAD_ASSIGNED: { icon: Eye, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
    PAYMENT_RECEIVED: { icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  };

  const { icon: Icon, color, bg } = config[type] || {
    icon: Zap, color: 'text-primary', bg: 'bg-primary/10'
  };

  return (
    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', bg)}>
      <Icon className={cn('w-3.5 h-3.5', color)} />
    </div>
  );
}

/* ─── Helpers ─── */
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
    TASK_STARTED: 'started a task',
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
    INFO: 'logged',
    ERROR: 'reported an error',
  };
  return map[action] || action?.toLowerCase().replace(/_/g, ' ') || '';
}

function mergeNotifications(serverNotifs, liveNotifs) {
  const ids = new Set(serverNotifs.map(n => n.id));
  const merged = [...serverNotifs];
  for (const n of liveNotifs) {
    if (n.id && !ids.has(n.id)) {
      merged.unshift(n);
      ids.add(n.id);
    }
  }
  return merged.slice(0, 20);
}
