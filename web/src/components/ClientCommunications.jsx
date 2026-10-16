import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { paginatedItems } from '../lib/paginated-items';
import Button from './ui/Button';
import CommunicationTaskDialog from './CommunicationTaskDialog';
import { useAuth } from '../hooks/useAuth';

function MessageDate({ value }) {
  const date = value && new Date(value);
  return date && !Number.isNaN(date.getTime())
    ? <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>
    : <span>Date unavailable</span>;
}

function StoredMessage({ clientId, item, user }) {
  const [taskOpen, setTaskOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const supported = ['inbox', 'project'].includes(item.source);
  const detail = useQuery({
    queryKey: ['client-communication-detail', clientId, item.source, item.id],
    queryFn: () => api.getClientCommunication(clientId, item.source, item.id),
    enabled: open && supported,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const direction = item.direction?.toUpperCase();
  return <li className="rounded-lg border border-border p-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{direction === 'INBOUND' ? 'Received' : direction === 'OUTBOUND' ? 'Sent' : 'Stored message'}</span>
      <MessageDate value={item.receivedAt} />
      <span>{item.source === 'inbox' ? 'Inbox record' : 'Project record'}</span>
    </div>
    <p className="mt-1 break-words font-medium">{item.subject || 'No subject'}</p>
    <p className="break-words text-sm">From: {item.sender || 'Sender unavailable'}</p>
    {item.snippet && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.snippet}</p>}
    <div className="flex flex-wrap gap-x-4">
      {item.threadId && <Link className="inline-flex min-h-11 items-center text-sm underline" to={`/thread/${encodeURIComponent(item.threadId)}`}>Open source thread</Link>}
      {item.projectId && <Link className="inline-flex min-h-11 items-center text-sm underline" to={`/project/${encodeURIComponent(item.projectId)}`}>Open source project</Link>}
    </div>
    {supported && <details onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
      <summary className="min-h-11 cursor-pointer text-sm font-medium">Read stored message</summary>
      {open && <div className="space-y-2 py-2">
        {detail.isPending && <p role="status">Loading stored message…</p>}
        {detail.isError && <div role="alert"><p>This stored message could not be loaded. It may no longer be available to you.</p><Button type="button" variant="outline" disabled={detail.isFetching} onClick={() => detail.refetch()}>Retry stored message</Button></div>}
        {!detail.isError && detail.data && <>
          {detail.data.bodyTruncated && <p role="status" className="text-xs text-muted-foreground">Only part of this stored message is shown. Open the source record to review more if available.</p>}
          <p className="whitespace-pre-wrap break-words text-sm">{detail.data.bodyText || 'No stored message body is available.'}</p>
          {item.source === 'inbox' && ['ADMIN', 'TEAM'].includes(user?.role) && <Button type="button" variant="outline" onClick={() => setTaskOpen(true)}>Create task</Button>}
        </>}
      </div>}
    </details>}
    {taskOpen && !detail.isError && detail.data && ['ADMIN', 'TEAM'].includes(user?.role) && <CommunicationTaskDialog clientId={clientId} message={{ ...item, ...detail.data }} user={user} onClose={() => setTaskOpen(false)} />}
  </li>;
}

function Communications({ clientId, user }) {
  const [open, setOpen] = useState(false);
  const history = useInfiniteQuery({
    queryKey: ['client-communications', clientId],
    queryFn: ({ pageParam }) => api.listClientCommunications(clientId, { limit: 25, ...(pageParam ? { after: pageParam } : {}) }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const pages = history.data?.pages || [];
  const items = paginatedItems(pages, (item) => `${item.source}:${item.id}`);
  const partial = pages.some((page) => page.warnings?.length > 0);
  const exclusions = [...new Set(pages.flatMap((page) => page.coverage?.exclusions || []).filter((entry) => typeof entry === 'string' && entry.trim()))];

  return <details className="rounded-lg border border-border bg-card p-4" onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-medium">Stored email history</summary>
    {open && <div className="space-y-4 pt-2">
      <p className="text-sm text-muted-foreground">Email records already stored in Hub and linked to this client. This is incomplete history, not a live mailbox connection. New messages and other conversations may be missing.</p>
      {history.isPending && <p role="status">Loading stored email history…</p>}
      {history.isError && <div role="alert"><p>Stored email history could not be loaded. Retry to check the records available to you.</p><Button type="button" variant="outline" disabled={history.isFetching} onClick={() => history.refetch()}>Retry email history</Button></div>}
      {!history.isError && history.data && <>
        {exclusions.length > 0 && <div className="space-y-1 text-sm text-muted-foreground"><p className="font-medium">History coverage exclusions</p><ul className="list-disc space-y-1 pl-5">{exclusions.map((entry) => <li key={entry}>{entry}</li>)}</ul></div>}
        {partial && <div role="status" className="space-y-2 text-sm"><p>Some stored sources could not be loaded. The records shown may omit additional email.</p><Button type="button" variant="outline" disabled={history.isFetching} onClick={() => history.refetch()}>Retry missing sources</Button></div>}
        {items.length > 0 ? <ul aria-label="Stored client email" className="space-y-3">{items.map((item) => <StoredMessage key={`${clientId}:${item.source}:${item.id}`} clientId={clientId} item={item} user={user} />)}</ul> : <p className="text-sm text-muted-foreground">No stored email records were returned. This does not mean the client has no email history.</p>}
        {history.hasNextPage && <Button type="button" variant="outline" loading={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load more email</Button>}
      </>}
    </div>}
  </details>;
}

export default function ClientCommunications({ clientId }) {
  const { user } = useAuth();
  return clientId ? <Communications key={`${user?.organizationId}:${user?.id}:${clientId}`} clientId={clientId} user={user} /> : null;
}
