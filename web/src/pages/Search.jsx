import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon, MessageSquare, FolderOpen, Users, Filter } from 'lucide-react';
import { api } from '../lib/api';
import { formatRelativeTime, getPriorityColor, getStatusColor, cn } from '../lib/utils';

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [filters, setFilters] = useState({
    type: searchParams.get('type') || 'all',
    clientId: searchParams.get('clientId') || '',
    projectId: searchParams.get('projectId') || '',
  });

  const { data: results, isLoading, refetch } = useQuery({
    queryKey: ['search', query, filters],
    queryFn: () => api.search(query, filters),
    enabled: query.length >= 2,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.length >= 2) {
      setSearchParams({ q: query, ...filters });
      refetch();
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search threads, messages, clients, projects..."
              className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-lg"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Search
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-500">Filters:</span>
          </div>

          <select
            value={filters.type}
            onChange={(e) => handleFilterChange('type', e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="all">All Types</option>
            <option value="threads">Threads</option>
            <option value="messages">Messages</option>
            <option value="clients">Clients</option>
            <option value="projects">Projects</option>
          </select>

          <select
            value={filters.clientId}
            onChange={(e) => handleFilterChange('clientId', e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Clients</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>

          <select
            value={filters.projectId}
            onChange={(e) => handleFilterChange('projectId', e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Projects</option>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </form>

      {/* Results */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {!isLoading && results && (
        <div className="space-y-6">
          {/* Result Count */}
          <p className="text-sm text-gray-500">
            Found {results.total || 0} results for "{query}"
          </p>

          {/* Threads */}
          {results.threads?.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Threads ({results.threads.length})</h2>
              </div>
              <ul className="divide-y">
                {results.threads.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      to={`/thread/${thread.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{thread.subject}</div>
                        <div className="text-sm text-gray-500 flex items-center gap-2">
                          {thread.client?.name && (
                            <span>{thread.client.name}</span>
                          )}
                          {thread.project?.name && (
                            <>
                              <span>•</span>
                              <span>{thread.project.name}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span
                          className={cn(
                            'px-2 py-0.5 text-xs font-medium rounded',
                            getStatusColor(thread.status)
                          )}
                        >
                          {thread.status}
                        </span>
                        <span className="text-sm text-gray-500">
                          {formatRelativeTime(thread.lastActivityAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Messages */}
          {results.messages?.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Messages ({results.messages.length})</h2>
              </div>
              <ul className="divide-y">
                {results.messages.map((message) => (
                  <li key={message.id}>
                    <Link
                      to={`/thread/${message.threadId}`}
                      className="block px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="text-sm text-gray-500 mb-1">
                        {message.senderEmail} • {formatRelativeTime(message.receivedAt)}
                      </div>
                      <div className="text-gray-700 line-clamp-2">
                        {message.bodyText}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Clients */}
          {results.clients?.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Clients ({results.clients.length})</h2>
              </div>
              <ul className="divide-y">
                {results.clients.map((client) => (
                  <li key={client.id}>
                    <Link
                      to={`/client/${client.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                    >
                      <div>
                        <div className="font-medium">{client.name}</div>
                        {client.domain && (
                          <div className="text-sm text-gray-500">{client.domain}</div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 text-xs font-medium rounded',
                          client.status === 'ACTIVE'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {client.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Projects */}
          {results.projects?.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Projects ({results.projects.length})</h2>
              </div>
              <ul className="divide-y">
                {results.projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      to={`/project/${project.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                    >
                      <div>
                        <div className="font-medium">{project.name}</div>
                        <div className="text-sm text-gray-500">
                          {project.client?.name}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 text-xs font-medium rounded',
                          project.health === 'ON_TRACK'
                            ? 'bg-green-50 text-green-700'
                            : project.health === 'NEEDS_ATTENTION'
                            ? 'bg-yellow-50 text-yellow-700'
                            : 'bg-red-50 text-red-700'
                        )}
                      >
                        {project.health?.replace(/_/g, ' ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No Results */}
          {results.total === 0 && (
            <div className="text-center py-12 text-gray-500">
              No results found for "{query}"
            </div>
          )}
        </div>
      )}

      {!query && (
        <div className="text-center py-12 text-gray-500">
          Enter at least 2 characters to search
        </div>
      )}
    </div>
  );
}
