import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Zap, Clock, FileText, FileSignature, AlertTriangle, CheckCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { Button, Card } from '../components/ui';

const TRIGGER_CONFIG = {
  PROPOSAL_APPROVED: {
    icon: CheckCircle,
    color: 'text-green-600 bg-green-50 dark:bg-green-900/20',
    label: 'Proposal Approved'
  },
  CONTRACT_SIGNED: {
    icon: FileSignature,
    color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
    label: 'Contract Signed'
  },
  INVOICE_OVERDUE: {
    icon: Clock,
    color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20',
    label: 'Invoice Overdue'
  },
  INVOICE_OVERDUE_7D: {
    icon: AlertTriangle,
    color: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    label: 'Invoice 7+ Days Overdue'
  }
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
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function ActionBadge({ action }) {
  const colors = {
    created: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    reminded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    escalated: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[action] || 'bg-muted text-muted-foreground'}`}>
      {action}
    </span>
  );
}

export default function Automations() {
  const [page, setPage] = useState(0);
  const limit = 25;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automation-history', page],
    queryFn: () => api.get(`/automations/history?limit=${limit}&offset=${page * limit}`),
    refetchInterval: 60000,
  });

  const automations = data?.automations || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Workflow Automations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated actions triggered by proposals, contracts, and invoices
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} leftIcon={<RefreshCw className="w-4 h-4" />}>
          Refresh
        </Button>
      </div>

      {/* Active Automations Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(TRIGGER_CONFIG).map(([key, config]) => {
          const Icon = config.icon;
          const count = automations.filter(a => a.metadata?.trigger === key).length;
          return (
            <Card key={key} className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${config.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{config.label}</p>
                  <p className="text-xs text-muted-foreground">{count} recent</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Active Rules */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Active Rules</h2>
        <div className="space-y-3">
          {[
            { icon: CheckCircle, color: 'text-green-500', trigger: 'Proposal Approved', action: 'Auto-create draft contract + notify admin' },
            { icon: FileSignature, color: 'text-blue-500', trigger: 'Contract Signed', action: 'Auto-create project + welcome email + notify admin' },
            { icon: Clock, color: 'text-yellow-500', trigger: 'Invoice Overdue', action: 'Send reminder email + notify admin' },
            { icon: AlertTriangle, color: 'text-red-500', trigger: 'Invoice 7+ Days Overdue', action: 'Send escalation email + flag client AT_RISK' },
          ].map(({ icon: Icon, color, trigger, action }) => (
            <div key={trigger} className="flex items-center gap-3 text-sm">
              <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
              <span className="text-muted-foreground">{trigger}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-foreground">{action}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* History */}
      <Card>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Automation History
            {total > 0 && <span className="text-muted-foreground font-normal ml-2">({total} total)</span>}
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">Failed to load automation history</div>
        ) : automations.length === 0 ? (
          <div className="p-12 text-center">
            <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No automation events yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Automations will appear here when proposals are approved, contracts are signed, or invoices become overdue.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {automations.map((event) => {
              const trigger = event.metadata?.trigger || 'UNKNOWN';
              const config = TRIGGER_CONFIG[trigger] || {
                icon: Zap,
                color: 'text-muted-foreground bg-muted',
                label: trigger
              };
              const Icon = config.icon;

              return (
                <div key={event.id} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`p-1.5 rounded-lg ${config.color} mt-0.5`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{config.label}</span>
                        <ActionBadge action={event.action} />
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {event.entityType} <span className="font-medium text-foreground">{event.entityName}</span>
                        {event.metadata?.clientName && (
                          <span> for {event.metadata.clientName}</span>
                        )}
                        {event.metadata?.daysOverdue && (
                          <span className="text-red-500"> ({event.metadata.daysOverdue} days overdue)</span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                      {formatTime(event.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
