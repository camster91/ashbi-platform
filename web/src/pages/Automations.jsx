import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Zap, Clock, FileText, FileSignature, AlertTriangle, CheckCircle, ArrowRight, RefreshCw } from 'lucide-react';

const TRIGGER_CONFIG = {
  PROPOSAL_APPROVED: {
    icon: CheckCircle,
    color: 'text-green-600 bg-green-50',
    label: 'Proposal Approved'
  },
  CONTRACT_SIGNED: {
    icon: FileSignature,
    color: 'text-blue-600 bg-blue-50',
    label: 'Contract Signed'
  },
  INVOICE_OVERDUE: {
    icon: Clock,
    color: 'text-yellow-600 bg-yellow-50',
    label: 'Invoice Overdue'
  },
  INVOICE_OVERDUE_7D: {
    icon: AlertTriangle,
    color: 'text-red-600 bg-red-50',
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function ActionBadge({ action }) {
  const colors = {
    created: 'bg-green-100 text-green-700',
    reminded: 'bg-yellow-100 text-yellow-700',
    escalated: 'bg-red-100 text-red-700'
  };

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[action] || 'bg-gray-100 text-gray-700'}`}>
      {action}
    </span>
  );
}

export default function Automations() {
  const [page, setPage] = useState(0);
  const limit = 25;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automation-history', page],
    queryFn: () => api.get(`/automations/history?limit=${limit}&offset=${page * limit}`)
  });

  const automations = data?.automations || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Workflow Automations
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Automated actions triggered by proposals, contracts, and invoices
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Active Automations Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(TRIGGER_CONFIG).map(([key, config]) => {
          const Icon = config.icon;
          const count = automations.filter(a => a.metadata?.trigger === key).length;
          return (
            <div key={key} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${config.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{config.label}</p>
                  <p className="text-xs text-gray-500">{count} recent</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Automation Rules Info */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Active Rules</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            <span className="text-gray-600">Proposal Approved</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="text-gray-900">Auto-create draft contract + notify admin</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <FileSignature className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <span className="text-gray-600">Contract Signed</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="text-gray-900">Auto-create project + welcome email + notify admin</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Clock className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            <span className="text-gray-600">Invoice Overdue</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="text-gray-900">Send reminder email + notify admin</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-gray-600">Invoice 7+ Days Overdue</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="text-gray-900">Send escalation email + flag client AT_RISK</span>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            Automation History
            {total > 0 && <span className="text-gray-400 font-normal ml-2">({total} total)</span>}
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">
            Failed to load automation history
          </div>
        ) : automations.length === 0 ? (
          <div className="p-12 text-center">
            <Zap className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No automation events yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Automations will appear here when proposals are approved, contracts are signed, or invoices become overdue.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {automations.map((event) => {
              const trigger = event.metadata?.trigger || 'UNKNOWN';
              const config = TRIGGER_CONFIG[trigger] || {
                icon: Zap,
                color: 'text-gray-600 bg-gray-50',
                label: trigger
              };
              const Icon = config.icon;

              return (
                <div key={event.id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`p-1.5 rounded-lg ${config.color} mt-0.5`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {config.label}
                        </span>
                        <ActionBadge action={event.action} />
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {event.entityType} <span className="font-medium">{event.entityName}</span>
                        {event.metadata?.clientName && (
                          <span className="text-gray-400"> for {event.metadata.clientName}</span>
                        )}
                        {event.metadata?.daysOverdue && (
                          <span className="text-red-500"> ({event.metadata.daysOverdue} days overdue)</span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {formatTime(event.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
