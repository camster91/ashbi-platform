import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building,
  Mail,
  FolderOpen,
  MessageSquare,
  User,
  DollarSign,
  Receipt,
  Plus,
  Send,
  CheckCircle,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { formatRelativeTime, getHealthColor, getProjectStatusColor, getProjectStatusLabel, cn } from '../lib/utils';

const invoiceStatusConfig = {
  DRAFT: { color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  SENT: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  PAID: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  OVERDUE: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  VOID: { color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

export default function Client() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.getClient(id),
  });

  const { data: insights } = useQuery({
    queryKey: ['client-insights', id],
    queryFn: () => api.getClientInsights(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!client) {
    return <div className="text-center py-8">Client not found</div>;
  }

  const primaryContact = client.contacts?.find(c => c.isPrimary) || client.contacts?.[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/clients" className="p-2 hover:bg-muted rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-heading font-bold text-foreground">{client.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {client.domain && (
              <span className="text-sm text-muted-foreground">{client.domain}</span>
            )}
            {primaryContact && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" /> {primaryContact.email}
              </span>
            )}
          </div>
        </div>
        <span
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-lg',
            client.status === 'ACTIVE'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : client.status === 'PAUSED'
              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          )}
        >
          {client.status}
        </span>
      </div>

      {/* Quick Actions + Revenue Stats */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate(`/projects?create=true&clientId=${id}`)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Project
        </button>
        {isAdmin && (
          <button
            onClick={() => navigate(`/invoices?create=true&clientId=${id}`)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <Receipt className="w-3.5 h-3.5" /> Send Invoice
          </button>
        )}

        <div className="ml-auto flex items-center gap-4 text-sm">
          {isAdmin && client.totalRevenue > 0 && (
            <div className="flex items-center gap-1.5 text-green-600">
              <DollarSign className="w-4 h-4" />
              <span className="font-medium">${client.totalRevenue.toLocaleString()}</span>
              <span className="text-muted-foreground">total revenue</span>
            </div>
          )}
          {isAdmin && client.outstandingBalance > 0 && (
            <div className="flex items-center gap-1.5 text-orange-600">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-medium">${client.outstandingBalance.toLocaleString()}</span>
              <span className="text-muted-foreground">outstanding</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Projects */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-4 py-3 border-b border-border flex justify-between items-center">
              <h2 className="font-semibold text-foreground">Projects</h2>
              <span className="text-sm text-muted-foreground">
                {client.projects?.length || 0} total
              </span>
            </div>
            {client.projects?.length > 0 ? (
              <ul className="divide-y divide-border">
                {client.projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      to={`/project/${project.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <div className="font-medium text-foreground">{project.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {project._count?.threads || 0} threads,{' '}
                            {project._count?.tasks || 0} tasks
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'px-2 py-0.5 text-xs font-medium rounded-full',
                          getProjectStatusColor(project.status)
                        )}>
                          {getProjectStatusLabel(project.status)}
                        </span>
                        <span
                          className={cn(
                            'px-2 py-1 text-xs font-medium rounded',
                            getHealthColor(project.health)
                          )}
                        >
                          {project.health?.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No projects yet
              </div>
            )}
          </div>

          {/* Invoices */}
          {isAdmin && client.invoices?.length > 0 && (
            <div className="bg-card rounded-xl border border-border">
              <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                <h2 className="font-semibold text-foreground">Invoices</h2>
                <Link to={`/invoices?clientId=${id}`} className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              <ul className="divide-y divide-border">
                {client.invoices.slice(0, 10).map((invoice) => {
                  const displayStatus = invoice.isOverdue ? 'OVERDUE' : invoice.status;
                  const config = invoiceStatusConfig[displayStatus] || invoiceStatusConfig.DRAFT;
                  return (
                    <li key={invoice.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <span className="text-sm font-mono font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">${invoice.total?.toFixed(2)}</span>
                          {invoice.dueDate && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Due {new Date(invoice.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={cn(
                        'px-2 py-0.5 text-xs font-medium rounded-full',
                        config.color
                      )}>
                        {displayStatus}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Recent Threads */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground">Recent Threads</h2>
            </div>
            {client.threads?.length > 0 ? (
              <ul className="divide-y divide-border">
                {client.threads.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      to={`/thread/${thread.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <div className="font-medium text-foreground">{thread.subject}</div>
                          <div className="text-sm text-muted-foreground">
                            {thread.project?.name || 'No project'} -{' '}
                            {thread.assignedTo?.name || 'Unassigned'}
                          </div>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatRelativeTime(thread.lastActivityAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No threads yet
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Contacts */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground">Contacts</h3>
            </div>
            {client.contacts?.length > 0 ? (
              <ul className="divide-y divide-border">
                {client.contacts.map((contact) => (
                  <li key={contact.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm text-foreground">
                          {contact.name}
                          {contact.isPrimary && (
                            <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              Primary
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {contact.email}
                        </div>
                        {contact.role && (
                          <div className="text-xs text-muted-foreground">{contact.role}</div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No contacts
              </div>
            )}
          </div>

          {/* Insights */}
          {insights && (
            <div className="bg-card rounded-xl border border-border">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-foreground">Insights</h3>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <span className="text-sm text-muted-foreground">Recent Threads</span>
                  <p className="font-medium text-foreground">{insights.recentThreadCount}</p>
                </div>
                {insights.sentimentBreakdown &&
                  Object.keys(insights.sentimentBreakdown).length > 0 && (
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Sentiment Breakdown
                      </span>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {Object.entries(insights.sentimentBreakdown).map(
                          ([sentiment, count]) => (
                            <span
                              key={sentiment}
                              className="text-xs bg-muted px-2 py-1 rounded"
                            >
                              {sentiment}: {count}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}
                <div>
                  <span className="text-sm text-muted-foreground">Satisfaction</span>
                  <p className="font-medium capitalize text-foreground">
                    {insights.satisfactionTrend}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Communication Preferences */}
          {client.communicationPrefs &&
            Object.keys(client.communicationPrefs).length > 0 && (
              <div className="bg-card rounded-xl border border-border">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-semibold text-foreground">Communication Preferences</h3>
                </div>
                <div className="p-4 space-y-2 text-sm">
                  {Object.entries(client.communicationPrefs).map(
                    ([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="font-medium text-foreground">{value}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
