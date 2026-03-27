import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function GlobalSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all, projects, tasks, clients, messages

  useEffect(() => {
    if (query.trim()) {
      search();
    } else {
      setResults([]);
    }
  }, [query, filter]);

  const search = async () => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    try {
      setLoading(true);
      const params = new URLSearchParams({ q: query, type: filter === 'all' ? '' : filter });
      const res = await fetch(`/api/search?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
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
    switch (result.type) {
      case 'project':
        navigate(`/project/${result.id}`);
        break;
      case 'task':
        navigate(`/task/${result.id}`);
        break;
      case 'client':
        navigate(`/client/${result.id}`);
        break;
      case 'thread':
        navigate(`/thread/${result.id}`);
        break;
      default:
        break;
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'project': return '📁';
      case 'task': return '✓';
      case 'client': return '👤';
      case 'thread': return '💬';
      case 'message': return '📧';
      default: return '🔍';
    }
  };

  const getTypeBadgeColor = (type) => {
    switch (type) {
      case 'project': return 'bg-blue-100 text-blue-700';
      case 'task': return 'bg-green-100 text-green-700';
      case 'client': return 'bg-purple-100 text-purple-700';
      case 'thread': return 'bg-orange-100 text-orange-700';
      case 'message': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6 bg-[#f8f4ef] min-h-screen">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#1a2744] mb-2">Search Hub</h1>
          <p className="text-gray-600">Find projects, tasks, clients, and conversations</p>
        </div>

        {/* Search Box */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <input
            type="text"
            value={query}
            onChange={handleSearch}
            placeholder="Search for projects, tasks, clients, messages..."
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-[#c9a84c] outline-none text-lg"
            autoFocus
          />

          {/* Filters */}
          <div className="mt-4 flex gap-2 flex-wrap">
            {[
              { value: 'all', label: 'All' },
              { value: 'projects', label: '📁 Projects' },
              { value: 'tasks', label: '✓ Tasks' },
              { value: 'clients', label: '👤 Clients' },
              { value: 'threads', label: '💬 Messages' }
            ].map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-4 py-2 rounded-lg transition ${
                  filter === f.value
                    ? 'bg-[#c9a84c] text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600 mb-6">
            {error}
          </div>
        )}

        {/* Results */}
        <div>
          {loading && (
            <div className="text-center text-gray-500 py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#c9a84c] mx-auto mb-4"></div>
              Searching...
            </div>
          )}

          {!loading && results.length === 0 && query.trim() && (
            <div className="text-center text-gray-500 py-12">
              <p className="text-lg">No results found for "{query}"</p>
              <p className="text-sm">Try a different search term</p>
            </div>
          )}

          {!loading && results.length === 0 && !query.trim() && (
            <div className="text-center text-gray-500 py-12">
              <p className="text-lg">Enter search terms to get started</p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 mb-4">
                Found <span className="font-semibold">{results.length}</span> results
              </p>

              {results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => goToResult(result)}
                  className="w-full bg-white rounded-lg shadow p-4 hover:shadow-lg transition text-left"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl">{getTypeIcon(result.type)}</span>
                        <h3 className="font-semibold text-[#1a2744] text-lg">{result.name || result.title}</h3>
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${getTypeBadgeColor(result.type)}`}>
                          {result.type}
                        </span>
                      </div>

                      {result.description && (
                        <p className="text-sm text-gray-600 line-clamp-2 ml-11">
                          {result.description}
                        </p>
                      )}

                      <div className="mt-2 ml-11 flex gap-4 text-xs text-gray-500">
                        {result.clientName && <span>Client: {result.clientName}</span>}
                        {result.status && <span>Status: {result.status}</span>}
                        {result.lastActivity && (
                          <span>
                            Updated: {new Date(result.lastActivity).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="ml-4 text-right">
                      {result.progress && (
                        <div className="text-xs text-gray-600 mb-2">{result.progress}% done</div>
                      )}
                      {result.score && (
                        <div className="text-xs text-gray-500">Relevance: {(result.score * 100).toFixed(0)}%</div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
