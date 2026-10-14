import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from '../components/QueryErrorState';

const control = 'block min-h-11 min-w-0 w-full rounded border border-border bg-card px-3';
export default function RecordCollections() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '', portfolio = params.get('portfolio') || '', archived = params.get('archived') === 'true';
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [newPortfolio, setNewPortfolio] = useState('');
  const cache = useQueryClient(), navigate = useNavigate();
  const collections = useInfiniteQuery({ queryKey: ['recordCollections', search, portfolio, archived], initialPageParam: null,
    queryFn: ({ pageParam }) => api.getRecordCollections({ search, includeArchived: String(archived), limit: 25, ...(portfolio ? { portfolio } : {}), ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: page => page.nextCursor || undefined });
  const create = useMutation({ mutationFn: () => api.createRecordCollection({ name: name.trim(), description, portfolio: newPortfolio || null }), onSuccess: async row => { await cache.invalidateQueries({ queryKey: ['recordCollections'] }); navigate(`/collections/${row.id}`); } });
  const archive = useMutation({ mutationFn: row => api.updateRecordCollection(row.id, { revision: row.revision, archived: !row.archivedAt }), onSuccess: () => cache.invalidateQueries({ queryKey: ['recordCollections'] }) });
  function param(key, value) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }); }
  return <div className="min-w-0 space-y-5">
    <h1 className="font-heading text-2xl font-bold">Collections</h1>
    <p className="text-sm text-muted-foreground">Organize briefs, assets and other shared team records with custom fields, calculations and reusable forms.</p>
    <details className="rounded border border-border p-3"><summary className="cursor-pointer min-h-11 flex items-center font-semibold">New collection</summary>
      <form aria-label="Create collection" className="space-y-3 mt-3" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
        <label className="block">Collection name<input className={control} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="block">Description<textarea className={`${control} min-h-20 py-2`} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label className="block">Work portfolio<select className={control} value={newPortfolio} onChange={event => setNewPortfolio(event.target.value)}><option value="">Unclassified</option><option value="ASHBI_DESIGN">Ashbi Design</option><option value="FREELANCE">Freelance</option></select></label>
        <button className="min-h-11 rounded bg-primary text-primary-foreground px-4" disabled={create.isPending || !name.trim()}>Create collection</button>
        {create.isError && <p role="alert">{create.error.message || 'Collection could not be created. Your draft is retained.'}</p>}
      </form>
    </details>
    <div className="grid sm:grid-cols-2 gap-3"><label className="block">Search collections<input className={control} maxLength={200} value={search} onChange={event => param('search', event.target.value)} /></label>
      <label className="block">Portfolio filter<select className={control} value={portfolio} onChange={event => param('portfolio', event.target.value)}><option value="">All work</option><option value="ASHBI_DESIGN">Ashbi Design</option><option value="FREELANCE">Freelance</option><option value="UNCLASSIFIED">Unclassified</option></select></label></div>
    <label className="min-h-11 inline-flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => param('archived', event.target.checked ? 'true' : '')} />Show archived collections</label>
    {archive.isError && <p role="alert">{archive.error.message || 'Collection changed. Reload before trying again.'}</p>}
    {collections.isError ? <QueryErrorState error={collections.error} message="Collections could not be loaded" onRetry={collections.refetch} /> : collections.isPending ? <p role="status">Loading collections…</p> : <ul className="grid md:grid-cols-2 gap-4">{collections.data.pages.flatMap(page => page.items).map(row => <li key={row.id} className="min-w-0 rounded border border-border p-4 space-y-2 [overflow-wrap:anywhere]">
      <h2 className="font-semibold"><Link className="min-h-11 inline-flex items-center text-primary" to={`/collections/${row.id}`}>{row.name}</Link>{row.archivedAt && ' (archived)'}</h2><p className="text-sm">{row.description}</p><p className="text-sm text-muted-foreground">{row.portfolio === 'ASHBI_DESIGN' ? 'Ashbi Design' : row.portfolio === 'FREELANCE' ? 'Freelance' : 'Unclassified'}</p>
      <button className="min-h-11 underline" disabled={archive.isPending} onClick={() => archive.mutate(row)}>{row.archivedAt ? 'Restore' : 'Archive'} {row.name}</button>
    </li>)}</ul>}
    {collections.data?.pages.every(page => !page.items.length) && <p>No matching collections.</p>}
    {collections.hasNextPage && <button className="min-h-11 underline" disabled={collections.isFetchingNextPage} onClick={() => collections.fetchNextPage()}>Load more collections</button>}
  </div>;
}
