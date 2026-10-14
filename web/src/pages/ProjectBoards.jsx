import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from '../components/QueryErrorState';

export default function ProjectBoards() {
  const { projectId } = useParams();
  const cache = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [archived, setArchived] = useState(false);
  const boards = useInfiniteQuery({ queryKey: ['projectBoards', projectId, archived], initialPageParam: null,
    queryFn: ({ pageParam }) => api.getProjectBoards(projectId, { limit: 50, includeArchived: String(archived), ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const create = useMutation({ mutationFn: () => api.createProjectBoard(projectId, { name, description }), onSuccess: async () => { setName(''); setDescription(''); await cache.invalidateQueries({ queryKey: ['projectBoards', projectId] }); } });
  const archive = useMutation({ mutationFn: board => api.updateProjectBoard(projectId, board.id, { revision: board.revision, archived: !board.archivedAt }), onSuccess: () => cache.invalidateQueries({ queryKey: ['projectBoards', projectId] }) });
  const rows = boards.data?.pages.flatMap(page => page.items) ?? [];
  return <div className="space-y-5 min-w-0">
    <Link className="text-primary min-h-11 inline-flex items-center" to={`/project/${projectId}`}>Back to project</Link>
    <h1 className="text-2xl font-heading font-bold">Project boards</h1>
    <p className="text-sm text-muted-foreground">Separate workflows keep this project's clients, custom fields and billing together. Existing tasks stay in the project board until you move them.</p>
    <form aria-label="Create project board" className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
      <label className="text-sm">Board name<input className="block min-h-11 max-w-full rounded border border-border bg-card px-3" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="text-sm">Description<input className="block min-h-11 max-w-full rounded border border-border bg-card px-3" maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <button className="min-h-11 px-3 rounded bg-primary text-primary-foreground" disabled={create.isPending || !name.trim()}>Create board</button>
    </form>
    {create.isError && <p role="alert">{create.error.message || 'Board could not be created.'}</p>}
    {archive.isError && <p role="alert">{archive.error.message || 'Board changed. Reload and try again.'}</p>}
    <label className="min-h-11 inline-flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Show archived boards</label>
    {boards.isError ? <QueryErrorState error={boards.error} message="Boards could not be loaded" onRetry={boards.refetch} /> : boards.isPending ? <p role="status">Loading boards…</p> : <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">{rows.map(board => {
      const suffix = board.isDefault ? '' : `?board=${encodeURIComponent(board.id)}`;
      return <li key={board.id} className="rounded border border-border p-4 space-y-2 min-w-0 [overflow-wrap:anywhere]">
        <h2 className="font-semibold">{board.name}{board.archivedAt && ' (archived)'}</h2><p className="text-sm">{board.description}</p><p className="text-sm text-muted-foreground">{board.taskCount} tasks</p>
        {!board.archivedAt && <div className="flex flex-wrap gap-3"><Link className="min-h-11 inline-flex items-center text-primary" to={`/project/${projectId}/kanban${suffix}`}>Kanban</Link><Link className="min-h-11 inline-flex items-center text-primary" to={`/project/${projectId}/views${suffix}`}>Saved views</Link></div>}
        {!board.isDefault && <button className="min-h-11 text-primary underline" disabled={archive.isPending} onClick={() => archive.mutate(board)}>{board.archivedAt ? 'Restore board' : 'Archive board'}</button>}
      </li>;
    })}</ul>}
    {boards.hasNextPage && <button className="min-h-11 text-primary underline" disabled={boards.isFetchingNextPage} onClick={() => boards.fetchNextPage()}>Load more boards</button>}
  </div>;
}
