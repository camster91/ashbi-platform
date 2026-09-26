import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, LoadingState } from './ui';
import QueryErrorState from './QueryErrorState';
import ConfirmDialog from './ConfirmDialog';

// Organization "bring your own key" AI provider (#413, docs/ai-byok.md).
// The key is typed into a password field, sent once and never shown again:
// the API only ever returns its last four characters.

const QUERY_KEY = ['ai-connection'];

const inputClass = 'w-full px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20';

const STATUS_LABELS = { active: 'Active', disabled: 'Disabled', revoked: 'Revoked' };

export function parseModelList(text) {
  return [...new Set(String(text || '').split(/[\s,]+/).map((model) => model.trim()).filter(Boolean))];
}

export function dollarsToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

function formatDollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function errorMessage(error, fallback) {
  if (!error) return null;
  const detail = error.data?.errorType ? ` (${error.data.errorType.replace(/_/g, ' ')})` : '';
  return `${error.message || fallback}${detail}`;
}

function UsageBar({ spentCents, budgetCents, alertThresholdPercent }) {
  const percent = budgetCents ? Math.min(100, Math.round((spentCents / budgetCents) * 100)) : 0;
  const tone = percent >= 100 ? 'bg-destructive' : percent >= (alertThresholdPercent || 80) ? 'bg-amber-500' : 'bg-primary';
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span id="ai-byok-usage-label">Estimated spend this month</span>
        <span>{formatDollars(spentCents)} of {formatDollars(budgetCents)}</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby="ai-byok-usage-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% of the monthly budget used`}
        className="h-2 w-full rounded-full bg-muted overflow-hidden"
      >
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ConnectForm({ onDone, pricedModels = [] }) {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [budget, setBudget] = useState('');

  const allowedModels = parseModelList(models);
  const chosenDefault = defaultModel || allowedModels[0] || '';
  const budgetCents = dollarsToCents(budget);
  // Budgets only count priced usage, so the server refuses unpriced models
  // (MODEL_PRICE_UNKNOWN); say so before the admin submits.
  const unpriced = allowedModels.filter((model) => !pricedModels.includes(model));
  const ready = baseUrl.trim() && apiKey && allowedModels.length > 0 && budgetCents && unpriced.length === 0;

  const connect = useMutation({
    mutationFn: () => api.connectAiProvider({
      baseUrl: baseUrl.trim(), apiKey, allowedModels, defaultModel: chosenDefault, monthlyBudgetCents: budgetCents,
    }),
    onSuccess: () => {
      setApiKey('');
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onDone?.();
    },
    // Never keep the key around after a failed attempt either.
    onError: () => setApiKey(''),
  });

  return (
    <form
      className="space-y-3"
      aria-describedby="ai-byok-connect-help"
      onSubmit={(e) => { e.preventDefault(); if (ready) connect.mutate(); }}
    >
      <p id="ai-byok-connect-help" className="text-xs text-muted-foreground">
        Any OpenAI-compatible endpoint. The key is checked with the provider before it is saved, stored encrypted, and never shown again.
      </p>
      <div>
        <label htmlFor="ai-byok-base-url" className="block text-sm font-medium mb-1">Base URL</label>
        <input id="ai-byok-base-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className={inputClass} />
      </div>
      <div>
        <label htmlFor="ai-byok-api-key" className="block text-sm font-medium mb-1">API key</label>
        <input id="ai-byok-api-key" type="password" autoComplete="off" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ai-byok-models" className="block text-sm font-medium mb-1">Allowed models</label>
          <input id="ai-byok-models" aria-describedby="ai-byok-models-help" value={models} onChange={(e) => setModels(e.target.value)} className={inputClass} />
          <p id="ai-byok-models-help" className="text-xs text-muted-foreground mt-1">
            Model ids, separated by commas. {pricedModels.length
              ? `Models with a configured price: ${pricedModels.join(', ')}.`
              : 'No model prices are configured yet; the platform operator sets them (AI_MODEL_PRICES).'}
          </p>
          {unpriced.length > 0 && (
            <p role="alert" className="text-xs text-destructive mt-1">
              No price is configured for {unpriced.join(', ')}, so the budget could not count its usage. Choose priced models or ask the platform operator to add a price.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ai-byok-default-model" className="block text-sm font-medium mb-1">Default model</label>
          <select id="ai-byok-default-model" value={chosenDefault} onChange={(e) => setDefaultModel(e.target.value)} className={inputClass} disabled={allowedModels.length === 0}>
            {allowedModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="ai-byok-budget" className="block text-sm font-medium mb-1">Monthly budget (USD)</label>
        <input id="ai-byok-budget" type="number" min="0.01" step="0.01" required value={budget} onChange={(e) => setBudget(e.target.value)} className={inputClass} />
      </div>
      {connect.error && (
        <p role="alert" className="text-sm text-destructive">{errorMessage(connect.error, 'The provider could not be connected.')}</p>
      )}
      <Button type="submit" disabled={!ready || connect.isPending} loading={connect.isPending}>
        Connect provider
      </Button>
      <p className="text-xs text-muted-foreground">You will be asked to confirm your password or two-factor code.</p>
    </form>
  );
}

function RotateForm({ onDone }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const rotate = useMutation({
    mutationFn: () => api.rotateAiConnectionKey(apiKey),
    onSuccess: () => {
      setApiKey('');
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onDone?.();
    },
    onError: () => setApiKey(''),
  });
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (apiKey) rotate.mutate(); }}>
      <label htmlFor="ai-byok-rotate-key" className="block text-sm font-medium">New API key</label>
      <input id="ai-byok-rotate-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} />
      {rotate.error && (
        <p role="alert" className="text-sm text-destructive">{errorMessage(rotate.error, 'The key could not be rotated. The current key is still in use.')}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!apiKey || rotate.isPending} loading={rotate.isPending}>Replace key</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export default function AiByokSettings() {
  const queryClient = useQueryClient();
  const [rotating, setRotating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: QUERY_KEY, queryFn: () => api.getAiConnection() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const validate = useMutation({ mutationFn: () => api.validateAiConnection(), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: () => api.revokeAiConnection(), onSuccess: () => { setConfirmRevoke(false); refresh(); } });
  const killSwitch = useMutation({ mutationFn: (disabled) => api.setOrganizationAiDisabled(disabled), onSuccess: refresh });

  if (isLoading) return <LoadingState label="Loading AI provider…" compact className="justify-start" size="sm" />;
  if (error) return <QueryErrorState error={error} message="Failed to load the AI provider connection" onRetry={refetch} isRetrying={isFetching} />;

  const connection = data?.connection;
  const connected = connection && connection.status !== 'revoked';
  const usage = data?.usage || {};
  const actionError = validate.error || killSwitch.error;

  return (
    <div className="space-y-5">
      {data?.platformAiDisabled && (
        <p role="status" className="text-sm rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 p-3">
          AI is turned off for this whole deployment by the platform operator.
        </p>
      )}
      {data?.aiDisabled && (
        <p role="status" className="text-sm rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 p-3">
          AI features are turned off for this workspace.
        </p>
      )}

      {connected ? (
        <div className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Provider</dt><dd className="font-medium break-all">{connection.baseUrlHost || connection.baseUrl}</dd></div>
            <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{STATUS_LABELS[connection.status] || connection.status}{connection.disabledReason ? ` (${connection.disabledReason.replace(/[_:]/g, ' ')})` : ''}</dd></div>
            <div><dt className="text-muted-foreground">API key</dt><dd className="font-mono">••••{connection.keyLast4}</dd></div>
            <div><dt className="text-muted-foreground">Default model</dt><dd className="font-medium break-all">{connection.defaultModel}</dd></div>
            <div><dt className="text-muted-foreground">Last checked</dt><dd>{connection.lastValidatedAt ? new Date(connection.lastValidatedAt).toLocaleString('en-CA') : 'Never'}{connection.lastValidationError ? ` · failed (${connection.lastValidationError.replace(/_/g, ' ')})` : ''}</dd></div>
            <div><dt className="text-muted-foreground">Tokens this month</dt><dd>{((usage.promptTokens || 0) + (usage.completionTokens || 0)).toLocaleString('en-CA')}</dd></div>
          </dl>
          <UsageBar spentCents={usage.spentCents} budgetCents={usage.budgetCents} alertThresholdPercent={usage.alertThresholdPercent} />
          {usage.unpricedTokens > 0 && (
            <p className="text-xs text-muted-foreground">
              {usage.unpricedTokens.toLocaleString('en-CA')} tokens used models without a configured price and are not counted toward the budget.
            </p>
          )}
          {validate.data && (
            <p role="status" className="text-sm">
              {validate.data.valid ? 'The provider accepted the key.' : `The provider check failed (${String(validate.data.errorType).replace(/_/g, ' ')}).`}
            </p>
          )}
          {actionError && <p role="alert" className="text-sm text-destructive">{errorMessage(actionError, 'The action failed. Try again.')}</p>}
          {rotating ? (
            <RotateForm onDone={() => setRotating(false)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => validate.mutate()} loading={validate.isPending} disabled={validate.isPending}>Check connection</Button>
              <Button size="sm" variant="outline" onClick={() => setRotating(true)}>Rotate key</Button>
              <Button size="sm" variant="outline" onClick={() => { revoke.reset(); setConfirmRevoke(true); }}>Revoke key</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {connection?.status === 'revoked' && (
            <p className="text-sm text-muted-foreground">The previous key (••••{connection.keyLast4}) was revoked. AI uses the platform provider until you connect a new one.</p>
          )}
          {!connection && <p className="text-sm text-muted-foreground">No provider connected. AI features use the platform provider.</p>}
          <ConnectForm pricedModels={data?.pricedModels || []} />
        </div>
      )}

      <div className="border-t border-border pt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data?.aiDisabled ? 'AI is off for this workspace.' : 'Turn every AI feature off for this workspace, whichever provider it uses.'}
        </p>
        <Button
          size="sm"
          variant={data?.aiDisabled ? 'primary' : 'outline'}
          onClick={() => killSwitch.mutate(!data?.aiDisabled)}
          loading={killSwitch.isPending}
          disabled={killSwitch.isPending}
        >
          {data?.aiDisabled ? 'Turn AI back on' : 'Turn AI off'}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmRevoke}
        title="Revoke AI provider key"
        description="The stored key is deleted and AI features fall back to the platform provider. Revoke the key with your provider too."
        confirmLabel="Revoke key"
        onConfirm={() => revoke.mutate()}
        onCancel={() => { revoke.reset(); setConfirmRevoke(false); }}
        pending={revoke.isPending}
        error={revoke.error?.message}
      />
    </div>
  );
}
