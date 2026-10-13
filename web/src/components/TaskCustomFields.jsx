import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';

const control = 'block min-h-11 w-full rounded border border-border bg-card px-3';
function RelationPicker({ taskId, field, value, relation, onChange }) {
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['taskFieldOptions', taskId, field.key, search], queryFn: () => api.getTaskFieldOptions(taskId, field.key, search) });
  const items = query.data?.items ?? [];
  return <div className="space-y-2">
    <label className="text-sm">Search related {field.target.toLowerCase()}<input className={control} aria-label={`Search ${field.name} relations`} value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></label>
    <select className={control} aria-label={field.name} value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
      <option value="">No relation</option>
      {value && !items.some(item => item.id === value) && <option value={value}>{relation?.name || 'Selected record unavailable — clear or replace'}</option>}
      {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {query.isError && <p role="alert" className="text-sm text-destructive">Related records could not be loaded. <button type="button" onClick={() => query.refetch()} className="underline min-h-11">Retry</button></p>}
    <p className="text-xs text-muted-foreground">Up to 25 matching records. Search to narrow the list.</p>
  </div>;
}
function FieldInput({ field, value, onChange, taskId, relation }) {
  if (field.type === 'RELATION') return <RelationPicker {...{ field, value, onChange, taskId, relation }} />;
  if (field.type === 'BOOLEAN' || field.type === 'SELECT') return <select aria-label={field.name} className={control} value={value === null || value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? null : field.type === 'BOOLEAN' ? event.target.value === 'true' : event.target.value)}>
    <option value="">Not set</option>{(field.type === 'BOOLEAN' ? ['true', 'false'] : field.options).map(option => <option key={option} value={option}>{field.type === 'BOOLEAN' ? option === 'true' ? 'Yes' : 'No' : option}</option>)}
  </select>;
  if (field.type === 'MULTI_SELECT') return <select multiple aria-label={field.name} className={`${control} min-h-24`} value={value ?? []} onChange={event => onChange(Array.from(event.target.selectedOptions, item => item.value))}>{field.options.map(option => <option key={option}>{option}</option>)}</select>;
  return <input aria-label={field.name} className={control} type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'URL' ? 'url' : 'text'} step={field.type === 'NUMBER' ? 'any' : undefined} maxLength={field.type === 'URL' ? 2048 : 2000}
    value={value ?? ''} onChange={event => onChange(event.target.value === '' ? null : field.type === 'NUMBER' ? Number(event.target.value) : event.target.value)} />;
}
export default function TaskCustomFields({ taskId }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['taskFields', taskId], queryFn: () => api.getTaskFields(taskId) });
  // Capture both revisions when editing starts; background refetches must not
  // silently rebase a stale draft onto somebody else's changes.
  const config = draft?.config ?? query.data;
  const values = draft?.values ?? config?.values ?? {};
  const save = useMutation({ mutationFn: () => api.saveTaskFields(taskId, { revision: config.revision, definitionRevision: config.definitionRevision,
    values: Object.fromEntries(config.fields.filter(field => !field.archived).map(field => [field.key, values[field.key] ?? null])) }),
    onSuccess: async () => { setDraft(null); setError(''); await client.invalidateQueries({ queryKey: ['taskFields', taskId] }); },
    onError: err => setError(err.data?.message || err.message),
  });
  if (query.isLoading) return <p role="status">Loading custom fields…</p>;
  if (query.isError) return <QueryErrorState error={query.error} message="Custom fields could not be loaded" onRetry={query.refetch} />;
  const fields = config.fields.filter(field => !field.archived);
  return <section aria-label="Custom task fields" className="my-6 space-y-3">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-semibold">Custom fields</h2><Link className="text-primary min-h-11 inline-flex items-center" to={`/project/${config.projectId}/fields`}>Configure fields</Link></div>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={save.isPending} className="space-y-3">
        {!fields.length && <p className="text-sm text-muted-foreground">No active custom fields in this project.</p>}
        {fields.map(field => <div key={field.key}><p className="text-sm font-medium mb-1">{field.name}</p><FieldInput field={field} taskId={taskId} relation={config.relations[field.key]} value={values[field.key]} onChange={value => setDraft({ config, values: { ...values, [field.key]: value } })} /></div>)}
        {!!fields.length && <button type="submit" disabled={!draft} className="min-h-11 rounded bg-primary text-primary-foreground px-3 disabled:opacity-50">Save custom fields</button>}
        <button type="button" className="min-h-11 px-3 underline" onClick={() => { setDraft(null); setError(''); query.refetch(); }}>Reload custom fields</button>
      </fieldset>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {save.isSuccess && !draft && <p role="status">Custom fields saved.</p>}
    </form>
  </section>;
}
