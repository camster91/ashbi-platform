import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Database, Cpu, Brain, BarChart3 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, LoadingState } from '../components/ui';
import Modal, { ModalFooter } from '../components/Modal';
import QueryErrorState from '../components/QueryErrorState';

const EMPTY_DOCUMENT = { content: '', source: 'MANUAL' };

export default function SemanticSearch() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [showIndex, setShowIndex] = useState(false);
  const [showRebuild, setShowRebuild] = useState(false);
  const [indexDoc, setIndexDoc] = useState(EMPTY_DOCUMENT);

  const {
    data: results = [],
    isLoading: searching,
    isFetching: searchFetching,
    error: searchError,
    refetch: retrySearch,
  } = useQuery({
    queryKey: ['semantic-search', query, clientId],
    queryFn: () => api.semanticSearch(query.trim(), 10, clientId.trim() || undefined),
    enabled: false,
  });

  const {
    data: stats = [],
    isLoading: statsLoading,
    isFetching: statsFetching,
    error: statsError,
    refetch: retryStats,
  } = useQuery({
    queryKey: ['embedding-stats'],
    queryFn: () => api.getEmbeddingStats(),
  });

  const indexMutation = useMutation({
    mutationFn: (data) => api.createEmbedding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-stats'] });
      setIndexDoc(EMPTY_DOCUMENT);
      setShowIndex(false);
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: (cId) => api.rebuildClientBrain(cId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-stats'] });
      setShowRebuild(false);
    },
  });

  const handleSearch = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setHasSearched(true);
    retrySearch();
  };

  const handleIndexDocument = (event) => {
    event.preventDefault();
    if (!clientId.trim() || !indexDoc.content.trim()) return;
    indexMutation.mutate({
      clientId: clientId.trim(),
      content: indexDoc.content.trim(),
      source: indexDoc.source,
      sourceId: crypto.randomUUID(),
      metadata: { type: 'manual' },
    });
  };

  const closeIndex = () => {
    if (indexMutation.isPending) return;
    setShowIndex(false);
    indexMutation.reset();
  };

  const closeRebuild = () => {
    if (rebuildMutation.isPending) return;
    setShowRebuild(false);
  };

  const similarityColor = (score) => {
    if (score >= 0.8) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 0.6) return 'text-amber-700 dark:text-amber-400';
    return 'text-red-700 dark:text-red-300';
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

      <Card className="p-4 sm:p-6">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="min-w-0 flex-1 relative">
            <label htmlFor="semantic-query" className="sr-only">Search client knowledge</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input id="semantic-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search client knowledge..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm" />
          </div>
          <label htmlFor="semantic-client" className="sr-only">Client ID</label>
          <input id="semantic-client" type="text" value={clientId} onChange={(event) => setClientId(event.target.value)}
            placeholder="Client ID (optional for search)"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm sm:w-56" />
          <Button type="submit" loading={searching || searchFetching} disabled={!query.trim()} leftIcon={<Search className="w-4 h-4" />}>
            Search
          </Button>
        </form>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" size="sm" onClick={() => { indexMutation.reset(); setShowIndex(true); }}
          disabled={!clientId.trim()} leftIcon={<Database className="w-4 h-4" />}>
          Index document
        </Button>
        <Button variant="outline" size="sm" onClick={() => { rebuildMutation.reset(); setShowRebuild(true); }}
          disabled={!clientId.trim()} leftIcon={<Cpu className="w-4 h-4" />}>
          Rebuild client brain
        </Button>
        {!clientId.trim() && (
          <p className="basis-full text-sm text-muted-foreground">Enter a client ID before indexing or rebuilding knowledge.</p>
        )}
      </div>

      {!showRebuild && rebuildMutation.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {rebuildMutation.error.message || 'The client brain could not be rebuilt. Existing knowledge was preserved.'}
        </p>
      )}
      {rebuildMutation.data && (
        <p role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-foreground">
          {rebuildMutation.data.existingEmbeddingsPreserved
            ? 'No rebuildable source content was found. Existing client knowledge was preserved.'
            : `Rebuild complete: ${rebuildMutation.data.embeddingsCreated} embeddings created and ${rebuildMutation.data.embeddingsReplaced} replaced.`}
        </p>
      )}

      {searching ? (
        <LoadingState label="Searching client knowledge…" />
      ) : searchError ? (
        <QueryErrorState error={searchError} message="Search could not be completed" onRetry={retrySearch} isRetrying={searchFetching} />
      ) : hasSearched && results.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-medium">No matching knowledge</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try different wording or confirm that this client has indexed knowledge.</p>
        </Card>
      ) : results.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Search results</h2>
          {results.map((result, index) => (
            <Card key={result.id || index} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground whitespace-pre-wrap">{result.content}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{result.sourceType || result.source}</span>
                    {result.metadata && <span className="break-all text-xs text-muted-foreground">{JSON.stringify(result.metadata)}</span>}
                  </div>
                </div>
                <div className={`shrink-0 text-sm font-bold tabular-nums ${similarityColor(result.similarity)}`}>
                  {(result.similarity * 100).toFixed(1)}%
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="embedding-stats-heading">
        <h2 id="embedding-stats-heading" className="text-lg font-semibold mb-3 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Embedding stats
        </h2>
        {statsLoading ? (
          <LoadingState label="Loading embedding stats…" compact />
        ) : statsError ? (
          <QueryErrorState error={statsError} message="Embedding stats could not be loaded" onRetry={retryStats} isRetrying={statsFetching} />
        ) : stats.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">No client knowledge has been indexed yet.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {stats.map((stat) => (
              <Card key={stat.source} className="p-4">
                <p className="text-xs text-muted-foreground uppercase">{stat.source}</p>
                <p className="text-2xl font-bold mt-1">{stat.count || 0}</p>
                <p className="text-xs text-muted-foreground">embeddings</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Modal isOpen={showIndex} onClose={closeIndex} title="Index document" size="md" showCloseButton={!indexMutation.isPending}>
        <form onSubmit={handleIndexDocument} className="space-y-4">
          <p className="text-sm text-muted-foreground">This knowledge will be attached to client <span className="font-medium text-foreground">{clientId || '—'}</span>.</p>
          <div>
            <label htmlFor="embedding-source" className="block text-sm font-medium mb-1">Source</label>
            <select id="embedding-source" value={indexDoc.source}
              onChange={(event) => setIndexDoc((current) => ({ ...current, source: event.target.value }))}
              disabled={indexMutation.isPending}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
              <option value="MANUAL">Manual note</option>
              <option value="EMAIL">Email</option>
              <option value="CONTRACT">Contract</option>
              <option value="PROPOSAL">Proposal</option>
              <option value="CALL">Call</option>
            </select>
          </div>
          <div>
            <label htmlFor="embedding-content" className="block text-sm font-medium mb-1">Knowledge</label>
            <textarea id="embedding-content" value={indexDoc.content}
              onChange={(event) => setIndexDoc((current) => ({ ...current, content: event.target.value }))}
              disabled={indexMutation.isPending} required rows={7} maxLength={50000}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-y"
              placeholder="Enter verified client knowledge…" />
          </div>
          {indexMutation.error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {indexMutation.error.message || 'The document could not be indexed. Your content has been preserved.'}
            </p>
          )}
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={closeIndex} disabled={indexMutation.isPending}>Cancel</Button>
            <Button type="submit" loading={indexMutation.isPending} disabled={!clientId.trim() || !indexDoc.content.trim()}>Index document</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal isOpen={showRebuild} onClose={closeRebuild} title="Rebuild client brain" size="sm" showCloseButton={!rebuildMutation.isPending}>
        <p className="text-sm text-muted-foreground">
          Ashbi will generate a complete replacement before removing the existing embeddings. If generation fails, the current client knowledge remains available.
        </p>
        {rebuildMutation.error && (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {rebuildMutation.error.message || 'The rebuild failed. Existing knowledge was preserved.'}
          </p>
        )}
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={closeRebuild} disabled={rebuildMutation.isPending}>Cancel</Button>
          <Button onClick={() => rebuildMutation.mutate(clientId.trim())} loading={rebuildMutation.isPending}>Rebuild safely</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
