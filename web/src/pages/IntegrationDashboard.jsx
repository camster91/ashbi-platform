import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui';
import { 
  Link as LinkIcon, 
  CheckCircle, 
  AlertCircle, 
  Settings,
  Plus,
  Globe,
  Mail,
  MessageSquare,
  Bot,
  Calendar,
  CreditCard,
  Database,
  Shield,
  ExternalLink
} from 'lucide-react';

export default function IntegrationDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    // Simulate loading integration data
    setTimeout(() => {
      setData({
        totalIntegrations: 24,
        connectedIntegrations: 12,
        activeIntegrations: 9,
        integrations: [
          {
            id: 1,
            name: 'Gmail',
            category: 'Email',
            status: 'connected',
            lastSync: '2 minutes ago',
            description: 'Email management and automation',
            icon: Mail,
            color: 'text-red-600',
            bgColor: 'bg-red-100 dark:bg-red-900/30',
            config: { account: 'cameron@ashbi.ca', sync: true }
          },
          {
            id: 2,
            name: 'Discord',
            category: 'Communication',
            status: 'connected',
            lastSync: '5 minutes ago',
            description: 'Team communication and notifications',
            icon: MessageSquare,
            color: 'text-indigo-600',
            bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
            config: { webhook: 'configured', channels: 3 }
          },
          {
            id: 3,
            name: 'OpenClaw',
            category: 'AI Platform',
            status: 'connected',
            lastSync: '1 minute ago',
            description: 'AI agent orchestration and management',
            icon: Bot,
            color: 'text-purple-600',
            bgColor: 'bg-purple-100 dark:bg-purple-900/30',
            config: { agents: 8, active: true }
          },
          {
            id: 4,
            name: 'Shopify',
            category: 'E-commerce',
            status: 'disconnected',
            lastSync: 'Never',
            description: 'E-commerce store management',
            icon: Globe,
            color: 'text-green-600',
            bgColor: 'bg-green-100 dark:bg-green-900/30',
            config: null
          },
          {
            id: 5,
            name: 'Stripe',
            category: 'Payments',
            status: 'connected',
            lastSync: '10 minutes ago',
            description: 'Payment processing and invoicing',
            icon: CreditCard,
            color: 'text-blue-600',
            bgColor: 'bg-blue-100 dark:bg-blue-900/30',
            config: { webhooks: true, live: true }
          },
          {
            id: 6,
            name: 'WordPress',
            category: 'CMS',
            status: 'error',
            lastSync: '2 hours ago',
            description: 'Website content management',
            icon: Globe,
            color: 'text-slate-600',
            bgColor: 'bg-slate-100 dark:bg-slate-900/30',
            config: { sites: 5, error: 'API key expired' }
          },
          {
            id: 7,
            name: 'Google Calendar',
            category: 'Productivity',
            status: 'connected',
            lastSync: '30 minutes ago',
            description: 'Calendar and scheduling integration',
            icon: Calendar,
            color: 'text-orange-600',
            bgColor: 'bg-orange-100 dark:bg-orange-900/30',
            config: { calendars: 3, sync: true }
          },
          {
            id: 8,
            name: 'Airtable',
            category: 'Database',
            status: 'disconnected',
            lastSync: 'Never',
            description: 'Database and project management',
            icon: Database,
            color: 'text-yellow-600',
            bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
            config: null
          }
        ],
        categories: ['Email', 'Communication', 'AI Platform', 'E-commerce', 'Payments', 'CMS', 'Productivity', 'Database'],
        recentActivity: [
          { integration: 'Gmail', action: 'Synced 15 new emails', time: '2 min ago' },
          { integration: 'Discord', action: 'Sent project notification', time: '5 min ago' },
          { integration: 'Stripe', action: 'Processed payment webhook', time: '10 min ago' },
          { integration: 'WordPress', action: 'Failed to sync content', time: '2 hr ago', error: true },
        ]
      });
      setLoading(false);
    }, 1000);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected': return 'bg-green-100 text-green-700';
      case 'error': return 'bg-red-100 text-red-700';
      case 'disconnected': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'connected': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'disconnected': return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
      default: return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  if (loading) {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Integration Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all your third-party integrations and data connections
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />
            Add Integration
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <LinkIcon className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Integrations</p>
              <p className="text-xl font-semibold">{data?.totalIntegrations || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Connected</p>
              <p className="text-xl font-semibold">{data?.connectedIntegrations || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Bot className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-xl font-semibold">{data?.activeIntegrations || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Shield className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Categories</p>
              <p className="text-xl font-semibold">{data?.categories?.length || 0}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Integrations List */}
        <div className="lg:col-span-2">
          <Card>
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground">All Integrations</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data?.integrations?.map((integration) => (
                  <div key={integration.id} className="flex items-center gap-4 p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className={`p-2 rounded-lg ${integration.bgColor}`}>
                      <integration.icon className={`w-6 h-6 ${integration.color}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground">{integration.name}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(integration.status)}`}>
                          {integration.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{integration.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">Last sync: {integration.lastSync}</p>
                      {integration.config && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {integration.name === 'Gmail' && `Account: ${integration.config.account}`}
                          {integration.name === 'Discord' && `Channels: ${integration.config.channels}`}
                          {integration.name === 'OpenClaw' && `Agents: ${integration.config.agents}`}
                          {integration.name === 'WordPress' && integration.config.error && (
                            <span className="text-red-500">Error: {integration.config.error}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(integration.status)}
                      <button className="p-1 hover:bg-muted rounded">
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground">Recent Activity</h2>
          </div>
          <div className="p-4">
            {data?.recentActivity?.map((activity, index) => (
              <div key={index} className="flex items-start gap-3 py-3 border-b border-border last:border-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  activity.error ? 'bg-red-100 dark:bg-red-900/30' : 'bg-primary/10'
                }`}>
                  <LinkIcon className={`w-4 h-4 ${activity.error ? 'text-red-600' : 'text-primary'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{activity.integration}</span>
                  </p>
                  <p className={`text-xs mt-0.5 ${activity.error ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {activity.action}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activity.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Integration Categories */}
      <Card>
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-foreground">Available Categories</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data?.categories?.map((category, index) => (
              <div key={index} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="p-2 rounded-lg bg-muted">
                  {category === 'Email' && <Mail className="w-4 h-4" />}
                  {category === 'Communication' && <MessageSquare className="w-4 h-4" />}
                  {category === 'AI Platform' && <Bot className="w-4 h-4" />}
                  {category === 'E-commerce' && <Globe className="w-4 h-4" />}
                  {category === 'Payments' && <CreditCard className="w-4 h-4" />}
                  {category === 'CMS' && <Globe className="w-4 h-4" />}
                  {category === 'Productivity' && <Calendar className="w-4 h-4" />}
                  {category === 'Database' && <Database className="w-4 h-4" />}
                </div>
                <div>
                  <p className="font-medium text-foreground">{category}</p>
                  <p className="text-xs text-muted-foreground">
                    {data?.integrations?.filter(i => i.category === category).length} integrations
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}