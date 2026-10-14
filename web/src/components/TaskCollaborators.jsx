import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';

export default function TaskCollaborators({ taskId }) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [revision, setRevision] = useState(null);
  const [search, setSearch] = useState('');
  const members = useQuery({ queryKey: ['taskCollaborators', taskId], queryFn: () => api.getTaskCollaborators(taskId) });
  const team = useQuery({ queryKey: ['team'], queryFn: api.getTeam, enabled: Boolean(members.data?.canManage) });
  const save = useMutation({ mutationFn: userIds => api.saveTaskCollaborators(taskId, { revision, userIds }),
    onSuccess: data => { cache.setQueryData(['taskCollaborators', taskId], data); setDraft(null); setRevision(null); },
  });
  if (members.isError) return <QueryErrorState error={members.error} message="Collaborators could not be loaded" onRetry={members.refetch} />;
  if (!members.data) return <p role="status">Loading collaborators…</p>;
  const current = members.data;
  const selected = draft ?? current.collaborators.map(member => member.id);
  const directory = [...new Map([...(team.data ?? []).filter(member => member.isActive !== false && ['ADMIN', 'TEAM'].includes(member.role)), ...current.collaborators].map(member => [member.id, member])).values()];
  const change = (id, checked) => {
    if (draft === null) setRevision(current.revision);
    setDraft(checked ? [...selected, id] : selected.filter(value => value !== id));
  };
  return <section aria-label="Task collaborators" className="rounded border border-border p-4 space-y-3">
    <h2 className="font-semibold">Collaborators</h2>
    <p className="text-sm text-muted-foreground">Contributors help with this task. Its accountable owner is the assignee shown in task properties.</p>
    {current.canManage ? <form onSubmit={event => { event.preventDefault(); save.mutate(selected); }} className="space-y-3">
      <label className="text-sm block">Search teammates<input aria-label="Search collaborators" className="block min-h-11 max-w-full rounded border border-border bg-card px-3" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {team.isError && <QueryErrorState error={team.error} message="Team members could not be loaded" onRetry={team.refetch} />}
      <fieldset disabled={save.isPending || team.isError || team.isLoading} className="flex flex-wrap gap-3"><legend className="sr-only">Contributors</legend>
        {directory.filter(member => selected.includes(member.id) || member.name?.toLowerCase().includes(search.toLowerCase())).map(member => <label key={member.id} className="min-h-11 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(member.id)} disabled={!selected.includes(member.id) && selected.length >= 30} onChange={event => change(member.id, event.target.checked)} />{member.name || 'Teammate'}{member.isActive === false && ' (inactive)'}
        </label>)}
      </fieldset>
      <button type="submit" disabled={draft === null || save.isPending || team.isError} className="min-h-11 text-primary disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save collaborators'}</button>
      {save.isError && <p role="alert" className="text-destructive">{save.error?.data?.message || save.error?.message || 'Collaborators could not be saved.'} <button type="button" className="min-h-11 underline" onClick={async () => { const fresh = await members.refetch(); if (fresh.data && !fresh.isError) { setDraft(null); setRevision(null); save.reset(); } }}>Reload roster and discard draft</button></p>}
    </form> : <ul>{current.collaborators.map(member => <li key={member.id}>{member.name}{member.isActive === false && ' (inactive)'}</li>)}</ul>}
    {!current.collaborators.length && <p className="text-sm text-muted-foreground">No contributors selected yet.</p>}
  </section>;
}
