// /admin/command-center — Unified Hub Dashboard
// Aggregates: GitHub CI, VPS health, all sites, active agents, today's tasks
// Auto-refreshes every 60 seconds

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Github, Server, Globe, Bot, CheckSquare,
  AlertTriangle, CheckCircle, XCircle, Clock, ExternalLink,
  Play, RotateCcw, ChevronDown, ChevronUp, Wifi, WifiOff,
  Activity, Zap, Database, Code2
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import api from '../lib/api';

const REFRESH_INTERVAL = 60_000; // 60 seconds

// ─── Status dot helpers ────────────────────────────────────────────────────────
const healthClasses = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  unknown: 'bg-muted-foreground/50',
};

const healthBorder = {
  green: 'border-green-500/30',
  yellow: 'border-yellow-400/30',
  red: 'border-red-500/30',
  unknown: 'border-border',
};

function StatusDot({ health = 'unknown', size = 'sm', animate = false }) {
  const sizes = { xs: 'w-1.5 h-1.5', sm: 'w-2.5 h-2.5', md: 'w-3.5 h-3.5' };
  return (
    <span className={`inline-block rounded-full flex-shrink-0 ${sizes[size]} ${healthClasses[health] || healthClasses.unknown} ${animate && health === 'red' ? 'animate-pulse' : ''}`} />
  );
}

function SectionCard({ title, icon: Icon, health, children, loading, actions, collapsible = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const borderClass = healthBorder[health] || healthBorder.unknown;

  return (
    <Card className={`border-2 ${borderClass} bg-card`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {health && <StatusDot health={health} size="md" animate={health === 'red'} />}
            <Icon className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">{title}</CardTitle>
            {loading && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {collapsible && (
              <button
                onClick={() => setCollapsed(c => !c)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      {!collapsed && <CardContent className="pt-3">{children}</CardContent>}
    </Card>
  );
}

function Badge({ children, variant = 'default' }) {
  const styles = {
    default: 'bg-muted text-muted-foreground',
    green: 'bg-green-500/10 text-green-600 dark:text-green-400',
    yellow: 'bg-yellow-400/10 text-yellow-600 dark:text-yellow-400',
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

function TimeAgo({ date }) {
  if (!date) return <span className="text-muted-foreground text-xs">—</span>;
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  let label = '';
  if (mins < 2) label = 'just now';
  else if (mins < 60) label = `${mins}m ago`;
  else if (hrs < 24) label = `${hrs}h ago`;
  else label = `${days}d ago`;
  return <span className="text-muted-foreground text-xs">{label}</span>;
}

// ─── GitHub Panel ──────────────────────────────────────────────────────────────
function GithubPanel({ data, loading, onRefresh }) {
  const health = data?.health || 'unknown';

  return (
    <SectionCard
      title="GitHub"
      icon={Github}
      health={health}
      loading={loading}
      collapsible
      actions={
        <button onClick={onRefresh} className="p-1 hover:text-foreground text-muted-foreground" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      }
    >
      {data?.error && <p className="text-red-400 text-sm">{data.error}</p>}
      <div className="flex gap-4 mb-3 text-sm">
        <span className="text-muted-foreground">Open PRs: <strong className={data?.openPRCount > 0 ? 'text-yellow-400' : 'text-foreground'}>{data?.openPRCount ?? '—'}</strong></span>
        <span className="text-muted-foreground">Failing CI: <strong className={data?.failingCI > 0 ? 'text-red-400' : 'text-foreground'}>{data?.failingCI ?? 0}</strong></span>
      </div>
      {data?.recentRepos?.length > 0 && (
        <div className="space-y-1.5">
          {data.recentRepos.map(repo => (
            <div key={repo.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
                <a
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary font-medium"
                >
                  {repo.name}
                </a>
              </div>
              <TimeAgo date={repo.pushedAt} />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── VPS Panel ─────────────────────────────────────────────────────────────────
function VpsPanel({ data, loading, onRefresh, onRestart }) {
  const health = data?.health || 'unknown';

  return (
    <SectionCard
      title="VPS / Coolify"
      icon={Server}
      health={health}
      loading={loading}
      collapsible
      actions={
        <button onClick={onRefresh} className="p-1 hover:text-foreground text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      }
    >
      {data?.error && <p className="text-red-400 text-sm">{data.error}</p>}
      {data && !data.error && (
        <>
          <div className="flex gap-3 mb-3 text-sm flex-wrap">
            <Badge variant="green">✓ {data.running ?? 0} running</Badge>
            {data.stopped > 0 && <Badge variant="yellow">⏸ {data.stopped} stopped</Badge>}
            {data.errored > 0 && <Badge variant="red">✕ {data.errored} errored</Badge>}
          </div>
          <div className="space-y-1.5">
            {data.apps?.map(app => (
              <div key={app.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <StatusDot health={statusToHealth(app.status)} size="xs" />
                  <span className="font-medium truncate max-w-40">{app.name}</span>
                  {app.fqdn && (
                    <a href={`https://${app.fqdn}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs capitalize">{app.status || 'unknown'}</span>
                  {onRestart && (
                    <button
                      onClick={() => onRestart(app.uuid || app.name)}
                      className="p-0.5 hover:text-primary text-muted-foreground"
                      title="Restart"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─── Sites Panel ───────────────────────────────────────────────────────────────
function SitesPanel({ data, loading, onRefresh }) {
  const health = !data ? 'unknown'
    : data.summary?.critical > 0 ? 'red'
    : data.summary?.warning > 0 ? 'yellow'
    : 'green';

  return (
    <SectionCard
      title="Hostinger Sites"
      icon={Globe}
      health={health}
      loading={loading}
      collapsible
      actions={
        <button onClick={onRefresh} className="p-1 hover:text-foreground text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      }
    >
      {data?.error && <p className="text-red-400 text-sm">{data.error}</p>}
      {data?.summary && (
        <div className="flex gap-3 mb-3 flex-wrap">
          <Badge variant="green">✓ {data.summary.healthy} up</Badge>
          {data.summary.warning > 0 && <Badge variant="yellow">⚠ {data.summary.warning} warn</Badge>}
          {data.summary.critical > 0 && <Badge variant="red">✕ {data.summary.critical} down</Badge>}
        </div>
      )}
      <div className="space-y-1.5">
        {data?.sites?.map(site => (
          <div key={site.domain} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <StatusDot health={site.health} size="xs" animate={site.health === 'red'} />
              <a
                href={`https://${site.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary font-medium"
              >
                {site.domain}
              </a>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              {site.latencyMs && <span>{site.latencyMs}ms</span>}
              {site.status && typeof site.status === 'number' && (
                <Badge variant={site.status >= 500 ? 'red' : site.status >= 400 ? 'yellow' : 'green'}>
                  {site.status}
                </Badge>
              )}
            </div>
          </div>
        ))}
        {(!data?.sites || data.sites.length === 0) && !loading && (
          <p className="text-muted-foreground text-sm">No sites configured. Set <code className="text-xs">HOSTINGER_ASHBI_SITES</code> env var.</p>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Agents Panel ──────────────────────────────────────────────────────────────
function AgentsPanel({ data, loading, onRefresh, onRunAgent }) {
  const [running, setRunning] = useState({});

  const handleRun = async (name) => {
    setRunning(r => ({ ...r, [name]: true }));
    try {
      await onRunAgent(name);
    } finally {
      setTimeout(() => setRunning(r => ({ ...r, [name]: false })), 2000);
    }
  };

  return (
    <SectionCard
      title="AI Agents"
      icon={Bot}
      health={data?.openclawRunning ? 'green' : 'yellow'}
      loading={loading}
      collapsible
      actions={
        <button onClick={onRefresh} className="p-1 hover:text-foreground text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      }
    >
      <div className="flex items-center gap-2 mb-3">
        {data?.openclawRunning ? (
          <><Wifi className="w-3.5 h-3.5 text-green-500" /><span className="text-sm text-green-500">OpenClaw online</span></>
        ) : (
          <><WifiOff className="w-3.5 h-3.5 text-yellow-400" /><span className="text-sm text-yellow-400">OpenClaw status unknown</span></>
        )}
      </div>
      <div className="space-y-2">
        {data?.agents?.map(agent => (
          <div key={agent.name} className="flex items-center justify-between text-sm">
            <div>
              <p className="font-medium">{agent.displayName}</p>
              <p className="text-xs text-muted-foreground">{agent.description}</p>
            </div>
            <button
              onClick={() => handleRun(agent.name)}
              disabled={running[agent.name]}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50"
            >
              {running[agent.name] ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {running[agent.name] ? 'Running...' : 'Run'}
            </button>
          </div>
        ))}
      </div>
      {data?.recentLogs?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-1.5">Recent logs:</p>
          <div className="flex flex-wrap gap-1">
            {data.recentLogs.map(log => (
              <Badge key={log.date} variant="default">{log.date}</Badge>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Tasks Panel ───────────────────────────────────────────────────────────────
function TasksPanel({ data, loading }) {
  const navigate = useNavigate();
  const priorityColor = { CRITICAL: 'red', HIGH: 'yellow', NORMAL: 'blue', LOW: 'default' };

  return (
    <SectionCard
      title="Today's Tasks"
      icon={CheckSquare}
      health={data?.health || 'unknown'}
      loading={loading}
    >
      {data && (
        <div className="flex gap-3 mb-3 flex-wrap text-sm">
          <span className="text-muted-foreground">Today: <strong>{data.todayCount ?? 0}</strong></span>
          <span className="text-muted-foreground">In Progress: <strong>{data.inProgressCount ?? 0}</strong></span>
          {data.overdueCount > 0 && (
            <Badge variant="red">⚠ {data.overdueCount} overdue</Badge>
          )}
        </div>
      )}
      <div className="space-y-2">
        {data?.todayTasks?.map(task => (
          <div
            key={task.id}
            onClick={() => navigate(`/task/${task.id}`)}
            className="flex items-start justify-between text-sm cursor-pointer hover:bg-muted/50 rounded p-1.5 -mx-1.5"
          >
            <div>
              <p className="font-medium leading-tight">{task.title}</p>
              {task.project && <p className="text-xs text-muted-foreground">{task.project}</p>}
            </div>
            <div className="flex items-center gap-1 ml-2 flex-shrink-0">
              <Badge variant={priorityColor[task.priority] || 'default'}>{task.priority}</Badge>
            </div>
          </div>
        ))}
        {(!data?.todayTasks || data.todayTasks.length === 0) && !loading && (
          <p className="text-muted-foreground text-sm">No tasks due today 🎉</p>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function CommandCenter() {
  const [data, setData] = useState(null);
  const [githubDetailed, setGithubDetailed] = useState(null);
  const [vpsDetailed, setVpsDetailed] = useState(null);
  const [sitesData, setSitesData] = useState(null);
  const [agentsData, setAgentsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Main aggregate
      const [center, sites, agents] = await Promise.allSettled([
        api.getCommandCenter(),
        api.getHostingerSites(),
        api.getAgentsStatus(),
      ]);

      if (center.status === 'fulfilled') setData(center.value);
      if (sites.status === 'fulfilled') setSitesData(sites.value);
      if (agents.status === 'fulfilled') setAgentsData(agents.value);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchAll]);

  const refreshPanel = async (panel, fetchFn, setter) => {
    setPanelLoading(p => ({ ...p, [panel]: true }));
    try {
      const result = await fetchFn();
      setter(result);
    } catch (err) {
      console.error(`Panel ${panel} refresh failed:`, err);
    } finally {
      setPanelLoading(p => ({ ...p, [panel]: false }));
    }
  };

  const handleRestartApp = async (uuid) => {
    try {
      await api.restartApp(uuid);
      setTimeout(() => refreshPanel('vps', api.getVpsHealth, setVpsDetailed), 3000);
    } catch (err) {
      alert(`Restart failed: ${err.message}`);
    }
  };

  const handleRunAgent = async (name) => {
    try {
      await api.runAgent(name);
    } catch (err) {
      alert(`Failed to run agent: ${err.message}`);
    }
  };

  // Derive VPS data — prefer detailed if loaded, else fall back to command center
  const vpsData = vpsDetailed || (data?.vps ? { ...data.vps, apps: data.vps.apps || [] } : null);
  const githubData = githubDetailed || data?.github;
  const tasksData = data?.tasks;

  const overallHealth = deriveOverallHealth({ github: githubData, vps: vpsData, sites: sitesData, tasks: tasksData });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Single pane of glass — auto-refreshes every 60s
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground">
              Last: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <StatusDot health={overallHealth} size="md" animate={overallHealth === 'red'} />
            <span className="text-sm font-medium capitalize">{overallHealth}</span>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          ⚠ {error}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile
          label="GitHub"
          icon={Github}
          health={githubData?.health || 'unknown'}
          value={githubData ? `${githubData.openPRCount ?? 0} PRs` : '—'}
          sub={githubData?.recentRepos?.[0]?.name || 'loading'}
        />
        <SummaryTile
          label="VPS Apps"
          icon={Server}
          health={vpsData?.health || 'unknown'}
          value={vpsData ? `${vpsData.running ?? 0}/${vpsData.total ?? 0}` : '—'}
          sub="running"
        />
        <SummaryTile
          label="Sites"
          icon={Globe}
          health={sitesData ? (sitesData.summary?.critical > 0 ? 'red' : sitesData.summary?.warning > 0 ? 'yellow' : 'green') : 'unknown'}
          value={sitesData ? `${sitesData.summary?.healthy ?? 0}/${sitesData.summary?.total ?? 0}` : '—'}
          sub="up"
        />
        <SummaryTile
          label="Tasks"
          icon={CheckSquare}
          health={tasksData?.health || 'unknown'}
          value={tasksData ? `${tasksData.todayCount ?? 0} today` : '—'}
          sub={tasksData?.overdueCount > 0 ? `${tasksData.overdueCount} overdue` : 'on track'}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <GithubPanel
          data={githubData}
          loading={loading || panelLoading.github}
          onRefresh={() => refreshPanel('github', api.getGithubRepos, setGithubDetailed)}
        />

        <VpsPanel
          data={vpsData}
          loading={loading || panelLoading.vps}
          onRefresh={() => refreshPanel('vps', api.getVpsHealth, setVpsDetailed)}
          onRestart={handleRestartApp}
        />

        <SitesPanel
          data={sitesData}
          loading={loading || panelLoading.sites}
          onRefresh={() => refreshPanel('sites', api.getHostingerSites, setSitesData)}
        />

        <AgentsPanel
          data={agentsData}
          loading={loading || panelLoading.agents}
          onRefresh={() => refreshPanel('agents', api.getAgentsStatus, setAgentsData)}
          onRunAgent={handleRunAgent}
        />

        <TasksPanel
          data={tasksData}
          loading={loading}
        />

        {/* Notion / Quick Actions */}
        <SectionCard title="Quick Actions" icon={Zap} collapsible>
          <div className="space-y-2">
            <ActionButton
              icon={Database}
              label="Sync Notion → Hub"
              description="Pull latest tasks from Notion"
              onClick={() => window.location.href = '/admin/settings/ai-context'}
            />
            <ActionButton
              icon={Github}
              label="View All Repos"
              description="Browse GitHub repositories"
              onClick={() => window.open(`https://github.com/camster91`, '_blank')}
            />
            <ActionButton
              icon={Server}
              label="Open Coolify"
              description="Manage deployments"
              onClick={() => window.open('http://187.77.26.99:8000', '_blank')}
            />
            <ActionButton
              icon={Bot}
              label="Run Overnight Batch"
              description="Email triage + Upwork checks"
              onClick={() => handleRunAgent('overnight-batch')}
            />
          </div>
        </SectionCard>
      </div>

      {/* Footer */}
      <p className="text-xs text-muted-foreground text-center">
        hub.ashbi.ca command center · auto-refresh {REFRESH_INTERVAL / 1000}s
      </p>
    </div>
  );
}

function SummaryTile({ label, icon: Icon, health, value, sub }) {
  const bg = {
    green: 'bg-green-500/5 border-green-500/20',
    yellow: 'bg-yellow-400/5 border-yellow-400/20',
    red: 'bg-red-500/5 border-red-500/20',
    unknown: 'bg-muted/30 border-border',
  };
  return (
    <div className={`rounded-xl border p-3 ${bg[health] || bg.unknown}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <StatusDot health={health} size="xs" className="ml-auto" />
      </div>
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function ActionButton({ icon: Icon, label, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 text-left p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
    >
      <div className="p-1.5 rounded-md bg-primary/10">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function statusToHealth(status) {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s.includes('running') || s === 'healthy') return 'green';
  if (s.includes('starting') || s.includes('deploying') || s.includes('restarting')) return 'yellow';
  if (s.includes('stopped') || s.includes('exited') || s.includes('error') || s.includes('failed')) return 'red';
  return 'yellow';
}

function deriveOverallHealth({ github, vps, sites, tasks }) {
  if (vps?.errored > 0 || sites?.summary?.critical > 0 || tasks?.overdueCount > 5) return 'red';
  if (vps?.stopped > 0 || sites?.summary?.warning > 0 || tasks?.overdueCount > 0 || github?.openPRCount > 5) return 'yellow';
  if (vps && sites && github) return 'green';
  return 'unknown';
}
