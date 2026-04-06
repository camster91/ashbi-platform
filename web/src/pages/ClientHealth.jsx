import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Heart,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Zap,
  DollarSign,
  MessageSquare,
  Activity,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const STATUS_CONFIG = {
  HEALTHY: { label: 'Healthy', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', bar: 'bg-green-500', icon: CheckCircle },
  FAIR: { label: 'Fair', color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', bar: 'bg-yellow-400', icon: Activity },
  AT_RISK: { label: 'At Risk', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', bar: 'bg-orange-500', icon: AlertTriangle },
  CRITICAL: { label: 'Critical', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', bar: 'bg-red-500', icon: XCircle },
};

const PRIORITY_CONFIG = {
  HIGH: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  MEDIUM: { color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  LOW: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
};

function ScoreBar({ score, status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.FAIR;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${cfg.bar}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${cfg.color}`}>{score}</span>
    </div>
  );
}

function BreakdownBar({ label, score, icon: Icon }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-400' : score >= 40 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      {Icon && <Icon className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
      <span className="text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 text-right font-medium">{score}</span>
    </div>
  );
}

function ClientRow({ client, expanded, onToggle }) {
  const cfg = STATUS_CONFIG[client.healthStatus] || STATUS_CONFIG.FAIR;
  const StatusIcon = cfg.icon;

  return (
    <div className={`border rounded-lg overflow-hidden ${cfg.border}`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <StatusIcon className={`w-4 h-4 flex-shrink-0 ${cfg.color}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-foreground">{client.clientName}</span>
              {client.clientDomain && (
                <span className="text-xs text-muted-foreground">{client.clientDomain}</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color} ${cfg.bg}`}>
                {cfg.label}
              </span>
            </div>
            <ScoreBar score={client.healthScore} status={client.healthStatus} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {client.recommendations?.length > 0 && (
              <span className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">
                {client.recommendations.length} action{client.recommendations.length > 1 ? 's' : ''}
              </span>
            )}
            {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className={`px-4 pb-4 pt-1 border-t ${cfg.border} ${cfg.bg}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Score breakdown */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score Breakdown</p>
              <BreakdownBar label="Payment" score={client.breakdown?.paymentScore ?? 0} icon={DollarSign} />
              <BreakdownBar label="Activity" score={client.breakdown?.activityScore ?? 0} icon={Activity} />
              <BreakdownBar label="Comms" score={client.breakdown?.communicationScore ?? 0} icon={MessageSquare} />
              <BreakdownBar label="Retainer" score={client.breakdown?.retainerScore ?? 0} icon={TrendingDown} />
            </div>

            {/* Details + recommendations */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-background/60 rounded p-2">
                  <p className="text-muted-foreground">Overdue invoices</p>
                  <p className={`font-semibold ${client.details?.overdueInvoices > 0 ? 'text-red-600' : 'text-foreground'}`}>
                    {client.details?.overdueInvoices ?? 0}
                    {client.details?.overdueAmount > 0 && ` ($${client.details.overdueAmount.toLocaleString()})`}
                  </p>
                </div>
                <div className="bg-background/60 rounded p-2">
                  <p className="text-muted-foreground">Active projects</p>
                  <p className="font-semibold">{client.details?.activeProjects ?? 0}</p>
                </div>
                <div className="bg-background/60 rounded p-2">
                  <p className="text-muted-foreground">Recent threads</p>
                  <p className="font-semibold">{client.details?.recentThreads ?? 0}</p>
                </div>
                <div className="bg-background/60 rounded p-2">
                  <p className="text-muted-foreground">Retainer</p>
                  <p className={`font-semibold ${client.details?.hasRetainer ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {client.details?.hasRetainer ? 'Active' : 'None'}
                  </p>
                </div>
              </div>

              {client.recommendations?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recommendations</p>
                  {client.recommendations.map((rec, i) => (
                    <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                      <Zap className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                      {rec}
                    </p>
                  ))}
                </div>
              )}

              <Link
                to={`/client/${client.clientId}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View client <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientHealth() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('ALL'); // ALL | HEALTHY | FAIR | AT_RISK | CRITICAL
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [showRecommendations, setShowRecommendations] = useState(true);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['client-health-dashboard'],
    queryFn: () => api.getClientHealthDashboard('ALL'),
    staleTime: 2 * 60 * 1000, // 2 min
  });

  const { data: recommendations = { actions: [] } } = useQuery({
    queryKey: ['client-health-recommendations'],
    queryFn: () => api.getClientHealthRecommendations(),
    staleTime: 2 * 60 * 1000,
  });

  const recalcMutation = useMutation({
    mutationFn: () => api.recalculateClientHealth(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-health-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['client-health-recommendations'] });
    },
  });

  const toggleExpanded = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clients = data?.clients || [];
  const summary = data?.summary || {};

  const filtered = filter === 'ALL'
    ? clients
    : clients.filter(c => c.healthStatus === filter);

  const highPriorityActions = recommendations.actions?.filter(a => a.priority === 'HIGH') || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Client Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor engagement, payment history, and churn risk across all clients
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} leftIcon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={recalcMutation.isPending}
            onClick={() => recalcMutation.mutate()}
            leftIcon={<Heart className="w-4 h-4" />}
          >
            Recalculate
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {!isLoading && summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { key: 'ALL', label: 'Total', value: summary.total, color: 'text-foreground' },
            { key: 'HEALTHY', label: 'Healthy', value: summary.healthy, color: 'text-green-600' },
            { key: 'FAIR', label: 'Fair', value: summary.fair, color: 'text-yellow-600' },
            { key: 'AT_RISK', label: 'At Risk', value: summary.atRisk, color: 'text-orange-600' },
            { key: 'CRITICAL', label: 'Critical', value: summary.critical, color: 'text-red-600' },
          ].map(({ key, label, value, color }) => (
            <Card
              key={key}
              className={`p-4 cursor-pointer transition-all hover:ring-2 hover:ring-primary/30 ${filter === key ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setFilter(key)}
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value ?? 0}</p>
              {key === 'ALL' && summary.avgScore !== undefined && (
                <p className="text-xs text-muted-foreground mt-1">avg score {summary.avgScore}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* High-priority action strip */}
      {highPriorityActions.length > 0 && showRecommendations && (
        <Card className="p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                {highPriorityActions.length} urgent action{highPriorityActions.length > 1 ? 's' : ''} needed
              </span>
            </div>
            <button
              onClick={() => setShowRecommendations(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {highPriorityActions.slice(0, 5).map((action, i) => (
              <div key={i} className="flex items-start gap-2">
                <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <Link
                    to={`/client/${action.clientId}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {action.clientName}
                  </Link>
                  <span className="text-muted-foreground"> — {action.action}</span>
                </div>
              </div>
            ))}
            {highPriorityActions.length > 5 && (
              <p className="text-xs text-muted-foreground pl-5">
                +{highPriorityActions.length - 5} more...
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Filter pills */}
      {!isLoading && clients.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {['ALL', 'CRITICAL', 'AT_RISK', 'FAIR', 'HEALTHY'].map(key => {
            const cfg = STATUS_CONFIG[key];
            const count = key === 'ALL' ? clients.length : clients.filter(c => c.healthStatus === key).length;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filter === key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {cfg ? cfg.label : 'All'} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Client list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Heart className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">
            {filter === 'ALL' ? 'No clients found' : `No ${STATUS_CONFIG[filter]?.label.toLowerCase()} clients`}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {filter !== 'ALL' ? 'Try a different filter.' : 'Add clients to start tracking health.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(client => (
            <ClientRow
              key={client.clientId}
              client={client}
              expanded={expandedIds.has(client.clientId)}
              onToggle={() => toggleExpanded(client.clientId)}
            />
          ))}
        </div>
      )}

      {/* Full recommendations panel */}
      {recommendations.actions?.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">All Recommendations</h2>
            <span className="text-xs text-muted-foreground">
              {recommendations.highPriority} high · {recommendations.totalActions} total
            </span>
          </div>
          <div className="space-y-2">
            {recommendations.actions.map((action, i) => {
              const pcfg = PRIORITY_CONFIG[action.priority] || PRIORITY_CONFIG.LOW;
              return (
                <div key={i} className={`flex items-start gap-3 p-2 rounded-lg ${pcfg.bg}`}>
                  <Zap className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${pcfg.color}`} />
                  <div className="flex-1 text-xs">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <Link to={`/client/${action.clientId}`} className="font-medium hover:text-primary">
                        {action.clientName}
                      </Link>
                      <span className={`font-medium ${pcfg.color}`}>{action.priority}</span>
                      <span className="text-muted-foreground">· score {action.healthScore}</span>
                    </div>
                    <p className="text-muted-foreground">{action.action}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
