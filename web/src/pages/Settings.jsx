import { embeddedAiEnabled } from '../lib/features';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Lock,
  Save,
  CheckCircle,
  Eye,
  EyeOff,
  Zap,
  Plus,
  Copy,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import QueryErrorState from '../components/QueryErrorState';
import { Button, Card, LoadingState, Tabs, TabList, Tab, TabPanel } from '../components/ui';
import ConfirmDialog from '../components/ConfirmDialog';
import TwoFactorSettings from '../components/TwoFactorSettings';
import OrganizationMfaPolicy from '../components/OrganizationMfaPolicy';
import ActivityLog from '../components/ActivityLog';
import WorkspaceConnectionGuide from '../components/WorkspaceConnectionGuide';
import { AgentAccessTable, AgentSafetyRules } from '../components/settings/AgentAccess';
const AiByokSettings = lazy(() => import('../components/AiByokSettings'));
const AiApprovals = lazy(() => import('../components/AiApprovals'));

// Ashbi Hub settings (design: Settings mockup). A side list of sections kept
// in ?section= so a link or the back button lands on the same view; Agents
// and MCP is the default. Business, Payments and Team are admin-only, as are
// the admin-only panels inside the shared sections (the API enforces each).

function Section({ title, description, actions, children }) {
  // Expose each settings card as a named accessible region so screen-reader
  // users (and tests) can address one section without page-global queries.
  const headingId = `settings-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <Card padding="lg" className="border-border/60" role="region" aria-labelledby={headingId}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-heading font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

const TAG_COLORS = {
  vision:   'bg-primary/10 text-primary',
  tools:    'bg-info/10 text-info',
  thinking: 'bg-warning/10 text-warning',
  audio:    'bg-success/10 text-success',
  cloud:    'bg-info/10 text-info',
};

export function NotificationPreferences() {
  const { user } = useAuth();
  const { permission, subscribed, status, error, supported, offline, cleanupPending, subscribe, unsubscribe } = usePushNotifications({ userId: user?.id });
  // An unclaimed legacy subscription or a failed Disable can still deliver.
  // Keep removal available without treating that subscription as consent.
  const cleanupIncomplete = cleanupPending;
  const busy = status === 'subscribing' || status === 'unsubscribing';

  let summary = 'Notifications are available but not enabled.';
  if (!supported) summary = 'This browser does not support web push notifications.';
  else if (offline) summary = 'You are offline. Reconnect to change this preference.';
  else if (permission === 'denied') summary = 'Notifications are blocked in browser settings.';
  else if (cleanupIncomplete) summary = 'A notification subscription remains in this browser without this account\'s consent. Notifications may still arrive. Select Disable notifications to remove it before enabling notifications for this account.';
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
        {subscribed || cleanupIncomplete ? (
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

function GoogleCalendarPreferences() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['google-calendar-connection'],
    queryFn: api.getGoogleCalendarConnection,
    retry: false,
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectGoogleCalendar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['google-calendar-connection'] }),
  });
  const connection = data?.connection;
  const busy = disconnect.isPending;

  if (isLoading) return <LoadingState label="Checking Google Calendar connection…" compact className="justify-start" size="sm" />;
  if (error) {
    return <QueryErrorState error={error} message="Google Calendar connection could not be loaded" onRetry={refetch} isRetrying={isFetching} />;
  }

  const connected = connection?.status === 'ACTIVE';
  const connect = () => window.location.assign(api.googleCalendarOAuthStartUrl());

  return (
    <div className="space-y-4">
      <div aria-live="polite" aria-atomic="true">
        <p className="text-sm font-medium text-foreground">
          {connected ? 'Google Calendar is connected for this account.' : 'Google Calendar is not connected.'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ashbi only syncs an event when its creator explicitly selects Sync to Google Calendar. Ashbi remains the source of truth; no calendar events are imported.
        </p>
      </div>
      {connection?.lastError && <p role="alert" className="text-sm text-destructive">Last connection error: {connection.lastError}</p>}
      {disconnect.error && <p role="alert" className="text-sm text-destructive">{disconnect.error.message || 'Google Calendar could not be disconnected.'}</p>}
      <div className="flex flex-wrap gap-2">
        {connected ? (
          <Button type="button" variant="outline" isLoading={busy} disabled={busy} onClick={() => disconnect.mutate()}>
            {busy ? 'Disconnecting…' : 'Disconnect Google Calendar'}
          </Button>
        ) : (
          <Button type="button" onClick={connect}>Connect Google Calendar</Button>
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

export function toModelNames(models) {
  if (!models) return [];
  const values = Array.isArray(models) ? models : Object.values(models);
  return values.filter((name) => typeof name === 'string' && name.length > 0);
}

function AIModelSection() {
  const queryClient = useQueryClient();
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
    // Only seed the picker; never overwrite a model the user already chose.
    if (aiData?.ollamaModel) {
      setSelectedModel((current) => current || aiData.ollamaModel);
    }
  }, [aiData]);

  const mutation = useMutation({
    mutationFn: (model) => api.setAIProvider('ollama', model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-provider'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const canManage = aiData?.canManage === true;

  // The API returns model names, either as an array (live list) or as the
  // values of the OLLAMA_MODELS map. Key every card by its real model name so
  // the value we save is a model the provider can use.
  const modelNames = [...new Set([
    ...toModelNames(modelData?.models),
    ...toModelNames(aiData?.ollamaModels),
    ...(aiData?.ollamaModel ? [aiData.ollamaModel] : []),
  ])];
  const families = {};
  modelNames.forEach((name) => {
    const family = name.split(':')[0] || 'Other';
    if (!families[family]) families[family] = [];
    families[family].push({ key: name, label: name, tags: [] });
  });

  return (
    <Section title="AI Model" description="Choose which Ollama model powers all AI features">
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
                    disabled={!canManage}
                    aria-pressed={selectedModel === key}
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
          {canManage ? (
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
              <span className="text-sm text-success flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Saved for this server until it restarts
              </span>
            )}
            {mutation.isError && (
              <span role="alert" className="text-sm text-destructive">
                {mutation.error?.message || 'Failed to change the AI model'}
              </span>
            )}
          </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The AI model is shared by every workspace on this deployment, so only a platform operator can change it.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-mono font-medium">{aiData?.ollamaModel || '—'}</span>
          </p>
        </div>
      )}
    </Section>
  );
}

// Mirrors API_KEY_SCOPES in src/auth/api-key-scopes.js (the server rejects
// anything else). Labels are for the settings UI only.
const API_KEY_SCOPE_OPTIONS = [
  { value: 'workspace:read', label: 'Read workspace', description: 'Projects, clients and tasks through API or MCP. No AI provider needed.' },
  { value: 'workspace:actions', label: 'Workspace actions', description: 'Prepare and separately confirm authorized workspace actions. Saved-report publication requires an administrator.' },
  { value: 'ai_bridge:read', label: 'Embedded AI chat (legacy)', description: 'Ask the AI bridge about projects, tasks, clients and retainers.' },
  { value: 'ai_bridge:actions', label: 'AI bridge actions (legacy)', description: 'Prepare and confirm tasks, calendar events and Slack messages.' },
];
const API_KEY_SCOPE_LABELS = Object.fromEntries(API_KEY_SCOPE_OPTIONS.map((option) => [option.value, option.label]));
const API_KEY_EXPIRY_OPTIONS = [30, 90, 180, 365];

export function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState(['workspace:read']);
  const [newKeyExpiryDays, setNewKeyExpiryDays] = useState(90);
  const [createdKey, setCreatedKey] = useState(null);
  const [keyToRevoke, setKeyToRevoke] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [mcpFeedback, setMcpFeedback] = useState(null);
  const nameInputRef = useRef(null);
  const { data: oauthStatus } = useQuery({ queryKey: ['mcp-oauth-status'], queryFn: () => api.getMcpOAuthStatus(), retry: false });

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
    mutationFn: (name) => api.createApiKey({ name, scopes: newKeyScopes, expiresInDays: newKeyExpiryDays }),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setCopyFeedback(null);
      setNewKeyName('');
      setNewKeyScopes(['workspace:read']);
      setNewKeyExpiryDays(90);
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

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback({ error: false, message: 'API key copied.' });
    } catch {
      setCopyFeedback({ error: true, message: 'Copy failed. Select the key and copy it manually before dismissing it.' });
    }
  };

  const mcpUrl = `${window.location.origin}/api/mcp`;
  const copyMcpAddress = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setMcpFeedback({ error: false, message: 'MCP address copied.' });
    } catch {
      setMcpFeedback({ error: true, message: 'Copy failed. Select the address and copy it manually.' });
    }
  };

  return (
    <div className="space-y-5">
      <Section
        title="Connected agents"
        description="Each agent connects with its own key. Revoke a key to switch that agent off straight away."
        actions={(
          <Button type="button" onClick={() => nameInputRef.current?.focus()} leftIcon={<Plus className="w-4 h-4" />}>
            Connect an agent
          </Button>
        )}
      >
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
          <p className="text-sm text-muted-foreground">No agents are connected yet. Create a key below to connect one.</p>
        ) : (
          <ul aria-label="Connected agents" className="divide-y divide-border/40">
            {keysData.keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 py-3.5 first:pt-0">
                <span className="inline-flex shrink-0 rounded bg-secondary px-2 py-0.5 text-eyebrow text-secondary-foreground">
                  {(key.scopes || []).some((scope) => scope.endsWith(':actions')) ? 'Can prepare changes' : 'Read only'}
                </span>
                <div className="min-w-0 flex-[1_1_260px]">
                  <p className="text-sm font-semibold text-foreground break-words">
                    {key.name}
                    {!key.expiresAt && (
                      <span className="ml-2 inline-flex rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                        No expiry
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Scopes: {(key.scopes || []).length
                      ? key.scopes.map((scope) => API_KEY_SCOPE_LABELS[scope] || scope).join(', ')
                      : 'none'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(key.createdAt).toLocaleDateString('en-CA')}
                    {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString('en-CA')}`}
                    {key.expiresAt && ` · Expires ${new Date(key.expiresAt).toLocaleDateString('en-CA')}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="danger-outline"
                  size="sm"
                  aria-label={`Revoke ${key.name}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => { deleteMutation.reset(); setKeyToRevoke(key); }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-background p-4">
          <div className="min-w-0 flex-[1_1_260px]">
            <p className="text-eyebrow text-muted-foreground">MCP address</p>
            <code className="block font-mono text-sm text-foreground break-all select-all">{mcpUrl}</code>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={copyMcpAddress} aria-label="Copy MCP address" leftIcon={<Copy className="w-4 h-4" />}>
            Copy
          </Button>
          {mcpFeedback && (
            <p role={mcpFeedback.error ? 'alert' : 'status'} className={`basis-full text-sm ${mcpFeedback.error ? 'text-destructive' : 'text-muted-foreground'}`}>
              {mcpFeedback.message}
            </p>
          )}
        </div>

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
      </Section>

      <Section title="Connect an agent" description="Create a key for Claude, Codex, ChatGPT or any other MCP client">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Discover tools at <code>/api/agent/tools</code>. MCP endpoint: <code>/api/mcp</code>. Use a scoped API key as a Bearer token. Writes return a preview and require a separate confirmation.</p>
          <WorkspaceConnectionGuide oauthEnabled={oauthStatus?.enabled === true} showMcpEndpoint={false} />
          {createMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {createMutation.error.message || 'The API key could not be created. Try again.'}
            </p>
          )}
          {/* Create new key */}
          <div className="flex flex-wrap gap-2">
            <input
              ref={nameInputRef}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name, e.g. Claude desktop"
              aria-label="API key name"
              className="min-h-11 min-w-0 flex-1 px-3 py-2 text-sm bg-background text-foreground rounded-lg border border-border focus:outline-hidden focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newKeyName.trim() && newKeyScopes.length > 0) {
                  createMutation.mutate(newKeyName.trim());
                }
              }}
            />
            <Button
              onClick={() => createMutation.mutate(newKeyName.trim())}
              disabled={!newKeyName.trim() || newKeyScopes.length === 0 || createMutation.isPending}
              leftIcon={<Plus className="w-4 h-4" />}
              loading={createMutation.isPending}
            >
              Create Key
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-medium mb-1">Scopes</legend>
              <div className="space-y-1">
                {API_KEY_SCOPE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={newKeyScopes.includes(option.value)}
                      onChange={(e) => setNewKeyScopes((current) => (e.target.checked
                        ? [...new Set([...current, option.value])]
                        : current.filter((scope) => scope !== option.value)))}
                    />
                    <span>
                      {option.label}
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {newKeyScopes.length === 0 && (
                <p className="text-xs text-destructive mt-1">Choose at least one scope.</p>
              )}
            </fieldset>
            <div>
              <label htmlFor="api-key-expiry" className="block text-sm font-medium mb-1">Expires after</label>
              <select
                id="api-key-expiry"
                value={newKeyExpiryDays}
                onChange={(e) => setNewKeyExpiryDays(Number(e.target.value))}
                className="min-h-11 w-full px-3 py-2 text-sm bg-background text-foreground rounded-lg border border-border focus:outline-hidden focus:ring-2 focus:ring-ring"
              >
                {API_KEY_EXPIRY_OPTIONS.map((days) => (
                  <option key={days} value={days}>{days === 365 ? '1 year' : `${days} days`}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">You will be asked to confirm your password or two-factor code.</p>
            </div>
          </div>

          {/* Show newly created key (only shown once) */}
          {createdKey && (
            <div className="p-3 bg-success/5 border border-success/30 rounded-lg">
              <p className="text-sm font-medium text-success mb-1">
                API key created! Copy it now — you won't see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-card dark:bg-card p-2 rounded font-mono break-all select-all">
                  {createdKey}
                </code>
                <button
                  onClick={() => copyToClipboard(createdKey)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  title="Copy to clipboard"
                  aria-label="Copy API key"
                >
                  <Copy className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              {copyFeedback && <p role={copyFeedback.error ? 'alert' : 'status'} className="text-sm mt-2">{copyFeedback.message}</p>}
              <button
                onClick={() => { setCreatedKey(null); setCopyFeedback(null); }}
                className="min-h-11 text-xs text-muted-foreground hover:text-foreground mt-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                I've copied it — dismiss
              </button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Use your API key in the <code className="bg-muted px-1 rounded">x-api-key</code> header or as a <code className="bg-muted px-1 rounded">Bearer</code> token.
          </p>
        </div>
      </Section>
    </div>
  );
}

export function IntegrationsSection() {
  const providers = [
    { type: 'QUICKBOOKS', name: 'QuickBooks Online', color: 'bg-success text-success-foreground' },
    { type: 'XERO', name: 'Xero', color: 'bg-info text-info-foreground' },
  ];

  return (
    <Section title="Accounting Integrations" description="Accounting providers are not currently available">
      <div className="space-y-4">
        {providers.map(provider => {
          return (
            <div key={provider.type} className="flex flex-col gap-3 p-4 bg-muted/50 rounded-lg sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${provider.color} flex items-center justify-center font-bold text-sm`}>
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

function SlackIntegrationPreferences() {
  const queryClient = useQueryClient();
  const [mappingForm, setMappingForm] = useState({ installationId: '', projectId: '', channelId: '', channelName: '', inboundEnabled: true, outboundEnabled: false });
  const { data: installationData, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['slack-installations'], queryFn: api.getSlackInstallations, retry: false,
  });
  const { data: projectsData } = useQuery({
    queryKey: ['projects', 'slack-mapping'], queryFn: () => api.getProjects(), retry: false,
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectSlackInstallation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['slack-installations'] }),
  });
  const mapChannel = useMutation({
    mutationFn: ({ installationId, ...data }) => api.createSlackChannelMapping(installationId, data),
    onSuccess: () => {
      setMappingForm((current) => ({ ...current, channelId: '', channelName: '' }));
      queryClient.invalidateQueries({ queryKey: ['slack-installations'] });
    },
  });
  const installations = installationData?.installations || [];
  const activeInstallations = installations.filter((installation) => installation.status === 'ACTIVE');
  const projects = projectsData?.projects || [];

  if (isLoading) return <LoadingState label="Checking Slack installations…" compact className="justify-start" size="sm" />;
  if (error) return <QueryErrorState error={error} message="Slack installations could not be loaded" onRetry={refetch} isRetrying={isFetching} />;

  const submitMapping = (event) => {
    event.preventDefault();
    mapChannel.mutate({ ...mappingForm, channelId: mappingForm.channelId.trim(), channelName: mappingForm.channelName.trim() || undefined });
  };

  return (
    <div className="space-y-4">
      <div aria-live="polite" aria-atomic="true">
        <p className="text-sm font-medium text-foreground">{activeInstallations.length ? `${activeInstallations.length} active Slack workspace${activeInstallations.length === 1 ? '' : 's'}` : 'No Slack workspace is connected.'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Only explicitly mapped project channels can receive inbound messages or confirmed outbound posts. Disconnect immediately stops processing and clears the stored token.</p>
      </div>
      {disconnect.error && <p role="alert" className="text-sm text-destructive">{disconnect.error.message || 'Slack could not be disconnected.'}</p>}
      <Button type="button" onClick={() => window.location.assign(api.slackOAuthStartUrl())}>Connect Slack workspace</Button>

      {installations.map((installation) => (
        <div key={installation.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">{installation.teamName || installation.teamId}</p>
              <p className="text-xs text-muted-foreground">{installation.status} · {Array.isArray(installation.scopes) ? installation.scopes.join(', ') : 'scopes unavailable'}</p>
            </div>
            {installation.status === 'ACTIVE' && <Button type="button" variant="outline" isLoading={disconnect.isPending} disabled={disconnect.isPending} onClick={() => disconnect.mutate(installation.id)}>Disconnect</Button>}
          </div>
          {installation.channelMappings?.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{installation.channelMappings.map((mapping) => <li key={mapping.id}>#{mapping.channelName || mapping.channelId} → project {mapping.projectId} ({mapping.inboundEnabled ? 'inbound' : 'no inbound'}; {mapping.outboundEnabled ? 'outbound' : 'no outbound'})</li>)}</ul>}
        </div>
      ))}

      {activeInstallations.length > 0 && (
        <form onSubmit={submitMapping} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium text-foreground">Map a project channel</p>
          <select aria-label="Slack workspace" required value={mappingForm.installationId} onChange={(event) => setMappingForm({ ...mappingForm, installationId: event.target.value })} className="w-full rounded border border-border bg-background px-2 py-2 text-sm">
            <option value="">Choose workspace</option>
            {activeInstallations.map((installation) => <option key={installation.id} value={installation.id}>{installation.teamName || installation.teamId}</option>)}
          </select>
          <select aria-label="Ashbi project" required value={mappingForm.projectId} onChange={(event) => setMappingForm({ ...mappingForm, projectId: event.target.value })} className="w-full rounded border border-border bg-background px-2 py-2 text-sm">
            <option value="">Choose project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <input aria-label="Slack channel ID" required value={mappingForm.channelId} onChange={(event) => setMappingForm({ ...mappingForm, channelId: event.target.value })} className="w-full rounded border border-border bg-background px-2 py-2 text-sm" placeholder="Channel ID, for example C0123ABC" />
          <input aria-label="Slack channel name" value={mappingForm.channelName} onChange={(event) => setMappingForm({ ...mappingForm, channelName: event.target.value })} className="w-full rounded border border-border bg-background px-2 py-2 text-sm" placeholder="Channel name (optional)" />
          <div className="flex flex-wrap gap-4 text-sm text-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={mappingForm.inboundEnabled} onChange={(event) => setMappingForm({ ...mappingForm, inboundEnabled: event.target.checked })} /> Receive inbound messages</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={mappingForm.outboundEnabled} onChange={(event) => setMappingForm({ ...mappingForm, outboundEnabled: event.target.checked })} /> Allow confirmed outbound posts</label>
          </div>
          <Button type="submit" isLoading={mapChannel.isPending} disabled={mapChannel.isPending || !mappingForm.installationId || !mappingForm.projectId || !mappingForm.channelId.trim()}>{mapChannel.isPending ? 'Saving mapping…' : 'Save channel mapping'}</Button>
          {mapChannel.error && <p role="alert" className="text-sm text-destructive">{mapChannel.error.message || 'Slack channel mapping could not be saved.'}</p>}
        </form>
      )}
    </div>
  );
}

// Order follows the mockup, with the personal Profile first.
const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Profile', title: 'Your', accent: 'profile', description: 'Your name, skills and weekly capacity, and your getting-started checklist.' },
  { id: 'business', label: 'Business', adminOnly: true, title: 'Your', accent: 'studio', description: 'Brand, workspace tools and the logins Ashbi Hub keeps for your clients.' },
  { id: 'payments', label: 'Payments', adminOnly: true, title: 'Payments', accent: 'and billing', description: 'Accounting connections, retainers, rates and overdue follow-ups.' },
  { id: 'agents', label: 'Agents and MCP', title: 'Agents', accent: 'and MCP', description: 'Let Claude, Codex or any MCP agent work in Ashbi Hub. You decide what each one can see and do.' },
  { id: 'team', label: 'Team', adminOnly: true, title: 'Your', accent: 'team', description: 'The people in this workspace and how their time is reviewed.' },
  { id: 'security', label: 'Security', title: 'Security', accent: 'and sign-in', description: 'Your password, two-factor authentication and, for administrators, workspace-wide rules and the activity log.' },
  { id: 'alerts', label: 'Alerts', title: 'Your', accent: 'alerts', description: 'Browser notifications for assigned work and client activity.' },
  { id: 'integrations', label: 'Integrations', title: 'Connected', accent: 'apps', description: 'Your Google Calendar and, for administrators, the Slack workspace.' },
];
const DEFAULT_SECTION = 'agents';

function AdminLinks({ links }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {links.map(({ label, href, desc }) => (
        href ? <Link
          key={href}
          to={href}
          className="min-h-11 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
        </Link> : <div key={label} aria-disabled="true" className="min-h-11 p-3 rounded-lg border border-dashed border-border bg-muted/30">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
      ))}
    </div>
  );
}

export default function Settings() {
  const { user, checkAuth } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Profile form
  const [profile, setProfile] = useState({ name: '', skills: '', capacity: 100 });
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
        capacity: user.capacity ?? 100,
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
  const isStaff = user && user.role !== 'CLIENT' && user.role !== 'BOT';

  const sections = SETTINGS_SECTIONS.filter((section) => isAdmin || !section.adminOnly);
  const requested = params.get('section');
  const oauthReturn = params.has('googleCalendar') || params.has('slack');
  const sectionId = sections.some((section) => section.id === requested)
    ? requested
    : oauthReturn ? 'integrations' : DEFAULT_SECTION;
  const current = sections.find((section) => section.id === sectionId);
  const selectSection = (next) => {
    const nextParams = new URLSearchParams(params);
    // The OAuth return markers only choose the first view.
    for (const marker of ['googleCalendar', 'slack', 'code']) nextParams.delete(marker);
    if (next === DEFAULT_SECTION) nextParams.delete('section'); else nextParams.set('section', next);
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <p className="text-eyebrow text-muted-foreground">Settings</p>
        <h1 className="mt-1.5 text-3xl font-heading font-semibold tracking-tight text-foreground">
          {current.title} <span className="font-display italic font-normal text-primary">{current.accent}</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{current.description}</p>
      </div>

      <Tabs value={sectionId} onValueChange={selectSection} orientation="vertical" className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <TabList aria-label="Settings sections" className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:flex lg:w-52 lg:shrink-0 lg:flex-col">
          {sections.map((section) => (
            <Tab
              key={section.id}
              value={section.id}
              className="justify-start rounded-md border border-transparent border-b px-3 text-left text-foreground hover:bg-muted/60 hover:text-foreground data-[state=active]:border-border/60 data-[state=active]:bg-card data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-xs whitespace-normal"
            >
              {section.label}
            </Tab>
          ))}
        </TabList>

        <div className="min-w-0 flex-1">
          <TabPanel value="profile" className="space-y-5">
      {/* Profile */}
      <Section title="Profile" description="Update your name, skills, and capacity percentage">
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label htmlFor="settings-profile-name" className="block text-sm font-medium mb-1">Full Name</label>
            <input
              id="settings-profile-name"
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="settings-profile-email" className="block text-sm font-medium mb-1">Email</label>
            <input
              id="settings-profile-email"
              type="email"
              value={user?.email || ''}
              aria-describedby="settings-profile-email-help"
              disabled
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-muted-foreground cursor-not-allowed"
            />
            <p id="settings-profile-email-help" className="text-xs text-muted-foreground mt-1">Contact an admin to change your email</p>
          </div>
          <div>
            <label htmlFor="settings-profile-skills" className="block text-sm font-medium mb-1">Skills</label>
            <input
              id="settings-profile-skills"
              type="text"
              value={profile.skills}
              aria-describedby="settings-profile-skills-help"
              onChange={(e) => setProfile({ ...profile, skills: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g. design, react, shopify, branding"
            />
            <p id="settings-profile-skills-help" className="text-xs text-muted-foreground mt-1">Comma-separated. Used for AI task assignment.</p>
          </div>
          <div>
            <label htmlFor="settings-profile-capacity" className="block text-sm font-medium mb-1">Capacity (%)</label>
            <input
              id="settings-profile-capacity"
              aria-describedby="settings-profile-capacity-help"
              type="number"
              min="0"
              max="200"
              value={profile.capacity}
              onChange={(e) => setProfile({ ...profile, capacity: e.target.value })}
              className="w-32 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            <p id="settings-profile-capacity-help" className="text-xs text-muted-foreground mt-1">100% represents 40 hours per week; 50% represents 20 hours.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={profileMutation.isPending} leftIcon={<Save className="w-4 h-4" />}>
              Save Profile
            </Button>
            {profileSaved && (
              <span className="text-sm text-success flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </form>
      </Section>


            <Section title="Getting started" description="Resume or restart your role-specific first-success checklist">
              <OnboardingPreferences />
            </Section>
          </TabPanel>

          {isAdmin && (
            <TabPanel value="business" className="space-y-5">
              <Section title="Studio" description="Your brand, workspace tools and stored logins">
                <AdminLinks links={[
                  { label: 'Brand Settings', href: '/admin/brand', desc: 'Logo, colors, company info' },
                  ...(embeddedAiEnabled ? [{ label: 'AI Context', href: '/admin/settings/ai-context', desc: 'Custom AI instructions' }] : []),
                  { label: 'Command Center', href: '/admin/command-center', desc: 'VPS & GitHub integrations' },
                  { label: 'Automations', href: '/automations', desc: 'Workflow automation log' },
                  { label: 'Credentials', href: '/credentials', desc: 'Stored API keys & passwords' },
                  { label: 'Approvals', href: '/approvals', desc: 'Pending automation and content approvals' },
                ]} />
              </Section>
            </TabPanel>
          )}

          {isAdmin && (
            <TabPanel value="payments" className="space-y-5">
              <IntegrationsSection />
              <Section title="Billing tools" description="Recurring plans, rates and overdue follow-ups">
                <AdminLinks links={[
                  { label: 'Retainers', href: '/retainers', desc: 'Recurring client retainers' },
                  { label: 'Rate cards', href: '/rate-cards', desc: 'Billable rates for estimates and time' },
                  { label: 'Invoice Chaser', href: '/invoice-chaser', desc: 'Overdue invoice follow-ups' },
                  { label: 'Reports (planned)', desc: 'P&L and team utilization will appear after the finance workflow is approved.' },
                ]} />
              </Section>
            </TabPanel>
          )}

          {/* Kept mounted (hidden) while another section is open: a newly
              created key is shown only once, so leaving the section must not
              discard it before it is copied. */}
          <TabPanel value="agents" forceMount className="space-y-5">
            <ApiKeysSection />
            <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
              <Section title="What agents can do" description="Access is set per key, by scope, when you create it">
                <AgentAccessTable />
              </Section>
              <Section title="Safety rules" description="Enforced by Ashbi Hub for every agent">
                <AgentSafetyRules />
              </Section>
            </div>

            {/* AI approvals and receipts (#413 slice 2): admins see the workspace, team members their own */}
            {embeddedAiEnabled && (isAdmin || user?.role === 'TEAM') && (
              <Section title="Action approvals" description="Review proposed actions and their execution receipts">
                <Suspense fallback={null}><AiApprovals /></Suspense>
              </Section>
            )}

            {/* AI Model Picker — admin only */}
            {embeddedAiEnabled && isAdmin && <AIModelSection />}

            {/* Organization BYOK AI provider, budget and kill switch (#413) — admin only */}
            {embeddedAiEnabled && isAdmin && (
              <Section title="AI provider (bring your own key)" description="Use your own AI provider account, cap monthly spend, or turn AI off for this workspace">
                <Suspense fallback={null}><AiByokSettings /></Suspense>
              </Section>
            )}
          </TabPanel>

          {isAdmin && (
            <TabPanel value="team" className="space-y-5">
              <Section title="People" description="Who works in this workspace and how their time is reviewed">
                <AdminLinks links={[
                  { label: 'Team', href: '/team', desc: 'Invite people, set roles and capacity' },
                  { label: 'Timesheets', href: '/timesheets', desc: 'Review and approve logged time' },
                ]} />
              </Section>
            </TabPanel>
          )}

          <TabPanel value="security" className="space-y-5">
      {/* Password */}
      <Section title="Password" description="Change your login password">
        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div>
            <label htmlFor="settings-current-password" className="block text-sm font-medium mb-1">Current Password</label>
            <div className="relative">
              <input
                id="settings-current-password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Hide passwords' : 'Show passwords'}
                aria-pressed={showPw}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPw ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="settings-new-password" className="block text-sm font-medium mb-1">New Password</label>
            <input
              id="settings-new-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
              minLength={8}
            />
          </div>
          <div>
            <label htmlFor="settings-confirm-password" className="block text-sm font-medium mb-1">Confirm New Password</label>
            <input
              id="settings-confirm-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
          {pwError && <p role="alert" className="text-sm text-destructive">{pwError}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={passwordMutation.isPending} leftIcon={<Lock className="w-4 h-4" />}>
              Change Password
            </Button>
            {pwSaved && (
              <span className="text-sm text-success flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Password updated
              </span>
            )}
          </div>
        </form>
      </Section>
            {isStaff && (
              <Section title="Two-factor authentication" description="Protect your account with an authenticator app">
                <TwoFactorSettings />
              </Section>
            )}

            {/* Organization MFA requirement — admin only (the API also enforces this) */}
            {isAdmin && (
              <Section title="Organization security" description="Require two-factor authentication for every staff account in this workspace">
                <OrganizationMfaPolicy />
              </Section>
            )}

            {/* Append-only audit trail — admin only (the API also enforces this) */}
            {isAdmin && (
              <Section title="Activity log" description="Who sent or settled invoices, signed contracts, and changed access">
                <ActivityLog />
              </Section>
            )}
          </TabPanel>

          <TabPanel value="alerts" className="space-y-5">
            <Section title="Browser notifications" description="Inspect or change notifications for this browser">
              <NotificationPreferences />
            </Section>
          </TabPanel>

          <TabPanel value="integrations" className="space-y-5">
            <Section title="Google Calendar" description="Connect your own calendar and explicitly sync events you create">
              <GoogleCalendarPreferences />
            </Section>

            {/* Slack — admin only */}
            {isAdmin && <Section title="Slack workspace" description="Install Slack and explicitly map project channels"><SlackIntegrationPreferences /></Section>}
          </TabPanel>
        </div>
      </Tabs>

      {/* Account info */}
      <div className="text-xs text-muted-foreground text-center pb-4">
        Logged in as <span className="font-medium">{user?.email}</span> ·{' '}
        <span className="capitalize">{user?.role?.toLowerCase()}</span>
      </div>
    </div>
  );
}
