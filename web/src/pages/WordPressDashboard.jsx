import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui';
import { 
  Globe, 
  FileText, 
  Users, 
  Shield,
  Zap,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  TrendingUp
} from 'lucide-react';

export default function WordPressDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    // Simulate loading WordPress data
    setTimeout(() => {
      setData({
        sitesCount: 8,
        totalPosts: 324,
        totalUsers: 156,
        securityScore: 85,
        sites: [
          { 
            name: 'ashbi.ca', 
            status: 'online', 
            version: '6.4.2', 
            securityScore: 92,
            lastUpdate: '2 hours ago',
            pageSpeed: 87 
          },
          { 
            name: 'client1.com', 
            status: 'online', 
            version: '6.3.1', 
            securityScore: 78,
            lastUpdate: '1 day ago',
            pageSpeed: 72 
          },
          { 
            name: 'client2.ca', 
            status: 'maintenance', 
            version: '6.4.2', 
            securityScore: 95,
            lastUpdate: '3 hours ago',
            pageSpeed: 91 
          },
        ],
        securityIssues: [
          { site: 'client1.com', issue: 'Outdated plugins', severity: 'medium' },
          { site: 'client2.ca', issue: 'SSL certificate expires soon', severity: 'high' },
        ],
        performance: {
          avgLoadTime: 2.1,
          avgPageSpeed: 83,
          uptime: 99.8
        }
      });
      setLoading(false);
    }, 1000);
  }, []);

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
          <h1 className="text-2xl font-heading font-bold text-foreground">WordPress Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor all client WordPress sites and security status
          </p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
          <RefreshCw className="w-4 h-4" />
          Refresh Sites
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Globe className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Sites</p>
              <p className="text-xl font-semibold">{data?.sitesCount || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <FileText className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Posts</p>
              <p className="text-xl font-semibold">{data?.totalPosts || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Users</p>
              <p className="text-xl font-semibold">{data?.totalUsers || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Shield className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Security Score</p>
              <p className="text-xl font-semibold">{data?.securityScore || 0}%</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-600" />
            <span className="text-sm font-medium">Avg Load Time</span>
          </div>
          <p className="text-xl font-semibold mt-1">{data?.performance?.avgLoadTime}s</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium">Avg Page Speed</span>
          </div>
          <p className="text-xl font-semibold mt-1">{data?.performance?.avgPageSpeed}/100</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium">Uptime</span>
          </div>
          <p className="text-xl font-semibold mt-1">{data?.performance?.uptime}%</p>
        </Card>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sites Overview */}
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground">Sites Overview</h2>
          </div>
          <div className="p-4">
            {data?.sites?.map((site, index) => (
              <div key={index} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{site.name}</p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      site.status === 'online' ? 'bg-green-100 text-green-700' :
                      site.status === 'maintenance' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {site.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">WP {site.version} • Updated {site.lastUpdate}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">Security: {site.securityScore}%</p>
                  <p className="text-sm text-muted-foreground">Speed: {site.pageSpeed}/100</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Security Issues */}
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground">Security Issues</h2>
          </div>
          <div className="p-4">
            {data?.securityIssues?.length > 0 ? (
              data.securityIssues.map((issue, index) => (
                <div key={index} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                  <AlertTriangle className={`w-4 h-4 ${
                    issue.severity === 'high' ? 'text-red-500' :
                    issue.severity === 'medium' ? 'text-yellow-500' :
                    'text-blue-500'
                  }`} />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{issue.site}</p>
                    <p className="text-sm text-muted-foreground">{issue.issue}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    issue.severity === 'high' ? 'bg-red-100 text-red-700' :
                    issue.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {issue.severity}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p>No security issues detected</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Integration Notice */}
      <Card className="p-4 border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-900/10">
        <div className="flex items-start gap-3">
          <Globe className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-800 dark:text-blue-200">WordPress Management</h3>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Connect your WordPress sites for automated monitoring, security scans, and performance tracking.
            </p>
            <button className="flex items-center gap-1 mt-2 text-sm text-blue-800 dark:text-blue-200 hover:underline">
              <ExternalLink className="w-4 h-4" />
              Connect WordPress sites
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}