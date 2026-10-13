import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { PORTFOLIO_OPTIONS } from '@shared/portfolio.js';
import { api } from '../lib/api';
import LoadingState from '../components/ui/LoadingState';
import QueryErrorState from '../components/QueryErrorState';
import useClients, { useClientSearch } from '../hooks/useClients';

const control = 'block min-h-11 max-w-full rounded border border-border bg-card px-3';
export default function BoardTemplates() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selected, setSelected] = useState('');
  const [projectName, setProjectName] = useState('');
  const [chosenClient, setChosenClient] = useState('');
  const [search, setSearch] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [error, setError] = useState('');
  const projectQuery = useQuery({ queryKey: ['boardTemplateSource', projectId], queryFn: () => api.getProject(projectId) });
  const templates = useInfiniteQuery({ queryKey: ['boardTemplates', includeArchived], initialPageParam: undefined,
    queryFn: ({ pageParam }) => api.getBoardTemplates(includeArchived, pageParam), getNextPageParam: response => response.nextCursor ?? undefined });
  const initialClients = useClients({ limit: 25 });
  const searchedClients = useClientSearch(search, { limit: 25 });
  const clients = search.trim().length >= 2 ? searchedClients : initialClients;
  const handleError = err => setError(err.data?.message || err.message);
  const save = useMutation({ mutationFn: () => api.saveBoardTemplate({ projectId, name: name.trim(), description: description.trim() }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['boardTemplates'] }); setName(''); setDescription(''); setError(''); }, onError: handleError,
  });
  const archive = useMutation({ mutationFn: ({ id, archived }) => api.archiveBoardTemplate(id, archived),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['boardTemplates'] }); setSelected(''); setError(''); }, onError: handleError,
  });
  const create = useMutation({ mutationFn: () => api.createProjectFromBoardTemplate({ templateId: selected, clientId: chosenClient || projectQuery.data.clientId, name: projectName.trim(), portfolio: portfolio || null }),
    onSuccess: project => { queryClient.invalidateQueries({ queryKey: ['projects'] }); navigate(`/project/${project.id}/kanban`); }, onError: handleError,
  });
  if (projectQuery.isLoading) return <LoadingState label="Loading template source" />;
  if (projectQuery.isError) return <QueryErrorState error={projectQuery.error} message="Source project could not be loaded" onRetry={projectQuery.refetch} />;
  const project = projectQuery.data;
  const clientId = chosenClient || project.clientId;
  const choices = clients.data;
  const templateRows = templates.data?.pages.flatMap(page => page.items) ?? [];
  const busy = save.isPending || archive.isPending || create.isPending;
  return <div className="min-w-0 space-y-5">
    <Link className="text-primary" to={`/project/${projectId}/views`}>Task views</Link>
    <h1 className="font-heading text-2xl font-bold">Board templates</h1>
    <p>Reuse the stages, saved views and custom field definitions from {project.name}. A new project starts empty, with the client and portfolio you choose.</p>
    <form onSubmit={event => { event.preventDefault(); save.mutate(); }} className="rounded border border-border p-4 space-y-3">
      <h2 className="font-semibold">Save this board as a template</h2>
      <label className="block text-sm">Template name<input aria-label="Board template name" className={control} required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="block text-sm">Description<textarea aria-label="Board template description" className={`${control} min-h-20`} maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <button disabled={busy || !name.trim()} className={`${control} bg-primary text-primary-foreground disabled:opacity-50`}>Save board template</button>
      {save.isSuccess && <p role="status">Board template saved.</p>}
    </form>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Show archived templates</label>
    {templates.isError ? <QueryErrorState error={templates.error} message="Board templates could not be loaded" onRetry={templates.refetch} /> : templates.isLoading ? <LoadingState label="Loading board templates" />
      : <ul className="space-y-3">{templateRows.map(template => <li key={template.id} className="rounded border border-border p-3 space-y-2">
        <h2 className="font-semibold">{template.name}{template.kind === 'BOARD_ARCHIVED' ? ' (Archived)' : ''}</h2>
        {template.description && <p className="text-sm">{template.description}</p>}
        <p className="text-sm text-muted-foreground">{template.boardConfig?.stages?.length ?? 0} configured stages, {template.boardConfig?.views?.length ?? 0} saved views, {template.boardConfig?.fields?.length ?? 0} field definitions</p>
        <div className="flex flex-wrap gap-2">
          {template.kind === 'BOARD' && <button disabled={busy} className={control} type="button" onClick={() => { setSelected(template.id); setError(''); }}>Use {template.name}</button>}
          <button disabled={busy} className={control} type="button" onClick={() => archive.mutate({ id: template.id, archived: template.kind === 'BOARD' })}>{template.kind === 'BOARD' ? 'Archive' : 'Restore'} {template.name}</button>
        </div>
      </li>)}</ul>}
    {!templates.isLoading && templateRows.length === 0 && <p>No board templates yet.</p>}
    {templates.hasNextPage && <button type="button" disabled={templates.isFetchingNextPage} className={control} onClick={() => templates.fetchNextPage()}>Load more board templates</button>}
    {selected && <form aria-label="Create project from board template" className="rounded border border-border p-4 space-y-3" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
      <h2 className="font-semibold">Create an empty project</h2>
      <label className="block text-sm">Project name<input aria-label="Template project name" className={control} required maxLength={200} value={projectName} onChange={event => setProjectName(event.target.value)} /></label>
      <label className="block text-sm">Search clients<input aria-label="Search template clients" className={control} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="block text-sm">Client<select aria-label="Template project client" className={control} value={clientId} onChange={event => setChosenClient(event.target.value)}>
        {!choices.some(client => client.id === clientId) && <option value={clientId}>{project.client?.id === clientId ? project.client.name : 'Selected client'}</option>}
        {choices.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select></label>
      {clients.isError && <p role="alert">Clients could not be loaded. <button type="button" className="min-h-11 underline" onClick={() => clients.refetch()}>Retry client search</button></p>}
      <p className="text-xs text-muted-foreground">Enter at least two characters to search up to 25 clients.</p>
      <label className="block text-sm">Work portfolio<select aria-label="Template project portfolio" className={control} value={portfolio} onChange={event => setPortfolio(event.target.value)}><option value="">Unclassified</option>{PORTFOLIO_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <button disabled={busy || !projectName.trim() || !clientId} className={`${control} bg-primary text-primary-foreground disabled:opacity-50`}>Create project from template</button>
    </form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
