import { useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { paginatedItems } from '../lib/paginated-items';
import Button from './ui/Button';

export function AttentionAcknowledgement({ attention, channelId }) {
  const cache = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  async function acknowledge() {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(false);
    try {
      const result = await api.acknowledgeWorkspaceChatAttention(channelId, attention.id);
      if (!result.attention?.acknowledgedAt) throw Error('Unconfirmed acknowledgement');
      await Promise.all([cache.invalidateQueries({ queryKey: ['workspace-chat-attention'] }), cache.invalidateQueries({ queryKey: ['workspace-chat-messages'] })]);
    } catch { setError(true); }
    finally { busy.current = false; setPending(false); }
  }
  return <div>
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={acknowledge}>Acknowledge attention</Button>
    {error && <p role="alert">Acknowledgement could not be confirmed. Reload to check; repeating this acknowledgement is safe.</p>}
  </div>;
}

export default function WorkspaceChatAttention({ user, onOpen }) {
  const query = useInfiniteQuery({ queryKey: ['workspace-chat-attention', user.organizationId, user.id], initialPageParam: undefined,
    queryFn: ({ pageParam }) => api.listWorkspaceChatAttention({ limit: 20, ...(pageParam ? { after: pageParam } : {}) }),
    getNextPageParam: page => page.nextCursor || undefined, retry: false, refetchInterval: 10000 });
  const items = query.isError ? [] : paginatedItems(query.data?.pages || [], row => row.id);
  return <section aria-label="Attention requested from you" className="space-y-3 rounded-xl border border-border bg-card p-4">
    <h2 className="font-semibold">Attention requested from you</h2>
    <p className="text-sm text-muted-foreground">Explicit requests from human channel members. Acknowledged means seen, not task completion or an assignment transfer. No external notifications are sent.</p>
    {query.isPending && <p role="status">Loading attention requests…</p>}
    {query.isError && <p role="alert">Attention requests are unavailable. Channel access may have changed.</p>}
    <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Reload attention</Button>
    {!query.isPending && !query.isError && <p role="status">{items.length} pending requests loaded{query.hasNextPage ? '; more are available.' : '.'}</p>}
    <ul className="space-y-3">{items.map(row => <li key={row.id} className="rounded-lg border border-border p-3">
      <p className="text-sm">{row.message.author?.name || 'Team member'} · {row.channel.name}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{row.message.content}</p>
      <Button type="button" variant="ghost" onClick={() => onOpen(row.channel)}>Open source conversation</Button>
      <AttentionAcknowledgement attention={row} channelId={row.channelId} />
    </li>)}</ul>
    {!query.isError && query.hasNextPage && <Button type="button" variant="outline" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Load more attention requests</Button>}
  </section>;
}
