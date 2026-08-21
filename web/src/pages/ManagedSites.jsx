import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe2, Plus, Server, ShoppingBag } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, LoadingState } from '../components/ui';
import Modal, { ModalFooter } from '../components/Modal';
import QueryErrorState from '../components/QueryErrorState';

const PLATFORM_LABELS = {
  WORDPRESS: 'WordPress',
  SHOPIFY: 'Shopify',
  STATIC: 'Static',
  NODE: 'Node',
  HOSTINGER_BUILDER: 'Hostinger Builder',
  INTERNAL_APP: 'Internal app',
  OTHER: 'Other',
};

const blankSite = {
  name: '', url: '', platform: 'WORDPRESS', host: 'HOSTINGER', lifecycle: 'INVENTORIED', source: '', notes: '',
};

function PlatformIcon({ platform }) {
  if (platform === 'SHOPIFY') return <ShoppingBag className="h-4 w-4" aria-hidden="true" />;
  if (platform === 'INTERNAL_APP' || platform === 'NODE') return <Server className="h-4 w-4" aria-hidden="true" />;
  return <Globe2 className="h-4 w-4" aria-hidden="true" />;
}

export default function ManagedSites() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankSite);
  const [formError, setFormError] = useState('');
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['managed-sites'],
    queryFn: api.listManagedSites,
  });
  const sites = data?.sites ?? [];
  const counts = useMemo(() => sites.reduce((result, site) => {
    result[site.platform] = (result[site.platform] || 0) + 1;
    return result;
  }, {}), [sites]);
  const createSite = useMutation({
    mutationFn: api.createManagedSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managed-sites'] });
      setShowAdd(false);
      setForm(blankSite);
      setFormError('');
    },
    onError: (err) => setFormError(err.message || 'Could not add the site.'),
  });

  if (isLoading) return <LoadingState label="Loading managed sites…" />;
  if (isError) return <QueryErrorState error={error} onRetry={refetch} isRetrying={isFetching} message="Managed sites could not be loaded" />;

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = (event) => {
    event.preventDefault();
    createSite.mutate({
      ...form,
      source: form.source || undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-heading font-bold text-foreground"><Globe2 className="h-6 w-6 text-primary" /> Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Inventory every managed website and application. WordPress bridge controls stay on the WordPress Sites page.</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowAdd(true)}>Add Site</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="All sites" value={sites.length} />
        <Summary label="WordPress" value={counts.WORDPRESS || 0} />
        <Summary label="Commerce" value={counts.SHOPIFY || 0} />
        <Summary label="Apps & static" value={(counts.NODE || 0) + (counts.STATIC || 0) + (counts.INTERNAL_APP || 0) + (counts.HOSTINGER_BUILDER || 0) + (counts.OTHER || 0)} />
      </div>

      <Card className="overflow-hidden">
        {!sites.length ? (
          <div className="p-8 text-center">
            <h2 className="font-semibold text-foreground">No sites in the inventory</h2>
            <p className="mt-1 text-sm text-muted-foreground">Add a site manually or import a reviewed hosting inventory.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-5 py-3">Site</th><th className="px-5 py-3">Platform</th><th className="px-5 py-3">Host</th><th className="px-5 py-3">Lifecycle</th><th className="px-5 py-3">Client</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sites.map((site) => (
                  <tr key={site.id}>
                    <td className="px-5 py-4"><a className="inline-flex items-center gap-2 font-medium text-foreground hover:text-primary" href={site.url} target="_blank" rel="noreferrer"><PlatformIcon platform={site.platform} />{site.name}<ExternalLink className="h-3.5 w-3.5" /></a><div className="mt-1 text-xs text-muted-foreground">{site.url}</div></td>
                    <td className="px-5 py-4 text-muted-foreground">{PLATFORM_LABELS[site.platform] || site.platform}</td>
                    <td className="px-5 py-4 text-muted-foreground">{site.host.replace('_', ' ')}</td>
                    <td className="px-5 py-4"><span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-foreground">{site.lifecycle.replace('_', ' ')}</span></td>
                    <td className="px-5 py-4 text-muted-foreground">{site.client?.name || 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal isOpen={showAdd} onClose={() => !createSite.isPending && setShowAdd(false)} title="Add site to inventory">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Site name" value={form.name} onChange={(value) => update('name', value)} placeholder="Example Store" required />
          <Field label="Public URL" value={form.url} onChange={(value) => update('url', value)} placeholder="https://example.com" required type="url" />
          <div className="grid gap-4 sm:grid-cols-2"><Select label="Platform" value={form.platform} onChange={(value) => update('platform', value)} options={PLATFORM_LABELS} /><Select label="Host" value={form.host} onChange={(value) => update('host', value)} options={{ HOSTINGER: 'Hostinger', ASHBI_VPS: 'Ashbi VPS', SHOPIFY: 'Shopify', OTHER: 'Other' }} /></div>
          <Select label="Lifecycle" value={form.lifecycle} onChange={(value) => update('lifecycle', value)} options={{ INVENTORIED: 'Inventoried', ACTIVE: 'Active', MAINTENANCE: 'Maintenance', ARCHIVED: 'Archived' }} />
          <Field label="Evidence source (optional)" value={form.source} onChange={(value) => update('source', value)} placeholder="Hosting inventory" />
          <label className="block text-sm font-medium text-foreground">Notes (optional)<textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <ModalFooter><Button type="button" variant="outline" onClick={() => setShowAdd(false)} disabled={createSite.isPending}>Cancel</Button><Button type="submit" disabled={createSite.isPending}>{createSite.isPending ? 'Adding…' : 'Add Site'}</Button></ModalFooter>
        </form>
      </Modal>
    </div>
  );
}

function Summary({ label, value }) { return <Card className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold text-foreground">{value}</p></Card>; }

function Field({ label, value, onChange, placeholder, required, type = 'text' }) { return <label className="block text-sm font-medium text-foreground">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>; }

function Select({ label, value, onChange, options }) { return <label className="block text-sm font-medium text-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{Object.entries(options).map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>; }
