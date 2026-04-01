import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Building, FolderOpen, MessageSquare, Users, ChevronRight, Plus, Heart, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import CreateClientModal from '../components/CreateClientModal';

export default function Clients() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showHealth, setShowHealth] = useState(false);

  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['client-health'],
    queryFn: () => api.getClientHealth(),
    enabled: showHealth,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Clients</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowHealth(!showHealth); if (!showHealth) refetchHealth(); }}
            className={cn(
              'px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors',
              showHealth
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <Heart className="w-4 h-4" />
            Health
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </button>
        </div>
      </div>

      {/* Client Health Dashboard */}
      {showHealth && (
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-primary" />
              <h2 className="font-heading font-semibold text-foreground">Client Health</h2>
            </div>
            {healthLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {healthData?.clients?.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {healthData.clients.map((client) => {
                const color = client.score >= 80 ? 'green' : client.score >= 50 ? 'yellow' : 'red';
                const colorClasses = {
                  green: 'border-green-500/30 bg-green-50 dark:bg-green-950/20',
                  yellow: 'border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20',
                  red: 'border-red-500/30 bg-red-50 dark:bg-red-950/20'
                };
                const scoreClasses = {
                  green: 'text-green-700 dark:text-green-400',
                  yellow: 'text-yellow-700 dark:text-yellow-400',
                  red: 'text-red-700 dark:text-red-400'
                };
                // Find the client's first project to navigate to
                const matchedClient = clients?.find(c => c.id === client.id);
                return (
                  <button
                    key={client.id}
                    onClick={() => navigate(`/client/${client.id}`)}
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all hover:shadow-md',
                      colorClasses[color]
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm text-foreground truncate">{client.name}</span>
                      <span className={cn('text-lg font-bold', scoreClasses[color])}>
                        {client.score}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {client.daysSinceContact !== null && (
                        <div>Last contact: {client.daysSinceContact}d ago</div>
                      )}
                      <div>Open tasks: {client.openTasks}</div>
                      {client.overdueTasks > 0 && (
                        <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertTriangle className="w-3 h-3" />
                          {client.overdueTasks} overdue
                        </div>
                      )}
                      {client.retainerPct !== null && (
                        <div>Retainer: {client.retainerPct}% used</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !healthLoading ? (
            <p className="text-sm text-muted-foreground">No active clients found.</p>
          ) : null}
        </div>
      )}

      <CreateClientModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Projects</th>
              <th className="px-4 py-3 font-medium">Threads</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {clients?.map((client) => (
              <tr key={client.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center font-medium">
                      {client.name[0]}
                    </div>
                    <div>
                      <div className="font-medium">{client.name}</div>
                      <div className="text-sm text-gray-500">
                        {client._count?.contacts || 0} contacts
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {client.domain || '-'}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1">
                    <FolderOpen className="w-4 h-4 text-gray-400" />
                    {client._count?.projects || 0}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-4 h-4 text-gray-400" />
                    {client._count?.threads || 0}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded',
                      client.status === 'ACTIVE'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {client.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={`/client/${client.id}`}
                    className="text-primary hover:text-primary/80"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {clients?.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No clients yet. Add your first client to get started.
        </div>
      )}
    </div>
  );
}
