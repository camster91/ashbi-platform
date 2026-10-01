import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useClients, { CLIENT_OPTIONS_LIMIT, clientOptionsKey, normalizeClients } from '../hooks/useClients';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getClients: vi.fn() } }));

function wrapperFor(queryClient) {
  return ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('normalizeClients', () => {
  it('unwraps the route payload and passes arrays through', () => {
    const rows = [{ id: 'c1', name: 'Acme' }];
    expect(normalizeClients({ clients: rows, total: 1 })).toBe(rows);
    expect(normalizeClients(rows)).toBe(rows);
  });

  it('turns anything else into an empty array', () => {
    for (const value of [undefined, null, {}, { clients: 'x' }, 'x', 3]) {
      expect(normalizeClients(value)).toEqual([]);
    }
  });
});

describe('useClients', () => {
  it('always exposes an array, with the server total, under its own key', async () => {
    api.getClients.mockResolvedValue({ clients: [{ id: 'c1', name: 'Acme' }], total: 260 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useClients(), { wrapper: wrapperFor(queryClient) });

    expect(result.current.data).toEqual([]);
    expect(result.current.isComplete).toBe(false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'c1', name: 'Acme' }]);
    expect(result.current.total).toBe(260);
    expect(result.current.isComplete).toBe(false);
    expect(api.getClients).toHaveBeenCalledWith({ limit: CLIENT_OPTIONS_LIMIT });
    // The raw payload is cached under the picker key, never under bare ['clients'].
    expect(queryClient.getQueryData(clientOptionsKey())).toEqual({ clients: [{ id: 'c1', name: 'Acme' }], total: 260 });
    expect(queryClient.getQueryData(['clients'])).toBeUndefined();
  });

  it('still yields an array if an older array-shaped payload is cached', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(clientOptionsKey(), [{ id: 'c2', name: 'Globex' }]);
    const { result } = renderHook(() => useClients(), { wrapper: wrapperFor(queryClient) });
    expect(result.current.data).toEqual([{ id: 'c2', name: 'Globex' }]);
    expect(result.current.isComplete).toBe(true);
    expect(api.getClients).not.toHaveBeenCalled();
  });

  it('is not complete while the list is loading or failed', async () => {
    api.getClients.mockRejectedValue(new Error('down'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useClients(), { wrapper: wrapperFor(queryClient) });
    expect(result.current.isComplete).toBe(false);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isComplete).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(Object.keys(result.current).sort()).toEqual(
      ['clients', 'data', 'error', 'isComplete', 'isError', 'isFetching', 'isLoading', 'isSuccess', 'refetch', 'total'],
    );
  });
});

describe('client list cache contract', () => {
  const SOURCE_ROOT = resolve(process.cwd(), 'src');

  function sources(dir) {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'tests' ? [] : sources(path);
      return /\.(jsx?|tsx?)$/.test(name) ? [path] : [];
    });
  }

  it('fetches clients only through useClients or the Clients page list', () => {
    const allowed = new Set(['useClients.js', 'Clients.jsx', 'api.js']);
    const offenders = sources(SOURCE_ROOT)
      .filter((path) => !allowed.has(path.split('/').pop()))
      .filter((path) => readFileSync(path, 'utf8').includes('api.getClients('));
    expect(offenders).toEqual([]);
  });

  it('never caches a client list under the bare [\'clients\'] key', () => {
    const offenders = sources(SOURCE_ROOT)
      .filter((path) => /queryKey:\s*\['clients'\s*\],\s*queryFn/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
