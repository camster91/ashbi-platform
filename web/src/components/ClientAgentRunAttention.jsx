import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Button from './ui/Button';

const denied = (error) => [401, 403, 404].includes(error?.status ?? error?.statusCode);
const reviewed = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));

export default function ClientAgentRunAttention({ run, user, clientId, conversationId, onAccessDenied, readPending = false, expectedScope }) {
  const cache = useQueryClient();
  const [state, setState] = useState('idle');
  const [confirmedAt, setConfirmedAt] = useState(null);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const eligible = run.requestedById === user.id && ['FAILED', 'UNKNOWN'].includes(run.status);
  const isReviewed = reviewed(confirmedAt) || reviewed(run.attentionReviewedAt);
  const key = ['client-agent-conversation', user.organizationId, user.id, clientId, conversationId];

  function validate(value) {
    if (value?.id !== run.id || value.conversationId !== conversationId || value.requestedById !== user.id || value.status !== run.status || (expectedScope && value.scope !== expectedScope) || !(value.attentionReviewedAt === null || reviewed(value.attentionReviewedAt))) throw new Error('Unconfirmed review');
    return value;
  }

  function confirm(value) {
    setConfirmedAt(value.attentionReviewedAt);
    cache.setQueriesData({ queryKey: key }, (old) => {
      if (old?.pages) return { ...old, pages: old.pages.map((page) => ({ ...page, runs: page.runs?.map((entry) => entry.id === run.id ? value : entry) })) };
      return old?.id === run.id ? value : old;
    });
    // Only confirmed persisted review invalidates the queue; never optimistically clear it.
    void cache.invalidateQueries({ queryKey: ['work-queue'] });
    void cache.invalidateQueries({ queryKey: key });
  }

  async function act(recheck) {
    if (!eligible || readPending || isReviewed || busy.current || (!recheck && state === 'unknown')) return;
    busy.current = true;
    setState(recheck ? 'checking' : 'pending');
    try {
      const value = validate(await (recheck ? api.getClientAgentRun(clientId, conversationId, run.id) : api.reviewClientAgentRun(clientId, conversationId, run.id)));
      if (!alive.current) return;
      if (reviewed(value.attentionReviewedAt)) { confirm(value); setState('confirmed'); }
      else setState(recheck ? 'retry' : 'unknown');
    } catch (error) {
      if (!alive.current) return;
      if (denied(error)) onAccessDenied();
      else setState('unknown');
    } finally {
      busy.current = false;
      if (alive.current) setState((current) => ['pending', 'checking'].includes(current) ? 'unknown' : current);
    }
  }

  if (!eligible) return null;
  return <div className="space-y-2 text-sm" aria-label="Run attention review">
    {isReviewed ? <p role="status">Marked reviewed. The run outcome and any possible provider cost are unchanged.</p> : <>
      <p>Review this request, then mark it reviewed to remove it from your daily queue. This does not retry, cancel or change the run outcome.</p>
      {state === 'unknown' ? <div role="alert"><p>Review could not be confirmed. Its outcome is unknown. Check saved review status before trying again.</p><Button type="button" variant="outline" disabled={readPending} onClick={() => act(true)}>Check review status</Button></div> : <>
        {state === 'retry' && <p role="status">The saved run is not marked reviewed. You can explicitly try again.</p>}
        <Button type="button" variant="outline" disabled={readPending || state === 'pending' || state === 'checking'} onClick={() => act(false)}>{state === 'pending' ? 'Marking reviewed…' : state === 'checking' ? 'Checking review…' : 'Mark reviewed'}</Button>
      </>}
    </>}
  </div>;
}