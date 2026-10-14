import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';

const control = 'block min-h-11 min-w-0 w-full rounded border border-border bg-card px-3';
const button = 'min-h-11 rounded border border-border px-3';
const types = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'URL', 'SELECT', 'MULTI_SELECT', 'RELATION', 'FORMULA', 'ROLLUP'];
const operations = { add: 2, subtract: 2, multiply: 2, divide: 2, round: 1, equal: 2, greater: 2, less: 2, and: 2, or: 2, not: 1, concat: 2, if: 3, coalesce: 2, daysBetween: 2 };
const label = value => value.toLowerCase().replaceAll('_', ' ');
function defaultExpression(type, fields) {
  if (type === 'field') return { field: fields[0]?.key || '' };
  if (type === 'number') return { literal: 0 };
  if (type === 'text') return { literal: '' };
  if (type === 'boolean') return { literal: false };
  return { op: type, args: Array.from({ length: operations[type] }, (_, index) => ['and', 'or', 'not'].includes(type) || (type === 'if' && index === 0) ? { literal: false } : type === 'concat' ? { literal: '' } : type === 'daysBetween' ? { field: fields.find(field => field.type === 'DATE')?.key || '' } : { literal: 0 }) };
}
function FormulaExpression({ expression, fields, onChange, path = 'Formula', depth = 0 }) {
  const type = expression?.field !== undefined ? 'field' : expression?.literal !== undefined ? expression.literal === null ? 'number' : ({ number: 'number', string: 'text', boolean: 'boolean' })[typeof expression.literal] : expression?.op || 'number';
  return <fieldset className={`min-w-0 space-y-2 [overflow-wrap:anywhere] ${depth ? 'border-t border-border py-2' : 'rounded border border-border p-3'}`}><legend>{path}</legend>
    <label className="block text-sm">{path} type<select className={control} value={type} onChange={event => onChange(defaultExpression(event.target.value, fields))}><option value="field">Field value</option><option value="number">Number</option><option value="text">Text</option><option value="boolean">Boolean</option>{depth < 12 && Object.keys(operations).map(op => <option key={op} value={op}>{op}</option>)}</select></label>
    {type === 'field' ? <label className="block text-sm">{path} field<select className={control} required value={expression.field} onChange={event => onChange({ field: event.target.value })}><option value="">Choose field</option>{fields.map(field => <option key={field.key} value={field.key}>{field.name}</option>)}</select></label>
      : type === 'number' ? <label className="block text-sm">{path} number<input className={control} type="number" step="any" required value={expression?.literal ?? ''} onChange={event => onChange({ literal: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      : type === 'text' ? <label className="block text-sm">{path} text<input className={control} maxLength={2000} value={expression?.literal ?? ''} onChange={event => onChange({ literal: event.target.value })} /></label>
      : type === 'boolean' ? <label className="block text-sm">{path} boolean<select className={control} value={String(expression.literal)} onChange={event => onChange({ literal: event.target.value === 'true' })}><option value="false">False</option><option value="true">True</option></select></label>
      : expression.args?.map((arg, index) => <FormulaExpression key={index} expression={arg} fields={fields} depth={depth + 1} path={`${path} operand ${index + 1}`} onChange={next => onChange({ ...expression, args: expression.args.map((previous, i) => i === index ? next : previous) })} />)}
    {['add', 'multiply', 'and', 'or', 'concat', 'coalesce'].includes(type) && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={expression.args.length >= 8} onClick={() => onChange({ ...expression, args: [...expression.args, defaultExpression(type === 'concat' ? 'text' : ['and', 'or'].includes(type) ? 'boolean' : 'number', fields)] })}>Add {path} operand</button>{expression.args.length > 2 && <button type="button" className={button} onClick={() => onChange({ ...expression, args: expression.args.slice(0, -1) })}>Remove last {path} operand</button>}</div>}
  </fieldset>;
}
export default function CollectionFieldSettings({ collection, onDone }) {
  const blocked = Boolean(collection.archivedAt);
  const [snapshot] = useState(() => structuredClone(collection));
  const [name, setName] = useState(snapshot.name), [description, setDescription] = useState(snapshot.description), [portfolio, setPortfolio] = useState(snapshot.portfolio || '');
  const [fields, setFields] = useState(snapshot.fields), [selected, setSelected] = useState(null);
  const current = fields.find(field => field.key === selected);
  const original = snapshot.fields.some(field => field.key === selected);
  const collections = useInfiniteQuery({ queryKey: ['recordCollectionChoices'], initialPageParam: null,
    queryFn: ({ pageParam }) => api.getRecordCollections({ limit: 25, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const relation = current?.type === 'ROLLUP' ? fields.find(field => field.key === current.relationKey && field.type === 'RELATION') : current;
  const targetId = relation?.collectionId;
  const target = useQuery({ queryKey: ['recordCollection', targetId], enabled: Boolean(targetId && targetId !== snapshot.id), queryFn: () => api.getRecordCollection(targetId) });
  const targetFields = targetId === snapshot.id ? fields : target.data?.fields || [];
  const save = useMutation({ mutationFn: () => api.updateRecordCollection(snapshot.id, { revision: snapshot.revision, name, description, portfolio: portfolio || null, ...(JSON.stringify(fields) !== JSON.stringify(snapshot.fields) ? { fields } : {}) }), onSuccess: onDone });
  function update(patch) { setFields(previous => previous.map(field => field.key === selected ? { ...field, ...patch } : field)); }
  function changeType(type) { setFields(previous => previous.map(field => field.key !== selected ? field : { key: field.key, name: field.name, archived: Boolean(field.archived), required: false, type, ...(['SELECT', 'MULTI_SELECT'].includes(type) ? { options: ['Option 1'] } : type === 'RELATION' ? { target: 'CLIENT' } : type === 'FORMULA' ? { expression: { literal: 0 } } : type === 'ROLLUP' ? { relationKey: '', aggregate: 'COUNT' } : {}) })); }
  function add() { let suffix = fields.length + 1; while (fields.some(field => field.key === `field_${suffix}`)) suffix++; const key = `field_${suffix}`; setFields(previous => [...previous, { key, name: `Field ${suffix}`, type: 'TEXT', required: false, archived: false }]); setSelected(key); }
  return <form aria-label="Configure collection" className="min-w-0 space-y-4 rounded border border-border p-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <fieldset disabled={blocked || save.isPending} className="contents">
    <h2 className="font-semibold">Configure collection</h2>
    <label className="block">Collection name<input className={control} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="block">Collection description<textarea className={`${control} py-2 min-h-20`} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className="block">Collection portfolio<select className={control} value={portfolio} onChange={event => setPortfolio(event.target.value)}><option value="">Unclassified</option><option value="ASHBI_DESIGN">Ashbi Design</option><option value="FREELANCE">Freelance</option></select></label>
    <ul className="flex flex-wrap gap-2">{fields.map(field => <li key={field.key}><button type="button" className={`${button} max-w-full [overflow-wrap:anywhere]`} aria-pressed={selected === field.key} onClick={() => setSelected(field.key)}>{field.name}{field.archived ? ' (archived)' : ''}</button></li>)}</ul>
    <button type="button" className={button} disabled={fields.length >= 40} onClick={add}>Add field</button><span className="text-sm text-muted-foreground"> {fields.length}/40 fields</span>
    {current && <fieldset className="min-w-0 space-y-3 rounded border border-border p-3"><legend>Field settings</legend>
      <label className="block">Field name<input className={control} required maxLength={80} value={current.name} onChange={event => update({ name: event.target.value })} /></label>
      <p className="text-xs text-muted-foreground">Stable key: {current.key}</p>
      <label className="block">Field type<select className={control} disabled={original} value={current.type} onChange={event => changeType(event.target.value)}>{types.map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
      {original && <p className="text-xs text-muted-foreground">Existing field types and relation targets stay fixed to preserve historical values.</p>}
      <label className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={Boolean(current.archived)} onChange={event => update({ archived: event.target.checked })} />Archive field</label>
      <label className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={Boolean(current.required)} disabled={['FORMULA', 'ROLLUP'].includes(current.type)} onChange={event => update({ required: event.target.checked })} />Require field</label>
      {['SELECT', 'MULTI_SELECT'].includes(current.type) && <label className="block">Choices, one per line<textarea className={`${control} py-2 min-h-24`} value={current.options.join('\n')} onChange={event => update({ options: event.target.value.split('\n') })} /><span className="text-xs text-muted-foreground">Keep existing choices when editing. Up to 30 choices.</span></label>}
      {current.type === 'RELATION' && <><label className="block">Relation target<select className={control} disabled={original} value={current.target || 'COLLECTION'} onChange={event => { const value = event.target.value; setFields(previous => previous.map(field => field.key !== selected ? field : { key: field.key, name: field.name, type: 'RELATION', archived: field.archived, required: field.required, ...(value === 'COLLECTION' ? { collectionId: '' } : { target: value }) })); }}><option value="CLIENT">Clients</option><option value="PROJECT">Projects</option><option value="TASK">Tasks</option><option value="PERSON">Team members</option><option value="COLLECTION">Collection records</option></select></label>
        {!current.target && <label className="block">Related collection<select className={control} disabled={original} required value={current.collectionId} onChange={event => update({ collectionId: event.target.value })}><option value="">Choose collection</option><option value={snapshot.id}>{snapshot.name} (this collection)</option>{collections.data?.pages.flatMap(page => page.items).filter(row => row.id !== snapshot.id).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
      </>}
      {current.type === 'FORMULA' && <FormulaExpression expression={current.expression} fields={fields.filter(field => !field.archived && field.key !== current.key && field.type !== 'RELATION' && field.type !== 'MULTI_SELECT')} onChange={expression => update({ expression })} />}
      {current.type === 'ROLLUP' && <><label className="block">Rollup relation<select className={control} required value={current.relationKey} onChange={event => update({ relationKey: event.target.value })}><option value="">Choose relation</option>{fields.filter(field => field.type === 'RELATION' && !field.archived && field.collectionId).map(field => <option key={field.key} value={field.key}>{field.name}</option>)}</select></label>
        <label className="block">Aggregate<select className={control} value={current.aggregate} onChange={event => { const aggregate = event.target.value; setFields(previous => previous.map(field => field.key !== selected ? field : { key: field.key, name: field.name, type: 'ROLLUP', archived: field.archived, required: false, relationKey: field.relationKey, aggregate, ...(aggregate === 'COUNT' ? {} : { targetKey: field.targetKey || '' }) })); }}>{['COUNT', 'SUM', 'AVERAGE', 'MIN', 'MAX', 'UNIQUE'].map(value => <option key={value}>{value}</option>)}</select></label>
        {current.aggregate !== 'COUNT' && <label className="block">Target field<select className={control} required value={current.targetKey || ''} onChange={event => update({ targetKey: event.target.value })}><option value="">Choose target field</option>{targetFields.filter(field => !field.archived && (current.aggregate === 'UNIQUE' ? ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT'].includes(field.type) : field.type === 'NUMBER')).map(field => <option key={field.key} value={field.key}>{field.name}</option>)}</select></label>}
        {target.isError && <QueryErrorState error={target.error} message="Related collection could not be loaded" onRetry={target.refetch} />}
      </>}
      {!original && <button type="button" className={button} onClick={() => { setFields(previous => previous.filter(field => field.key !== selected)); setSelected(null); }}>Remove new field</button>}
    </fieldset>}
    {collections.isError && <QueryErrorState error={collections.error} message="Collection choices could not be loaded" onRetry={collections.refetch} />}
    {collections.hasNextPage && <button type="button" className={button} disabled={collections.isFetchingNextPage} onClick={() => collections.fetchNextPage()}>Load more collection choices</button>}
    {save.isError && <p role="alert">{save.error.message || 'Collection changed. Your draft is retained.'}</p>}
    <p className="text-xs text-muted-foreground">Add required fields as optional first, fill existing records, then require them. Archive fields to retain historical values. Calculations must use compatible types and cannot form cycles.</p>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button className={`${button} bg-primary text-primary-foreground`} disabled={blocked || save.isPending || !name.trim()}>Save collection</button><button type="button" className={button} disabled={save.isPending} onClick={() => onDone(null)}>Cancel</button></div>
  </form>;
}
