import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui';
import { 
  Bot, 
  Activity, 
  CheckCircle, 
  Clock,
  AlertCircle,
  Zap,
  MessageSquare,
  Settings,
  Play,
  Pause,
  MoreVertical
} from 'lucide-react';

export default function AgentTeamDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    // Simulate loading agent data
    setTimeout(() => {
      setData({
        totalAgents: 12,
        activeAgents: 8,
        completedTasks: 156,
        pendingTasks: 23,
        agents: [
          {
            id: 1,
            name: 'Email Triage Agent',
            type: 'Communication',
            status: 'active',
            tasksCompleted: 45,
            lastActivity: '2 minutes ago',
            efficiency: 92,
            description: 'Manages inbox triage and client communication'
          },
          {
            id: 2,
            name: 'Content Writer',
            type: 'Creative',
            status: 'active',
            tasksCompleted: 38,
            lastActivity: '15 minutes ago',
            efficiency: 88,
            description: 'Creates blog posts and marketing copy'
          },
          {
            id: 3,
            name: 'LinkedIn Outreach',
            type: 'Sales',
            status: 'paused',
            tasksCompleted: 23,
            lastActivity: '2 hours ago',
            efficiency: 76,
            description: 'Automated LinkedIn prospecting and outreach'
          },
          {
            id: 4,
            name: 'SEO Blog Writer',
            type: 'Marketing',
            status: 'active',
            tasksCompleted: 31,
            lastActivity: '1 hour ago',
            efficiency: 94,
            description: 'Optimized content creation for search engines'
          },
          {
            id: 5,
            name: 'Cold Email Campaigns',
            type: 'Sales',
            status: 'inactive',
            tasksCompleted: 19,
            lastActivity: '1 day ago',
            efficiency: 67,
            description: 'Automated cold email sequences and follow-ups'
          },
        ],
        recentActivity: [
          { agent: 'Email Triage Agent', action: 'Processed 12 new emails', time: '2 min ago' },
          { agent: 'Content Writer', action: 'Completed blog post draft', time: '15 min ago' },
          { agent: 'SEO Blog Writer', action: 'Optimized 3 articles for keywords', time: '1 hr ago' },
          { agent: 'LinkedIn Outreach', action: 'Sent 25 connection requests', time: '2 hr ago' },
        ],
        performance: {
          avgEfficiency: 83,
          totalTasksToday: 67,
          errorRate: 2.1
        }
      });
      setLoading(false);
    }, 1000);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700';
      case 'paused': return 'bg-yellow-100 text-yellow-700';
      case 'inactive': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'paused': return <Pause className="w-4 h-4 text-yellow-600" />;
      case 'inactive': return <Clock className="w-4 h-4 text-gray-600" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-600" />;
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
          <h1 className="text-2xl font-heading font-bold text-foreground">Agent Team Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and manage your AI agent workforce
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-3 py-2 text-sm bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-colors">
            <Settings className="w-4 h-4" />
            Configure Agents
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Bot className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Agents</p>
              <p className="text-xl font-semibold">{data?.totalAgents || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <Activity className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Now</p>
              <p className="text-xl font-semibold">{data?.activeAgents || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <CheckCircle className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tasks Completed</p>
              <p className="text-xl font-semibold">{data?.completedTasks || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Clock className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending Tasks</p>
              <p className="text-xl font-semibold">{data?.pendingTasks || 0}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-600" />
            <span className="text-sm font-medium">Avg Efficiency</span>
          </div>
          <p className="text-xl font-semibold mt-1">{data?.performance?.avgEfficiency}%</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium">Tasks Today</span>
          </div>
          <p className="text-xl font-semibold mt-1">{data?.performance?.totalTasksToday}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-sm font-medium">Error Rate</span>
          </div>
          <p className="text-xl font-semibold mt-1">{data?.performance?.errorRate}%</p>
        </Card>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agents List */}
        <div className="lg:col-span-2">
          <Card>
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground">Agent Team</h2>
            </div>
            <div className="p-4 space-y-4">
              {data?.agents?.map((agent) => (
                <div key={agent.id} className="flex items-center gap-4 p-4 border border-border rounded-lg">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Bot className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{agent.name}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(agent.status)}`}>
                        {agent.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{agent.tasksCompleted} tasks completed</span>
                      <span>Efficiency: {agent.efficiency}%</span>
                      <span>Last active: {agent.lastActivity}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(agent.status)}
                    <button className="p-1 hover:bg-muted rounded">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
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
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{activity.agent}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
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
    </div>
  );
}