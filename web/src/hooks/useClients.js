import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// The clients route clamps `limit` to 200 (src/routes/client.routes.js), so
// pickers ask for the largest page the server will return.
export const CLIENT_OPTIONS_LIMIT = 200;

// Every cached client query lives under this root, so a mutation can refresh
// all of them with `invalidateQueries({ queryKey: CLIENTS_ROOT_KEY })`.
export const CLIENTS_ROOT_KEY = ['clients'];

export const clientOptionsKey = (limit = CLIENT_OPTIONS_LIMIT) => ['clients', 'options', limit];

/**
 * Normalize any client-list payload to an array. `GET /clients` returns
 * `{ clients, total, limit, offset }`; older callers cached the unwrapped
 * array. Accept both, and anything else becomes `[]`.
 */
export function normalizeClients(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.clients)) return data.clients;
  return [];
}

/**
 * Client options for dropdowns and pickers. Owns the query key, the fetch and
 * the normalization, so `data` is always an array regardless of what shape
 * sits in the cache. `isComplete` is false when the organization has more
 * clients than the server returns in one page.
 */
export default function useClients({ limit = CLIENT_OPTIONS_LIMIT, enabled = true } = {}) {
  const query = useQuery({
    queryKey: clientOptionsKey(limit),
    queryFn: () => api.getClients({ limit }),
    select: (data) => ({
      clients: normalizeClients(data),
      total: typeof data?.total === 'number' ? data.total : normalizeClients(data).length,
    }),
    enabled,
  });

  const clients = query.data?.clients ?? [];
  const total = query.data?.total ?? clients.length;
  // Only the fields callers use; `data` is always an array.
  return {
    data: clients,
    clients,
    total,
    // Unknown until the list has loaded.
    isComplete: query.isSuccess && total <= clients.length,
    isSuccess: query.isSuccess,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Server-side client search, for pickers whose first page (`useClients`) is
 * not the whole list. Runs once the term has at least 2 characters; `data` is
 * always an array.
 */
export function useClientSearch(term, { enabled = true, limit = 50 } = {}) {
  const search = String(term || '').trim();
  const query = useQuery({
    queryKey: ['clients', 'search', search, limit],
    queryFn: () => api.getClients({ search, limit }),
    select: normalizeClients,
    enabled: enabled && search.length >= 2,
  });
  return { ...query, data: query.data ?? [] };
}
