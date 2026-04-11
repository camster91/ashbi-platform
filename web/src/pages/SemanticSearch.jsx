import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Database, Trash2, Cpu, Brain, BarChart3, FileText, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

export default function SemanticSearch() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState('');
  const [showIndex, setShowIndex] = useState(false);
  const [indexDocs, setIndexDocs] = useState([
    { content: 'Client prefers modern, minimalist design with bold typography', source: 'notes', metadata: { type: 'design_preference' } },
    { content: 'Project timeline: 8 weeks for web design, 4 weeks for development', source: 'proposal', metadata: { type: 'timeline' } },
    { content: 'Budget range: $5,000 - $15,000 for full website redesign', source: 'contract', metadata: { type: 'budget' } },
  ]);

  const { data: results = [], isLoading: searching, refetch } = useQuery({
    queryKey: ['semantic-search', query, clientId],
    queryFn: () => api.semanticSearch(query, 10, clientId || undefined),
    enabled: false,
  });

  const { data: stats } = useQuery({
    queryKey: ['embedding-stats'],
    queryFn: () => api.getEmbeddingStats ? api.getEmbeddingStats() : Promise.resolve([]),
  });

  const indexMutation = useMutation({
    mutationFn: (data) => api.createEmbedding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-stats'] });
      setShowIndex(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ source, sourceId }) => api.deleteEmbedding(source, sourceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['embedding-stats'] }),
  });

  const rebuildMutation = useMutation({
    mutationFn: (cId) => api.rebuildClientBrain(cId),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    refetch();
  };

  const handleIndexDocs = () => {
    indexDocs.forEach((doc, i) => {
      indexMutation.mutate({
        clientId: clientId || undefined,
        content: doc.content,
        sourceType: doc.source,
        sourceId: `sample-${Date.now()}-${i}`,
        metadata: doc.metadata,
      });
    });
  };

  const similarityColor = (score) => {
    if (score >= 0.8) return 'text-emerald-500';
    if (score >= 0.6) return 'text-amber-500';
    return 'text-red-400';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary" />
          Client Brain
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Semantic search across client knowledge using AI embeddings</p>
      </div>

      {/* Search */}
      <Card className="p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search client knowledge..."
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm" />
            </div>
            <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
              placeholder="Client ID (optional)"
              className="w-32 px-3 py-2.5 rounded-lg border border-border bg-background text-sm" />
            <Button type="submit" loading={searching} leftIcon={<Search className="w-4 h-4" />}>
              Search
            </Button>
          </div>
        </form>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setShowIndex(true)} leftIcon={<Database className="w-4 h-4" />}>
          Index Documents
        </Button>
        {clientId && (
          <Button variant="outline" size="sm" onClick={() => rebuildMutation.mutate(clientId)}
            loading={rebuildMutation.isPending} leftIcon={<Cpu className="w-4 h-4" />}>
            Rebuild Client Brain
          </Button>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Search Results</h2>
          {results.map((result, i) => (
            <Card key={result.id || i} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground whitespace-pre-wrap">{result.content}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{result.sourceType || result.source}</span>
                    {result.metadata && (
                      <span className="text-xs text-muted-foreground">{JSON.stringify(result.metadata)}</span>
                    )}
                  </div>
                </div>
                <div className={`text-sm font-bold tabular-nums ${similarityColor(result.similarity)}`}>
                  {(result.similarity * 100).toFixed(1)}%
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Stats */}
      {stats && Array.isArray(stats) && stats.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Embedding Stats
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stats.map((stat, i) => (
              <Card key={i} className="p-4">
                <p className="text-xs text-muted-foreground uppercase">{stat.source || stat._id}</p>
                <p className="text-2xl font-bold mt-1">{stat.count || stat.totalCount || 0}</p>
                <p className="text-xs text-muted-foreground">embeddings</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Index Modal */}
      {showIndex && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowIndex(false)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5" />
              Index Documents
            </h3>
            <div className="space-y-4">
              {indexDocs.map((doc, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input type="text" value={doc.content} onChange={e => {
                      const updated = [...indexDocs];
                      updated[i] = { ...updated[i], content: e.target.value };
                      setIndexDocs(updated);
                    }} className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm" />
                    <button onClick={() => setIndexDocs(indexDocs.filter((_, j) => j !== i))}
                      className="p-1 text-muted-foreground hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="flex gap-2">
                    <select value={doc.source} onChange={e => {
                      const updated = [...indexDocs];
                      updated[i] = { ...updated[i], source: e.target.value };
                      setIndexDocs(updated);
                    }} className="px-2 py-1 rounded border border-border bg-background text-xs">
                      <option value="notes">Notes</option>
                      <option value="email">Email</option>
                      <option value="contract">Contract</option>
                      <option value="proposal">Proposal</option>
                      <option value="call">Call</option>
                    </select>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setIndexDocs([...indexDocs, { content: '', source: 'notes', metadata: { type: 'general' } }])}>
                + Add Document
              </Button>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowIndex(false)}>Cancel</Button>
              <Button onClick={handleIndexDocs} loading={indexMutation.isPending}>Index All</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}