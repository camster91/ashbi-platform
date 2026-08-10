import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Folder, CheckSquare, User, MessageSquare, Mail } from 'lucide-react';
import api from '../lib/api';
import LoadingState from '../components/ui/LoadingState';

const TYPE_ICON = { project: Folder, task: CheckSquare, client: User, thread: MessageSquare, message: Mail };

const TYPE_COLORS = {
  project: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  task: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  client: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  thread: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  message: 'bg-muted text-muted-foreground',
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'projects', label: 'Projects' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'clients', label: 'Clients' },
  { value: 'threads', label: 'Conversations' },
  { value: 'messages', label: 'Messages' },
];

const FILTER_VALUES = new Set(FILTERS.map(({ value }) => value));

export function normalizeSearchResults(data) {
  const r = data?.results || {};
  const tag = (arr, type, mapFn) => (arr || []).map((item) => ({
    ...item,
    type,
    ...mapFn(item),
  }));

  return [
    ...tag(r.projects, 'project', (item) => ({ title: item.name, clientName: item.client?.name })),
    ...tag(r.tasks, 'task', (item) => ({
      title: item.title,
      clientName: item.project?.client?.name,
      projectName: item.project?.name,
    })),
    ...tag(r.clients, 'client', (item) => ({ title: item.name })),
    ...tag(r.threads, 'thread', (item) => ({ title: item.subject, clientName: item.client?.name })),
    ...tag(r.messages, 'message', (item) => ({
      title: item.thread?.subject || item.subject || 'Message',
      clientName: item.thread?.client?.name,
      threadId: item.thread?.id,
      messageId: item.id,
      description: item.bodyText,
    })),
  ];
}

export function resultDestination(result) {
  const routes = {
    project: `/project/${result.id}`,
    task: `/task/${result.id}`,
    client: `/client/${result.id}`,
    thread: `/thread/${result.id}`,
    message: result.threadId
      ? `/thread/${result.threadId}?message=${encodeURIComponent(result.messageId)}`
      : null,
  };
  return routes[result.type] || null;
}

export default function GlobalSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlQuery = searchParams.get('q') || '';
  const urlFilter = FILTER_VALUES.has(searchParams.get('type')) ? searchParams.get('type') : 'all';
  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(urlFilter);
  const requestSequence = useRef(0);

  useEffect(() => {
    setQuery(urlQuery);
    setFilter(urlFilter);
  }, [urlFilter, urlQuery]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const requestId = ++requestSequence.current;

    if (trimmedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    const search = async () => {
      try {
        setLoading(true);
        setError('');
        const params = filter === 'all' ? {} : { type: filter };
        const data = await api.search(trimmedQuery, params);
        if (requestId !== requestSequence.current) return;
        setResults(normalizeSearchResults(data));
      } catch (err) {
        if (requestId !== requestSequence.current) return;
        setResults([]);
        setError(err.message || 'Search failed. Please try again.');
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    };

    search();
    return () => {
      requestSequence.current += 1;
    };
  }, [query, filter]);

  const updateUrlState = (nextQuery, nextFilter) => {
    const params = new URLSearchParams();
    if (nextQuery) params.set('q', nextQuery);
    if (nextFilter !== 'all') params.set('type', nextFilter);
    setSearchParams(params);
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setQuery(value);
    updateUrlState(value, filter);
  };

  const handleFilter = (value) => {
    setFilter(value);
    updateUrlState(query, value);
  };

  const goToResult = (result) => {
    const destination = resultDestination(result);
    if (destination) navigate(destination);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Search Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">Find projects, tasks, clients, and conversations</p>
      </div>

      {/* Search box */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            aria-label="Search Hub"
            type="text"
            value={query}
            onChange={handleSearch}
            placeholder="Search for projects, tasks, clients, messages..."
            className="w-full pl-10 pr-4 py-3 border-2 border-border rounded-lg focus:border-primary outline-none text-lg bg-background text-foreground placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => handleFilter(f.value)}
              aria-pressed={filter === f.value}
              className={`min-h-11 px-3 py-1.5 rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filter === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {!error && (loading ? (
        <LoadingState label="Searching…" compact className="py-12" />
      ) : results.length === 0 && query.trim() ? (
        <div className="text-center text-muted-foreground py-12">
          <Search className="mx-auto mb-3 opacity-20" size={40} />
          <p className="text-lg">No results for "{query}"</p>
          <p className="text-sm">Try a different search term</p>
        </div>
      ) : results.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <Search className="mx-auto mb-3 opacity-20" size={40} />
          <p>Enter search terms to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            Found <span className="font-semibold text-foreground">{results.length}</span> results
          </p>
          {results.map((result) => {
            const Icon = TYPE_ICON[result.type] || Search;
            return (
              <button
                key={`${result.type}-${result.id}`}
                type="button"
                onClick={() => goToResult(result)}
                aria-label={`Open ${result.type} ${result.name || result.title}`}
                className="w-full min-h-11 bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground truncate">{result.name || result.title}</h3>
                      <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[result.type] || TYPE_COLORS.message}`}>
                        {result.type}
                      </span>
                    </div>
                    {result.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{result.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
                      {result.clientName && <span className="min-w-0 break-words">Client: {result.clientName}</span>}
                      {result.projectName && <span className="min-w-0 break-words">Project: {result.projectName}</span>}
                      {result.status && <span className="min-w-0 break-words">Status: {result.status}</span>}
                      {result.lastActivity && (
                        <span>Updated: {new Date(result.lastActivity).toLocaleDateString('en-CA')}</span>
                      )}
                    </div>
                  </div>
                  {result.progress != null && (
                    <span className="flex-shrink-0 text-xs text-muted-foreground">{result.progress}%</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
