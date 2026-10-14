import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taskFieldFilterOperators } from '@shared/task-field-filters.js';
import { api } from '../lib/api';
import { todayDateInputValue } from '../lib/format';

const control = 'block min-h-11 max-w-full rounded border border-border bg-card px-3';
const operatorLabels = { EQ: 'Is', CONTAINS: 'Contains text', GTE: 'Is at least / on or after', LTE: 'Is at most / on or before', HAS: 'Includes choice' };
const initial = field => ({ key: field.key, operator: taskFieldFilterOperators(field.type)[0], value: field.type === 'NUMBER' ? 0 : field.type === 'BOOLEAN' ? false : field.type === 'DATE' ? todayDateInputValue() : ['SELECT', 'MULTI_SELECT'].includes(field.type) ? field.options?.[0] || '' : '' });

export default function TaskFieldFilters({ projectId, fields, value, onChange, onDirtyChange, disabled }) {
  const [draft, setDraft] = useState(value ?? []);
  useEffect(() => setDraft(value ?? []), [value]);
  useEffect(() => onDirtyChange?.(JSON.stringify(draft) !== JSON.stringify(value ?? [])), [draft, value, onDirtyChange]);
  const active = fields.filter(field => !field.archived);
  if (!active.length && !draft.length) return null;
  const edit = (index, next) => setDraft(rows => rows.map((row, i) => i === index ? next : row));
  return <form aria-label="Custom field filters" className="rounded border border-border p-3 space-y-3" onSubmit={event => { event.preventDefault(); onChange(draft); }}>
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">Custom field filters</legend>
      <p className="text-xs text-muted-foreground">All criteria must match. Apply changes before saving the view.</p>
      {draft.map((row, index) => {
        const field = fields.find(item => item.key === row.key && !item.archived);
        return <div key={index} className="flex flex-wrap items-end gap-3">
          <label className="text-sm min-w-0 max-w-full">Field<select aria-label={`Field filter ${index + 1} field`} className={control} value={row.key} onChange={event => edit(index, initial(active.find(item => item.key === event.target.value)))}>
            {active.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}{!field && <option value={row.key}>Unavailable field — remove this criterion</option>}
          </select></label>
          <label className="text-sm min-w-0 max-w-full">Condition<select aria-label={`Field filter ${index + 1} condition`} className={control} value={row.operator} onChange={event => edit(index, { ...row, operator: event.target.value })}>{taskFieldFilterOperators(field?.type).map(operator => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}{!taskFieldFilterOperators(field?.type).includes(row.operator) && <option value={row.operator}>{operatorLabels[row.operator]}</option>}</select></label>
          {field?.type === 'RELATION' ? <RelationValue key={field.key} projectId={projectId} field={field} index={index} value={row.value} onChange={value => edit(index, { ...row, value })} />
            : <label className="text-sm min-w-0 max-w-full">Value{field?.type === 'BOOLEAN' ? <select aria-label={`Field filter ${index + 1} value`} className={control} value={String(row.value)} onChange={event => edit(index, { ...row, value: event.target.value === 'true' })}><option value="false">No</option><option value="true">Yes</option></select>
              : ['SELECT', 'MULTI_SELECT'].includes(field?.type) ? <select aria-label={`Field filter ${index + 1} value`} className={control} value={row.value} onChange={event => edit(index, { ...row, value: event.target.value })}>{field.options.map(option => <option key={option}>{option}</option>)}</select>
                : <input aria-label={`Field filter ${index + 1} value`} className={control} type={field?.type === 'NUMBER' ? 'number' : field?.type === 'DATE' ? 'date' : field?.type === 'URL' ? 'url' : 'text'} step="any" required={['NUMBER', 'DATE', 'URL'].includes(field?.type)} maxLength={2048} value={row.value} onChange={event => edit(index, { ...row, value: field?.type === 'NUMBER' && event.target.value !== '' ? Number(event.target.value) : event.target.value })} />}</label>}
          <button type="button" aria-label={`Remove field filter ${index + 1}`} className="min-h-11 text-destructive" onClick={() => setDraft(rows => rows.filter((_, i) => i !== index))}>Remove</button>
        </div>;
      })}
      <div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 text-primary" disabled={!active.length || draft.length >= 10} onClick={() => setDraft(rows => [...rows, initial(active[0])])}>Add field filter</button><button type="submit" className="min-h-11 text-primary">Apply field filters</button></div>
    </fieldset>
  </form>;
}
function RelationValue({ projectId, field, index, value, onChange }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 300); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: ['taskFilterRelations', projectId, field.key, query], queryFn: () => api.getProjectTaskFieldOptions(projectId, field.key, query) });
  const items = options.data?.items ?? [];
  return <div className="text-sm space-y-1 min-w-0 max-w-full"><label>Search<input aria-label={`Search field filter ${index + 1} relations`} className={control} value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /></label>
    <label>Value<select required aria-label={`Field filter ${index + 1} value`} className={control} value={value} onChange={event => onChange(event.target.value)}><option value="">Choose a record</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{value && !items.some(item => item.id === value) && <option value={value}>Selected record is outside these results</option>}</select></label>
    {options.isError && <p role="alert">Related records could not be loaded. <button type="button" className="min-h-11 underline" onClick={() => options.refetch()}>Retry</button></p>}<p className="text-xs text-muted-foreground">Search returns up to 25 matching records.</p>
  </div>;
}
