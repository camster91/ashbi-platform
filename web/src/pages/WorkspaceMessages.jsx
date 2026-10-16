import { useClientPages } from '../hooks/useClients';
import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { paginatedItems } from '../lib/paginated-items';
import { useAuth } from '../hooks/useAuth';
import Button from '../components/ui/Button';
import Input, { inputStyles } from '../components/ui/Input';
import WorkspaceChatAttention, { AttentionAcknowledgement } from '../components/WorkspaceChatAttention';

function conversationName(channel, userId) {
  if (channel.kind === 'DIRECT') {
    const names = (channel.members || []).filter((member) => (member.userId || member.user?.id) !== userId).map((member) => member.user?.name).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  return channel.name || 'Direct message';
}

function readMessageIntent(name) {
  try {
    const raw = sessionStorage.getItem(name);
    if (!raw) return { intent: null, blocked: false };
    const value = JSON.parse(raw);
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(value.key || '') || !/^[a-f0-9]{64}$/.test(value.fingerprint || '')) throw Error('Invalid saved intent');
    return { intent: { key: value.key, fingerprint: value.fingerprint }, blocked: false };
  } catch { return { intent: null, blocked: true }; }
}
async function messageFingerprint(input) {
  const payload = { content: input.content, parentId: input.parentId ?? null, attentionRecipientIds: [...input.attentionRecipientIds].sort() };
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function Conversation({ channel, user }) {
  const userId = user.id;
  const storageKey = `ashbi:chat-message:${[user.organizationId, userId, channel.id].map(encodeURIComponent).join(':')}`;
  const [recovery] = useState(() => readMessageIntent(storageKey));
  const [storageBlocked, setStorageBlocked] = useState(recovery.blocked);
  const cache = useQueryClient();
  const [content, setContent] = useState('');
  const [reply, setReply] = useState(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const [attentionRecipients, setAttentionRecipients] = useState([]);
  const [uncertain, setUncertain] = useState(Boolean(recovery.intent));
  const intent = useRef(recovery.intent);
  const busy = useRef(false);
  const id = useId();
  const queryKey = ['workspace-chat-messages', userId, channel.id];
  const history = useInfiniteQuery({ queryKey, initialPageParam: undefined, queryFn: ({ pageParam }) => api.getWorkspaceChatMessages(channel.id, { limit: 30, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: (page) => page.nextCursor || undefined, retry: false, refetchInterval: 10000, refetchOnWindowFocus: true });
  const messages = history.isError ? [] : paginatedItems((history.data?.pages || []).slice().reverse(), (message) => message.id);
  const latestId = messages.at(-1)?.id;
  const frozen = pending || (uncertain && Boolean(intent.current?.input)) || storageBlocked;
  const currentMembers = history.isError ? [] : (history.data?.pages?.[0]?.channel?.members || []).filter(member => !member.leftAt && member.userId !== userId && member.user?.isActive === true && ['ADMIN', 'TEAM'].includes(member.user.role)).slice(0, 29);
  const unavailableSelection = attentionRecipients.some(value => !currentMembers.some(member => member.userId === value));
  useEffect(() => {
    if (!latestId || history.isError) return;
    // Read tracking is advisory. Failure never hides the actual conversation.
    api.markWorkspaceChatRead(channel.id).catch(() => {});
  }, [channel.id, latestId, history.isError]);

  async function send(event) {
    event.preventDefault();
    if (busy.current || !content.trim() || content.length > 4000 || history.isError || storageBlocked || (unavailableSelection && !uncertain)) return;
    busy.current = true; setPending(true); setFailure(false);
    try {
      const input = intent.current?.input || { content: content.trim(), ...(reply ? { parentId: reply.id } : {}), attentionRecipientIds: [...attentionRecipients].sort() };
      const fingerprint = await messageFingerprint(input);
      if (intent.current?.fingerprint && intent.current.fingerprint !== fingerprint) { setFailure(true); return; }
      if (!intent.current) intent.current = { key: crypto.randomUUID(), fingerprint };
      try {
        const saved = JSON.stringify({ key: intent.current.key, fingerprint });
        sessionStorage.setItem(storageKey, saved);
        if (sessionStorage.getItem(storageKey) !== saved) throw Error('Storage unavailable');
      } catch { setStorageBlocked(true); return; }
      intent.current.input = input;
      await api.postWorkspaceChatMessage(channel.id, { ...intent.current.input, idempotencyKey: intent.current.key });
      sessionStorage.removeItem(storageKey);
      setContent(''); setReply(null); setAttentionRecipients([]); setUncertain(false); intent.current = null;
      await Promise.all([cache.invalidateQueries({ queryKey }), cache.invalidateQueries({ queryKey: ['workspace-chat-attention'] })]);
    } catch (error) { setFailure(true); if (uncertain || ![400, 401, 403, 404, 409, 429].includes(error?.status ?? error?.statusCode)) setUncertain(true); else { try { sessionStorage.removeItem(storageKey); } catch { setStorageBlocked(true); } intent.current = null; setUncertain(false); } }
    finally { busy.current = false; setPending(false); }
  }

  async function checkDelivery() {
    if (!intent.current || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const result = await api.getWorkspaceChatMessageIntent(channel.id, intent.current.key);
      if (!result.message?.id || result.message.clientKey !== intent.current.key || result.message.intentHash !== intent.current.fingerprint) throw Error('Unconfirmed delivery');
      sessionStorage.removeItem(storageKey);
      setContent(''); setReply(null); setAttentionRecipients([]); setUncertain(false); setFailure(false); intent.current = null;
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
          {message.attention?.length > 0 && <ul aria-label="Requested attention">{message.attention.map(attention => <li key={attention.id} className="space-y-1 text-sm">
            <span>{attention.recipient?.name || 'Team member'}: {attention.acknowledgedAt ? 'Acknowledged' : 'Attention requested'}</span>
            {attention.recipientId === userId && !attention.acknowledgedAt && <AttentionAcknowledgement attention={attention} channelId={channel.id} />}
          </li>)}</ul>}
          <Button type="button" size="sm" variant="ghost" disabled={frozen} aria-label={`Reply to ${message.author?.name || 'team member'}: ${message.content.slice(0, 40)}`} onClick={() => { setReply(message); if (!uncertain) intent.current = null; }}>Reply</Button>
        </li>)}
      </ol>
      <form onSubmit={send} className="space-y-2">
        {reply && <div className="text-sm"><p>Replying to {reply.author?.name || 'team member'}: {reply.content.slice(0, 80)}</p><Button type="button" variant="ghost" disabled={frozen} onClick={() => { setReply(null); if (!uncertain) intent.current = null; }}>Cancel reply</Button></div>}
        <label htmlFor={id}>Message</label>
        <textarea id={id} className={inputStyles('min-h-24')} maxLength={4000} value={content} disabled={frozen} onChange={(event) => { setContent(event.target.value); if (!uncertain) intent.current = null; setFailure(false); }} />
        {currentMembers.length > 0 && <fieldset disabled={frozen} className="space-y-2"><legend>Request attention from current members (optional)</legend>
          <p className="text-xs text-muted-foreground">Select people explicitly. Typing @names does not request attention, assign work, or run a bot.</p>
          {currentMembers.map(member => <label key={member.userId} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={attentionRecipients.includes(member.userId)} onChange={event => { setAttentionRecipients(current => event.target.checked ? [...current, member.userId] : current.filter(value => value !== member.userId)); if (!uncertain) intent.current = null; }} />{member.user.name}</label>)}
        </fieldset>}
        {unavailableSelection && !uncertain && <div role="alert"><p>A selected recipient is no longer an active member. Review and clear the selection before sending.</p><Button type="button" variant="outline" disabled={pending || storageBlocked} onClick={() => { setAttentionRecipients([]); intent.current = null; }}>Clear attention selection</Button></div>}
        {failure && <p role="alert">{uncertain ? 'Message delivery could not be confirmed. Your draft and recipients are frozen. Check saved status or retry this same message; a missing receipt does not prove failure.' : 'Message was refused. Review the current members and draft before trying again.'}</p>}
        {uncertain && <Button type="button" variant="outline" disabled={pending} onClick={checkDelivery}>Check saved message status</Button>}
        {uncertain && !intent.current?.input && <p role="status">A delivery intent was recovered without its private message text. Check saved status, or re-enter the exact message, reply and recipients to retry the same intent.</p>}
        {storageBlocked && <p role="alert">This browser cannot safely retain delivery intent. Sending is unavailable.</p>}
        <Button type="submit" loading={pending} disabled={!content.trim() || storageBlocked || (unavailableSelection && !uncertain)}>{uncertain ? 'Retry same message' : 'Send message'}</Button>
      </form>
    </>}
  </section>;
}

async function projectPage(params) {
  const response = await api.getProjects(params);
  if (!Array.isArray(response?.projects)) throw new Error('Conversation scope unavailable');
  return response;
}

function StaffMessages({ user }) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [attentionChannel, setAttentionChannel] = useState(null);
  const [kind, setKind] = useState('DIRECT');
  const [name, setName] = useState('');
  const [members, setMembers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [creationUnknown, setCreationUnknown] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const creatingRef = useRef(false);
  const id = useId();
  const channelQueryKey = ['workspace-chat-channels', user.id];
  const channels = useInfiniteQuery({ queryKey: channelQueryKey, initialPageParam: undefined, queryFn: ({ pageParam }) => api.listWorkspaceChatChannels({ limit: 50, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: (page) => page.nextCursor || undefined, retry: false });
  const people = useQuery({ queryKey: ['workspace-chat-people', user.id], queryFn: () => api.listWorkspaceChatPeople(), retry: false });
  const channelItems = paginatedItems(channels.data?.pages, (item) => item.id);
  const channel = channels.isError ? null : channelItems.find((item) => item.id === selected) || (attentionChannel?.id === selected ? attentionChannel : null);
  const scopedKind = kind === 'CLIENT' || kind === 'PROJECT';
  const clients = useClientPages({ enabled: newOpen && scopedKind, limit: 100, scope: [user.organizationId, user.id, user.role] });
  const clientItems = clients.isError ? [] : paginatedItems(clients.data?.pages.map(page => ({ items: page.clients })), item => item.id).filter(item => !item.deletedAt && (!item.organizationId || item.organizationId === user.organizationId));
  const selectedClient = !clients.isError && clientItems.find(item => item.id === clientId);
  const projects = useInfiniteQuery({ queryKey: ['chat-create-projects', user.organizationId, user.id, user.role, clientId], enabled: newOpen && kind === 'PROJECT' && Boolean(selectedClient),
    initialPageParam: 0, queryFn: ({ pageParam }) => projectPage({ clientId, limit: 100, offset: pageParam }),
    getNextPageParam: (page, _pages, offset) => offset + page.projects.length < page.total && page.projects.length ? offset + page.projects.length : undefined, retry: false });
  const projectItems = projects.isError ? [] : paginatedItems(projects.data?.pages.map(page => ({ items: page.projects })), item => item.id).filter(item => item.clientId === clientId && !item.deletedAt && (!item.organizationId || item.organizationId === user.organizationId));
  const selectedProject = !projects.isError && projectItems.find(item => item.id === projectId);
  const peopleItems = people.isError ? [] : (people.data?.items || []).filter(person => person.id !== user.id && person.isActive !== false && (!person.role || ['ADMIN', 'TEAM'].includes(person.role)) && (!person.organizationId || person.organizationId === user.organizationId));
  const validMembers = members.every(member => peopleItems.some(person => person.id === member));
  const cannotCreate = creating || creationUnknown || people.isPending || people.isError || !validMembers || (kind === 'DIRECT' ? members.length !== 1 : !name.trim())
    || (kind === 'COMPANY' && (!members.length || user.role !== 'ADMIN')) || (scopedKind && (!selectedClient || clients.isFetching)) || (kind === 'PROJECT' && (!selectedProject || projects.isFetching));


  async function create(event) {
    event.preventDefault();
    if (creatingRef.current || cannotCreate) return;
    creatingRef.current = true; setCreating(true); setFailed(false);
    try {
      const result = await api.createWorkspaceChatChannel({ kind, memberIds: members, ...(kind !== 'DIRECT' ? { name: name.trim() } : {}), ...(scopedKind ? { clientId } : {}), ...(kind === 'PROJECT' ? { projectId } : {}) });
      if (!alive.current) return;
      await cache.invalidateQueries({ queryKey: channelQueryKey });
      // A new channel can sort beyond the first page. Keep the server-created
      // result reachable immediately; later pages are deduplicated by id.
      cache.setQueryData(channelQueryKey, (current) => current ? { ...current, pages: current.pages.map((page, index) => index === 0 ? { ...page, items: [...page.items.filter((item) => item.id !== result.channel.id), result.channel] } : page) } : { pages: [{ items: [result.channel], nextCursor: null }], pageParams: [undefined] });
      setSelected(result.channel.id); setName(''); setMembers([]);
    } catch (error) { if (alive.current) { setFailed(true); setCreationUnknown(kind !== 'DIRECT' && ![400, 401, 403, 404, 409, 429].includes(error?.status ?? error?.statusCode)); } }
    finally { creatingRef.current = false; if (alive.current) setCreating(false); }
  }

  return <div className="space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Team messages</h1><p className="text-sm text-muted-foreground">Shared conversations for your team. Messages stay inside Hub.</p><Link to="/chat" className="inline-flex min-h-11 items-center text-sm underline">Open Ash AI</Link></header>
    <WorkspaceChatAttention user={user} onOpen={source => { setAttentionChannel(source); setSelected(source.id); }} />
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="Conversations">
        <h2 className="font-semibold">Channels and direct messages</h2>
        {channels.isPending && <p role="status">Loading channels…</p>}
        {channels.isError && <div role="alert"><p>Channels could not be loaded.</p><Button variant="outline" onClick={() => channels.refetch()}>Retry channels</Button></div>}
        {!channels.isError && <ul>{channelItems.map((item) => <li key={item.id}><button type="button" className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>{conversationName(item, user.id)}<span className="block text-xs text-muted-foreground">{item.kind.toLowerCase()}</span></button></li>)}</ul>}
        {!channels.isPending && !channels.isError && channelItems.length === 0 && <p className="text-sm text-muted-foreground">No conversations yet.</p>}
        {!channels.isError && channels.hasNextPage && <Button variant="outline" disabled={channels.isFetchingNextPage} onClick={() => channels.fetchNextPage()}>Load more conversations</Button>}
        <details onToggle={(event) => { if (event.target === event.currentTarget) setNewOpen(event.currentTarget.open); }}><summary className="min-h-11 cursor-pointer font-medium">New conversation</summary>
          <form onSubmit={create} className="space-y-3">
            <div><label htmlFor={`${id}-kind`}>Conversation type</label><select id={`${id}-kind`} className={inputStyles()} value={kind} disabled={creating || creationUnknown} onChange={(event) => { setKind(event.target.value); setMembers([]); setClientId(''); setProjectId(''); setFailed(false); }}><option value="DIRECT">Direct message</option>{user.role === 'ADMIN' && <option value="COMPANY">Company channel</option>}<option value="CLIENT">Client channel</option><option value="PROJECT">Project channel</option></select></div>
            {scopedKind && <div className="space-y-2"><label htmlFor={`${id}-client`}>Client</label><select id={`${id}-client`} className={inputStyles()} required value={clientId} disabled={creating || creationUnknown || clients.isPending || clients.isError} onChange={(event) => { setClientId(event.target.value); setProjectId(''); }}><option value="">Choose a client</option>{clientItems.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
              {clients.isPending && <p role="status">Loading clients...</p>}{clients.isError && <div role="alert">Clients could not be loaded.<Button type="button" variant="outline" onClick={() => clients.refetch()}>Retry clients</Button></div>}
              {!clients.isPending && !clients.isError && !clientItems.length && <p role="status">No available clients.</p>}
              {clients.hasNextPage && <Button type="button" variant="outline" disabled={clients.isFetchingNextPage || creating || creationUnknown} onClick={() => clients.fetchNextPage()}>Load more clients</Button>}
            </div>}
            {kind === 'PROJECT' && selectedClient && <div className="space-y-2"><label htmlFor={`${id}-project`}>Project</label><select id={`${id}-project`} className={inputStyles()} required value={projectId} disabled={creating || creationUnknown || projects.isPending || projects.isError} onChange={(event) => setProjectId(event.target.value)}><option value="">Choose a client project</option>{projectItems.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
              {projects.isPending && <p role="status">Loading client projects...</p>}{projects.isError && <div role="alert">Projects could not be loaded.<Button type="button" variant="outline" onClick={() => projects.refetch()}>Retry client projects</Button></div>}
              {!projects.isPending && !projects.isError && !projectItems.length && <p role="status">This client has no available projects.</p>}
              {projects.hasNextPage && <Button type="button" variant="outline" disabled={projects.isFetchingNextPage || creating || creationUnknown} onClick={() => projects.fetchNextPage()}>Load more client projects</Button>}
            </div>}
            {kind !== 'DIRECT' ? <div><label htmlFor={`${id}-name`}>Channel name</label><Input id={`${id}-name`} value={name} maxLength={100} required disabled={creating || creationUnknown} onChange={(event) => setName(event.target.value)} /><p className="text-xs text-muted-foreground">Only you and the selected staff members can access this channel. Client and project channels do not invite clients or grant portal access.</p>{selectedClient && <p className="text-sm">Client: {selectedClient.name}{kind === 'PROJECT' && selectedProject ? ` / Project: ${selectedProject.name}` : ''}</p>}<fieldset><legend>Channel members</legend>{peopleItems.map((person) => <label key={person.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={members.includes(person.id)} disabled={creating || creationUnknown || (!members.includes(person.id) && members.length >= 29)} onChange={(event) => setMembers(event.target.checked ? [...members, person.id] : members.filter((member) => member !== person.id))} />{person.name}</label>)}</fieldset></div> : <div><label htmlFor={`${id}-person`}>Team member</label><select id={`${id}-person`} className={inputStyles()} disabled={creating || creationUnknown || people.isError || people.isPending} value={members[0] || ''} required onChange={(event) => setMembers(event.target.value ? [event.target.value] : [])}><option value="">Choose a team member</option>{peopleItems.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>}
            {people.isError && <div role="alert"><p>Team members could not be loaded.</p><Button type="button" variant="outline" onClick={() => people.refetch()}>Retry team members</Button></div>}
            {failed && <p role="alert">{creationUnknown ? 'Conversation creation could not be confirmed. Your draft is preserved. Reload conversations and check for the channel before creating another; this form will not repeat the request.' : 'The conversation could not be created. Check your choices and try again.'}</p>}
            {creationUnknown && <Button type="button" variant="outline" disabled={channels.isFetching} onClick={() => channels.refetch()}>Reload conversations</Button>}
            <Button type="submit" loading={creating} disabled={cannotCreate}>Create conversation</Button>
          </form>
        </details>
      </aside>
      {channel ? <Conversation key={`${user.organizationId}-${user.id}-${channel.id}`} channel={channel} user={user} /> : <p role="status" className="p-4 text-muted-foreground">Choose a conversation to see its messages.</p>}
    </div>
  </div>;
}

export default function WorkspaceMessages() {
  const { user } = useAuth();
  if (!['ADMIN', 'TEAM'].includes(user?.role)) return <p role="alert" className="p-6">Team messages are available to staff only.</p>;
  return <StaffMessages key={`${user.organizationId}:${user.id}:${user.role}`} user={user} />;
}
