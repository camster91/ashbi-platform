import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Plus,
  Trash2,
  ExternalLink,
  Shield,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  X,
  RefreshCw,
  Send
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const STATUS_COLORS = {
  HEALTHY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  DEGRADED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  DOWN: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  MAINTENANCE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// Map our derived `lastPingStatus` (from the fleet aggregation) to the
// colored status pill used elsewhere in the page. We translate the
// fleet's `ok | unreachable | silent` values to HEALTHY / DEGRADED / DOWN.
function pingStatusToPill(pingStatus) {
  if (pingStatus === 'ok') return 'HEALTHY';
  if (pingStatus === 'unreachable') return 'DOWN';
  return 'DEGRADED'; // silent — show as amber
}

// Dot color: green for ok, red for unreachable, amber/yellow for silent.
function pingStatusToDot(pingStatus) {
  if (pingStatus === 'ok') return 'bg-emerald-500';
  if (pingStatus === 'unreachable') return 'bg-red-500';
  return 'bg-amber-500';
}

function statusText(pingStatus) {
  if (pingStatus === 'ok') return 'Healthy';
  if (pingStatus === 'unreachable') return 'Unreachable';
  return 'Silent';
}

export default function WPSites() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addKey, setAddKey] = useState('');
  const [alert, setAlert] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Existing canonical data fetch (sites list) — kept as-is for backwards
  // compat with whatever else reads `['wp-sites']`.
  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['wp-sites'],
    queryFn: () => api.listWPSites(),
  });

  // Plan 6 — fleet status rollup. Surfaces the 7 metrics + per-site rows
  // for the columns / status dot / row expansion.
  const {
    data: fleet,
    isLoading: fleetLoading,
    refetch: refetchFleet,
    isFetching: fleetFetching
  } = useQuery({
    queryKey: ['wp-fleet-status'],
    queryFn: () => api.getWPFleetStatus(),
    refetchInterval: 60_000,
  });

  const registerMutation = useMutation({
    mutationFn: (data) => api.registerWPSite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wp-sites'] });
      queryClient.invalidateQueries({ queryKey: ['wp-fleet-status'] });
      setShowAdd(false);
      setAddUrl('');
      setAddKey('');
      setAlert({ type: 'success', msg: 'Site registered successfully!' });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err) => {
      setAlert({ type: 'error', msg: err.message || 'Failed to register site' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteWPSite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wp-sites'] });
      queryClient.invalidateQueries({ queryKey: ['wp-fleet-status'] });
    },
  });

  const magicLoginMutation = useMutation({
    mutationFn: (siteId) => api.generateWPMagicLogin(siteId),
    onSuccess: (data) => {
      if (data?.magicLink) {
        navigator.clipboard.writeText(data.magicLink);
        setAlert({ type: 'success', msg: 'Magic login link copied to clipboard!' });
        setTimeout(() => setAlert(null), 3000);
      }
    },
    onError: (err) => {
      setAlert({ type: 'error', msg: err.message || 'Failed to generate magic link' });
    },
  });

  const digestMutation = useMutation({
    mutationFn: () => api.postWPFleetDigest(),
    onSuccess: (data) => {
      setAlert({
        type: 'success',
        msg: `Daily digest posted to Slack (${data?.fleet?.healthy ?? '?'}/${data?.fleet?.totalSites ?? '?'} healthy)`
      });
      setTimeout(() => setAlert(null), 4000);
    },
    onError: (err) => {
      setAlert({ type: 'error', msg: err.message || 'Failed to send digest' });
    },
  });

  const handleRegister = (e) => {
    e.preventDefault();
    if (!addUrl.trim()) return;
    registerMutation.mutate({ siteUrl: addUrl, secretKey: addKey });
  };

  // Index fleet sites by siteUrl so the table can render columns without
  // an extra round-trip per row. If the fleet query hasn't returned yet
  // we fall back to a defensive empty map.
  const fleetByUrl = new Map();
  if (fleet && Array.isArray(fleet.sites)) {
    for (const fs of fleet.sites) fleetByUrl.set(fs.siteUrl, fs);
  }

  // The canonical "list of sites" still drives rows so anything else
  // subscribing to `['wp-sites']` (or future widgets) keeps working.
  const rows = (sites || []).map((s) => {
    const f = fleetByUrl.get(s.url) || fleetByUrl.get(s.siteUrl) || null;
    return {
      ...s,
      url: s.url || s.siteUrl,
      pingStatus: f?.lastPingStatus || 'silent',
      sslDaysRemaining: f?.sslDaysRemaining ?? null,
      pendingUpdates: f?.pendingUpdates ?? (typeof s.pluginUpdates === 'number' ? s.pluginUpdates : 0),
      brokenLinks: f?.brokenLinks ?? 0,
      lastPingAt: f?.lastPingAt || s.lastCheckedAt || null
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            WordPress Sites
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage connected WordPress sites</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => digestMutation.mutate()}
            loading={digestMutation.isPending}
            leftIcon={<Send className="w-4 h-4" />}
          >
            Send digest
          </Button>
          <Button onClick={() => setShowAdd(true)} leftIcon={<Plus className="w-4 h-4" />}>
            Add Site
          </Button>
        </div>
      </div>

      {/* Alert */}
      {alert && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg ${
          alert.type === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        }`}>
          {alert.type === 'success' ? <Shield className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-sm">{alert.msg}</span>
          <button onClick={() => setAlert(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* =================== FLEET STATUS ROLLUP CARD (Plan 6) =================== */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Fleet Status
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchFleet()}
            leftIcon={<RefreshCw className={`w-4 h-4 ${fleetFetching ? 'animate-spin' : ''}`} />}
            disabled={fleetFetching}
          >
            Refresh
          </Button>
        </div>
        {fleetLoading && !fleet ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="animate-pulse h-20 rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3" data-testid="fleet-rollup">
            <RollupMetric label="Total sites" value={fleet?.totalSites ?? 0} />
            <RollupMetric
              label="Healthy"
              value={fleet?.healthy ?? 0}
              tone="ok"
              hint={fleet ? `${fleet.healthy}/${fleet.totalSites}` : '—'}
            />
            <RollupMetric
              label="Unreachable"
              value={fleet?.unreachable ?? 0}
              tone={fleet?.unreachable > 0 ? 'danger' : 'neutral'}
            />
            <RollupMetric
              label="Silent"
              value={fleet?.silent ?? 0}
              tone={fleet?.silent > 0 ? 'warn' : 'neutral'}
            />
            <RollupMetric
              label="SSL ≤14d"
              value={fleet?.sslExpiringSoon ?? 0}
              tone={fleet?.sslExpiringSoon > 0 ? 'warn' : 'neutral'}
            />
            <RollupMetric
              label="Pending updates"
              value={fleet?.pendingUpdates ?? 0}
              tone={(fleet?.pendingUpdates ?? 0) > 0 ? 'warn' : 'neutral'}
            />
            <RollupMetric
              label="Broken links (7d)"
              value={fleet?.brokenLinks ?? 0}
              tone={(fleet?.brokenLinks ?? 0) > 0 ? 'danger' : 'neutral'}
            />
          </div>
        )}
      </Card>

      {/* =================== SITES TABLE (Plan 6: enhanced with columns + dot + expand) =================== */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <Globe className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">No WordPress sites connected</h3>
          <p className="text-sm text-muted-foreground mt-1">Add your first site to get started</p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="wp-sites-table">
              <thead>
                <tr className="bg-muted/40 text-left">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">SSL</th>
                  <th className="px-3 py-2 font-medium">Updates</th>
                  <th className="px-3 py-2 font-medium">Broken</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    expanded={expandedId === site.id}
                    onToggle={() => setExpandedId(expandedId === site.id ? null : site.id)}
                    onMagicLogin={() => magicLoginMutation.mutate(site.id)}
                    onDelete={() => { if (confirm('Remove this site?')) deleteMutation.mutate(site.id); }}
                    magicPending={magicLoginMutation.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Setup Guide */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Setup Guide</h2>
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">1</div>
            <div>
              <p className="font-medium text-foreground">Install the Ashbi WP Bridge Plugin</p>
              <p className="text-sm text-muted-foreground mt-0.5">Download and install the plugin on your WordPress site</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">2</div>
            <div>
              <p className="font-medium text-foreground">Configure the Plugin</p>
              <p className="text-sm text-muted-foreground mt-0.5">Enter your Ashbi Hub URL and secret key in the plugin settings</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">3</div>
            <div>
              <p className="font-medium text-foreground">Register Your Site</p>
              <p className="text-sm text-muted-foreground mt-0.5">Click "Add Site" above and enter your site URL and secret key</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">4</div>
            <div>
              <p className="font-medium text-foreground">Monitor & Manage</p>
              <p className="text-sm text-muted-foreground mt-0.5">View site health, generate magic login links, and receive alerts</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Add Site Modal */}
      {showAdd && (
        <div role="button" tabIndex={0} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdd(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setShowAdd(false); e.preventDefault(); } }}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add WordPress Site</h3>
              <button onClick={() => setShowAdd(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Site URL</label>
                <input type="url" value={addUrl} onChange={e => setAddUrl(e.target.value)}
                  placeholder="https://yoursite.com"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Secret Key</label>
                <input type="text" value={addKey} onChange={e => setAddKey(e.target.value)}
                  placeholder="From WP Bridge plugin settings"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button type="submit" loading={registerMutation.isPending}>Register Site</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Subcomponents kept here to avoid creating new files outside scope -----

function RollupMetric({ label, value, tone = 'neutral', hint }) {
  // Tone only affects the value color so a glance still works for
  // red/green-weak viewers — the number itself is the source of truth.
  const toneClass =
    tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' :
    tone === 'warn' ? 'text-amber-600 dark:text-amber-400' :
    tone === 'danger' ? 'text-red-600 dark:text-red-400' :
    'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </div>
  );
}

function SiteRow({ site, expanded, onToggle, onMagicLogin, onDelete, magicPending }) {
  const dot = pingStatusToDot(site.pingStatus);
  const pillKey = pingStatusToPill(site.pingStatus);
  const sslText = site.sslDaysRemaining === null
    ? '—'
    : site.sslDaysRemaining < 0
      ? 'expired'
      : `${site.sslDaysRemaining}d`;
  const sslTone =
    site.sslDaysRemaining === null ? 'text-muted-foreground' :
    site.sslDaysRemaining <= 14 ? 'text-amber-600 dark:text-amber-400' :
    'text-foreground';

  return (
    <>
      <tr className="border-t border-border hover:bg-muted/30" data-testid={`wp-site-row-${site.id}`}>
        <td className="px-3 py-2 align-middle">
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? 'Collapse site detail' : 'Expand site detail'}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>
        <td className="px-3 py-2 align-middle">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} aria-label={`status ${site.pingStatus}`} />
            <div>
              <div className="font-medium text-foreground">{site.name || site.url}</div>
              <a href={site.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1">
                {site.url} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 align-middle">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pillKey] || STATUS_COLORS.HEALTHY}`}>
            {statusText(site.pingStatus)}
          </span>
        </td>
        <td className={`px-3 py-2 align-middle ${sslTone}`} data-testid="ssl-cell">{sslText}</td>
        <td className={`px-3 py-2 align-middle ${site.pendingUpdates > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          {site.pendingUpdates > 0 ? site.pendingUpdates : '0'}
        </td>
        <td className={`px-3 py-2 align-middle ${site.brokenLinks > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {site.brokenLinks > 0 ? site.brokenLinks : '0'}
        </td>
        <td className="px-3 py-2 align-middle text-right">
          <div className="inline-flex gap-1">
            <Button size="sm" variant="outline" onClick={onMagicLogin} loading={magicPending}>
              Magic Login
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-red-500 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={7} className="px-3 py-3">
            <SiteDetail siteUrl={site.url} />
          </td>
        </tr>
      )}
    </>
  );
}

function SiteDetail({ siteUrl }) {
  const { data: backups = [], isLoading: lb } = useQuery({
    queryKey: ['wp-site-backups', siteUrl],
    queryFn: () => api.getWPBackups(siteUrl, 5),
    enabled: Boolean(siteUrl)
  });
  const { data: reports = [], isLoading: lr } = useQuery({
    queryKey: ['wp-site-reports', siteUrl],
    queryFn: () => api.getWPReports(siteUrl),
    enabled: Boolean(siteUrl)
  });
  const { data: alerts = [], isLoading: la } = useQuery({
    queryKey: ['wp-site-alerts', siteUrl],
    queryFn: () => api.getWPAlerts(siteUrl, 5),
    enabled: Boolean(siteUrl)
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <DetailPanel
        title="Backups (last 5)"
        loading={lb}
        empty="No backups recorded"
        rows={(backups || []).slice(0, 5).map((b) => ({
          key: b.id,
          primary: new Date(b.timestamp).toLocaleString(),
          secondary: `db=${b.dbSuccess ? 'ok' : 'fail'} · files=${b.filesSuccess ? 'ok' : 'fail'}`
        }))}
      />
      <DetailPanel
        title="Reports (last 5)"
        loading={lr}
        empty="No reports recorded"
        rows={(reports || []).slice(0, 5).map((r) => {
          let sslTxt = '';
          try {
            const ssl = r.ssl ? JSON.parse(r.ssl) : null;
            if (ssl && typeof ssl.days === 'number') sslTxt = `SSL: ${ssl.days}d`;
          } catch { /* malformed JSON — skip */ }
          return {
            key: r.id,
            primary: r.month,
            secondary: sslTxt || '—'
          };
        })}
      />
      <DetailPanel
        title="Alerts (last 5)"
        loading={la}
        empty="No alerts"
        rows={(alerts || []).slice(0, 5).map((a) => ({
          key: a.id,
          primary: a.alertType,
          secondary: new Date(a.createdAt).toLocaleString()
        }))}
      />
    </div>
  );
}

function DetailPanel({ title, loading, empty, rows }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">{title}</div>
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="text-xs">
              <div className="font-medium text-foreground">{r.primary}</div>
              <div className="text-muted-foreground">{r.secondary}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}