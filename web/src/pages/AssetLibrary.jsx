import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Search, Plus, Trash2, X, ExternalLink, Image, FileText, Video, Palette, Globe } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const TYPE_ICONS = { image: Image, document: FileText, video: Video, brand: Palette, website: Globe };
const ASSET_TYPES = ['image', 'document', 'video', 'brand', 'website', 'other'];
const CATEGORIES = ['logo', 'photo', 'illustration', 'icon', 'template', 'guide', 'other'];

export default function AssetLibrary() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [newAsset, setNewAsset] = useState({ name: '', type: 'image', category: 'logo', url: '', description: '' });
  const [guidelines, setGuidelines] = useState({ colors: '', fonts: '', logoUsage: '', toneOfVoice: '' });

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets', clientId],
    queryFn: () => clientId ? api.getAssets(clientId) : Promise.resolve([]),
    enabled: !!clientId,
  });

  const { data: brandSettings } = useQuery({
    queryKey: ['brand-guidelines'],
    queryFn: () => api.getBrandSettings ? api.getBrandSettings() : Promise.resolve(null),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assets', clientId] }),
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
          <Button variant="outline" onClick={() => setShowGuidelines(true)}>Brand Guidelines</Button>
          <Button onClick={() => setShowUpload(true)} leftIcon={<Plus className="w-4 h-4" />} disabled={!clientId}>
            Add Asset
          </Button>
        </div>
      </div>

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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filteredAssets.length === 0 ? (
        <Card className="p-12 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">No assets found</h3>
          <p className="text-sm text-muted-foreground mt-1">Add your first asset or adjust your filters</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredAssets.map(asset => (
            <Card key={asset.id} className="p-3 group cursor-pointer hover:border-primary/30 transition-colors">
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
                <button onClick={() => { if (confirm('Delete?')) deleteMutation.mutate(asset.id); }}
                  className="p-1 text-muted-foreground hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowUpload(false)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Asset</h3>
              <button onClick={() => setShowUpload(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input type="text" value={newAsset.name} onChange={e => setNewAsset({ ...newAsset, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select value={newAsset.type} onChange={e => setNewAsset({ ...newAsset, type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                    {ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select value={newAsset.category} onChange={e => setNewAsset({ ...newAsset, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">URL</label>
                <input type="url" value={newAsset.url} onChange={e => setNewAsset({ ...newAsset, url: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={newAsset.description} onChange={e => setNewAsset({ ...newAsset, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" type="button" onClick={() => setShowUpload(false)}>Cancel</Button>
                <Button type="submit" loading={createMutation.isPending}>Add Asset</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Brand Guidelines Modal */}
      {showGuidelines && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowGuidelines(false)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Brand Guidelines</h3>
              <button onClick={() => setShowGuidelines(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Brand Colors (one per line)</label>
                <textarea value={guidelines.colors} onChange={e => setGuidelines({ ...guidelines, colors: e.target.value })}
                  placeholder="#1a1a2e&#10;#16213e&#10;#0f3460"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Brand Fonts (one per line)</label>
                <textarea value={guidelines.fonts} onChange={e => setGuidelines({ ...guidelines, fonts: e.target.value })}
                  placeholder="Inter&#10;Playfair Display"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Logo Usage</label>
                <textarea value={guidelines.logoUsage} onChange={e => setGuidelines({ ...guidelines, logoUsage: e.target.value })}
                  placeholder="Guidelines for logo placement, clear space, etc."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tone of Voice</label>
                <textarea value={guidelines.toneOfVoice} onChange={e => setGuidelines({ ...guidelines, toneOfVoice: e.target.value })}
                  placeholder="Professional yet approachable, confident, etc."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
              </div>
              <Button className="w-full" onClick={() => { /* save guidelines */ setShowGuidelines(false); }}>
                Save Guidelines
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}