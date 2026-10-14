import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from '../components/QueryErrorState';

const control = 'block min-h-11 min-w-0 w-full rounded border border-border bg-card px-3';
export default function WorkspaceWiki() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || ''; const archived = params.get('archived') === 'true'; const parentId = params.get('parent') || null;
  const [title, setTitle] = useState(''); const [content, setContent] = useState('');
  const [accessMode, setAccessMode] = useState('TEAM');
  const navigate = useNavigate(); const cache = useQueryClient();
  const pages = useInfiniteQuery({ queryKey: ['workspacePages', search, archived], initialPageParam: null,
    queryFn: ({ pageParam }) => api.getWorkspacePages({ search, includeArchived: String(archived), limit: 25, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const parent = useQuery({ queryKey: ['workspacePage', parentId], enabled: Boolean(parentId), queryFn: () => api.getWorkspacePage(parentId) });
  const create = useMutation({ mutationFn: () => api.createWorkspacePage({ title, content, parentId, accessMode }), onSuccess: async page => { await cache.invalidateQueries({ queryKey: ['workspacePages'] }); navigate(`/wiki/${page.id}`); } });
  function param(key, value) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }); }
  return <div className="min-w-0 space-y-5">
    <h1 className="text-2xl font-heading font-bold">Workspace wiki</h1>
    <p>Shared knowledge for the Ashbi team, independent of clients, projects and work portfolios.</p>
    <Link className="min-h-11 inline-flex items-center text-primary" to="/docs">Project documents</Link>
    <form aria-label="Create knowledge page" className="space-y-3" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
      <h2 className="font-semibold">Create {parentId ? 'nested' : 'top-level'} page</h2>
      {parentId && <div>{parent.isError ? <QueryErrorState error={parent.error} message="Parent page could not be loaded" onRetry={parent.refetch} /> : <p>Parent: {parent.data?.title || 'Loading…'}</p>}<button type="button" className="min-h-11 underline" onClick={() => param('parent', '')}>Create at top level instead</button></div>}
      <label className="block">Page title<input className={control} required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <div><label className="block" htmlFor="wiki-create-content">Page content</label><textarea id="wiki-create-content" className={`${control} py-3 min-h-40 font-mono`} maxLength={50000} value={content} onChange={event => setContent(event.target.value)} /></div>
      <label className="block">Initial audience<select className={control} value={accessMode} onChange={event => setAccessMode(event.target.value)}><option value="TEAM">All Ashbi staff</option><option value="RESTRICTED">Only you and organization administrators</option></select></label>
      {parentId && <p className="text-sm">Parent restrictions also apply to this page.</p>}
      <button className="min-h-11 rounded bg-primary text-primary-foreground px-3" disabled={create.isPending || !title.trim() || (parentId && (!parent.data?.permissions?.canEdit || parent.data.archivedAt))}>Create page</button>
      {create.isError && <p role="alert">{create.error.message} Your draft is retained.</p>}
    </form>
    <div className="space-y-3"><label className="block">Search knowledge<input className={control} maxLength={200} value={search} onChange={event => param('search', event.target.value)} /></label>
      <label className="min-h-11 inline-flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => param('archived', event.target.checked ? 'true' : '')} />Show archived pages</label></div>
    {pages.isError ? <QueryErrorState error={pages.error} message="Knowledge pages could not be loaded" onRetry={pages.refetch} /> : pages.isPending ? <p role="status">Loading knowledge…</p> : <ul className="space-y-3">{pages.data.pages.flatMap(page => page.items).map(page => <li key={page.id} className="min-w-0 rounded border border-border p-3 [overflow-wrap:anywhere]"><Link className="min-h-11 inline-flex items-center text-primary" to={`/wiki/${page.id}`}>{page.title}</Link><p className="text-sm text-muted-foreground">{page.archivedAt ? 'Archived' : page.parentId ? 'Nested page' : 'Top-level page'}</p></li>)}</ul>}
    {pages.data?.pages.every(page => !page.items.length) && <p>No matching knowledge pages.</p>}
    {pages.hasNextPage && <button className="min-h-11 underline" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>Load more knowledge pages</button>}
  </div>;
}
