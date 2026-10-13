import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '@shared/task-priority.js';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import LoadingState from '../components/ui/LoadingState';
import QueryErrorState from '../components/QueryErrorState';
import { buildKanbanColumns } from './TaskKanban';

const STATUSES = ['PENDING', 'IN_PROGRESS', 'REVIEW', 'WAITING_CLIENT', 'WAITING_US', 'BLOCKED', 'COMPLETED', 'UPCOMING', 'IMMEDIATE', 'TODO'];
const text = value => String(value || '').toLowerCase().replaceAll('_', ' ');
const dateRank = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : Infinity;
const priorityRank = value => TASK_PRIORITIES.includes(value) ? TASK_PRIORITIES.indexOf(value) : TASK_PRIORITIES.length;
export function sortViewTasks(tasks, sort) {
  return [...tasks].sort((a, b) => {
    const rank = sort === 'DUE_DATE' ? dateRank(a.dueDate) - dateRank(b.dueDate)
      : sort === 'PRIORITY' ? priorityRank(a.priority) - priorityRank(b.priority) : 0;
    return rank || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id));
  });
}

export default function TaskViews() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('PRIORITY');
  const [layout, setLayout] = useState('TABLE');
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState('');
  const configQuery = useQuery({ queryKey: ['taskViews', projectId], queryFn: () => api.getTaskViews(projectId) });
  const config = configQuery.data;
  const selected = config?.views.find(view => view.key === params.get('view'));
  useEffect(() => {
    setFilters(selected?.filters ?? {}); setSort(selected?.sort ?? 'PRIORITY');
    setLayout(selected?.layout ?? 'TABLE'); setName(selected?.name ?? ''); setSaveError('');
  }, [selected]);
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filters.search?.trim() || ''), 300);
    return () => clearTimeout(timeout);
  }, [filters.search]);
  const queryFilters = { ...filters, search };
  const tasksQuery = useQuery({
    queryKey: ['taskViewRows', projectId, queryFilters], enabled: Boolean(config),
    queryFn: async () => {
      const tasks = [];
      let page = 1;
      let response;
      do {
        response = await api.getTasks({ projectId, ...queryFilters, page, limit: 100 });
        const rows = response?.tasks ?? [];
        tasks.push(...rows);
        if (!rows.length) break;
        page += 1;
      } while (page <= (response.pagination?.pages ?? 1));
      return [...new Map(tasks.map(task => [task.id, task])).values()];
    },
  });
  const save = useMutation({
    mutationFn: ({ views }) => api.saveTaskViews(projectId, { revision: config.revision, views }),
    onSuccess: (saved, { selectedKey }) => {
      queryClient.setQueryData(['taskViews', projectId], saved);
      const next = new URLSearchParams(params);
      if (selectedKey) next.set('view', selectedKey); else next.delete('view');
      setParams(next); setSaveError('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: error => setSaveError(error.data?.message || error.message || 'View could not be saved.'),
  });
  function setFilter(key, value) {
    setFilters(current => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next; });
  }
  function saveCurrent(asNew) {
    const key = asNew ? crypto.randomUUID() : selected.key;
    const view = { key, name: name.trim(), filters, sort, layout };
    const views = asNew ? [...config.views, view] : config.views.map(item => item.key === key ? view : item);
    save.mutate({ views, selectedKey: key });
  }
  if (configQuery.isLoading) return <LoadingState label="Loading task views" />;
  if (configQuery.isError) return <QueryErrorState error={configQuery.error} message="Task views could not be loaded" onRetry={configQuery.refetch} />;
  const tasks = sortViewTasks(tasksQuery.data ?? [], sort);
  const board = {};
  for (const task of tasks) (board[task.status || 'PENDING'] ??= []).push(task);
  const controlClass = 'min-h-11 rounded border border-border bg-card px-3';
  return <div className="space-y-4">
    <div><Link to={`/project/${projectId}`} className="text-sm text-primary">{config.projectName}</Link><h1 className="text-2xl font-heading font-bold">Task views</h1>
      <p className="text-sm text-muted-foreground">Save reusable views for this project. Existing task permissions still apply.</p></div>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-sm">Saved view<select aria-label="Saved task view" className={`block ${controlClass}`} value={selected?.key ?? ''}
        onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('view', event.target.value); else next.delete('view'); setParams(next); }}>
        <option value="">All tasks</option>{config.views.map(view => <option key={view.key} value={view.key}>{view.name}</option>)}
      </select></label>
      <Link to={`/project/${projectId}/kanban`} className={`${controlClass} inline-flex items-center text-primary`}>Open task board</Link>
    </div>
    <fieldset disabled={save.isPending} className="flex flex-wrap gap-3 items-end">
      <label className="text-sm">Search<input aria-label="Search tasks in view" className={`block ${controlClass}`} value={filters.search || ''} maxLength={200} onChange={event => setFilter('search', event.target.value)} /></label>
      <label className="text-sm">Status<select aria-label="View status filter" className={`block ${controlClass}`} value={filters.status || ''} onChange={event => setFilter('status', event.target.value)}>
        <option value="">All statuses</option>{STATUSES.map(status => <option key={status} value={status}>{text(status)}</option>)}
      </select></label>
      <label className="text-sm">Priority<select aria-label="View priority filter" className={`block ${controlClass}`} value={filters.priority || ''} onChange={event => setFilter('priority', event.target.value)}>
        <option value="">All priorities</option>{TASK_PRIORITIES.map(priority => <option key={priority} value={priority}>{TASK_PRIORITY_LABELS[priority]}</option>)}
      </select></label>
      <label className="text-sm">Stage<select aria-label="View stage filter" className={`block ${controlClass}`} value={filters.stageKey || ''} onChange={event => setFilter('stageKey', event.target.value)}>
        <option value="">All stages</option>{config.stages.map(stage => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
        {filters.stageKey && !config.stages.some(stage => stage.key === filters.stageKey) && <option value={filters.stageKey}>Unavailable stage — clear this filter</option>}
      </select></label>
      <label className="text-sm">Sort<select aria-label="Task view sort" className={`block ${controlClass}`} value={sort} onChange={event => setSort(event.target.value)}>
        <option value="PRIORITY">Priority</option><option value="DUE_DATE">Due date</option><option value="TITLE">Title</option>
      </select></label>
      <label className="text-sm">Layout<select aria-label="Task view layout" className={`block ${controlClass}`} value={layout} onChange={event => setLayout(event.target.value)}><option value="TABLE">Table</option><option value="BOARD">Board</option></select></label>
    </fieldset>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); saveCurrent(true); }}>
      <label className="text-sm">View name<input aria-label="Task view name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} className={`block ${controlClass}`} /></label>
      <button type="submit" disabled={save.isPending || !name.trim() || config.views.length >= 20} className={`${controlClass} bg-primary text-primary-foreground disabled:opacity-50`}>Save as new view</button>
      {selected && <><button type="button" disabled={save.isPending || !name.trim()} className={controlClass} onClick={() => saveCurrent(false)}>Save view changes</button>
        <button type="button" disabled={save.isPending} className={`${controlClass} text-destructive`} onClick={() => save.mutate({ views: config.views.filter(view => view.key !== selected.key), selectedKey: null })}>Delete view</button></>}
    </form>
    {saveError && <div role="alert" className="text-sm text-destructive">{saveError} <button type="button" className="min-h-11 underline" onClick={() => configQuery.refetch()}>Reload saved views</button></div>}
    <p className="text-sm text-muted-foreground" role="status">{tasksQuery.isFetching ? 'Loading tasks…' : `${tasks.length} tasks`}</p>
    {tasksQuery.isError ? <QueryErrorState error={tasksQuery.error} message="Tasks could not be loaded" onRetry={tasksQuery.refetch} />
      : tasksQuery.isLoading ? <LoadingState label="Loading tasks" /> : tasks.length === 0 ? <p>No tasks match these filters.</p>
      : layout === 'BOARD' ? <div className="flex flex-col lg:flex-row gap-4 lg:overflow-x-auto min-w-0 [contain:inline-size]">
        {buildKanbanColumns(board, config.stages).map(column => <section key={column.key} className="rounded border border-border p-3 lg:min-w-64" aria-label={column.label}>
          <h2 className="font-semibold mb-3">{column.label} ({column.tasks.length})</h2>
          <ul className="space-y-2">{column.tasks.map(task => <li key={task.id}><Link className="block min-h-11 rounded bg-card border border-border p-3 text-primary" to={`/task/${task.id}`}>{task.title}</Link></li>)}</ul>
        </section>)}
      </div> : <div className="overflow-x-auto min-w-0 focus-visible:ring-2 focus-visible:ring-ring" role="region" aria-label="Task table" tabIndex={0}><table className="w-full text-sm"><caption className="sr-only">Tasks in {selected?.name ?? 'All tasks'}</caption>
        <thead><tr>{['Task', 'Status', 'Priority', 'Assignee', 'Due date'].map(label => <th key={label} className="text-left border-b border-border p-3">{label}</th>)}</tr></thead>
        <tbody>{tasks.map(task => <tr key={task.id}><td className="border-b border-border p-3"><Link className="text-primary" to={`/task/${task.id}`}>{task.title}</Link></td>
          <td className="p-3 border-b border-border">{text(task.status)}</td><td className="p-3 border-b border-border">{TASK_PRIORITY_LABELS[task.priority] || task.priority}</td>
          <td className="p-3 border-b border-border">{task.assignee?.name || 'Unassigned'}</td><td className="p-3 border-b border-border whitespace-nowrap">{task.dueDate ? formatDate(task.dueDate, { dateOnly: true }) : 'No date'}</td></tr>)}</tbody>
      </table></div>}
  </div>;
}
