import { useState } from 'react';

export default function AIQuery() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [examples] = useState([
    'Show me overdue tasks',
    'What are my active projects?',
    'List clients with no recent activity',
    'How many hours did the team log this week?',
    'Tasks assigned to me',
    'Projects at risk (health < 50%)',
    'High priority tasks due this week',
    'Team members with most hours logged'
  ]);

  const handleQuery = async (text) => {
    if (!text.trim()) return;

    setQuery(text);
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/ai/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ query: text })
      });

      if (!res.ok) throw new Error('Query failed');
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-[#f8f4ef] min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#1a2744] mb-2">Ask Hub Anything</h1>
          <p className="text-gray-600">Use natural language to query projects, tasks, and team data</p>
        </div>

        {/* Query Input */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleQuery(query)}
              placeholder="Ask anything... e.g. 'Show overdue tasks' or 'Team utilization this week'"
              className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-[#c9a84c] outline-none text-lg"
              autoFocus
            />
            <button
              onClick={() => handleQuery(query)}
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-[#c9a84c] text-white rounded-lg hover:bg-[#b89840] disabled:opacity-50 font-semibold"
            >
              {loading ? '⏳' : '🔍'}
            </button>
          </div>

          {/* Examples */}
          {!query && !results.length && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-gray-600 mb-3">Try asking:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {examples.map((example, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuery(example)}
                    className="text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-sm text-gray-700 transition"
                  >
                    → {example}
                  </button>
                ))}
              </div>
            </div>
          )}
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
              Thinking...
            </div>
          )}

          {!loading && results.length > 0 && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Results for: <span className="font-semibold">"{query}"</span>
              </p>

              <div className="space-y-4">
                {results.map((result, i) => (
                  <div key={i} className="bg-white rounded-lg shadow p-6">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{getIcon(result.type)}</span>
                      <div className="flex-1">
                        <h3 className="font-semibold text-[#1a2744] text-lg">
                          {result.name || result.title}
                        </h3>
                        <p className="text-gray-600 text-sm mt-1">{result.description}</p>

                        <div className="mt-3 flex gap-4 text-sm">
                          {result.metadata && Object.entries(result.metadata).map(([key, value]) => (
                            <span key={key} className="text-gray-500">
                              <span className="font-semibold">{key}:</span> {value}
                            </span>
                          ))}
                        </div>

                        {result.actionUrl && (
                          <button
                            onClick={() => window.location.href = result.actionUrl}
                            className="mt-4 px-4 py-2 bg-[#c9a84c] text-white text-sm rounded hover:bg-[#b89840]"
                          >
                            View Details →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && query && results.length === 0 && !error && (
            <div className="text-center text-gray-500 py-12">
              <p className="text-lg">No results found</p>
              <p className="text-sm">Try rephrasing your question</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getIcon(type) {
  switch (type) {
    case 'project': return '📁';
    case 'task': return '✓';
    case 'client': return '👤';
    case 'metric': return '📊';
    case 'alert': return '⚠️';
    default: return '📝';
  }
}
