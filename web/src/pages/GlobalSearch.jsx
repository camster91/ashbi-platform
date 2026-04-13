import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Folder, CheckSquare, User, MessageSquare, Mail } from 'lucide-react';
import api from '../lib/api';

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
  { value: 'threads', label: 'Messages' },
];

export default function GlobalSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (query.trim()) {
      search();
    } else {
      setResults([]);
    }
  }, [query, filter]);

  const search = async () => {
    if (query.trim().length < 2) { setResults([]); return; }
    try {
      setLoading(true);
      const type = filter === 'all' ? '' : filter;
      const data = await api.search(query, type);
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setQuery(value);
    setSearchParams({ q: value });
  };

  const goToResult = (result) => {
    const routes = { project: `/project/${result.id}`, task: `/task/${result.id}`, client: `/client/${result.id}`, thread: `/thread/${result.id}` };
    if (routes[result.type]) navigate(routes[result.type]);
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
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
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
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="text-center text-muted-foreground py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          Searching...
        </div>
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
          <p className="text-sm text-muted-foreground">
            Found <span className="font-semibold text-foreground">{results.length}</span> results
          </p>
          {results.map((result) => {
            const Icon = TYPE_ICON[result.type] || Search;
            return (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => goToResult(result)}
                className="w-full bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition text-left"
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
                    <div className="flex gap-4 text-xs text-muted-foreground mt-1.5">
                      {result.clientName && <span>Client: {result.clientName}</span>}
                      {result.status && <span>Status: {result.status}</span>}
                      {result.lastActivity && (
                        <span>Updated: {new Date(result.lastActivity).toLocaleDateString()}</span>
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
      )}
    </div>
  );
}
