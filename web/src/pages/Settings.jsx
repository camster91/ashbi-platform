import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Lock,
  Save,
  CheckCircle,
  Eye,
  EyeOff,
  Wrench,
  Bot,
  Zap,
  Key,
  Plus,
  Trash2,
  Copy,
  Link2,
  Bell,
  ListChecks,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import QueryErrorState from '../components/QueryErrorState';
import { Button, Card, LoadingState } from '../components/ui';
import ConfirmDialog from '../components/ConfirmDialog';

function Section({ icon: Icon, title, description, children }) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

const TAG_COLORS = {
  vision:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  tools:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  thinking: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  audio:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cloud:    'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
};

function NotificationPreferences() {
  const { permission, subscribed, status, error, supported, offline, subscribe, unsubscribe } = usePushNotifications();
  const busy = status === 'subscribing' || status === 'unsubscribing';

  let summary = 'Notifications are available but not enabled.';
  if (!supported) summary = 'This browser does not support web push notifications.';
  else if (offline) summary = 'You are offline. Reconnect to change this preference.';
  else if (permission === 'denied') summary = 'Notifications are blocked in browser settings.';
  else if (subscribed) summary = 'Notifications are enabled for this account and browser.';

  return (
    <div className="space-y-4">
      <div aria-live="polite" aria-atomic="true">
        <p className="text-sm font-medium text-foreground">{summary}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ashbi uses browser notifications for assigned work and client activity. This preference applies to this browser; signing out removes its server registration.
        </p>
      </div>

      {permission === 'denied' && (
        <p className="rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
          Open this site&apos;s browser permissions, change Notifications to Allow, then return here and select Try again.
        </p>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {subscribed ? (
          <Button type="button" variant="outline" onClick={unsubscribe} isLoading={status === 'unsubscribing'} disabled={busy || offline}>
            {status === 'unsubscribing' ? 'Disabling...' : 'Disable notifications'}
          </Button>
        ) : (
          <Button type="button" onClick={subscribe} isLoading={status === 'subscribing'} disabled={busy || offline || !supported}>
            {status === 'subscribing' ? 'Enabling...' : permission === 'denied' ? 'Try again' : 'Enable notifications'}
          </Button>
        )}
      </div>
    </div>
  );
}

function OnboardingPreferences() {
  const queryClient = useQueryClient();
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: api.getOnboardingProgress,
    retry: false,
  });
  const restart = useMutation({
    mutationFn: api.restartOnboarding,
    onSuccess: progress => {
      setShowRestartConfirm(false);
      queryClient.setQueryData(['onboarding-progress'], progress);
      window.dispatchEvent(new Event('ashbi:onboarding-restart'));
    },
  });

  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading onboarding progress…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">Onboarding progress could not be loaded.</p>;
  if (!data?.supported) return <p className="text-sm text-muted-foreground">{data?.reason || 'Onboarding is not available for this role.'}</p>;

  const stateLabel = {
    eligible: 'Not started',
    in_progress: 'In progress',
    completed: 'Completed',
    skipped: 'Skipped',
  }[data.state] || 'Available';

  return (
    <div className="space-y-3">
      <div aria-live="polite">
        <p className="text-sm font-medium text-foreground">{stateLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.completedCount} of {data.totalCount} role-specific tasks are completed or explicitly skipped. Progress is saved to this account, not this browser.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={restart.isPending}
        onClick={() => { restart.reset(); setShowRestartConfirm(true); }}
      >
        {restart.isPending ? 'Restarting…' : 'Restart getting started'}
      </Button>
      <ConfirmDialog
        isOpen={showRestartConfirm}
        title="Restart onboarding"
        description="Restart your onboarding checklist? Previously skipped tasks will be available again. Verified completed work will remain complete."
        confirmLabel="Restart onboarding"
        destructive={false}
        onConfirm={() => restart.mutate()}
        onCancel={() => { restart.reset(); setShowRestartConfirm(false); }}
        pending={restart.isPending}
        error={restart.error?.message || (restart.error ? 'Onboarding could not be restarted.' : '')}
      />
    </div>
  );
}

function AIModelSection() {
  const [saved, setSaved] = useState(false);

  const {
    data: aiData,
    isLoading: aiLoading,
    isFetching: aiFetching,
    error: aiError,
    refetch: refetchAIProvider,
  } = useQuery({
    queryKey: ['ai-provider'],
    queryFn: () => api.getAIProvider(),
  });

  const {
    data: modelData,
    isLoading: modelsLoading,
    isFetching: modelsFetching,
    error: modelsError,
    refetch: refetchModels,
  } = useQuery({
    queryKey: ['ollama-models'],
    queryFn: () => api.getOllamaModels(),
  });

  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    if (aiData?.ollamaModel && !selectedModel) {
      setSelectedModel(aiData.ollamaModel);
    }
  }, [aiData]);

  const mutation = useMutation({
    mutationFn: (model) => api.setAIProvider('ollama', model),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const models = modelData?.models || aiData?.ollamaModels || {};

  // Group models by family
  const families = {};
  Object.entries(models).forEach(([key, val]) => {
    const family = val.family || 'Other';
    if (!families[family]) families[family] = [];
    families[family].push({ key, ...val });
  });

  return (
    <Section icon={Bot} title="AI Model" description="Choose which Ollama model powers all AI features">
      {aiLoading || modelsLoading ? (
        <LoadingState label="Loading AI model settings…" compact className="justify-start" size="sm" />
      ) : aiError || modelsError ? (
        <QueryErrorState
          error={aiError || modelsError}
          message="Failed to load AI model settings"
          onRetry={() => Promise.all([refetchAIProvider(), refetchModels()])}
          isRetrying={aiFetching || modelsFetching}
        />
      ) : (
        <div className="space-y-5">
          {Object.entries(families).map(([family, items]) => (
            <div key={family}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{family}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items.map(({ key, label, tags = [] }) => (
                  <button
                    key={key}
                    onClick={() => setSelectedModel(key)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      selectedModel === key
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      {selectedModel === key && <Zap className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tags.map(tag => (
                        <span key={tag} className={`text-xs px-1.5 py-0.5 rounded font-medium ${TAG_COLORS[tag] || 'bg-muted text-muted-foreground'}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={() => mutation.mutate(selectedModel)}
              loading={mutation.isPending}
              disabled={!selectedModel || selectedModel === aiData?.ollamaModel}
              leftIcon={<Save className="w-4 h-4" />}
            >
              Apply Model
            </Button>
            {saved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Saved — restart may be needed
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-mono font-medium">{aiData?.ollamaModel || '—'}</span>
          </p>
        </div>
      )}
    </Section>
  );
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState(null);
  const [keyToRevoke, setKeyToRevoke] = useState(null);

  const {
    data: keysData = { keys: [] },
    isLoading,
    isFetching: keysFetching,
    error: keysError,
    refetch: refetchKeys,
  } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.getApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (name) => api.createApiKey({ name }),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteApiKey(id),
    onSuccess: () => {
      setKeyToRevoke(null);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      {createMutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {createMutation.error.message || 'The API key could not be created. Try again.'}
        </p>
      )}
      {/* Create new key */}
      <div className="flex gap-2">
        <input
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name, e.g. OpenClaw Bot"
          className="flex-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newKeyName.trim()) {
              createMutation.mutate(newKeyName.trim());
            }
          }}
        />
        <Button
          onClick={() => createMutation.mutate(newKeyName.trim())}
          disabled={!newKeyName.trim() || createMutation.isPending}
          leftIcon={<Plus className="w-4 h-4" />}
          loading={createMutation.isPending}
        >
          Create Key
        </Button>
      </div>

      {/* Show newly created key (only shown once) */}
      {createdKey && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
            API key created! Copy it now — you won't see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white dark:bg-card p-2 rounded font-mono break-all select-all">
              {createdKey}
            </code>
            <button
              onClick={() => copyToClipboard(createdKey)}
              className="p-1.5 text-muted-foreground hover:text-foreground"
              title="Copy to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-xs text-muted-foreground hover:text-foreground mt-2"
          >
            I've copied it — dismiss
          </button>
        </div>
      )}

      {/* Existing keys */}
      {isLoading ? (
        <LoadingState label="Loading API keys…" compact className="justify-start" size="sm" />
      ) : keysError ? (
        <QueryErrorState
          error={keysError}
          message="Failed to load API keys"
          onRetry={refetchKeys}
          isRetrying={keysFetching}
        />
      ) : !keysError && keysData.keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet. Create one above.</p>
      ) : (
        <div className="space-y-2">
          {keysData.keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm font-medium">{key.name}</p>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(key.createdAt).toLocaleDateString('en-CA')}
                  {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString('en-CA')}`}
                  {key.expiresAt && ` · Expires ${new Date(key.expiresAt).toLocaleDateString('en-CA')}`}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Revoke ${key.name}`}
                disabled={deleteMutation.isPending}
                onClick={() => { deleteMutation.reset(); setKeyToRevoke(key); }}
                className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                title="Revoke key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(keyToRevoke)}
        title="Revoke API key"
        description={keyToRevoke ? `Revoke “${keyToRevoke.name}”? Any integrations using it will stop working immediately.` : ''}
        confirmLabel="Revoke API key"
        onConfirm={() => keyToRevoke && deleteMutation.mutate(keyToRevoke.id)}
        onCancel={() => { deleteMutation.reset(); setKeyToRevoke(null); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />

      <p className="text-xs text-muted-foreground">
        Use your API key in the <code className="bg-muted px-1 rounded">x-api-key</code> header or as a <code className="bg-muted px-1 rounded">Bearer</code> token.
      </p>
    </div>
  );
}

export function IntegrationsSection() {
  const providers = [
    { type: 'QUICKBOOKS', name: 'QuickBooks Online', color: 'bg-green-600' },
    { type: 'XERO', name: 'Xero', color: 'bg-blue-600' },
  ];

  return (
    <Section icon={Link2} title="Accounting Integrations" description="Accounting providers are not currently available">
      <div className="space-y-4">
        {providers.map(provider => {
          return (
            <div key={provider.type} className="flex flex-col gap-3 p-4 bg-muted/50 rounded-lg sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${provider.color} flex items-center justify-center text-white font-bold text-sm`}>
                  {provider.type === 'QUICKBOOKS' ? 'QB' : 'Xe'}
                </div>
                <div>
                  <p className="font-medium text-foreground">{provider.name}</p>
                  <p className="text-xs text-muted-foreground">Available after accounting integration approval and implementation.</p>
                </div>
              </div>
              <span role="status" className="self-start rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground sm:self-auto">
                Unavailable
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export default function Settings() {
  const { user, checkAuth } = useAuth();
  const queryClient = useQueryClient();

  // Profile form
  const [profile, setProfile] = useState({ name: '', skills: '', capacity: 40 });
  const [profileSaved, setProfileSaved] = useState(false);

  // Password form
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setProfile({
        name: user.name || '',
        skills: (user.skills || []).join(', '),
        capacity: user.capacity || 40,
      });
    }
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: (data) => api.updateProfile(data),
    onSuccess: () => {
      checkAuth();
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (data) => api.changePassword(data),
    onSuccess: () => {
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwSaved(true);
      setPwError('');
      setTimeout(() => setPwSaved(false), 3000);
    },
    onError: (err) => {
      setPwError(err.message || 'Failed to change password');
    },
  });

  const handleProfileSave = (e) => {
    e.preventDefault();
    profileMutation.mutate({
      name: profile.name,
      skills: profile.skills.split(',').map(s => s.trim()).filter(Boolean),
      capacity: parseInt(profile.capacity),
    });
  };

  const handlePasswordSave = (e) => {
    e.preventDefault();
    setPwError('');
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwError('New password must be at least 8 characters');
      return;
    }
    passwordMutation.mutate({
      currentPassword: pwForm.currentPassword,
      newPassword: pwForm.newPassword,
    });
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <Section icon={User} title="Profile" description="Update your name, skills, and weekly capacity">
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Full Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground mt-1">Contact an admin to change your email</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Skills</label>
            <input
              type="text"
              value={profile.skills}
              onChange={(e) => setProfile({ ...profile, skills: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g. design, react, shopify, branding"
            />
            <p className="text-xs text-muted-foreground mt-1">Comma-separated. Used for AI task assignment.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Weekly Capacity (hours)</label>
            <input
              type="number"
              min="1"
              max="80"
              value={profile.capacity}
              onChange={(e) => setProfile({ ...profile, capacity: e.target.value })}
              className="w-32 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={profileMutation.isPending} leftIcon={<Save className="w-4 h-4" />}>
              Save Profile
            </Button>
            {profileSaved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </form>
      </Section>

      {/* Password */}
      <Section icon={Lock} title="Password" description="Change your login password">
        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
          {pwError && <p className="text-sm text-destructive">{pwError}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={passwordMutation.isPending} leftIcon={<Lock className="w-4 h-4" />}>
              Change Password
            </Button>
            {pwSaved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Password updated
              </span>
            )}
          </div>
        </form>
      </Section>

      <Section icon={Bell} title="Browser notifications" description="Inspect or change notifications for this browser">
        <NotificationPreferences />
      </Section>

      <Section icon={ListChecks} title="Getting started" description="Resume or restart your role-specific first-success checklist">
        <OnboardingPreferences />
      </Section>

      {/* API Keys */}
      <Section icon={Key} title="API Keys" description="Manage API keys for external integrations like OpenClaw">
        <ApiKeysSection />
      </Section>

      {/* Integrations — admin only */}
      {isAdmin && <IntegrationsSection />}

      {/* AI Model Picker — admin only */}
      {isAdmin && <AIModelSection />}

      {/* Admin links */}
      {isAdmin && (
        <Section icon={Wrench} title="Admin Settings" description="Additional configuration options">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Brand Settings', href: '/admin/brand', desc: 'Logo, colors, company info' },
              { label: 'AI Context', href: '/admin/settings/ai-context', desc: 'Custom AI instructions' },
              { label: 'Command Center', href: '/admin/command-center', desc: 'VPS & GitHub integrations' },
              { label: 'Automations', href: '/automations', desc: 'Workflow automation log' },
              { label: 'Credentials', href: '/credentials', desc: 'Stored API keys & passwords' },
              { label: 'Reports (planned)', desc: 'P&L and team utilization will appear after the finance workflow is approved.' },
            ].map(({ label, href, desc }) => (
              href ? <a
                key={href}
                href={href}
                className="min-h-11 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </a> : <div key={label} aria-disabled="true" className="min-h-11 p-3 rounded-lg border border-dashed border-border bg-muted/30">
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Account info */}
      <div className="text-xs text-muted-foreground text-center pb-4">
        Logged in as <span className="font-medium">{user?.email}</span> ·{' '}
        <span className="capitalize">{user?.role?.toLowerCase()}</span>
      </div>
    </div>
  );
}
