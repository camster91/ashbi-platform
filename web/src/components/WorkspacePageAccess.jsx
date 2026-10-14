import { useState, useId } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';

const control = 'min-h-11 min-w-0 max-w-full rounded border border-border bg-card px-3';
export default function WorkspacePageAccess({ pageId }) {
  const fieldId = useId();
  const cache = useQueryClient(); const [draft, setDraft] = useState(null); const [search, setSearch] = useState(''); const [chosen, setChosen] = useState(''); const [reloadError, setReloadError] = useState('');
  const query = useQuery({ queryKey: ['workspacePageAccess', pageId], queryFn: () => api.getWorkspacePageAccess(pageId) });
  const options = useInfiniteQuery({ queryKey: ['workspacePageAccessOptions', pageId, search], enabled: (draft ?? query.data)?.mode === 'RESTRICTED', initialPageParam: null,
    queryFn: ({ pageParam }) => api.getWorkspacePageAccessOptions(pageId, { search, limit: 25, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const config = draft ?? query.data;
  const save = useMutation({ mutationFn: () => api.saveWorkspacePageAccess(pageId, { revision: config.revision, mode: config.mode, members: config.mode === 'TEAM' ? [] : config.members.map(({ userId, role }) => ({ userId, role })) }), onSuccess: current => { cache.setQueryData(['workspacePageAccess', pageId], current); setDraft(null); cache.invalidateQueries({ queryKey: ['workspacePage'] }); cache.invalidateQueries({ queryKey: ['workspacePages'] }); cache.invalidateQueries({ queryKey: ['workspacePageParents'] }); cache.invalidateQueries({ queryKey: ['workspacePageChildren'] }); } });
  if (query.isPending) return <p role="status">Loading page access…</p>;
  if (query.isError) return <QueryErrorState error={query.error} message="Page access could not be loaded" onRetry={query.refetch} />;
  const items = options.data?.pages.flatMap(page => page.items) ?? [];
  return <section aria-label="Knowledge page access" className="rounded border border-border p-4 space-y-3 min-w-0">
    <h2 className="font-semibold">Page access</h2><p className="text-sm">The page owner and organization administrators retain access. Parent restrictions also apply, and changing this audience can change visibility of nested pages.</p>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
        <div><label className="block" htmlFor={`${fieldId}-audience`}>Audience</label><select id={`${fieldId}-audience`} className={`block ${control}`} value={config.mode} onChange={event => setDraft({ ...config, mode: event.target.value, members: event.target.value === 'TEAM' ? [] : config.members })}><option value="TEAM">All Ashbi staff</option><option value="RESTRICTED">Restricted staff</option></select></div>
        {config.mode === 'RESTRICTED' && <>
          <label className="block">Search teammates<input className={`block w-full ${control}`} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setChosen(''); }} /></label>
          <div><label className="block" htmlFor={`${fieldId}-teammate`}>Teammate</label><select id={`${fieldId}-teammate`} className={`block w-full ${control}`} value={chosen} onChange={event => setChosen(event.target.value)}><option value="">Choose a teammate</option>{items.filter(item => !config.members.some(member => member.userId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {options.isError && <QueryErrorState error={options.error} message="Teammates could not be loaded" onRetry={options.refetch} />}
          {options.hasNextPage && <button type="button" className="min-h-11 underline" disabled={options.isFetchingNextPage} onClick={() => options.fetchNextPage()}>Load more teammates</button>}
          <button type="button" className="min-h-11 underline" disabled={!chosen || config.members.length >= 100} onClick={() => { const person = items.find(item => item.id === chosen); if (person) { setDraft({ ...config, members: [...config.members, { userId: person.id, name: person.name, role: 'READ', isActive: true }] }); setChosen(''); } }}>Add reader</button>
          <ul className="space-y-2">{config.members.map(member => <li key={member.userId} className="min-w-0 flex flex-wrap items-center gap-3"><span className="[overflow-wrap:anywhere]">{member.name}{!member.isActive && ' (inactive)'}</span><label>Permission<select aria-label={`Permission for ${member.name}`} className={control} value={member.role} disabled={!member.isActive} onChange={event => setDraft({ ...config, members: config.members.map(row => row.userId === member.userId ? { ...row, role: event.target.value } : row) })}><option value="READ">Read</option><option value="EDIT">Edit content</option></select></label><button type="button" className="min-h-11 underline" aria-label={`Remove ${member.name}`} onClick={() => setDraft({ ...config, members: config.members.filter(row => row.userId !== member.userId) })}>Remove</button></li>)}</ul>
        </>}
        <button className="min-h-11 rounded bg-primary text-primary-foreground px-3" disabled={!draft}>Save page access</button>
      </fieldset>
    </form>
    {save.isError && <div role="alert">{save.error.data?.message || save.error.message} Your access draft is retained. <button className="min-h-11 underline" onClick={async () => { try { const current = await api.getWorkspacePageAccess(pageId); cache.setQueryData(['workspacePageAccess', pageId], current); setDraft(null); save.reset(); setReloadError(''); } catch { setReloadError('Access could not be reloaded. Your draft is retained.'); } }}>Reload access and discard draft</button></div>}
    {reloadError && <p role="alert">{reloadError}</p>}
  </section>;
}
