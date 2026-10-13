import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import LoadingState from '../components/ui/LoadingState';
import QueryErrorState from '../components/QueryErrorState';

const types = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'URL', 'SELECT', 'MULTI_SELECT', 'RELATION'];
const targets = ['TASK', 'PROJECT', 'CLIENT', 'PERSON'];
const control = 'min-h-11 rounded border border-border bg-card px-3 max-w-full';
function FieldEditor({ current, onChange, existing, index, onRemove }) {
  const choices = ['SELECT', 'MULTI_SELECT'].includes(current.type);
  return <fieldset className="rounded border border-border p-3 space-y-3">
    <legend className="px-2">{current.name || 'New field'}</legend>
    <div className="flex flex-wrap gap-3">
      <label>Name<input aria-label={`Field ${index + 1} name`} required className={`block ${control}`} value={current.name} maxLength={80} onChange={event => onChange({ ...current, name: event.target.value })} /></label>
      <label>Type<select aria-label={`Field ${index + 1} type`} className={`block ${control}`} value={current.type} disabled={existing}
        onChange={event => onChange({ key: current.key, name: current.name, archived: current.archived, type: event.target.value, ...(['SELECT', 'MULTI_SELECT'].includes(event.target.value) ? { options: ['First choice'] } : event.target.value === 'RELATION' ? { target: 'TASK' } : {}) })}>
        {types.map(type => <option key={type} value={type}>{type.toLowerCase().replaceAll('_', ' ')}</option>)}
      </select></label>
      {choices && <label>Choices (one per line)<textarea aria-label={`Field ${index + 1} choices`} required className={`block ${control}`} value={current.options.join('\n')} onChange={event => onChange({ ...current, options: event.target.value.split('\n') })} /></label>}
      {current.type === 'RELATION' && <label>Related record type<select aria-label={`Field ${index + 1} relation`} disabled={existing} className={`block ${control}`} value={current.target} onChange={event => onChange({ ...current, target: event.target.value })}>{targets.map(target => <option key={target}>{target}</option>)}</select></label>}
      <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={current.archived} onChange={event => onChange({ ...current, archived: event.target.checked })} />Archived</label>
      {!existing && <button type="button" className={control} onClick={onRemove}>Remove unsaved field</button>}
    </div>
  </fieldset>;
}
export default function TaskFieldSettings() {
  const { projectId } = useParams();
  const client = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['taskFieldDefinitions', projectId], queryFn: () => api.getTaskFieldDefinitions(projectId) });
  const config = draft ?? query.data;
  const save = useMutation({ mutationFn: () => api.saveTaskFieldDefinitions(projectId, { revision: config.revision, fields: config.fields }),
    onSuccess: saved => { client.setQueryData(['taskFieldDefinitions', projectId], saved); client.invalidateQueries({ queryKey: ['taskFields'] }); setDraft(null); setError(''); },
    onError: err => setError(err.data?.message || err.message),
  });
  if (query.isLoading) return <LoadingState label="Loading task fields" />;
  if (query.isError) return <QueryErrorState error={query.error} onRetry={query.refetch} message="Task fields could not be loaded" />;
  function change(field) { setDraft({ ...config, fields: config.fields.map(item => item.key === field.key ? field : item) }); }
  return <div className="space-y-4">
    <Link to={`/project/${projectId}/views`} className="text-primary">Task views</Link>
    <h1 className="text-2xl font-heading font-bold">Task fields — {config.projectName}</h1>
    <p>Define shared fields for this project. Archive a field to hide it while retaining its values. Existing types and choices are preserved.</p>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={save.isPending} className="space-y-4">
        {config.fields.map((field, index) => <FieldEditor key={field.key} current={field} index={index} onChange={change} onRemove={() => setDraft({ ...config, fields: config.fields.filter(item => item.key !== field.key) })} existing={query.data.fields.some(item => item.key === field.key)} />)}
        {!config.fields.length && <p>No custom fields yet.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={control} disabled={config.fields.length >= 40} onClick={() => setDraft({ ...config, fields: [...config.fields, { key: crypto.randomUUID(), name: '', type: 'TEXT', archived: false }] })}>Add field</button>
          <button type="submit" disabled={!draft} className={`${control} bg-primary text-primary-foreground disabled:opacity-50`}>Save field definitions</button>
          <button type="button" className={control} onClick={() => { setDraft(null); setError(''); query.refetch(); }}>Reload fields</button>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {save.isSuccess && !draft && <p role="status">Field definitions saved.</p>}
    </form>
  </div>;
}
