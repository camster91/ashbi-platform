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
  Send,
  Copy,
  PlayCircle,
  Terminal,
  FileCode,
  Settings2,
  ExternalLink as OpenIcon,
  ChevronDown as ChevronDownIcon
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const STATUS_COLORS = {
  HEALTHY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  DEGRADED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  DOWN: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  MAINTENANCE: 'bg-blue-100 text-blue-700 dark:text-blue-400',
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

// Plan 8 — whitelisted WP-CLI subcommands surfaced in the "Run Command" form
// help text. Mirrors the plugin-side allowlist that runs after the hub-side
// HMAC verification; if you add one here, also add it to the plugin's allowlist.
const WP_CLI_HELP = [
  'wp option get <name>',
  'wp option update <name> <value>',
  'wp plugin list',
  'wp plugin activate <slug>',
  'wp plugin deactivate <slug>',
  'wp theme list',
  'wp user list',
  'wp post list --posts_per_page=10',
  'wp db query "SELECT ..."'
].join('\n');

const OP_TYPE_LABELS = {
  file_patch: 'Patch',
  command: 'Command',
  option_set: 'Option',
  magic_login: 'Magic Login'
};

export default function WPSites() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('sites'); // 'sites' | 'fleet-ops' | 'login' | 'recent-logins'

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
      </div>

      {/* Tab bar — unobtrusive, plain buttons under the page header. */}
      <div role="tablist" aria-label="WPSites tabs" className="flex gap-1 border-b border-border">
        <TabButton id="sites" activeTab={activeTab} onSelect={setActiveTab} icon={<Globe className="w-4 h-4" />} testId="sites-tab">
          Sites
        </TabButton>
        <TabButton id="fleet-ops" activeTab={activeTab} onSelect={setActiveTab} icon={<Settings2 className="w-4 h-4" />} testId="fleet-ops-tab">
          Fleet Ops
        </TabButton>
        <TabButton id="login" activeTab={activeTab} onSelect={setActiveTab} icon={<Shield className="w-4 h-4" />} testId="login-tab">
          Login
        </TabButton>
        <TabButton id="recent-logins" activeTab={activeTab} onSelect={setActiveTab} icon={<Shield className="w-4 h-4" />} testId="recent-logins-tab">
          Recent Logins
        </TabButton>
      </div>

      {activeTab === 'sites' && <SitesTab queryClient={queryClient} />}
      {activeTab === 'fleet-ops' && <FleetOpsTab queryClient={queryClient} />}
      {activeTab === 'login' && <LoginTab />}
      {activeTab === 'recent-logins' && <RecentLoginsTab queryClient={queryClient} />}
    </div>
  );
}

function TabButton({ id, activeTab, onSelect, icon, children, testId }) {
  const active = activeTab === id;
  return (
    <button
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={() => onSelect(id)}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// =============================================================================
// SITES TAB — Plan 6 page contents, unchanged behavior
// =============================================================================

function SitesTab({ queryClient }) {
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addKey, setAddKey] = useState('');
  const [alert, setAlert] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['wp-sites'],
    queryFn: () => api.listWPSites(),
  });

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

  // PR-E (hub-ui-buttons-wire): DELETE /wp-bridge/:id is the actual route
  // shape — the prior handler sent the id as a query string (?id=) which the
  // server never matched. Body is omitted because DELETE carries nothing.
  // Treats 204 No Content as success (matches the hub endpoint contract:
  // `return reply.status(204).send()`).
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`/api/wp-bridge/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 204) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      return res.json().catch(() => null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wp-sites'] });
      queryClient.invalidateQueries({ queryKey: ['wp-fleet-status'] });
      setAlert({ type: 'success', msg: 'Site removed.' });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err) => {
      setAlert({ type: 'error', msg: err.message || 'Failed to delete site' });
    },
  });

  // PR-E (hub-ui-buttons-wire): the prior handler issued
  //   GET /wp-bridge/magic-login?siteId=...
  // which is not a route the server defines. The real entry point is
  // POST /api/wp-bridge/fleet/magic-login (per-site fan-out endpoint,
  // accepts { user_id, targetSites }). For a single-site click we hand it
  // targetSites=[siteId] so the fan-out is bounded to that one site and we
  // can open the only returned magic URL in a new tab.
  //
  // user_id defaults to 1 (Cameron). The hub has no hub-user -> wp-user
  // mapping table yet; once that exists, wire it in here. Until then the
  // payload intentionally targets WP user id 1 on the receiving site.
  const WP_ADMIN_USER_ID = 1;
  const magicLoginMutation = useMutation({
    mutationFn: async (siteId) => {
      const res = await fetch('/api/wp-bridge/fleet/magic-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: WP_ADMIN_USER_ID,
          targetSites: [siteId],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Magic login failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      const result = Array.isArray(data?.results) ? data.results[0] : null;
      if (result?.url) {
        // Open in a new tab so the operator keeps the hub context behind.
        // noopener+noreferrer blocks window.opener / Referer leaks.
        window.open(result.url, '_blank', 'noopener,noreferrer');
        setAlert({
          type: 'success',
          msg: 'Magic login link opened in a new tab.'
        });
        setTimeout(() => setAlert(null), 3000);
      } else if (result?.error) {
        setAlert({
          type: 'error',
          msg: `Magic login failed: ${result.error}`
        });
      } else {
        setAlert({
          type: 'error',
          msg: 'Magic login failed: empty response from plugin'
        });
      }
    },
    onError: (err) => {
      setAlert({ type: 'error', msg: err.message || 'Failed to generate magic login' });
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

  const fleetByUrl = new Map();
  if (fleet && Array.isArray(fleet.sites)) {
    for (const fs of fleet.sites) fleetByUrl.set(fs.siteUrl, fs);
  }

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
      <div className="flex items-center justify-end gap-2">
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
                    deletePending={deleteMutation.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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

// =============================================================================
// FLEET OPS TAB — Plan 8: 3 forms (Patch / Command / Option) + history table
// =============================================================================

function FleetOpsTab({ queryClient }) {
  const [alert, setAlert] = useState(null);

  // History (recent fleet ops). Refreshes on every successful mutation below
  // via queryClient.invalidateQueries.
  const { data: opsData, isLoading: opsLoading, refetch: refetchOps } = useQuery({
    queryKey: ['wp-fleet-ops', { limit: 50 }],
    queryFn: () => api.getWPFleetOps({ limit: 50 }),
    refetchInterval: 30_000
  });
  const ops = (opsData && Array.isArray(opsData.ops)) ? opsData.ops : [];

  // List of sites for the target-sites multi-select on each form. Pulled
  // from the same fleet status query the Sites tab uses; if it's still
  // loading, the multi-select shows an empty state.
  const { data: fleet } = useQuery({
    queryKey: ['wp-fleet-status'],
    queryFn: () => api.getWPFleetStatus()
  });
  const allSites = (fleet && Array.isArray(fleet.sites)) ? fleet.sites : [];

  const onSuccess = (op, msg) => {
    queryClient.invalidateQueries({ queryKey: ['wp-fleet-ops'] });
    setAlert({ type: 'success', msg });
    setTimeout(() => setAlert(null), 4000);
  };
  const onError = (err) => setAlert({ type: 'error', msg: err.message || 'Fleet op failed' });

  return (
    <div className="space-y-6">
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

      <PatchForm allSites={allSites} onSuccess={onSuccess} onError={onError} />
      <CommandForm allSites={allSites} onSuccess={onSuccess} onError={onError} />
      <OptionSetForm allSites={allSites} onSuccess={onSuccess} onError={onError} />

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            Fleet Ops History
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchOps()}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Refresh
          </Button>
        </div>
        {opsLoading && ops.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : ops.length === 0 ? (
          <div className="text-sm text-muted-foreground">No fleet ops recorded yet.</div>
        ) : (
          <FleetOpsHistoryTable ops={ops} />
        )}
      </Card>
    </div>
  );
}

function PatchForm({ allSites, onSuccess, onError }) {
  const [filePath, setFilePath] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [targetAll, setTargetAll] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [selected, setSelected] = useState([]); // site URLs when targetAll=false

  const mutation = useMutation({
    mutationFn: () => {
      const body = { filePath, find, replace, dryRun };
      if (targetAll) body.targetAll = true;
      else body.targetSites = selected;
      return api.postWPFleetFilePatch(body);
    },
    onSuccess: (data) => {
      const dry = dryRun ? ' (dry run)' : '';
      onSuccess(data, `Patch applied to ${data.succeeded}/${data.total} sites${dry}`);
      setFilePath(''); setFind(''); setReplace('');
    },
    onError
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileCode className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Patch file (find / replace)</h2>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3" data-testid="patch-form">
        <Field label="File path" value={filePath} onChange={setFilePath} placeholder="/srv/www/wp-config.php" required />
        <Field label="Find" value={find} onChange={setFind} placeholder="WP_DEBUG = false" required textarea />
        <Field label="Replace" value={replace} onChange={setReplace} placeholder="WP_DEBUG = true" textarea />
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label="Apply to all sites" checked={targetAll} onChange={setTargetAll} />
          <Checkbox label="Dry run" checked={dryRun} onChange={setDryRun} />
        </div>
        <TargetSitesSelect
          allSites={allSites}
          disabled={targetAll}
          selected={selected}
          onChange={setSelected}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={mutation.isPending} leftIcon={<PlayCircle className="w-4 h-4" />}>
            {dryRun ? 'Preview patch' : 'Apply patch'}
          </Button>
        </div>
        {mutation.data && <FleetOpResultSummary data={mutation.data} />}
        {mutation.isError && <FleetOpResultError err={mutation.error} />}
      </form>
    </Card>
  );
}

function CommandForm({ allSites, onSuccess, onError }) {
  const [cmd, setCmd] = useState('');
  const [targetAll, setTargetAll] = useState(true);
  const [selected, setSelected] = useState([]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = { cmd };
      if (targetAll) body.targetAll = true;
      else body.targetSites = selected;
      return api.postWPFleetCommand(body);
    },
    onSuccess: (data) => {
      onSuccess(data, `Command ran on ${data.succeeded}/${data.total} sites`);
      setCmd('');
    },
    onError
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Terminal className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Run command</h2>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3" data-testid="command-form">
        <Field label="Command" value={cmd} onChange={setCmd} placeholder="wp option get blogname" required />
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Whitelisted WP-CLI subcommands</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-muted/40 rounded p-2">{WP_CLI_HELP}</pre>
        </details>
        <Checkbox label="Apply to all sites" checked={targetAll} onChange={setTargetAll} />
        <TargetSitesSelect
          allSites={allSites}
          disabled={targetAll}
          selected={selected}
          onChange={setSelected}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={mutation.isPending} leftIcon={<PlayCircle className="w-4 h-4" />}>
            Run on fleet
          </Button>
        </div>
        {mutation.data && <FleetOpResultSummary data={mutation.data} />}
        {mutation.isError && <FleetOpResultError err={mutation.error} />}
      </form>
    </Card>
  );
}

function OptionSetForm({ allSites, onSuccess, onError }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [targetAll, setTargetAll] = useState(true);
  const [selected, setSelected] = useState([]);

  const mutation = useMutation({
    mutationFn: () => {
      // Try to parse the value as JSON first (so booleans, numbers, objects work);
      // fall back to the raw string. Empty string becomes empty string.
      let parsed;
      if (value === '') parsed = '';
      else if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (value === 'null') parsed = null;
      else if (/^-?\d+(\.\d+)?$/.test(value)) parsed = Number(value);
      else {
        try { parsed = JSON.parse(value); } catch { parsed = value; }
      }
      const body = { name, value: parsed };
      if (targetAll) body.targetAll = true;
      else body.targetSites = selected;
      return api.postWPFleetOptionSet(body);
    },
    onSuccess: (data) => {
      onSuccess(data, `Option set on ${data.succeeded}/${data.total} sites`);
      setName(''); setValue('');
    },
    onError
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Settings2 className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Set option</h2>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3" data-testid="option-form">
        <Field label="Option name" value={name} onChange={setName} placeholder="blogdescription" required />
        <Field label="Value (string, number, true, false, null, or JSON)" value={value} onChange={setValue} placeholder="Just another WordPress site" />
        <Checkbox label="Apply to all sites" checked={targetAll} onChange={setTargetAll} />
        <TargetSitesSelect
          allSites={allSites}
          disabled={targetAll}
          selected={selected}
          onChange={setSelected}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={mutation.isPending} leftIcon={<PlayCircle className="w-4 h-4" />}>
            Set on fleet
          </Button>
        </div>
        {mutation.data && <FleetOpResultSummary data={mutation.data} />}
        {mutation.isError && <FleetOpResultError err={mutation.error} />}
      </form>
    </Card>
  );
}

function FleetOpResultSummary({ data }) {
  if (!data) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20 p-3 text-sm" data-testid="fleet-op-result">
      <div className="font-medium text-emerald-800 dark:text-emerald-300">
        {data.succeeded}/{data.total} sites succeeded ({data.failed} failed)
      </div>
      {Array.isArray(data.results) && data.results.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {data.results.map((r) => (
            <li key={r.siteUrl} className="flex items-center gap-2">
              <span className={r.status === 'ok' ? 'text-emerald-600' : 'text-red-600'}>
                {r.status === 'ok' ? 'OK' : 'ERR'}
              </span>
              <span className="font-mono">{r.siteUrl}</span>
              {r.error && <span className="text-muted-foreground">— {r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FleetOpResultError({ err }) {
  if (!err) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300">
      <div className="font-medium">Fleet op failed</div>
      <div className="text-xs mt-1">{err.message || 'Unknown error'}</div>
    </div>
  );
}

function FleetOpsHistoryTable({ ops }) {
  const [expandedId, setExpandedId] = useState(null);

  const truncate = (v) => {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="fleet-ops-history">
        <thead>
          <tr className="bg-muted/40 text-left">
            <th className="px-3 py-2 w-8" />
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Op</th>
            <th className="px-3 py-2 font-medium">Targets</th>
            <th className="px-3 py-2 font-medium">OK</th>
            <th className="px-3 py-2 font-medium">Fail</th>
            <th className="px-3 py-2 font-medium">Payload</th>
            <th className="px-3 py-2 font-medium">By</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op) => (
            <FleetOpHistoryRow
              key={op.id}
              op={op}
              expanded={expandedId === op.id}
              onToggle={() => setExpandedId(expandedId === op.id ? null : op.id)}
              truncate={truncate}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FleetOpHistoryRow({ op, expanded, onToggle, truncate }) {
  return (
    <>
      <tr
        className="border-t border-border hover:bg-muted/30 cursor-pointer"
        onClick={onToggle}
        data-testid={`fleet-op-row-${op.id}`}
      >
        <td className="px-3 py-2 align-middle">
          {expanded ? <ChevronDownIcon className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </td>
        <td className="px-3 py-2 align-middle text-xs">{op.createdAt ? new Date(op.createdAt).toLocaleString() : '—'}</td>
        <td className="px-3 py-2 align-middle">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-foreground">
            {OP_TYPE_LABELS[op.opType] || op.opType}
          </span>
        </td>
        <td className="px-3 py-2 align-middle">{op.targetCount}</td>
        <td className="px-3 py-2 align-middle text-emerald-600">{op.successCount}</td>
        <td className="px-3 py-2 align-middle text-red-600">{op.failureCount}</td>
        <td className="px-3 py-2 align-middle font-mono text-xs">{truncate(op.payload)}</td>
        <td className="px-3 py-2 align-middle text-xs">{op.createdBy}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={8} className="px-3 py-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
{JSON.stringify(op, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// =============================================================================
// LOGIN TAB — bulk magic-login generator
// =============================================================================

function LoginTab() {
  const [userId, setUserId] = useState(1); // Cameron as primary admin (per task spec)
  const [targetAll, setTargetAll] = useState(true);
  const [selected, setSelected] = useState([]);
  const [alert, setAlert] = useState(null);

  const { data: fleet } = useQuery({
    queryKey: ['wp-fleet-status'],
    queryFn: () => api.getWPFleetStatus()
  });
  const allSites = (fleet && Array.isArray(fleet.sites)) ? fleet.sites : [];

  const mutation = useMutation({
    mutationFn: () => {
      const body = { user_id: userId };
      if (targetAll) body.targetAll = true;
      else body.targetSites = selected;
      return api.postWPFleetMagicLogin(body);
    },
    onSuccess: (data) => {
      setAlert({ type: 'success', msg: `Magic login generated for ${data.succeeded}/${data.total} sites` });
      setTimeout(() => setAlert(null), 4000);
    },
    onError: (err) => setAlert({ type: 'error', msg: err.message || 'Magic login failed' })
  });

  const results = (mutation.data && Array.isArray(mutation.data.results)) ? mutation.data.results : [];
  const successfulUrls = results.filter((r) => r.url);

  const copyOne = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setAlert({ type: 'success', msg: 'Magic login URL copied to clipboard' });
      setTimeout(() => setAlert(null), 2500);
    } catch {
      setAlert({ type: 'error', msg: 'Clipboard write failed — copy manually' });
    }
  };

  const openAll = () => {
    // Best-effort: most browsers cap popups without a user gesture; this
    // button is clicked by the user so it counts as one. Sites that fail
    // (popup blocker) still appear in the result table for manual opening.
    for (const r of successfulUrls) {
      try { window.open(r.url, '_blank', 'noopener,noreferrer'); } catch { /* ignored */ }
    }
  };

  return (
    <div className="space-y-6">
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

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Bulk magic login</h2>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3" data-testid="login-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Admin user ID</label>
              <input
                type="number"
                min={1}
                value={userId}
                onChange={(e) => setUserId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Defaults to <code>1</code> (Cameron's primary admin).
              </p>
            </div>
            <Checkbox label="Apply to all sites" checked={targetAll} onChange={setTargetAll} />
          </div>
          <TargetSitesSelect
            allSites={allSites}
            disabled={targetAll}
            selected={selected}
            onChange={setSelected}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={mutation.isPending} leftIcon={<PlayCircle className="w-4 h-4" />}>
              Generate magic logins
            </Button>
          </div>
        </form>
      </Card>

      {mutation.data && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">
              Results — {mutation.data.succeeded}/{mutation.data.total} succeeded
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={openAll}
              disabled={successfulUrls.length === 0}
              leftIcon={<OpenIcon className="w-4 h-4" />}
            >
              Open all in new tabs
            </Button>
          </div>
          {results.length === 0 ? (
            <div className="text-sm text-muted-foreground">No sites targeted.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="login-results-table">
                <thead>
                  <tr className="bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">Site</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Magic-login URL</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.siteUrl} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{r.siteUrl}</td>
                      <td className="px-3 py-2">
                        {r.url
                          ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">OK</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" title={r.error || 'Unknown error'}>Failed</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs break-all">
                        {r.url
                          ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{r.url}</a>
                          : <span className="text-muted-foreground">{r.error || '—'}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.url && (
                          <Button size="sm" variant="ghost" onClick={() => copyOne(r.url)}>
                            <Copy className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// Shared form primitives — kept in-file to avoid new files outside scope
// =============================================================================

function Field({ label, value, onChange, placeholder, required, textarea }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
          required={required}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          required={required}
        />
      )}
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border"
      />
      {label}
    </label>
  );
}

function TargetSitesSelect({ allSites, disabled, selected, onChange }) {
  if (disabled) {
    return (
      <p className="text-xs text-muted-foreground">
        Targeting all {allSites.length} connected sites.
      </p>
    );
  }
  const toggle = (url) => {
    if (selected.includes(url)) onChange(selected.filter((u) => u !== url));
    else onChange([...selected, url]);
  };
  return (
    <div>
      <label className="block text-sm font-medium mb-1">Target sites</label>
      {allSites.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sites loaded yet.</p>
      ) : (
        <div className="rounded-lg border border-border bg-background p-2 max-h-40 overflow-y-auto space-y-1">
          {allSites.map((s) => (
            <label key={s.id || s.siteUrl} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5">
              <input
                type="checkbox"
                checked={selected.includes(s.siteUrl)}
                onChange={() => toggle(s.siteUrl)}
              />
              <span className="font-mono text-xs">{s.siteUrl}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sites-tab subcomponents (unchanged from Plan 6)
// =============================================================================

function RollupMetric({ label, value, tone = 'neutral', hint }) {
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

function SiteRow({ site, expanded, onToggle, onMagicLogin, onDelete, magicPending, deletePending }) {
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
            <Button size="sm" variant="outline" onClick={onMagicLogin} loading={magicPending} data-testid="magic-login-button">
              Magic Login
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              loading={deletePending}
              className="text-red-500 hover:text-red-600"
              data-testid="delete-site-button"
            >
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

// =============================================================================
// RECENT LOGINS TAB — Plan 11 / PR-F.
// Read-only feed of magic-login audit events across all sites (or filtered
// to one). Backed by GET /api/wp-bridge/magic-login/log.
// =============================================================================

const STATUS_PILL = {
  issued:   'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  consumed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  revoked:  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
};

const REASON_LABELS = {
  replayed: 'replayed within 5-min window',
  expired: 'token expired',
  expired_or_invalid: 'expired or invalid',
  rate_limited: 'hub-side rate limit',
  ip_not_allowed: 'IP not in allowlist',
  manual_revoke: 'admin-initiated revoke'
};

function RecentLoginsTab({ queryClient }) {
  const [siteFilter, setSiteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' | issued | consumed | revoked | rejected
  const [alert, setAlert] = useState(null);

  const params = {};
  if (siteFilter) params.siteUrl = siteFilter;
  if (statusFilter) params.status = statusFilter;
  params.limit = 100;

  const {
    data: logData,
    isLoading,
    refetch,
    isFetching
  } = useQuery({
    queryKey: ['wp-magic-login-log', params],
    queryFn: () => api.getWPMagicLoginLog(params),
    refetchInterval: 30_000
  });
  const entries = (logData && Array.isArray(logData.entries)) ? logData.entries : [];

  // Site list from the fleet status so the filter dropdown stays in sync
  // with the Sites tab.
  const { data: fleet } = useQuery({
    queryKey: ['wp-fleet-status'],
    queryFn: () => api.getWPFleetStatus()
  });
  const allSites = (fleet && Array.isArray(fleet.sites)) ? fleet.sites : [];

  const revokeMutation = useMutation({
    mutationFn: ({ siteId, token }) => api.postWPMagicLoginRevoke({ siteId, token }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['wp-magic-login-log'] });
      setAlert({
        type: data?.ok ? 'success' : 'error',
        msg: data?.ok
          ? `Revoked magic login on ${data.siteUrl || 'site'}.`
          : `Revoke failed: ${data?.pluginResponse?.error || 'plugin rejected'}`
      });
      setTimeout(() => setAlert(null), 4000);
    },
    onError: (err) => {
      setAlert({ type: 'error', msg: err.message || 'Revoke request failed' });
    }
  });

  return (
    <div className="space-y-6">
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

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Recent Magic-Login Events
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            leftIcon={<RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />}
            disabled={isFetching}
          >
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium mb-1">Filter by site</label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              data-testid="site-filter"
            >
              <option value="">All sites</option>
              {allSites.map((s) => (
                <option key={s.id || s.siteUrl} value={s.siteUrl || s.url}>
                  {s.name || s.siteUrl || s.url}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              data-testid="status-filter"
            >
              <option value="">All statuses</option>
              <option value="issued">Issued</option>
              <option value="consumed">Consumed</option>
              <option value="revoked">Revoked</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="text-xs text-muted-foreground ml-auto self-end">
            {entries.length === 0 ? 'No events' : `${entries.length} event${entries.length === 1 ? '' : 's'}`}
          </div>
        </div>

        {isLoading && entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No magic-login events yet. Once you issue a magic link from the Sites tab, it shows up here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="recent-logins-table">
              <thead>
                <tr className="bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <RecentLoginRow
                    key={e.id}
                    entry={e}
                    onRevoke={(token) => {
                      if (!confirm('Revoke this magic-login token? The user will not be able to use it.')) return;
                      revokeMutation.mutate({ siteId: e.siteId, token });
                    }}
                    revokePending={revokeMutation.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function RecentLoginRow({ entry, onRevoke, revokePending }) {
  const statusPill = STATUS_PILL[entry.status] || 'bg-muted text-foreground';
  return (
    <tr className="border-t border-border" data-testid={`recent-login-row-${entry.id}`}>
      <td className="px-3 py-2 align-middle text-xs">{entry.ts ? new Date(entry.ts).toLocaleString() : '—'}</td>
      <td className="px-3 py-2 align-middle font-mono text-xs">{entry.siteUrl}</td>
      <td className="px-3 py-2 align-middle">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusPill}`}>
          {entry.status}
        </span>
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
        {REASON_LABELS[entry.reason] || entry.reason || '—'}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs">{entry.ip || '—'}</td>
      <td className="px-3 py-2 align-middle text-xs">{entry.userId ?? '—'}</td>
      <td className="px-3 py-2 align-middle text-xs">{entry.hubUserId ? entry.hubUserId.slice(0, 8) + '…' : '—'}</td>
      <td className="px-3 py-2 align-middle text-right">
        {/* Revoke is only meaningful for active or consumption-rejected tokens.
            Issued/consumed entries already carry a fresh state and pulling them
            back is partly theatre — but keep the affordance so an operator can
            burn a "stuck-open" token without guessing its lifecycle status. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRevoke(entry.tokenHash)}
          loading={revokePending}
          disabled={!entry.tokenHash || entry.status === 'revoked'}
          title="Best-effort revoke — pulls the token out of the plugin's active list and the consumed list."
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
}