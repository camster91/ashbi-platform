import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { paginatedItems } from '../lib/paginated-items';
import { useAuth } from '../hooks/useAuth';
import Button from '../components/ui/Button';
import Input, { inputStyles } from '../components/ui/Input';

function conversationName(channel, userId) {
  if (channel.kind === 'DIRECT') {
    const names = (channel.members || []).filter((member) => (member.userId || member.user?.id) !== userId).map((member) => member.user?.name).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  return channel.name || 'Direct message';
}

function Conversation({ channel, userId }) {
  const cache = useQueryClient();
  const [content, setContent] = useState('');
  const [reply, setReply] = useState(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const intent = useRef(null);
  const busy = useRef(false);
  const id = useId();
  const queryKey = ['workspace-chat-messages', userId, channel.id];
  const history = useInfiniteQuery({ queryKey, initialPageParam: undefined, queryFn: ({ pageParam }) => api.getWorkspaceChatMessages(channel.id, { limit: 30, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: (page) => page.nextCursor || undefined, retry: false, refetchInterval: 10000, refetchOnWindowFocus: true });
  const messages = history.isError ? [] : paginatedItems((history.data?.pages || []).slice().reverse(), (message) => message.id);
  const latestId = messages.at(-1)?.id;
  useEffect(() => {
    if (!latestId || history.isError) return;
    // Read tracking is advisory. Failure never hides the actual conversation.
    api.markWorkspaceChatRead(channel.id).catch(() => {});
  }, [channel.id, latestId, history.isError]);

  async function send(event) {
    event.preventDefault();
    if (busy.current || !content.trim() || content.length > 4000 || history.isError) return;
    if (!intent.current) intent.current = crypto.randomUUID();
    busy.current = true; setPending(true); setFailure(false);
    try {
      await api.postWorkspaceChatMessage(channel.id, { content: content.trim(), ...(reply ? { parentId: reply.id } : {}), idempotencyKey: intent.current });
      setContent(''); setReply(null); intent.current = null;
      await cache.invalidateQueries({ queryKey });
    } catch { setFailure(true); }
    finally { busy.current = false; setPending(false); }
  }

  return <section aria-label={`Conversation: ${conversationName(channel, userId)}`} className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4">
    <h2 className="text-lg font-semibold">{conversationName(channel, userId)}</h2>
    <p className="text-xs text-muted-foreground">{channel.kind === 'COMPANY' ? 'Company channel' : `${channel.kind?.toLowerCase() || 'Shared'} conversation`} · Checks for new messages every 10 seconds.</p>
    {history.isPending && <p role="status">Loading conversation…</p>}
    {history.isError && <div role="alert"><p>This conversation is unavailable. Access may have changed. Retry to check.</p><Button variant="outline" onClick={() => history.refetch()}>Retry conversation</Button></div>}
    {!history.isPending && !history.isError && <>
      {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load older messages</Button>}
      {!messages.length && <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>}
      <ol aria-label="Messages" className="space-y-3">
        {messages.map((message) => <li key={message.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{message.author?.name || 'Team member'}</span><time className="text-xs text-muted-foreground" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></div>
          {message.parentId && <p className="text-xs text-muted-foreground">Reply to {messages.find((parent) => parent.id === message.parentId)?.author?.name || 'an earlier message'}</p>}
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
          <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Reply to ${message.author?.name || 'team member'}: ${message.content.slice(0, 40)}`} onClick={() => { setReply(message); intent.current = null; }}>Reply</Button>
        </li>)}
      </ol>
      <form onSubmit={send} className="space-y-2">
        {reply && <div className="text-sm"><p>Replying to {reply.author?.name || 'team member'}: {reply.content.slice(0, 80)}</p><Button type="button" variant="ghost" disabled={pending} onClick={() => { setReply(null); intent.current = null; }}>Cancel reply</Button></div>}
        <label htmlFor={id}>Message</label>
        <textarea id={id} className={inputStyles('min-h-24')} maxLength={4000} value={content} disabled={pending} onChange={(event) => { setContent(event.target.value); intent.current = null; setFailure(false); }} />
        {failure && <p role="alert">Message delivery could not be confirmed. Your draft is preserved. Retry sends this same message safely.</p>}
        <Button type="submit" loading={pending} disabled={!content.trim()}>Send message</Button>
      </form>
    </>}
  </section>;
}

function StaffMessages({ user }) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [kind, setKind] = useState('DIRECT');
  const [name, setName] = useState('');
  const [members, setMembers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const creatingRef = useRef(false);
  const id = useId();
  const channelQueryKey = ['workspace-chat-channels', user.id];
  const channels = useInfiniteQuery({ queryKey: channelQueryKey, initialPageParam: undefined, queryFn: ({ pageParam }) => api.listWorkspaceChatChannels({ limit: 50, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: (page) => page.nextCursor || undefined, retry: false });
  const people = useQuery({ queryKey: ['workspace-chat-people', user.id], queryFn: () => api.listWorkspaceChatPeople(), retry: false });
  const channelItems = paginatedItems(channels.data?.pages, (item) => item.id);
  const channel = channels.isError ? null : channelItems.find((item) => item.id === selected);

  async function create(event) {
    event.preventDefault();
    if (creatingRef.current || (kind === 'COMPANY' && (!name.trim() || !members.length || user.role !== 'ADMIN')) || (kind === 'DIRECT' && members.length !== 1)) return;
    creatingRef.current = true; setCreating(true); setFailed(false);
    try {
      const result = await api.createWorkspaceChatChannel({ kind, ...(kind === 'COMPANY' ? { name: name.trim(), memberIds: members } : { memberIds: members }) });
      await cache.invalidateQueries({ queryKey: channelQueryKey });
      // A new channel can sort beyond the first page. Keep the server-created
      // result reachable immediately; later pages are deduplicated by id.
      cache.setQueryData(channelQueryKey, (current) => current ? { ...current, pages: current.pages.map((page, index) => index === 0 ? { ...page, items: [...page.items.filter((item) => item.id !== result.channel.id), result.channel] } : page) } : { pages: [{ items: [result.channel], nextCursor: null }], pageParams: [undefined] });
      setSelected(result.channel.id); setName(''); setMembers([]);
    } catch { setFailed(true); }
    finally { creatingRef.current = false; setCreating(false); }
  }

  return <div className="space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Team messages</h1><p className="text-sm text-muted-foreground">Shared conversations for your team. Messages stay inside Hub.</p><Link to="/chat" className="inline-flex min-h-11 items-center text-sm underline">Open Ash AI</Link></header>
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="Conversations">
        <h2 className="font-semibold">Channels and direct messages</h2>
        {channels.isPending && <p role="status">Loading channels…</p>}
        {channels.isError && <div role="alert"><p>Channels could not be loaded.</p><Button variant="outline" onClick={() => channels.refetch()}>Retry channels</Button></div>}
        {!channels.isError && <ul>{channelItems.map((item) => <li key={item.id}><button type="button" className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>{conversationName(item, user.id)}<span className="block text-xs text-muted-foreground">{item.kind.toLowerCase()}</span></button></li>)}</ul>}
        {!channels.isPending && !channels.isError && channelItems.length === 0 && <p className="text-sm text-muted-foreground">No conversations yet.</p>}
        {!channels.isError && channels.hasNextPage && <Button variant="outline" disabled={channels.isFetchingNextPage} onClick={() => channels.fetchNextPage()}>Load more conversations</Button>}
        <details><summary className="min-h-11 cursor-pointer font-medium">New conversation</summary>
          <form onSubmit={create} className="space-y-3">
            {user.role === 'ADMIN' && <div><label htmlFor={`${id}-kind`}>Conversation type</label><select id={`${id}-kind`} className={inputStyles()} value={kind} disabled={creating} onChange={(event) => { setKind(event.target.value); setMembers([]); }}><option value="DIRECT">Direct message</option><option value="COMPANY">Company channel</option></select></div>}
            {kind === 'COMPANY' ? <div><label htmlFor={`${id}-name`}>Channel name</label><Input id={`${id}-name`} value={name} maxLength={100} required disabled={creating} onChange={(event) => setName(event.target.value)} /><p className="text-xs text-muted-foreground">Only you and the selected members can access this channel.</p><fieldset><legend>Channel members</legend>{(people.data?.items || []).filter((person) => person.id !== user.id).map((person) => <label key={person.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={members.includes(person.id)} disabled={creating || (!members.includes(person.id) && members.length >= 29)} onChange={(event) => setMembers(event.target.checked ? [...members, person.id] : members.filter((member) => member !== person.id))} />{person.name}</label>)}</fieldset></div> : <div><label htmlFor={`${id}-person`}>Team member</label><select id={`${id}-person`} className={inputStyles()} disabled={creating || people.isError || people.isPending} value={members[0] || ''} required onChange={(event) => setMembers(event.target.value ? [event.target.value] : [])}><option value="">Choose a team member</option>{(people.data?.items || []).filter((person) => person.id !== user.id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>}
            {people.isError && <div role="alert"><p>Team members could not be loaded.</p><Button type="button" variant="outline" onClick={() => people.refetch()}>Retry team members</Button></div>}
            {failed && <p role="alert">The conversation could not be created. Check your choices and try again.</p>}
            <Button type="submit" loading={creating} disabled={kind === 'DIRECT' ? members.length !== 1 : !name.trim() || !members.length}>Create conversation</Button>
          </form>
        </details>
      </aside>
      {channel ? <Conversation key={`${user.id}-${channel.id}`} channel={channel} userId={user.id} /> : <p role="status" className="p-4 text-muted-foreground">Choose a conversation to see its messages.</p>}
    </div>
  </div>;
}

export default function WorkspaceMessages() {
  const { user } = useAuth();
  if (!['ADMIN', 'TEAM'].includes(user?.role)) return <p role="alert" className="p-6">Team messages are available to staff only.</p>;
  return <StaffMessages key={user.id} user={user} />;
}
