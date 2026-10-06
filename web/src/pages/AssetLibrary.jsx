import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Search, Plus, Trash2, Image, FileText, Video, Palette, Globe } from 'lucide-react';
import { api } from '../lib/api';
import { buildAssetCreatePayload } from '../lib/form-payloads';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button, Card, LoadingState } from '../components/ui';
import Modal, { ModalFooter } from '../components/Modal';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../hooks/useAuth';
import useClients, { useClientSearch } from '../hooks/useClients';

// Values match the API enum (assetCreateSchema in src/validators/schemas.js).
const TYPE_ICONS = { IMAGE: Image, DOCUMENT: FileText, VIDEO: Video, BRAND: Palette, WEBSITE: Globe };
const ASSET_TYPES = [
  { value: 'IMAGE', label: 'Image' },
  { value: 'DOCUMENT', label: 'Document' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'BRAND', label: 'Brand' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'OTHER', label: 'Other' },
];
const CATEGORIES = ['logo', 'photo', 'illustration', 'icon', 'template', 'guide', 'other'];

export default function AssetLibrary() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clientId, setClientId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [newAsset, setNewAsset] = useState({ name: '', type: 'IMAGE', category: 'logo', url: '', description: '' });
  const [assetToDelete, setAssetToDelete] = useState(null);
  const clientsQuery = useClients();
  // The picker lists the first page of clients (the server's maximum). A
  // workspace with more gets a search that asks the server for the rest.
  const [clientSearch, setClientSearch] = useState('');
  const clientSearchTerm = clientSearch.trim();
  const needsClientSearch = clientsQuery.isSuccess && !clientsQuery.isComplete;
  const clientSearchQuery = useClientSearch(clientSearchTerm, { enabled: needsClientSearch });
  const searchMatches = clientSearchQuery.data;
  const clients = [...clientsQuery.clients];
  const [rememberedClient, setRememberedClient] = useState(null);
  for (const extra of [...searchMatches, rememberedClient]) {
    if (extra && !clients.some(c => c.id === extra.id)) clients.push(extra);
  }
  const selectedClient = clients.find(c => c.id === clientId);
  const chooseClient = (id) => {
    setClientId(id);
    setRememberedClient(clients.find(c => c.id === id) || null);
  };

  const { data: assets = [], isLoading, isFetching, error: assetsError, refetch } = useQuery({
    queryKey: ['assets', clientId],
    queryFn: () => clientId ? api.getAssets(clientId) : Promise.resolve([]),
    enabled: !!clientId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createAsset(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', clientId] });
      setShowUpload(false);
      setNewAsset({ name: '', type: 'IMAGE', category: 'logo', url: '', description: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteAsset(id),
    onSuccess: () => {
      setAssetToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['assets', clientId] });
    },
  });

  const filteredAssets = assets.filter(a => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (searchQuery && !a.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate(buildAssetCreatePayload(newAsset, clientId));
  };

  const getTypeIcon = (type) => {
    const Icon = TYPE_ICONS[type] || FileText;
    return <Icon className="w-5 h-5" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" />
            Asset Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage brand assets and guidelines</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/brand')} disabled={user?.role !== 'ADMIN'}>Brand settings</Button>
          <Button onClick={() => { createMutation.reset(); setShowUpload(true); }} leftIcon={<Plus className="w-4 h-4" />} disabled={!clientId}>
            Add Asset
          </Button>
        </div>
      </div>

      {user?.role !== 'ADMIN' && (
        <p className="text-sm text-muted-foreground">Brand settings are managed by administrators.</p>
      )}
      {deleteMutation.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {deleteMutation.error.message || 'The asset could not be deleted. It remains available.'}
        </p>
      )}

      {/* Client picker + filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="asset-client" className="block text-sm font-medium mb-1">Client</label>
            <select id="asset-client" value={clientId} onChange={e => chooseClient(e.target.value)}
              disabled={clientsQuery.isLoading || clientsQuery.isError}
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-background text-sm">
              <option value="">{clientsQuery.isLoading ? 'Loading clients…' : 'Choose a client'}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label htmlFor="asset-search" className="block text-sm font-medium mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <input id="asset-search" type="search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Asset name"
                className="w-full min-h-11 pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm sm:w-48" />
            </div>
          </div>
          <div>
            <label htmlFor="asset-type-filter" className="block text-sm font-medium mb-1">Type</label>
            <select id="asset-type-filter" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="min-h-11 px-3 py-2 rounded-lg border border-border bg-background text-sm">
              <option value="">All types</option>
              {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="asset-category-filter" className="block text-sm font-medium mb-1">Category</label>
            <select id="asset-category-filter" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="min-h-11 px-3 py-2 rounded-lg border border-border bg-background text-sm">
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
        </div>
        {needsClientSearch && (
          <div className="mt-3 max-w-md">
            <label htmlFor="asset-client-search" className="block text-sm font-medium mb-1">Find a client not in the list</label>
            <input id="asset-client-search" type="search" value={clientSearch} onChange={e => setClientSearch(e.target.value)}
              placeholder="Client name"
              aria-describedby="asset-client-search-status"
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            <p id="asset-client-search-status" role="status" className="mt-1 text-xs text-muted-foreground">
              {clientSearchTerm.length < 2
                ? `The list shows the first ${clientsQuery.clients.length} of ${clientsQuery.total} clients. Type at least 2 letters to find another.`
                : clientSearchQuery.isFetching
                  ? 'Searching clients…'
                  : clientSearchQuery.isError
                    ? 'Clients could not be searched. Try again in a moment.'
                    : searchMatches.length === 0
                      ? `No client matches “${clientSearchTerm}”.`
                      : `${searchMatches.length} matching ${searchMatches.length === 1 ? 'client is' : 'clients are'} now in the Client list.`}
            </p>
          </div>
        )}
      </Card>

      {/* Assets grid */}
      {clientsQuery.isError ? (
        <QueryErrorState error={clientsQuery.error} message="Clients could not be loaded, so no assets can be shown" onRetry={clientsQuery.refetch} isRetrying={clientsQuery.isFetching} />
      ) : !clientsQuery.isLoading && clients.length === 0 ? (
        <Card className="p-12 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">No clients yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Assets belong to a client. Add a client first, then come back to add their assets.</p>
        </Card>
      ) : !clientId ? (
        <Card className="p-12 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">Choose a client</h3>
          <p className="text-sm text-muted-foreground mt-1">Pick a client above to see their assets.</p>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingState label="Loading assets…" compact />
        </div>
      ) : assetsError ? (
        <QueryErrorState error={assetsError} message="Failed to load assets" onRetry={refetch} isRetrying={isFetching} />
      ) : filteredAssets.length === 0 ? (
        <Card className="p-12 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">No assets found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {assets.length === 0
              ? `${selectedClient?.name || 'This client'} has no assets yet. Use Add Asset to add the first one.`
              : 'No assets match your search or filters.'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredAssets.map(asset => (
            <Card key={asset.id} className="p-3 group hover:border-primary/30 transition-colors">
              <div className="aspect-square rounded-lg bg-muted flex items-center justify-center mb-2 overflow-hidden">
                {asset.type === 'IMAGE' && asset.url ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-muted-foreground">{getTypeIcon(asset.type)}</div>
                )}
              </div>
              <p className="text-sm font-medium text-foreground truncate">{asset.name}</p>
              {asset.description && (
                <p className="text-xs text-muted-foreground truncate" title={asset.description}>{asset.description}</p>
              )}
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">{asset.category}</span>
                <button onClick={() => { deleteMutation.reset(); setAssetToDelete(asset); }}
                  type="button" aria-label={`Delete asset ${asset.name}`} disabled={deleteMutation.isPending}
                  className="min-h-11 min-w-11 p-1 text-muted-foreground hover:text-destructive rounded opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(assetToDelete)}
        title="Delete asset"
        description={assetToDelete ? `Permanently delete “${assetToDelete.name}” from the library? This cannot be undone.` : ''}
        confirmLabel="Delete asset"
        onConfirm={() => assetToDelete && deleteMutation.mutate(assetToDelete.id)}
        onCancel={() => { deleteMutation.reset(); setAssetToDelete(null); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />

      <Modal
        isOpen={showUpload}
        onClose={() => {
          if (createMutation.isPending) return;
          setShowUpload(false);
          createMutation.reset();
        }}
        title={selectedClient ? `Add asset for ${selectedClient.name}` : 'Add asset'}
        size="sm"
        showCloseButton={!createMutation.isPending}
      >
        <form onSubmit={handleCreate} className="space-y-4">
              <div>
            <label htmlFor="asset-name" className="block text-sm font-medium mb-1">Name</label>
            <input id="asset-name" type="text" value={newAsset.name} onChange={e => setNewAsset({ ...newAsset, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required disabled={createMutation.isPending} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
              <label htmlFor="asset-type" className="block text-sm font-medium mb-1">Type</label>
              <select id="asset-type" value={newAsset.type} onChange={e => setNewAsset({ ...newAsset, type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" disabled={createMutation.isPending}>
                    {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
              <label htmlFor="asset-category" className="block text-sm font-medium mb-1">Category</label>
              <select id="asset-category" value={newAsset.category} onChange={e => setNewAsset({ ...newAsset, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" disabled={createMutation.isPending}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
            <label htmlFor="asset-url" className="block text-sm font-medium mb-1">URL</label>
            <input id="asset-url" type="url" value={newAsset.url} onChange={e => setNewAsset({ ...newAsset, url: e.target.value })}
                  placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required disabled={createMutation.isPending} />
              </div>
              <div>
            <label htmlFor="asset-description" className="block text-sm font-medium mb-1">Description</label>
            <textarea id="asset-description" value={newAsset.description} onChange={e => setNewAsset({ ...newAsset, description: e.target.value })}
                  rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" disabled={createMutation.isPending} />
              </div>
          {createMutation.error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {createMutation.error.message || 'The asset could not be added. Your entries have been preserved.'}
            </p>
          )}
          <ModalFooter className="px-0 pb-0">
            <Button variant="ghost" type="button" onClick={() => setShowUpload(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Add asset</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
