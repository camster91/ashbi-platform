import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Clock,
  User,
  FolderOpen,
  ChevronRight,
  Flame,
  CheckCircle2,
  MessageSquare,
  Filter,
  MoreHorizontal,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatRelativeTime,
  truncate,
  getPriorityColor,
  getStatusColor,
  getSentimentIcon,
  cn,
} from '../lib/utils';
import { StatCard, Badge, EmptyInbox, SkeletonStatCard, SkeletonThreadRow } from '../components/ui';

export default function Inbox() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [triageResult, setTriageResult] = useState(null);

  const triageMutation = useMutation({
    mutationFn: () => api.triageInbox(),
    onSuccess: (data) => {
      setTriageResult(data);
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-stats'] });
      // Auto-dismiss after 8 seconds
      setTimeout(() => setTriageResult(null), 8000);
    },
  });

  const { data: inboxData, isLoading } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.getInbox(),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ['inbox-stats'],
    queryFn: api.getInboxStats,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonPageHeader />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <Skeleton className="h-6 w-20" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonThreadRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  const threads = inboxData?.threads || [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Inbox</h1>
          <p className="text-muted-foreground">Manage and respond to client requests</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => triageMutation.mutate()}
            disabled={triageMutation.isPending}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
              triageMutation.isPending
                ? 'bg-primary/20 text-primary cursor-wait'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {triageMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {triageMutation.isPending ? 'Triaging...' : 'AI Triage'}
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors">
            <Filter className="w-4 h-4" />
            Filter
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4" />
            View
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Open Threads"
          value={stats?.total || 0}
          icon={MessageSquare}
          variant="default"
        />
        <StatCard
          label="Needs Response"
          value={stats?.needsResponse || 0}
          icon={Clock}
          variant="warning"
          trend="up"
          trendValue="12%"
        />
        <StatCard
          label="Critical"
          value={stats?.critical || 0}
          icon={Flame}
          variant={stats?.critical > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Pending Approval"
          value={stats?.pendingApproval || 0}
          icon={CheckCircle2}
          variant="primary"
        />
      </div>

      {/* Triage Result Toast */}
      {triageResult && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-foreground">
              Triaged {triageResult.triaged} threads: {' '}
              {triageResult.summary.urgent > 0 && <span className="text-destructive font-semibold">{triageResult.summary.urgent} urgent</span>}
              {triageResult.summary.urgent > 0 && (triageResult.summary.followUp > 0 || triageResult.summary.waiting > 0 || triageResult.summary.lowPriority > 0) && ', '}
              {triageResult.summary.followUp > 0 && <span className="text-warning font-semibold">{triageResult.summary.followUp} follow-up</span>}
              {triageResult.summary.followUp > 0 && (triageResult.summary.waiting > 0 || triageResult.summary.lowPriority > 0) && ', '}
              {triageResult.summary.waiting > 0 && <span>{triageResult.summary.waiting} normal</span>}
              {triageResult.summary.waiting > 0 && triageResult.summary.lowPriority > 0 && ', '}
              {triageResult.summary.lowPriority > 0 && <span className="text-muted-foreground">{triageResult.summary.lowPriority} low-priority</span>}
            </span>
          </div>
          <button onClick={() => setTriageResult(null)} className="text-muted-foreground hover:text-foreground text-sm">
            Dismiss
          </button>
        </div>
      )}

      {/* Priority Threads Section (if there are critical/high priority items) */}
      {threads.some(t => t.priority === 'CRITICAL' || t.priority === 'HIGH') && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-5 h-5 text-destructive" />
            <h2 className="font-heading font-semibold text-foreground">Priority Threads</h2>
            <span className="ml-auto text-sm text-muted-foreground">
              Requires immediate attention
            </span>
          </div>
          <div className="space-y-2">
            {threads
              .filter(t => t.priority === 'CRITICAL' || t.priority === 'HIGH')
              .slice(0, 3)
              .map(thread => (
                <PriorityThreadRow key={thread.id} thread={thread} />
              ))}
          </div>
        </div>
      )}

      {/* Thread List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground">All Threads</h2>
          <span className="text-sm text-muted-foreground">
            {threads.length} {threads.length === 1 ? 'thread' : 'threads'}
          </span>
        </div>

        {threads.length === 0 ? (
          <EmptyInbox onBrowseProjects={() => navigate('/projects')} />
        ) : (
          <ul className="divide-y divide-border">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PriorityThreadRow({ thread }) {
  const latestMessage = thread.messages?.[0];
  const isCritical = thread.priority === 'CRITICAL';

  return (
    <Link
      to={`/thread/${thread.id}`}
      className={cn(
        'flex items-center gap-4 p-3 rounded-lg',
        'bg-card border border-border',
        'hover:border-destructive/50 transition-all duration-200'
      )}
    >
      <div className={cn(
        'w-1 h-10 rounded-full',
        isCritical ? 'bg-destructive' : 'bg-warning'
      )} />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground truncate">
            {thread.subject}
          </span>
          <Badge 
            variant="solid" 
            color={isCritical ? 'danger' : 'warning'}
            size="xs"
          >
            {thread.priority}
          </Badge>
          {thread.slaStatus === 'AT_RISK' && (
            <Badge variant="subtle" color="warning" size="xs">
              SLA at risk
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground">
          <span>{thread.client?.name}</span>
          <span>·</span>
          <span>{formatRelativeTime(thread.lastActivityAt)}</span>
        </div>
      </div>
      
      <ChevronRight className="w-5 h-5 text-muted-foreground" />
    </Link>
  );
}

function ThreadRow({ thread }) {
  const latestMessage = thread.messages?.[0];

  const priorityConfig = {
    CRITICAL: { color: 'bg-destructive', label: 'Critical' },
    HIGH: { color: 'bg-warning', label: 'High' },
    NORMAL: { color: 'bg-info', label: 'Normal' },
    LOW: { color: 'bg-success', label: 'Low' },
  };

  const priority = priorityConfig[thread.priority] || priorityConfig.NORMAL;

  return (
    <li>
      <Link
        to={`/thread/${thread.id}`}
        className={cn(
          'flex items-center gap-4 px-4 py-4',
          'hover:bg-muted/50 transition-colors duration-200',
          'group',
          thread.priority === 'CRITICAL' && 'border-l-4 border-l-destructive bg-destructive/5'
        )}
      >
        {/* Priority indicator */}
        <div
          className={cn(
            'w-1 h-12 rounded-full flex-shrink-0',
            priority.color
          )}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {thread.subject}
            </span>
            
            {thread.sentiment && (
              <span title={thread.sentiment} className="flex-shrink-0">
                {getSentimentIcon(thread.sentiment)}
              </span>
            )}
            
            {thread.needsTriage && (
              <Badge variant="subtle" color="warning" size="xs">
                Needs Triage
              </Badge>
            )}
            
            {thread.aiSuggested && (
              <Badge variant="subtle" color="primary" size="xs">
                AI Suggested
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
            {thread.client && (
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                {thread.client.name}
              </span>
            )}
            {thread.project && (
              <span className="flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5" />
                {thread.project.name}
              </span>
            )}
            {latestMessage && (
              <span className="truncate max-w-xs">
                {truncate(latestMessage.bodyText, 60)}
              </span>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 ml-4 flex-shrink-0">
          <Badge
            variant="subtle"
            color={thread.status === 'OPEN' ? 'primary' : 'default'}
            size="xs"
          >
            {thread.status.replace(/_/g, ' ')}
          </Badge>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(thread.lastActivityAt)}
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
      </Link>
    </li>
  );
}

// Simple skeleton component for page header
function Skeleton({ className }) {
  return (
    <div className={cn('animate-pulse bg-muted rounded', className)} />
  );
}

function SkeletonPageHeader() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-64" />
    </div>
  );
}
