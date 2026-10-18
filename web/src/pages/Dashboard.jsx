import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  DollarSign,
  CheckSquare,
  AlertTriangle,
  Plus,
  Receipt,
  ArrowRight,
  Clock,
  ShieldAlert,
  Zap,
  Eye,
  CircleDot,
  Mail,
  Bug,
} from 'lucide-react';
import { api } from '../lib/api';
import { embeddedAiEnabled } from '../lib/features';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { Card, Skeleton } from '../components/ui';
import StatusBadge from '../components/ui/StatusBadge';
import { formatRelativeTime, cn } from '../lib/utils';
import { formatDate, formatMoney } from '../lib/format';
import { mrrLabel } from '../lib/retainer-money';
import { invoiceDisplayStatus } from '../lib/invoice-status';
import TimeTrackerWidget from '../components/widgets/TimeTrackerWidget';
import UpcomingEventsWidget from '../components/widgets/UpcomingEventsWidget';
import OutreachFunnelWidget from '../components/widgets/OutreachFunnelWidget';
import QueryErrorState from '../components/QueryErrorState';
import PartialSectionNotice from '../components/PartialSectionNotice';
import { PendingItem, PENDING_KEY, RECEIPTS_KEY, useNow } from '../components/AiApprovals';
import { SlowMessage } from '../components/ui/SlowNotice';
import useSlowState from '../hooks/useSlowState';
import useManualRetry from '../hooks/useManualRetry';
import useSettledFailure from '../hooks/useSettledFailure';

// Layout follows the Ashbi Hub dashboard mockup: money at a glance, the
// agent approval queue, today's work, recent invoices and paid per month,
// then the triage panels, widgets, client health and activity.

const panelClass = 'rounded-lg';
const panelHeaderClass = 'px-5 pt-4 pb-3 flex flex-wrap items-baseline justify-between gap-2';
const panelTitleClass = 'text-lg font-semibold tracking-tight text-foreground';
const panelLinkClass = '-my-3 -mr-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
const emptyClass = 'px-5 pb-6 pt-2 text-sm text-muted-foreground';

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { notifications: liveNotifications } = useSocket();
  const isAdmin = user?.role === 'ADMIN';
  const isStaff = isAdmin || user?.role === 'TEAM';
  const now = useNow();

  const statsQuery = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.getDashboardStats(),
    // Pause polling while the stats request is failing: the error surface
    // offers an explicit retry, and polling a failing endpoint would keep
    // re-rendering (and re-announcing) the recovery notice.
    refetchInterval: (query) => (query.state.status === 'error' ? false : 30000),
    placeholderData: keepPreviousData,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const tasksQuery = useQuery({
    queryKey: ['my-tasks'],
    queryFn: () => api.getMyTasks().then((r) => Object.values(r ?? {}).flat()),
    placeholderData: keepPreviousData,
  });

  // Actions agents prepared (AI bridge or assistant) that wait for a person.
  // Shares its cache with Settings → Action approvals.
  const agentQuery = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => api.getAiToolApprovals(),
    enabled: isStaff,
    refetchInterval: 60000,
  });

  const invoicesQuery = useQuery({
    queryKey: ['dashboard-recent-invoices'],
    queryFn: () => api.getInvoices({ limit: 5, sort: 'createdAt', order: 'desc' }),
    enabled: isAdmin,
  });

  const { data: stats, isLoading, refetch } = statsQuery;
  const { data: myTasks, refetch: refetchTasks } = tasksQuery;
  // Failure state that survives retries/background refetches, so notices are
  // not unmounted and re-announced while a request is in flight.
  const { failed: isError, error } = useSettledFailure(statsQuery);
  const { failed: areTasksUnavailable, error: tasksError } = useSettledFailure(tasksQuery);

  // "Retrying…" reflects only a retry the person asked for, never polling or
  // background refetches, so live regions are not re-announced every cycle.
  const [retryStats, isRetryingStats] = useManualRetry(refetch);
  const [retryTasks, isRetryingTasks] = useManualRetry(refetchTasks);
  const taskList = myTasks ?? [];

  const isInitialLoadSlow = useSlowState(isLoading && !stats && !isError);

  // Show skeleton on first load (no data yet)
  if (isLoading && !stats && !isError) {
    return (
      <div role="status" aria-live="polite" aria-label="Loading dashboard" className="space-y-6 min-h-[60vh]">
        <span className="sr-only">Loading dashboard…</span>
        {isInitialLoadSlow && <SlowMessage kind="read" />}
        {/* Greeting skeleton */}
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-4 w-48" />
        {/* Stat card skeletons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        {/* Panel skeletons */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map(i => (
            <Skeleton key={i} className="h-80 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Show error banner if query keeps failing after retries
  if (isError && !stats) {
    return (
      <div className="space-y-6 min-h-[60vh]">
        <QueryErrorState error={error} onRetry={retryStats} isRetrying={isRetryingStats} message="Dashboard data could not be loaded" />
      </div>
    );
  }

  const firstName = user?.name?.split(' ')[0] || 'there';

  // Merge live WebSocket notifications with server-fetched ones
  const allNotifications = mergeNotifications(
    stats?.unreadNotifications || [],
    liveNotifications
  );

  const agentActions = agentQuery.data?.approvals ?? [];
  // Settings → Action approvals only exists when embedded AI is on; without
  // it the dashboard is the one place to decide, so it lists every action.
  const shownAgentActions = embeddedAiEnabled ? agentActions.slice(0, 3) : agentActions;
  const replyApprovals = stats?.pendingApprovals || 0;
  const waitingCount = agentActions.length + (replyApprovals > 0 ? 1 : 0);
  const paidHistory = (stats?.revenueHistory || []).slice(-6);
  const paidThisMonth = paidThisMonthTotal(paidHistory);
  const recentInvoices = invoicesQuery.data?.invoices ?? [];

  const onAgentDecided = () => {
    queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    queryClient.invalidateQueries({ queryKey: RECEIPTS_KEY });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">{formatToday()}</p>
          <h1 className="mt-1.5 text-3xl font-heading font-semibold text-foreground tracking-tight">
            {greetingFor()}, <span className="font-display italic font-normal text-primary">{firstName}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/projects?create=true')}
            className="inline-flex min-h-11 items-center gap-2 px-4 rounded-md border border-border bg-transparent font-mono text-xs font-medium uppercase tracking-[0.1em] text-foreground hover:bg-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New Project
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => navigate('/invoices?create=true')}
              className="inline-flex min-h-11 items-center gap-2 px-4 rounded-md border border-foreground bg-accent font-mono text-xs font-medium uppercase tracking-[0.1em] text-accent-foreground hover:bg-accent/80 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Receipt className="w-3.5 h-3.5" aria-hidden="true" /> New Invoice
            </button>
          )}
        </div>
      </div>

      {/* ─── Money at a glance (admin) / work at a glance (team) ─── */}
      <section aria-label="At a glance" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {isAdmin ? (
          <>
            <KpiTile
              tone="primary"
              label="Owed to you"
              value={formatMoney(stats?.totalOutstanding || 0, undefined, { compact: true })}
              detail={
                stats?.draftInvoiceCount > 0
                  ? `${stats?.outstandingCount || 0} sent · Drafts ${formatMoney(stats.draftInvoiceTotal || 0, undefined, { compact: true })} · ${stats.draftInvoiceCount} not sent`
                  : `${stats?.outstandingCount || 0} sent, unpaid invoices`
              }
              onClick={() => navigate('/invoices')}
            />
            <KpiTile
              tone={stats?.overdueCount > 0 ? 'warning' : 'default'}
              label="Overdue"
              value={formatMoney(stats?.overdueAmount || 0, undefined, { compact: true })}
              detail={stats?.overdueCount > 0 ? `${stats.overdueCount} invoice${stats.overdueCount === 1 ? '' : 's'} past due` : 'Nothing past due'}
              onClick={() => navigate('/invoices')}
            />
            <KpiTile
              label="Paid this month"
              value={formatMoney(paidThisMonth, undefined, { compact: true })}
              detail="From invoices marked paid"
              onClick={() => navigate('/invoices')}
            />
            <KpiTile
              label="MRR"
              value={mrrLabel(stats)}
              detail={stats?.activeRetainerCount > 0
                ? `${stats.activeRetainerCount} active retainer${stats.activeRetainerCount === 1 ? '' : 's'}`
                : 'No active retainers'}
              onClick={() => navigate('/retainers')}
            />
          </>
        ) : (
          <>
            <KpiTile label="Active projects" value={stats?.activeProjects || 0} onClick={() => navigate('/projects')} />
            <KpiTile
              tone={replyApprovals > 0 ? 'warning' : 'default'}
              label="Pending approvals"
              value={replyApprovals}
              onClick={() => navigate('/approvals')}
            />
            <KpiTile label="My tasks" value={myTasks ? myTasks.length : '—'} onClick={() => navigate('/inbox')} />
            <KpiTile label="Notifications" value={allNotifications.length} />
          </>
        )}
      </section>

      {/* Partial state: stale stats stay visible while the live refresh is retried. */}
      {isError && stats && (
        <PartialSectionNotice
          section="Live dashboard numbers"
          title="Live dashboard numbers could not be refreshed"
          detail="The figures below are from the last successful update."
          error={error}
          onRetry={retryStats}
          isRetrying={isRetryingStats}
        />
      )}

      {/* Partial state: tasks failed but the rest of the dashboard is usable. */}
      {areTasksUnavailable && (
        <PartialSectionNotice
          section="Task data"
          title="Task data is temporarily unavailable"
          detail="Other dashboard data is current."
          error={tasksError}
          onRetry={retryTasks}
          isRetrying={isRetryingTasks}
        />
      )}

      {/* ─── Waiting for your OK + Due today ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {isStaff && (
          <Card padding="none" className={cn(panelClass, 'lg:col-span-2')} as="section" aria-labelledby="waiting-heading">
            <div className={panelHeaderClass}>
              <div className="flex items-center gap-2">
                <h2 id="waiting-heading" className={panelTitleClass}>
                  Waiting for your <span className="font-display italic font-normal text-primary">OK</span>
                </h2>
                {waitingCount > 0 && (
                  <span className="rounded-full bg-accent px-2 font-mono text-[11px] font-medium text-accent-foreground">{waitingCount}</span>
                )}
              </div>
              {embeddedAiEnabled && <Link to="/settings" className={panelLinkClass}>All approvals <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>}
            </div>
            <p className="px-5 -mt-1 pb-3 text-sm text-muted-foreground">Your agents prepared these. Nothing changes until you approve.</p>
            <div className="px-5 pb-5 space-y-2">
              {replyApprovals > 0 && (
                <Link
                  to="/approvals"
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ShieldAlert className="w-4 h-4 text-warning shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-sm">
                    <span className="font-semibold text-foreground">{replyApprovals} client {replyApprovals === 1 ? 'reply' : 'replies'}</span>
                    <span className="text-muted-foreground"> drafted and waiting for review</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              )}
              {agentQuery.error && (
                <QueryErrorState error={agentQuery.error} onRetry={() => agentQuery.refetch()} message="Agent actions could not be loaded" />
              )}
              {agentActions.length > 0 && (
                <ul className="space-y-2" aria-label="Agent actions waiting for approval">
                  {shownAgentActions.map((action) => (
                    <PendingItem key={action.id} action={action} onDecided={onAgentDecided} now={now} />
                  ))}
                </ul>
              )}
              {agentActions.length > shownAgentActions.length && (
                <p className="text-sm text-muted-foreground">{agentActions.length - shownAgentActions.length} more in Settings → Action approvals.</p>
              )}
              {!agentQuery.isLoading && !agentQuery.error && waitingCount === 0 && (
                <p className="py-4 text-sm text-muted-foreground">Nothing waiting. Actions your agents prepare show up here first.</p>
              )}
            </div>
          </Card>
        )}

        <Card padding="none" className={cn(panelClass, !isStaff && 'lg:col-span-3')} as="section" aria-labelledby="my-tasks-heading">
          <div className={panelHeaderClass}>
            <h2 id="my-tasks-heading" className={panelTitleClass}>My tasks</h2>
            <Link to="/inbox" className={panelLinkClass}>View all <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
          </div>
          {taskList.length > 0 ? (
            <ul className="px-5 pb-3 divide-y divide-border/40">
              {taskList.slice(0, 6).map(task => {
                const overdue = task.dueDate && new Date(task.dueDate) < new Date();
                return (
                  <li key={task.id}>
                    <Link
                      to={`/task/${task.id}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-3 rounded-md hover:bg-muted/40 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground truncate">{task.title}</span>
                        <span className="block text-xs text-muted-foreground">{task.project?.name || 'No project'}</span>
                      </span>
                      {task.dueDate && (
                        <span className={cn('shrink-0 text-xs flex items-center gap-1', overdue ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {formatDate(task.dueDate, { dateOnly: true })}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={emptyClass}>{myTasks ? 'No open tasks assigned to you.' : 'Tasks will show here once they load.'}</p>
          )}
        </Card>
      </div>

      {/* ─── Recent invoices + Paid per month (admin) ─── */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card padding="none" className={cn(panelClass, 'lg:col-span-2')} as="section" aria-labelledby="recent-invoices-heading">
            <div className={panelHeaderClass}>
              <h2 id="recent-invoices-heading" className={panelTitleClass}>Recent invoices</h2>
              <Link to="/invoices" className={panelLinkClass}>All invoices <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
            </div>
            {invoicesQuery.error ? (
              <div className="px-5 pb-5">
                <QueryErrorState error={invoicesQuery.error} onRetry={() => invoicesQuery.refetch()} message="Recent invoices could not be loaded" />
              </div>
            ) : recentInvoices.length > 0 ? (
              <div className="overflow-x-auto px-5 pb-3">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left">
                      <th scope="col" className="py-2 pr-2 text-eyebrow text-muted-foreground">Invoice</th>
                      <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground">Client</th>
                      <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground text-right">Amount</th>
                      <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground">Status</th>
                      <th scope="col" className="py-2 pl-2 text-eyebrow text-muted-foreground">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map(invoice => {
                      const displayStatus = invoiceDisplayStatus(invoice);
                      return (
                      <tr key={invoice.id} className="border-t border-border/40">
                        <td className="py-3 pr-2">
                          <Link to={`/invoices/${invoice.id}`} className="figure text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                            {invoice.invoiceNumber || invoice.title || 'Invoice'}
                          </Link>
                        </td>
                        <td className="py-3 px-2 text-foreground">{invoice.client?.name || '—'}</td>
                        <td className="py-3 px-2 text-right figure">{formatMoney(invoice.total ?? 0, invoice.currency)}</td>
                        <td className="py-3 px-2">
                          <StatusBadge domain="invoice" status={displayStatus} />
                        </td>
                        <td className={cn('py-3 pl-2', displayStatus === 'OVERDUE' ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                          {invoice.dueDate ? formatDate(invoice.dueDate, { dateOnly: true }) : '—'}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={emptyClass}>{invoicesQuery.isLoading ? 'Loading invoices…' : 'No invoices yet.'}</p>
            )}
          </Card>

          <Card padding="none" className={panelClass} as="section" aria-labelledby="paid-heading">
            <div className={panelHeaderClass}>
              <h2 id="paid-heading" className={panelTitleClass}>Paid per month</h2>
            </div>
            {paidHistory.length > 0 ? (
              <PaidBars months={paidHistory} />
            ) : (
              <p className={emptyClass}>No paid invoices in the last six months.</p>
            )}
          </Card>
        </div>
      )}

      {/* ─── Blocked & at-risk + Inbox triage ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="none" className={panelClass} as="section" aria-labelledby="at-risk-heading">
          <div className={panelHeaderClass}>
            <h2 id="at-risk-heading" className={panelTitleClass}>Blocked &amp; at risk</h2>
            <Link to="/projects" className={panelLinkClass}>
              {stats?.activeProjects || 0} active projects <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
          {(stats?.atRiskProjects?.length || 0) > 0 ? (
            <ul className="px-5 pb-3 divide-y divide-border/40 max-h-[340px] overflow-y-auto">
              {stats.atRiskProjects.map(project => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/project/${project.id}`)}
                    className="w-full min-h-11 flex items-start justify-between gap-3 py-3 text-left rounded-md hover:bg-muted/40 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-muted-foreground">{project.client?.name}</span>
                      <span className="block text-sm font-semibold text-foreground truncate">{project.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded-full font-semibold',
                          project.health === 'AT_RISK' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
                        )}>
                          {project.health?.replace('_', ' ')}
                        </span>
                        {project.blockedTasks?.length > 0 && (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <Bug className="w-3 h-3" aria-hidden="true" />
                            {project.blockedTasks.length} blocked
                          </span>
                        )}
                        {project.endDate && (
                          <span className="text-xs text-muted-foreground">Due {formatDate(project.endDate, { dateOnly: true })}</span>
                        )}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn(
                        'block figure text-lg font-medium',
                        project.healthScore >= 80 ? 'text-success' : project.healthScore >= 60 ? 'text-warning' : 'text-destructive'
                      )}>{project.healthScore}</span>
                      <span className="block text-eyebrow text-muted-foreground">health</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn(emptyClass, 'flex items-center gap-2')}>
              <CheckSquare className="w-4 h-4 text-success" aria-hidden="true" />
              All projects on track
            </p>
          )}
        </Card>

        <Card padding="none" className={panelClass} as="section" aria-labelledby="inbox-heading">
          <div className={panelHeaderClass}>
            <div className="flex items-center gap-2">
              <h2 id="inbox-heading" className={panelTitleClass}>Inbox triage</h2>
              {(stats?.inboxTriage?.untriagedCount || 0) > 0 && (
                <span className="rounded-full bg-accent px-2 font-mono text-[11px] font-medium text-accent-foreground">
                  {stats.inboxTriage.untriagedCount}
                </span>
              )}
            </div>
            <Link to="/inbox" className={panelLinkClass}>Open inbox <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
          </div>
          {(stats?.inboxTriage?.latest?.length || 0) > 0 ? (
            <ul className="px-5 pb-3 divide-y divide-border/40 max-h-[340px] overflow-y-auto">
              {stats.inboxTriage.latest.map(thread => (
                <li key={thread.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className={cn(
                      'w-2 h-2 rounded-full mt-1.5 shrink-0',
                      thread.priority === 'HIGH' || thread.priority === 'CRITICAL' ? 'bg-destructive' : 'bg-primary/40'
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{thread.subject}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {thread.client ? `${thread.client} · ` : ''}{formatRelativeTime(thread.lastActivityAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn(emptyClass, 'flex items-center gap-2')}>
              <Mail className="w-4 h-4 text-primary" aria-hidden="true" />
              Inbox is clear — all triaged
            </p>
          )}
        </Card>
      </div>

      {/* ─── Overdue tasks ─── */}
      {(stats?.overdueTasks?.length || 0) > 0 && (
        <Card padding="none" className={panelClass} as="section" aria-labelledby="overdue-heading">
          <div className={panelHeaderClass}>
            <div className="flex items-center gap-2">
              <h2 id="overdue-heading" className={panelTitleClass}>Overdue tasks</h2>
              <span className="rounded-full bg-destructive/10 px-2 font-mono text-[11px] font-medium text-destructive">{stats.overdueTasks.length}</span>
            </div>
            <Link to="/inbox" className={panelLinkClass}>View tasks <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
          </div>
          <ul className="px-5 pb-3 divide-y divide-border/40 max-h-[340px] overflow-y-auto">
            {stats.overdueTasks.map(task => (
              <li key={task.id} className="py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[task.project, task.assignee, task.priority].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-xs text-destructive font-semibold shrink-0">
                  {formatDate(task.dueDate, { dateOnly: true })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ─── Upwork messages ─── */}
      {(stats?.upworkMessages || []).length > 0 && (
        <Card padding="none" className={panelClass} as="section" aria-labelledby="upwork-heading">
          <div className={panelHeaderClass}>
            <div className="flex items-center gap-2">
              <h2 id="upwork-heading" className={panelTitleClass}>Upwork messages</h2>
              {(stats?.upworkMessages || []).filter(m => m.lastMessageDays !== null && m.lastMessageDays >= 3).length > 0 && (
                <span className="rounded-full bg-warning/10 px-2 text-xs font-semibold text-warning">
                  {(stats?.upworkMessages || []).filter(m => m.lastMessageDays !== null && m.lastMessageDays >= 3).length} pending
                </span>
              )}
            </div>
            <a href="https://www.upwork.com/nx/messages" target="_blank" rel="noopener noreferrer" className={panelLinkClass}>
              Open inbox <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>
          <ul className="px-5 pb-3 divide-y divide-border/40 max-h-[340px] overflow-y-auto">
            {(stats?.upworkMessages || []).map(msg => {
              const daysSince = msg.lastMessageDays;
              const needsResponse = daysSince !== null && daysSince >= 2;
              return (
                <li key={msg.id} className="py-3 flex items-start gap-3">
                  <span aria-hidden="true" className={cn('w-2 h-2 rounded-full mt-2 shrink-0', needsResponse ? 'bg-destructive' : 'bg-success')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{msg.clientName}</p>
                    {msg.projectName && <p className="text-xs text-muted-foreground truncate">{msg.projectName}</p>}
                    {daysSince !== null && (
                      <p className={cn('text-xs font-medium', needsResponse ? 'text-destructive' : 'text-muted-foreground')}>
                        {daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : `${daysSince} days ago`}
                        {msg.currentMilestone ? ` · ${msg.milestoneStatus || 'Active'}` : ''}
                      </p>
                    )}
                  </div>
                  {msg.upworkUrl && (
                    <a href={msg.upworkUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline shrink-0">
                      View
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* ─── Time, events, outreach ─── */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          <TimeTrackerWidget data={stats?.timeTracking} />
          <UpcomingEventsWidget events={stats?.upcomingEvents} />
          <OutreachFunnelWidget
            outreach={stats?.outreach}
            coldEmail={stats?.coldEmail}
            linkedIn={stats?.linkedIn}
          />
        </div>
      )}

      {/* ─── Client health ─── */}
      {isAdmin && stats?.clientHealth?.length > 0 && (
        <section aria-labelledby="client-health-heading">
          <h2 id="client-health-heading" className={cn(panelTitleClass, 'mb-3')}>Client health</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {stats.clientHealth.map(client => (
              <ClientHealthCard key={client.id} client={client} navigate={navigate} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Activity + notifications ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="none" className={panelClass} as="section" aria-labelledby="activity-heading">
          <div className={panelHeaderClass}>
            <h2 id="activity-heading" className={panelTitleClass}>Activity</h2>
          </div>
          {stats?.recentActivity?.length > 0 ? (
            <ul className="px-5 pb-3 divide-y divide-border/40 max-h-[400px] overflow-y-auto focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" tabIndex={0} aria-label="Recent activity">
              {stats.recentActivity.map(activity => (
                <li key={activity.id} className="py-3 flex items-start gap-3">
                  <span aria-hidden="true" className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center shrink-0 text-xs font-bold">
                    {activity.user?.name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{activity.user?.name}</span>{' '}
                      <span className="text-muted-foreground">{formatActivityAction(activity.action)}</span>
                      {activity.entityName && <span className="font-medium"> {activity.entityName}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activity.project ? `${activity.project.name}${activity.project.client ? ` · ${activity.project.client.name}` : ''} · ` : ''}
                      {formatRelativeTime(activity.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={emptyClass}>No recent activity</p>
          )}
        </Card>

        <Card padding="none" className={panelClass} as="section" aria-labelledby="notifications-heading">
          <div className={panelHeaderClass}>
            <div className="flex items-center gap-2">
              <h2 id="notifications-heading" className={panelTitleClass}>Notifications</h2>
              {allNotifications.length > 0 && (
                <span className="rounded-full bg-accent px-2 font-mono text-[11px] font-medium text-accent-foreground">{allNotifications.length}</span>
              )}
            </div>
          </div>
          {allNotifications.length > 0 ? (
            <ul className="px-5 pb-3 divide-y divide-border/40 max-h-[400px] overflow-y-auto focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" tabIndex={0} aria-label="Unread notifications">
              {allNotifications.map(notif => (
                <li key={notif.id} className="py-3 flex items-start gap-3">
                  <NotificationIcon type={notif.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{notif.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatRelativeTime(notif.createdAt)}</p>
                  </div>
                  {!notif.read && <CircleDot className="w-3 h-3 text-primary shrink-0 mt-1" aria-label="Unread" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className={emptyClass}>All caught up — no unread notifications</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ─── KPI tile: mono label, mono figure, one line of context ─── */
function KpiTile({ label, value, detail, tone = 'default', onClick }) {
  const Component = onClick ? 'button' : 'div';
  const tones = {
    default: 'bg-card text-card-foreground border border-border/60',
    primary: 'bg-primary text-primary-foreground border border-primary',
    warning: 'bg-card text-card-foreground border border-warning/40',
  };
  const valueTone = tone === 'warning' ? 'text-warning' : '';
  const detailTone = tone === 'primary' ? 'text-primary-foreground/80' : 'text-muted-foreground';
  // The button's accessible name is its visible text (label, value and detail).
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'w-full rounded-lg p-5 text-left flex flex-col gap-1.5 transition-colors',
        tones[tone] || tones.default,
        onClick && 'cursor-pointer hover:border-primary/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      )}
    >
      <span className={cn('text-eyebrow', tone === 'primary' ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{label}</span>
      <span className={cn('figure text-3xl font-medium', valueTone)}>{value}</span>
      {detail && <span className={cn('text-sm', detailTone)}>{detail}</span>}
    </Component>
  );
}

/* ─── Paid per month: one bar per month, the current month highlighted ─── */
function PaidBars({ months }) {
  const max = Math.max(...months.map(m => m.total), 1);
  const last = months.length - 1;
  const description = months.map(m => `${m.month} ${formatMoney(m.total, undefined, { compact: true })}`).join(', ');
  return (
    <div className="px-5 pb-5">
      <div role="img" aria-label={`Paid per month: ${description}`} className="grid h-36 items-end gap-2" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map((m, i) => (
          <div key={`${m.year}-${m.month}`} className="flex h-full flex-col items-center justify-end gap-1.5">
            <span className={cn('figure text-[11px]', i === last ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {formatMoney(m.total, undefined, { compact: true })}
            </span>
            <div
              className={cn('w-full rounded-sm', i === last ? 'bg-primary' : 'bg-secondary')}
              style={{ height: `${Math.max(4, Math.round((m.total / max) * 96))}px` }}
            />
            <span className={cn('text-[11px]', i === last ? 'text-foreground font-semibold' : 'text-muted-foreground')}>{m.month}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Client Health Card ─── */
function ClientHealthCard({ client, navigate }) {
  const healthTone = {
    ON_TRACK: 'border-t-success',
    NEEDS_ATTENTION: 'border-t-warning',
    AT_RISK: 'border-t-destructive',
  };

  const retainerBadge = {
    ACTIVE: 'bg-success/10 text-success',
    AT_RISK: 'bg-warning/10 text-warning',
    PAUSED: 'bg-muted text-muted-foreground',
    CANCELLED: 'bg-destructive/10 text-destructive',
  };

  const open = () => navigate(`/client/${client.id}`);

  return (
    <Card
      className={cn(
        'p-4 rounded-lg border-t-4 cursor-pointer hover:border-primary/40 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        healthTone[client.healthStatus] || 'border-t-border'
      )}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <span className="sr-only">View client health for</span>{' '}
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-sm text-foreground truncate flex-1">{client.name}</h3>
        <span className="figure text-lg font-medium ml-2" title="Health Score">
          {client.healthScore}
        </span>
      </div>

      <div className="space-y-1.5">
        {client.retainerStatus && (
          <span className={cn(
            'inline-block text-xs px-2 py-0.5 rounded-full font-semibold',
            retainerBadge[client.retainerStatus] || 'bg-muted text-muted-foreground'
          )}>
            {client.retainerStatus.replace('_', ' ')}
            {client.monthlyAmount > 0 && ` · ${formatMoney(client.monthlyAmount, client.monthlyCurrency || 'USD')}/mo`}
          </span>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{client.activeProjects} active project{client.activeProjects !== 1 ? 's' : ''}</span>
          {client.lastActivity && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
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
    APPROVAL_NEEDED: { icon: ShieldAlert, color: 'text-warning', bg: 'bg-warning/10' },
    ALERT: { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10' },
    TASK_OVERDUE: { icon: Clock, color: 'text-destructive', bg: 'bg-destructive/10' },
    THREAD_ASSIGNED: { icon: Eye, color: 'text-info', bg: 'bg-info/10' },
    PAYMENT_RECEIVED: { icon: DollarSign, color: 'text-success', bg: 'bg-success/10' },
  };

  const { icon: Icon, color, bg } = config[type] || {
    icon: Zap, color: 'text-primary', bg: 'bg-primary/10'
  };

  return (
    <div aria-hidden="true" className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5', bg)}>
      <Icon className={cn('w-3.5 h-3.5', color)} />
    </div>
  );
}

/* ─── Helpers ─── */
function greetingFor(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatToday(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The current month's paid total from revenueHistory ({ month: 'Oct', year: '2026', total }). */
function paidThisMonthTotal(history, now = new Date()) {
  const month = MONTHS[now.getMonth()];
  const year = String(now.getFullYear());
  return (history || []).find(row => row.month === month && String(row.year) === year)?.total || 0;
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
