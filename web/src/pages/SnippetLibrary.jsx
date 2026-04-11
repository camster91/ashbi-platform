import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Code, Search, Plus, Copy, CheckCircle, Trash2, Star, X } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const LANGUAGES = ['JavaScript', 'TypeScript', 'Python', 'CSS', 'HTML', 'SQL', 'Bash', 'Go', 'Rust', 'Java', 'Other'];
const CATEGORIES = ['Utility', 'Component', 'Hook', 'API', 'Config', 'Algorithm', 'Template', 'Other'];

export default function SnippetLibrary() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedSnippet, setSelectedSnippet] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [newSnippet, setNewSnippet] = useState({
    title: '', description: '', code: '', language: 'JavaScript', category: 'Utility', tags: ''
  });

  const { data: snippets = [], isLoading } = useQuery({
    queryKey: ['snippets', language, category],
    queryFn: () => api.getSnippets({ language: language || undefined, category: category || undefined }),
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ['snippets-search', searchQuery],
    queryFn: () => api.searchSnippets(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createSnippet(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets'] });
      setShowAdd(false);
      setNewSnippet({ title: '', description: '', code: '', language: 'JavaScript', category: 'Utility', tags: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteSnippet(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snippets'] }),
  });

  const displaySnippets = searchQuery.length >= 2 ? searchResults : snippets;

  const handleCopy = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...newSnippet,
      tags: newSnippet.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Code className="w-6 h-6 text-primary" />
            Snippet Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Save and search code snippets</p>
        </div>
        <Button onClick={() => setShowAdd(true)} leftIcon={<Plus className="w-4 h-4" />}>
          Add Snippet
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search snippets..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm" />
          </div>
          <select value={language} onChange={e => setLanguage(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm">
            <option value="">All Languages</option>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm">
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </Card>

      {/* Snippets grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : displaySnippets.length === 0 ? (
        <Card className="p-12 text-center">
          <Code className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-medium">No snippets found</h3>
          <p className="text-sm text-muted-foreground mt-1">Create your first snippet or adjust your filters</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displaySnippets.map(snippet => (
            <Card key={snippet.id} className="p-4 cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => setSelectedSnippet(snippet)}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {snippet.language}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {snippet.category}
                  </span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete?')) deleteMutation.mutate(snippet.id); }}
                  className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <h3 className="text-sm font-medium text-foreground mb-1">{snippet.title}</h3>
              {snippet.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{snippet.description}</p>}
              <pre className="text-xs bg-gray-900 text-gray-100 p-2 rounded overflow-hidden max-h-24">
                <code>{snippet.code?.substring(0, 120)}{snippet.code?.length > 120 ? '...' : ''}</code>
              </pre>
              <div className="flex items-center gap-1 mt-2">
                <Star className="w-3 h-3 text-amber-500" />
                <span className="text-xs text-muted-foreground">{snippet.usageCount || snippet.usage_count || 0} uses</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add Snippet Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdd(false)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Add Snippet</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input type="text" value={newSnippet.title} onChange={e => setNewSnippet({ ...newSnippet, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input type="text" value={newSnippet.description} onChange={e => setNewSnippet({ ...newSnippet, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Language</label>
                  <select value={newSnippet.language} onChange={e => setNewSnippet({ ...newSnippet, language: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                    {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select value={newSnippet.category} onChange={e => setNewSnippet({ ...newSnippet, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Code</label>
                <textarea value={newSnippet.code} onChange={e => setNewSnippet({ ...newSnippet, code: e.target.value })}
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono resize-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
                <input type="text" value={newSnippet.tags} onChange={e => setNewSnippet({ ...newSnippet, tags: e.target.value })}
                  placeholder="react, hook, utility"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button type="submit" loading={createMutation.isPending}>Create Snippet</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Snippet Detail Modal */}
      {selectedSnippet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedSnippet(null)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">{selectedSnippet.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{selectedSnippet.language}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{selectedSnippet.category}</span>
                </div>
              </div>
              <button onClick={() => setSelectedSnippet(null)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            {selectedSnippet.description && <p className="text-sm text-muted-foreground mb-3">{selectedSnippet.description}</p>}
            <div className="relative">
              <pre className="text-sm bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-96">
                <code>{selectedSnippet.code}</code>
              </pre>
              <button onClick={() => handleCopy(selectedSnippet.code, selectedSnippet.id)}
                className="absolute top-2 right-2 p-1.5 bg-gray-800 rounded text-gray-400 hover:text-white transition-colors">
                {copiedId === selectedSnippet.id ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {selectedSnippet.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {selectedSnippet.tags.map((tag, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}