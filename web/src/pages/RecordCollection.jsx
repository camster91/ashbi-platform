import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from '../components/QueryErrorState';
import RecordValueInput, { editableRecordFields, recordDisplayValue } from '../components/RecordValueInput';
import CollectionFieldSettings from '../components/CollectionFieldSettings';

const control = 'block min-h-11 min-w-0 w-full rounded border border-border bg-card px-3';
const button = 'min-h-11 rounded border border-border px-3';
function RecordEditor({ collection, record, form, onDone }) {
  const blocked = Boolean(collection.archivedAt);
  // Pin definitions and revisions at draft creation; background refetch does
  // not reinterpret values or upgrade a stale draft's expected revision.
  const [snapshot] = useState(() => structuredClone({ collection, record, form }));
  const source = snapshot.collection;
  const fields = editableRecordFields(source.fields).filter(field => !snapshot.form || snapshot.form.configuration.fields.some(item => item.key === field.key));
  const [title, setTitle] = useState(snapshot.record?.title || '');
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => { const configured = snapshot.form?.configuration.fields.find(item => item.key === field.key); return [field.key, snapshot.record?.values?.[field.key] ?? configured?.defaultValue ?? null]; })));
  const save = useMutation({ mutationFn: () => {
    const input = { title, definitionRevision: source.schemaRevision, values };
    if (snapshot.form) return api.submitCollectionForm(source.id, snapshot.form.id, { ...input, revision: snapshot.form.revision });
    if (!snapshot.record) return api.createCollectionRecord(source.id, input);
    const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(snapshot.record.values?.[key] ?? null)));
    return api.updateCollectionRecord(source.id, snapshot.record.id, { title, definitionRevision: source.schemaRevision, revision: snapshot.record.revision, ...(Object.keys(patch).length ? { values: patch } : {}) });
  }, onSuccess: onDone });
  return <form aria-label={snapshot.form ? `Submit ${snapshot.form.configuration.name}` : snapshot.record ? 'Edit record' : 'Create record'} className="min-w-0 space-y-3 rounded border border-border p-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <fieldset disabled={blocked || save.isPending} className="contents">
    <h2 className="font-semibold">{snapshot.form ? snapshot.form.configuration.name : snapshot.record ? 'Edit record' : 'New record'}</h2>
    <label className="block">Record title<input className={control} required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
    {fields.map(field => { const configured = snapshot.form?.configuration.fields.find(item => item.key === field.key); const inputField = { ...field, name: configured?.label || field.name, required: field.required || configured?.required }; return <div key={field.key}><RecordValueInput collectionId={source.id} field={inputField} value={values[field.key]} relations={snapshot.record?.relations?.[field.key] ?? snapshot.form?.defaultRelations?.[field.key]} onChange={value => setValues(previous => ({ ...previous, [field.key]: value }))} />{configured?.help && <p className="text-sm text-muted-foreground">{configured.help}</p>}</div>; })}
    {save.isError && <p role="alert">{save.error.message || 'Record could not be saved. Your draft is retained.'}</p>}
    </fieldset>
    <div className="flex flex-wrap gap-2"><button className={`${button} bg-primary text-primary-foreground`} disabled={blocked || save.isPending || !title.trim()}>{snapshot.form ? 'Submit form' : 'Save record'}</button><button type="button" className={button} disabled={save.isPending} onClick={() => onDone(null)}>Cancel</button></div>
  </form>;
}
function SimpleFormBuilder({ collection, form, onDone }) {
  const blocked = Boolean(collection.archivedAt);
  const [snapshot] = useState(() => structuredClone({ collection, form }));
  const source = snapshot.collection, original = snapshot.form;
  const [name, setName] = useState(original?.configuration.name || '');
  const fields = editableRecordFields(source.fields);
  const [settings, setSettings] = useState(() => Object.fromEntries(fields.map(field => { const old = original?.configuration.fields.find(item => item.key === field.key); return [field.key, { included: Boolean(field.required || (!original || old)), label: old?.label || field.name, help: old?.help || '', required: Boolean(field.required || old?.required), hasDefault: Object.prototype.hasOwnProperty.call(old ?? {}, 'defaultValue'), defaultValue: old?.defaultValue ?? null }]; })));
  const configured = fields.filter(field => settings[field.key].included).map(field => { const item = settings[field.key]; return { key: field.key, label: item.label, help: item.help, required: Boolean(field.required || item.required), ...(item.hasDefault ? { defaultValue: item.defaultValue } : {}) }; });
  const create = useMutation({ mutationFn: () => {
    const configuration = { name, definitionRevision: source.schemaRevision, fields: configured };
    return original ? api.updateCollectionForm(source.id, original.id, { revision: original.revision, configuration }) : api.createCollectionForm(source.id, { configuration });
  }, onSuccess: onDone });
  function change(key, patch) { setSettings(previous => ({ ...previous, [key]: { ...previous[key], ...patch } })); }
  return <form aria-label={original ? 'Review record form' : 'Create record form'} className="space-y-3 rounded border border-border p-4" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
    <fieldset disabled={blocked || create.isPending} className="contents">
    {original?.needsReview && <p>Review the current fields and defaults before enabling this form again.</p>}
    <label className="block">Form name<input className={control} required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
    <fieldset className="space-y-3"><legend>Fields to include</legend>{fields.map(field => { const item = settings[field.key]; return <div key={field.key} className="rounded border border-border p-3 min-w-0">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={item.included} disabled={Boolean(field.required)} onChange={event => change(field.key, { included: event.target.checked })} />Include {field.name}{field.required ? ' (required)' : ''}</label>
      {item.included && <details><summary className="min-h-11 cursor-pointer flex items-center">Configure {field.name}</summary><div className="space-y-2"><label className="block">Label for {field.name}<input className={control} required maxLength={80} value={item.label} onChange={event => change(field.key, { label: event.target.value })} /></label>
        <label className="block">Help for {field.name}<textarea className={`${control} py-2`} maxLength={500} value={item.help} onChange={event => change(field.key, { help: event.target.value })} /></label>
        <label className="flex min-h-11 gap-2 items-center"><input type="checkbox" checked={item.required} disabled={Boolean(field.required)} onChange={event => change(field.key, { required: event.target.checked })} />Require {field.name}</label>
        <label className="flex min-h-11 gap-2 items-center"><input type="checkbox" checked={item.hasDefault} onChange={event => change(field.key, { hasDefault: event.target.checked })} />Set default for {field.name}</label>
        {item.hasDefault && <RecordValueInput collectionId={source.id} field={{ ...field, name: `Default ${field.name}`, required: false }} value={item.defaultValue} relations={original?.defaultRelations?.[field.key]} onChange={value => change(field.key, { defaultValue: value })} />}
      </div></details>}
    </div>; })}</fieldset>
    {create.isError && <p role="alert">{create.error.message || 'Form could not be created. Your draft is retained.'}</p>}
    </fieldset>
    <button className={button} disabled={blocked || create.isPending || !name.trim() || !configured.length}>Save form</button> <button type="button" className={button} disabled={create.isPending} onClick={() => onDone(null)}>Cancel</button>
  </form>;
}
export default function RecordCollection() {
  const { collectionId } = useParams();
  return <CollectionWorkspace key={collectionId} collectionId={collectionId} />;
}
function CollectionWorkspace({ collectionId }) {
  const cache = useQueryClient();
  const [search, setSearch] = useState(''), [archived, setArchived] = useState(false), [limit, setLimit] = useState(25), [editor, setEditor] = useState(null), [buildingForm, setBuildingForm] = useState(null);
  const [configuring, setConfiguring] = useState(false);
  const [archivedForms, setArchivedForms] = useState(false);
  const collection = useQuery({ queryKey: ['recordCollection', collectionId], queryFn: () => api.getRecordCollection(collectionId) });
  const records = useInfiniteQuery({ queryKey: ['collectionRecords', collectionId, search, archived, limit, Boolean(collection.data?.archivedAt)], enabled: Boolean(collection.data), initialPageParam: null,
    queryFn: ({ pageParam }) => api.getCollectionRecords(collectionId, { search, includeArchived: String(archived || Boolean(collection.data?.archivedAt)), limit, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const forms = useInfiniteQuery({ queryKey: ['collectionForms', collectionId, archivedForms, limit, Boolean(collection.data?.archivedAt)], enabled: Boolean(collection.data), initialPageParam: null,
    queryFn: ({ pageParam }) => api.getCollectionForms(collectionId, { limit, includeArchived: String(archivedForms || Boolean(collection.data?.archivedAt)), ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  async function refresh() { await Promise.all([cache.invalidateQueries({ queryKey: ['collectionRecords', collectionId] }), cache.invalidateQueries({ queryKey: ['collectionForms', collectionId] }), cache.invalidateQueries({ queryKey: ['recordCollection', collectionId] })]); }
  const archive = useMutation({ mutationFn: record => api.updateCollectionRecord(collectionId, record.id, { revision: record.revision, definitionRevision: record.definitionRevision, archived: !record.archivedAt }), onSuccess: refresh });
  const archiveForm = useMutation({ mutationFn: form => api.updateCollectionForm(collectionId, form.id, { revision: form.revision, archived: !form.archivedAt }), onSuccess: refresh });
  async function done(saved) {
    if (saved) {
      if (saved.schemaRevision !== undefined) cache.setQueryData(['recordCollection', collectionId], saved);
      await refresh();
    }
    setEditor(null); setBuildingForm(null); setConfiguring(false);
  }
  if (collection.isError) return <QueryErrorState error={collection.error} message="Collection could not be loaded" onRetry={collection.refetch} />;
  if (collection.isPending) return <p role="status">Loading collection…</p>;
  const row = collection.data, fields = row.fields.filter(field => !field.archived);
  const hasDraft = Boolean(editor || buildingForm || configuring);
  return <div className="min-w-0 space-y-5">
    <Link className="min-h-11 inline-flex items-center text-primary" to="/collections">All collections</Link>
    <h1 className="font-heading text-2xl font-bold [overflow-wrap:anywhere]">{row.name}</h1><p>{row.description}</p>
    {row.archivedAt && <p role="status">This collection is archived. Restore it from All collections before editing.</p>}
    {!row.archivedAt && !editor && !buildingForm && !configuring && <div className="flex gap-3 flex-wrap"><button className={button} onClick={() => setEditor({ record: null })}>New record</button><button className={button} disabled={!editableRecordFields(row.fields).length} onClick={() => setBuildingForm({ form: null })}>New reusable form</button><button className={button} onClick={() => setConfiguring(true)}>Configure collection</button></div>}
    {configuring && <CollectionFieldSettings collection={row} onDone={done} />}
    {editor && <RecordEditor key={editor.record?.id || editor.form?.id || 'new'} collection={row} record={editor.record} form={editor.form} onDone={done} />}
    {buildingForm && <SimpleFormBuilder key={buildingForm.form?.id || 'new'} collection={row} form={buildingForm.form} onDone={done} />}
    <div className="grid sm:grid-cols-2 gap-3"><label className="block">Search records<input className={control} value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></label><label className="block">Records per page<select className={control} value={limit} onChange={event => setLimit(Number(event.target.value))}><option value="25">25</option><option value="5">5</option><option value="1">1</option></select></label></div>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Show archived records</label>
    {archive.isError && <p role="alert">{archive.error.message || 'Record changed. Reload before trying again.'}</p>}
    {records.isError ? <QueryErrorState error={records.error} message="Records could not be loaded" onRetry={records.refetch} /> : records.isPending ? <p role="status">Loading records…</p> : <ul className="space-y-3">{records.data.pages.flatMap(page => page.items).map(record => <li key={record.id} className="min-w-0 rounded border border-border p-4 space-y-3">
      <h2 className="font-semibold [overflow-wrap:anywhere]">{record.title}{record.archivedAt && ' (archived)'}</h2>
      <dl className="grid sm:grid-cols-2 gap-3">{fields.map(field => <div key={field.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{field.name}</dt><dd className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{recordDisplayValue(field, record)}</dd></div>)}</dl>
      {!row.archivedAt && <div className="flex gap-2 flex-wrap">{!record.archivedAt && <button className={button} disabled={hasDraft} onClick={() => { setBuildingForm(null); setEditor({ record }); }}>Edit {record.title}</button>}<button className={button} disabled={hasDraft || archive.isPending} onClick={() => archive.mutate(record)}>{record.archivedAt ? 'Restore' : 'Archive'} {record.title}</button></div>}
    </li>)}</ul>}
    {records.data?.pages.every(page => !page.items.length) && <p>No matching records.</p>}
    {records.hasNextPage && <button className={button} disabled={records.isFetchingNextPage} onClick={() => records.fetchNextPage()}>Load more records</button>}
    <section aria-label="Reusable forms" className="space-y-3"><h2 className="font-semibold">Reusable forms</h2>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={archivedForms} onChange={event => setArchivedForms(event.target.checked)} />Show archived forms</label>
      {archiveForm.isError && <p role="alert">{archiveForm.error.message || 'Form could not be archived.'}</p>}
      {forms.isError ? <QueryErrorState error={forms.error} message="Forms could not be loaded" onRetry={forms.refetch} /> : forms.isPending ? <p role="status">Loading forms…</p> : <ul className="space-y-2">{forms.data.pages.flatMap(page => page.items).map(form => <li key={form.id} className="rounded border border-border p-3 [overflow-wrap:anywhere]"><h3>{form.configuration.name}{form.archivedAt ? ' (archived)' : ''}</h3>{form.needsReview && <p>This form needs review after collection fields changed.</p>}{!row.archivedAt && <div className="flex gap-2 flex-wrap">{!form.archivedAt && <><button className={button} disabled={hasDraft || form.needsReview} onClick={() => setEditor({ form })}>Use {form.configuration.name}</button><button className={button} disabled={hasDraft} onClick={() => setBuildingForm({ form })}>Review {form.configuration.name}</button></>}<button className={button} disabled={hasDraft || archiveForm.isPending} onClick={() => archiveForm.mutate(form)}>{form.archivedAt ? 'Restore' : 'Archive'} {form.configuration.name}</button></div>}</li>)}</ul>}
      {forms.hasNextPage && <button className={button} disabled={forms.isFetchingNextPage} onClick={() => forms.fetchNextPage()}>Load more forms</button>}
    </section>
  </div>;
}
