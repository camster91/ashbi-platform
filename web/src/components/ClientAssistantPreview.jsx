import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import Button from './ui/Button';

// Fixed copy only: provider errors can contain credentials or response bodies.
const ERROR_MESSAGES = new Map([
  ['CLIENT_AGENT_PLUGIN_DISABLED', 'Client work is disabled for this account manager. Enable it in Account manager settings to use project context.'],
  ['CLIENT_AGENT_PAUSED', 'This account manager is paused. Enable it in Account manager settings before generating a preview.'],
  ['AI_DISABLED', 'AI is turned off. Ask an admin to check the workspace AI settings.'],
  ['AI_BUDGET_EXCEEDED', 'This workspace has reached its monthly AI budget. Ask an admin to review the budget in Settings.'],
  ['AI_UNAVAILABLE', 'AI is not set up for this workspace. Ask an admin to check the AI provider in Settings.'],
  ['AI_CONNECTION_DISABLED', 'The workspace AI connection is disabled. Ask an admin to review it in Settings.'],
  ['AI_CONNECTION_UNAVAILABLE', 'The workspace AI connection is unavailable. Ask an admin to review it in Settings.'],
  ['AI_PROVIDER_AUTH', 'The AI provider rejected the workspace connection. Ask an admin to check the API key in Settings.'],
  ['AI_PROVIDER_QUOTA', 'The AI provider account has reached its credit or quota limit. Ask an admin to check the provider account.'],
  ['AI_PROVIDER_RATE_LIMIT', 'The AI provider is busy. Wait a minute before generating another preview.'],
  ['AI_PROVIDER_TIMEOUT', 'The AI provider did not answer in time. Try generating the preview again in a minute.'],
  ['AI_PROVIDER_INVALID_REQUEST', 'The AI provider rejected the request. Ask an admin to check the model in Settings.'],
  ['AI_PROVIDER_UPSTREAM', 'The AI provider is temporarily unavailable. Try generating the preview again later.'],
  ['AI_PROVIDER_INVALID_RESPONSE', 'The AI provider returned an unreadable response. Try generating the preview again.'],
]);

export default function ClientAssistantPreview({ clientId, clientName }) {
  const questionId = useId();
  const descriptionId = useId();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const currentClient = useRef(clientId);
  const request = useRef(0);
  const submitting = useRef(false);
  currentClient.current = clientId;

  useEffect(() => {
    request.current += 1;
    submitting.current = false;
    setMessage('');
    setPending(false);
    setError('');
    setResult(null);
    return () => { request.current += 1; };
  }, [clientId]);

  async function submit(event) {
    event.preventDefault();
    const question = message.trim();
    if (!clientId || !question || question.length > 2000 || submitting.current) return;
    const sequence = ++request.current;
    const requestedClient = clientId;
    const isCurrent = () => sequence === request.current && requestedClient === currentClient.current;
    submitting.current = true;
    setPending(true);
    setError('');
    setResult(null);
    try {
      const response = await api.previewClientAssistant(requestedClient, { message: question });
      if (isCurrent()) setResult({ ...response, clientId: requestedClient });
    } catch (failure) {
      if (isCurrent()) {
        setError(ERROR_MESSAGES.get(failure?.data?.code)
          || 'Assistant preview could not be generated. Try again when you are ready.');
      }
    } finally {
      if (isCurrent()) {
        submitting.current = false;
        setPending(false);
      }
    }
  }

  const visibleResult = result?.clientId === clientId ? result : null;
  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="min-h-11 cursor-pointer font-medium">Ask the account manager</summary>
      <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
        Staff preview for {clientName || 'this client'} using shareable project information.
        {' '}Client chat is not enabled. Conversations are not saved and no actions are taken.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
          {[
            ['Project status', 'Summarize this client’s project status and identify dates that need confirmation.'],
            ['Draft client update', 'Draft a short client update using only these project records. List missing information for staff review.'],
            ['Clarify a request', 'What information should we confirm before accepting a new client request? Prepare questions for a human handoff.'],
          ].map(([label, question]) => (
            <Button key={label} type="button" size="sm" variant="outline" disabled={pending} onClick={() => setMessage(question)}>{label}</Button>
          ))}
        </div>
        <label htmlFor={questionId} className="block text-sm font-medium">Ask about this client</label>
        <textarea
          id={questionId}
          aria-describedby={descriptionId}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          rows={3}
          required
          disabled={pending}
          className="w-full rounded-lg border border-input bg-background p-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" isLoading={pending} disabled={!clientId || !message.trim() || pending}>
          Generate preview
        </Button>
      </form>
      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {pending && 'Generating preview…'}
        {visibleResult && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words">{visibleResult.response}</p>
            <div>
              <p className="font-medium">Project context used</p>
              {visibleResult.context?.projects?.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {visibleResult.context.projects.map((project, index) => (
                    <li key={project.id || index}>{project.name} — {project.status}</li>
                  ))}
                </ul>
              ) : <p className="text-muted-foreground">No shareable projects were included.</p>}
              {visibleResult.context?.truncated && (
                <p className="mt-1 text-muted-foreground">Only part of this client’s project information was included.</p>
              )}
            </div>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </details>
  );
}
