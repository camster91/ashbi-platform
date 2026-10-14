import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';

const control = 'block min-h-11 min-w-0 w-full rounded border border-border bg-card px-3';
export const editableRecordFields = fields => fields.filter(field => !field.archived && !['FORMULA', 'ROLLUP'].includes(field.type));
export function recordDisplayValue(field, record) {
  if (['FORMULA', 'ROLLUP'].includes(field.type)) {
    const result = record.computed?.[field.key];
    if (result?.error) return `Cannot calculate: ${result.error.toLowerCase().replaceAll('_', ' ')}`;
    return result?.value === null || result?.value === undefined ? '—' : Array.isArray(result.value) ? result.value.join(', ') || '—' : String(result.value);
  }
  if (field.type === 'RELATION') return record.relations?.[field.key]?.map(item => item.name).join(', ') || '—';
  const value = record.values?.[field.key];
  return value === null || value === undefined ? '—' : Array.isArray(value) ? value.join(', ') || '—' : String(value);
}
function RelationInput({ collectionId, field, value, onChange, relations = [] }) {
  const [search, setSearch] = useState(''), [pickedNames, setPickedNames] = useState({});
  const selected = Array.isArray(value) ? value : [];
  const choices = useInfiniteQuery({ queryKey: ['recordRelationOptions', collectionId, field.key, search], initialPageParam: null,
    queryFn: ({ pageParam }) => api.getRecordRelationOptions(collectionId, field.key, { search, limit: 25, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const rows = choices.data?.pages.flatMap(page => page.items) ?? [];
  function toggle(row, checked) { setPickedNames(previous => ({ ...previous, [row.id]: row.name })); onChange(checked ? [...selected, row.id] : selected.filter(id => id !== row.id)); }
  return <fieldset className="min-w-0 space-y-2 rounded border border-border p-3"><legend>{field.name}{field.required ? ' (required)' : ''}</legend>
    <ul className="flex flex-wrap gap-2">{selected.map(id => { const label = pickedNames[id] || relations.find(item => item.id === id)?.name || rows.find(item => item.id === id)?.name || 'Selected record'; return <li key={id} className="min-w-0 max-w-full [overflow-wrap:anywhere]"><button type="button" className="min-h-11 rounded border border-border px-3" aria-label={`Remove ${field.name}: ${label}`} onClick={() => onChange(selected.filter(item => item !== id))}>{label} ×</button></li>; })}</ul>
    <label className="block text-sm">Search {field.name}<input className={control} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label>
    {choices.isError ? <QueryErrorState error={choices.error} message="Related records could not be loaded" onRetry={choices.refetch} /> : choices.isPending ? <p role="status">Loading choices…</p> : <div className="max-h-48 overflow-y-auto">{rows.map(row => <label key={row.id} className="min-h-11 flex items-center gap-2 [overflow-wrap:anywhere]"><input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 100} onChange={event => toggle(row, event.target.checked)} />{row.name}</label>)}</div>}
    {choices.hasNextPage && <button type="button" className="min-h-11 underline" disabled={choices.isFetchingNextPage} onClick={() => choices.fetchNextPage()}>Load more {field.name} choices</button>}
    <p className="text-xs text-muted-foreground">{selected.length} selected · Up to 100 records</p>
  </fieldset>;
}
export default function RecordValueInput({ collectionId, field, value, onChange, relations }) {
  if (field.type === 'RELATION') return <RelationInput {...{ collectionId, field, value, onChange, relations }} />;
  if (field.type === 'MULTI_SELECT') return <fieldset className="min-w-0 rounded border border-border p-3"><legend>{field.name}{field.required ? ' (required)' : ''}</legend>{field.options.map(option => <label key={option} className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={(value ?? []).includes(option)} onChange={event => onChange(event.target.checked ? [...(value ?? []), option] : (value ?? []).filter(item => item !== option))} />{option}</label>)}</fieldset>;
  const required = Boolean(field.required), label = `${field.name}${required ? ' (required)' : ''}`;
  if (field.type === 'BOOLEAN') return <label className="block">{label}<select className={control} required={required} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select></label>;
  if (field.type === 'SELECT') return <label className="block">{label}<select className={control} required={required} value={value ?? ''} onChange={event => onChange(event.target.value || null)}><option value="">Not set</option>{field.options.map(option => <option key={option}>{option}</option>)}</select></label>;
  if (field.type === 'TEXT') return <label className="block">{label}<textarea className={`${control} min-h-20 py-2`} required={required} maxLength={2000} value={value ?? ''} onChange={event => onChange(event.target.value)} /></label>;
  return <label className="block">{label}<input className={control} required={required} type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'url'} step={field.type === 'NUMBER' ? 'any' : undefined} maxLength={field.type === 'URL' ? 2048 : undefined} value={value ?? ''} onChange={event => onChange(field.type === 'NUMBER' ? event.target.value === '' ? null : Number(event.target.value) : event.target.value || null)} /></label>;
}
