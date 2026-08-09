import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Search, Plus, Trash2, Image, FileText, Video, Palette, Globe } from 'lucide-react';
import { api } from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button, Card, LoadingState } from '../components/ui';
import Modal, { ModalFooter } from '../components/Modal';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../hooks/useAuth';

const TYPE_ICONS = { image: Image, document: FileText, video: Video, brand: Palette, website: Globe };
const ASSET_TYPES = ['image', 'document', 'video', 'brand', 'website', 'other'];
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
  const [newAsset, setNewAsset] = useState({ name: '', type: 'image', category: 'logo', url: '', description: '' });
  const [assetToDelete, setAssetToDelete] = useState(null);

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
      setNewAsset({ name: '', type: 'image', category: 'logo', url: '', description: '' });
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
    createMutation.mutate({ ...newAsset, clientId });
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

      {/* Client selector + filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
            placeholder="Enter Client ID to load assets"
            className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm w-48" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm">
            <option value="">All Types</option>
            {ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm">
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
      </Card>

      {/* Assets grid */}
      {!clientId ? (
        <Card className="p-12 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">Enter a Client ID</h3>
          <p className="text-sm text-muted-foreground mt-1">Type a client ID above to load their assets</p>
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
          <p className="text-sm text-muted-foreground mt-1">Add your first asset or adjust your filters</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredAssets.map(asset => (
            <Card key={asset.id} className="p-3 group hover:border-primary/30 transition-colors">
              <div className="aspect-square rounded-lg bg-muted flex items-center justify-center mb-2 overflow-hidden">
                {asset.type === 'image' && asset.url ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-muted-foreground">{getTypeIcon(asset.type)}</div>
                )}
              </div>
              <p className="text-sm font-medium text-foreground truncate">{asset.name}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">{asset.category}</span>
                <button onClick={() => { deleteMutation.reset(); setAssetToDelete(asset); }}
                  type="button" aria-label={`Delete asset ${asset.name}`} disabled={deleteMutation.isPending}
                  className="min-h-11 min-w-11 p-1 text-muted-foreground hover:text-red-500 rounded opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50">
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
        title="Add asset"
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
                    {ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
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
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" disabled={createMutation.isPending} />
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
