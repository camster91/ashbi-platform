import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

const STATUSES = ['PENDING', 'IN_PROGRESS', 'REVIEW', 'WAITING_CLIENT', 'WAITING_US', 'BLOCKED', 'COMPLETED'];
const defaults = [
  { key: 'todo', name: 'To do', status: 'PENDING' },
  { key: 'doing', name: 'In progress', status: 'IN_PROGRESS' },
  { key: 'review', name: 'Review', status: 'REVIEW' },
  { key: 'done', name: 'Done', status: 'COMPLETED' },
];

export default function TaskStageSettings({ project, boardId, onClose }) {
  const queryClient = useQueryClient();
  const [stages, setStages] = useState(project.taskStages?.length ? project.taskStages : defaults);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => boardId ? api.saveTaskStages(project.id, { stages, revision: project.boardRevision ?? 0 }, boardId) : api.saveTaskStages(project.id, { stages, revision: project.boardRevision ?? 0 }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['kanban', project.id] });
      queryClient.invalidateQueries({ queryKey: ['taskViews', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projectBoardSettings', project.id] });
      onClose();
    },
    onError: err => setError(err.data?.message || err.message || 'Stages could not be saved.'),
  });
  function edit(index, changes) {
    setStages(current => current.map((stage, i) => i === index ? { ...stage, ...changes } : stage));
    setError('');
  }
  function reorder(index, step) {
    setStages(current => {
      const next = [...current];
      [next[index], next[index + step]] = [next[index + step], next[index]];
      return next;
    });
  }
  return <form className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Task stage settings" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <h2 className="font-semibold">Project stages</h2>
    <p className="text-sm text-muted-foreground">Name and order your workflow. Moving into a stage sets its task status. Existing tasks keep their status when settings change. Move tasks out before removing a stage.</p>
    <fieldset disabled={save.isPending} className="space-y-3">
      {stages.map((stage, index) => <div key={stage.key} className="flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-40 text-sm">Stage name
          <input aria-label={`Stage ${index + 1} name`} value={stage.name} required maxLength={80}
            onChange={event => edit(index, { name: event.target.value })} className="block min-h-11 w-full rounded border border-border bg-background px-2" />
        </label>
        <label className="text-sm">Task status
          <select aria-label={`Stage ${index + 1} status`} value={stage.status} onChange={event => edit(index, { status: event.target.value })}
            className="block min-h-11 rounded border border-border bg-background px-2">
            {[...new Set([...STATUSES, stage.status])].map(status => <option key={status} value={status}>{status.toLowerCase().replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <button type="button" aria-label={`Move ${stage.name} earlier`} disabled={index === 0} onClick={() => reorder(index, -1)} className="min-h-11 px-3 disabled:opacity-40">↑</button>
        <button type="button" aria-label={`Move ${stage.name} later`} disabled={index === stages.length - 1} onClick={() => reorder(index, 1)} className="min-h-11 px-3 disabled:opacity-40">↓</button>
        <button type="button" disabled={stages.length === 1} onClick={() => setStages(current => current.filter(item => item.key !== stage.key))}
          aria-label={`Remove ${stage.name}`} className="min-h-11 px-3 text-destructive disabled:opacity-40">Remove</button>
      </div>)}
      <button type="button" disabled={stages.length >= 20} className="min-h-11 px-3 rounded border border-border"
        onClick={() => setStages(current => [...current, { key: crypto.randomUUID(), name: `Stage ${current.length + 1}`, status: 'PENDING' }])}>Add stage</button>
      <div className="flex gap-2">
        <button type="submit" className="min-h-11 px-4 rounded bg-primary text-primary-foreground">{save.isPending ? 'Saving…' : 'Save stages'}</button>
        <button type="button" onClick={onClose} className="min-h-11 px-4 rounded border border-border">Cancel</button>
      </div>
    </fieldset>
    {error && <div role="alert" className="text-sm text-destructive">{error} <button type="button" className="underline min-h-11 px-2"
      onClick={async () => { await queryClient.invalidateQueries({ queryKey: ['project', project.id] }); onClose(); }}>Reload board settings</button></div>}
  </form>;
}
