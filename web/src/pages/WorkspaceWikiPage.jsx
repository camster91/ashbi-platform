import { lazy, Suspense, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import QueryErrorState from '../components/QueryErrorState';
import DocumentSaveRecovery from '../components/DocumentSaveRecovery';
import WorkspacePageAccess from '../components/WorkspacePageAccess';
const DocumentHistoryPanel = lazy(() => import('../components/DocumentHistoryPanel'));

const control = 'block min-h-11 min-w-0 w-full rounded border border-border bg-card px-3';
export default function WorkspaceWikiPage() {
  const { pageId } = useParams();
  return <WikiPageEditor key={pageId} pageId={pageId} />;
}
function WikiPageEditor({ pageId }) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState(null); const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const query = useQuery({ queryKey: ['workspacePage', pageId], queryFn: () => api.getWorkspacePage(pageId) });
  const parents = useInfiniteQuery({ queryKey: ['workspacePageParents', search], enabled: Boolean(draft), initialPageParam: null, queryFn: ({ pageParam }) => api.getWorkspacePages({ search, limit: 25, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const parentId = draft ? draft.parentId : query.data?.parentId;
  const parent = useQuery({ queryKey: ['workspacePage', parentId], enabled: Boolean(parentId), queryFn: () => api.getWorkspacePage(parentId) });
  const children = useInfiniteQuery({ queryKey: ['workspacePageChildren', pageId], initialPageParam: null, queryFn: ({ pageParam }) => api.getWorkspacePages({ parentId: pageId, limit: 25, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const save = useMutation({ mutationFn: data => api.updateWorkspacePage(pageId, data), onSuccess: async page => { cache.setQueryData(['workspacePage', pageId], page); setDraft(null); await cache.invalidateQueries({ queryKey: ['workspacePages'] }); cache.invalidateQueries({ queryKey: ['workspacePage'] }); cache.invalidateQueries({ queryKey: ['workspacePageChildren'] }); cache.invalidateQueries({ queryKey: ['workspacePageParents'] }); } });
  if (query.isPending) return <p role="status">Loading knowledge page…</p>;
  if (query.isError) return <QueryErrorState error={query.error} message="Knowledge page could not be loaded" onRetry={query.refetch} />;
  const page = query.data; const choices = parents.data?.pages.flatMap(result => result.items).filter(item => item.id !== pageId) ?? [];
  function edit(current) { setDraft({ title: current.title, content: current.content, parentId: current.parentId, revision: current.revision }); save.reset(); }
  return <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <Link className="min-h-11 inline-flex items-center text-primary" to="/wiki">Workspace wiki</Link>
    <h1 className="text-2xl font-heading font-bold">{page.title}</h1>
    <button type="button" className="min-h-11 underline" disabled={save.isPending} onClick={() => setShowHistory(true)}>Version history</button>
    {showHistory && <Suspense fallback={<p role="status">Loading version history…</p>}><DocumentHistoryPanel kind="page" documentId={pageId} currentRevision={draft?.revision ?? page.revision} open={showHistory} onOpenChange={setShowHistory} hideTrigger onRestored={() => { setShowHistory(false); setDraft(null); save.reset(); cache.invalidateQueries({ queryKey: ['workspacePage', pageId] }); cache.invalidateQueries({ queryKey: ['workspacePages'] }); }} /></Suspense>}
    <p className="text-sm text-muted-foreground">{page.accessMode === 'RESTRICTED' ? 'Restricted staff audience' : 'Shared with Ashbi staff'} · {page.author?.name || 'Original author unavailable'}{page.archivedAt && ' · Archived'}</p>
    {page.parentId && (parent.isError || parent.data?.archivedAt ? <p>Parent page unavailable. Choose a top-level or active parent when editing or restoring.</p> : parent.data && <Link className="min-h-11 inline-flex items-center text-primary" to={`/wiki/${page.parentId}`}>Parent: {parent.data.title}</Link>)}
    {draft ? <form aria-label="Edit knowledge page" className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate({ ...draft, ...(page.archivedAt ? { archived: false } : {}) }); }}>
      <DocumentSaveRecovery noteId={pageId} draft={draft} error={save.error} loadCurrent={() => api.getWorkspacePage(pageId)} onReload={current => { cache.setQueryData(['workspacePage', pageId], current); edit(current); }} />
      <label className="block">Page title<input className={control} required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <div><label className="block" htmlFor="wiki-page-content">Page content</label><textarea id="wiki-page-content" className={`${control} py-3 min-h-48 font-mono`} maxLength={50000} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></div>
      <label className="block">Search parent pages<input className={control} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="block">Parent page<select className={control} disabled={!page.permissions?.canManage} value={draft.parentId || ''} onChange={event => setDraft({ ...draft, parentId: event.target.value || null })}><option value="">Top level</option>{draft.parentId && !choices.some(item => item.id === draft.parentId) && <option value={draft.parentId}>{parent.data?.title || 'Current parent unavailable'}</option>}{choices.map(item => <option key={item.id} value={item.id} disabled={!item.permissions?.canEdit && item.id !== draft.parentId}>{item.title}</option>)}</select></label>
      <p className="text-sm">Moving a page changes inherited access. The owner or an administrator manages moves and archiving.</p>
      {parents.isError && <QueryErrorState error={parents.error} message="Parent choices could not be loaded" onRetry={parents.refetch} />}
      {parents.hasNextPage && <button type="button" className="min-h-11 underline" disabled={parents.isFetchingNextPage} onClick={() => parents.fetchNextPage()}>Load more parent pages</button>}
      <div className="flex flex-wrap gap-3"><button className="min-h-11 rounded bg-primary text-primary-foreground px-3" disabled={save.isPending || !draft.title.trim()}>{page.archivedAt ? 'Restore and save page' : 'Save page'}</button><button type="button" className="min-h-11 underline" disabled={save.isPending} onClick={() => { setDraft(null); save.reset(); }}>Cancel editing</button></div>
    </form> : <>
      <div role="region" aria-label="Knowledge page content" tabIndex={0} className="min-w-0 rounded border border-border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.content) }} />
      <div className="flex flex-wrap gap-3">{page.permissions?.canEdit && (!page.archivedAt || page.permissions.canManage) && <button className="min-h-11 underline" onClick={() => edit(page)}>{page.archivedAt ? 'Restore and edit page' : 'Edit page'}</button>}{!page.archivedAt && page.permissions?.canEdit && <Link className="min-h-11 inline-flex items-center text-primary" to={`/wiki?parent=${pageId}`}>Create nested page</Link>}{!page.archivedAt && page.permissions?.canManage && <button className="min-h-11 underline" disabled={save.isPending} onClick={() => save.mutate({ revision: page.revision, archived: true })}>Archive page</button>}</div>
      {!page.permissions?.canEdit && <p>This page is read only.</p>}
      {!page.archivedAt && page.permissions?.canManage && <p className="text-sm">Archiving retains content. Shared pages promote active children to the parent or top level. Move or archive nested pages first when this page has restricted access.</p>}
      {save.isError && <p role="alert">{save.error.message} <button className="min-h-11 underline" onClick={() => query.refetch()}>Reload page</button></p>}
    </>}
    {page.permissions?.canManage && !draft && <WorkspacePageAccess key={pageId} pageId={pageId} />}
    <section aria-label="Nested knowledge pages" className="space-y-2"><h2 className="font-semibold">Nested pages</h2>{children.isError ? <QueryErrorState error={children.error} message="Nested pages could not be loaded" onRetry={children.refetch} /> : <ul>{children.data?.pages.flatMap(result => result.items).map(child => <li key={child.id}><Link className="min-h-11 inline-flex items-center text-primary" to={`/wiki/${child.id}`}>{child.title}</Link></li>)}</ul>}{children.hasNextPage && <button className="min-h-11 underline" onClick={() => children.fetchNextPage()}>Load more nested pages</button>}</section>
  </div>;
}
