import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';

export default function TaskBoardMembership({ task }) {
  const projectId = task.projectId || task.project?.id;
  const cache = useQueryClient();
  const [destination, setDestination] = useState(null);
  const [revision, setRevision] = useState(null);
  const [reloadError, setReloadError] = useState('');
  const boards = useQuery({ queryKey: ['taskBoardChoices', projectId], enabled: Boolean(projectId), queryFn: async () => {
    const rows = []; let after;
    do { const page = await api.getProjectBoards(projectId, { limit: 100, includeArchived: 'true', ...(after ? { after } : {}) }); rows.push(...page.items); after = page.nextCursor; } while (after);
    return rows;
  } });
  const move = useMutation({ mutationFn: () => api.moveTaskBoard(task.id, { projectId, revision, boardId: destination === 'DEFAULT' ? null : destination }), onSuccess: async () => {
    await cache.invalidateQueries({ queryKey: ['task', task.id] });
    cache.invalidateQueries({ queryKey: ['kanban', projectId] }); cache.invalidateQueries({ queryKey: ['taskViewRows', projectId] }); cache.invalidateQueries({ queryKey: ['projectBoards', projectId] }); setDestination(null); setRevision(null);
  } });
  if (boards.isError) return <QueryErrorState error={boards.error} message="Board choices could not be loaded" onRetry={boards.refetch} />;
  return <section aria-label="Task board membership" className="rounded border border-border p-4 space-y-3 mb-6">
    <h2 className="font-semibold">Board</h2><p className="text-sm text-muted-foreground">Moving keeps the task's project, owner, content and billing links. Its lifecycle status stays the same; the old stage assignment is cleared.</p>
    <label className="text-sm block">Destination board<select className="block min-h-11 max-w-full rounded border border-border bg-card px-3" disabled={!boards.data || move.isPending} value={destination ?? task.boardId ?? 'DEFAULT'} onChange={event => { if (destination === null) setRevision(task.boardMembershipRevision ?? 0); setDestination(event.target.value); }}>
      {task.boardId && !boards.data?.some(board => board.id === task.boardId) && <option value={task.boardId}>Current unavailable board</option>}
      {boards.data?.map(board => <option key={board.id} value={board.id} disabled={Boolean(board.archivedAt)}>{board.name}{board.archivedAt && ' (archived)'}</option>)}
    </select></label>
    <button className="min-h-11 text-primary underline" disabled={destination === null || move.isPending} onClick={() => move.mutate()}>Move to board</button>
    {move.isError && <p role="alert">{move.error.message || 'Board membership changed. Reload before moving.'} <button className="min-h-11 underline" onClick={async () => { try { await cache.fetchQuery({ queryKey: ['task', task.id], queryFn: () => api.getTaskPage(task.id), staleTime: 0 }); setDestination(null); setRevision(null); setReloadError(''); move.reset(); } catch { setReloadError('Membership could not be reloaded. Your selection is retained.'); } }}>Reload membership and discard draft</button></p>}
    {reloadError && <p role="alert">{reloadError}</p>}
  </section>;
}
