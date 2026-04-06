import { useState } from 'react';
import { Search, Folder, CheckSquare, User, BarChart2, AlertTriangle, FileText } from 'lucide-react';

const TYPE_ICON = { project: Folder, task: CheckSquare, client: User, metric: BarChart2, alert: AlertTriangle };

const EXAMPLES = [
  'Show me overdue tasks',
  'What are my active projects?',
  'List clients with no recent activity',
  'How many hours did the team log this week?',
  'Tasks assigned to me',
  'Projects at risk (health < 50%)',
  'High priority tasks due this week',
  'Team members with most hours logged',
];

export default function AIQuery() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ query: text }),
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
    <div className="max-w-4xl mx-auto space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Ask Hub Anything</h1>
        <p className="text-sm text-muted-foreground mt-1">Use natural language to query projects, tasks, and team data</p>
      </div>

      {/* Query input */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleQuery(query)}
            placeholder="Ask anything… e.g. 'Show overdue tasks' or 'Team utilization this week'"
            className="flex-1 px-4 py-3 border-2 border-border rounded-lg focus:border-primary outline-none text-lg bg-background text-foreground placeholder:text-muted-foreground"
            autoFocus
          />
          <button
            onClick={() => handleQuery(query)}
            disabled={loading || !query.trim()}
            className="px-5 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>

        {!query && !results.length && (
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-3">Try asking:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {EXAMPLES.map((example, i) => (
                <button
                  key={i}
                  onClick={() => handleQuery(example)}
                  className="text-left px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm text-muted-foreground hover:text-foreground transition"
                >
                  → {example}
                </button>
              ))}
            </div>
          </div>
        )}
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
          Thinking...
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Results for: <span className="font-semibold text-foreground">"{query}"</span>
          </p>
          {results.map((result, i) => {
            const Icon = TYPE_ICON[result.type] || FileText;
            return (
              <div key={i} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground text-lg">{result.name || result.title}</h3>
                    {result.description && (
                      <p className="text-muted-foreground text-sm mt-1">{result.description}</p>
                    )}
                    {result.metadata && (
                      <div className="mt-2 flex gap-4 text-sm flex-wrap">
                        {Object.entries(result.metadata).map(([key, value]) => (
                          <span key={key} className="text-muted-foreground">
                            <span className="font-medium text-foreground">{key}:</span> {value}
                          </span>
                        ))}
                      </div>
                    )}
                    {result.actionUrl && (
                      <button
                        onClick={() => window.location.href = result.actionUrl}
                        className="mt-3 px-4 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
                      >
                        View Details →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : query && !error ? (
        <div className="text-center text-muted-foreground py-12">
          <Search className="mx-auto mb-3 opacity-20" size={40} />
          <p className="text-lg">No results found</p>
          <p className="text-sm">Try rephrasing your question</p>
        </div>
      ) : null}
    </div>
  );
}
