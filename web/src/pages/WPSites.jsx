import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Trash2, ExternalLink, Shield, AlertCircle, ChevronDown, X } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const STATUS_COLORS = {
  HEALTHY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  DEGRADED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  DOWN: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  MAINTENANCE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function WPSites() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addKey, setAddKey] = useState('');
  const [alert, setAlert] = useState(null);

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['wp-sites'],
    queryFn: () => api.listWPSites(),
  });

  const registerMutation = useMutation({
    mutationFn: (data) => api.registerWPSite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wp-sites'] });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wp-sites'] }),
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

  const handleRegister = (e) => {
    e.preventDefault();
    if (!addUrl.trim()) return;
    registerMutation.mutate({ siteUrl: addUrl, secretKey: addKey });
  };

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
        <Button onClick={() => setShowAdd(true)} leftIcon={<Plus className="w-4 h-4" />}>
          Add Site
        </Button>
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

      {/* Sites grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : sites.length === 0 ? (
        <Card className="p-12 text-center">
          <Globe className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">No WordPress sites connected</h3>
          <p className="text-sm text-muted-foreground mt-1">Add your first site to get started</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map(site => (
            <Card key={site.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-foreground">{site.name || site.siteUrl}</h3>
                  <a href={site.siteUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    {site.siteUrl} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[site.status] || STATUS_COLORS.HEALTHY}`}>
                  {site.status || 'HEALTHY'}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                {site.wpVersion && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WP Version</span>
                    <span className="font-medium">{site.wpVersion}</span>
                  </div>
                )}
                {site.phpVersion && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PHP Version</span>
                    <span className="font-medium">{site.phpVersion}</span>
                  </div>
                )}
                {site.activePlugins !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active Plugins</span>
                    <span className="font-medium">{site.activePlugins}</span>
                  </div>
                )}
                {site.theme && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Theme</span>
                    <span className="font-medium">{site.theme}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4">
                <Button size="sm" variant="outline" onClick={() => magicLoginMutation.mutate(site.id)}
                  loading={magicLoginMutation.isPending}>
                  Magic Login
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remove this site?')) deleteMutation.mutate(site.id); }}
                  className="text-red-500 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdd(false)}>
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