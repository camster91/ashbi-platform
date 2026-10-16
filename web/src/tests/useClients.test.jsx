import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useClients, { useClientPages, CLIENTS_ROOT_KEY, CLIENT_OPTIONS_LIMIT, clientOptionsKey, normalizeClients } from '../hooks/useClients';
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

describe('useClientPages', () => {
  it('loads lazily, advances through actual server pages and shares root invalidation', async () => {
    api.getClients.mockResolvedValueOnce({ clients: [{id:'c1',name:'First'}], total:2 })
      .mockResolvedValueOnce({ clients: [{id:'c2',name:'Second'}], total:2 });
    const queryClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
    const {result,rerender} = renderHook(({enabled}) => useClientPages({enabled,limit:100,scope:['org','staff','TEAM']}), {initialProps:{enabled:false},wrapper:wrapperFor(queryClient)});
    expect(api.getClients).not.toHaveBeenCalled(); rerender({enabled:true});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(api.getClients).toHaveBeenCalledWith({limit:100,offset:0}); expect(result.current.hasNextPage).toBe(true);
    await act(()=>result.current.fetchNextPage());
    expect(api.getClients).toHaveBeenLastCalledWith({limit:100,offset:1});
    await waitFor(()=>expect(result.current.data.pages).toHaveLength(2));
    expect(result.current.data.pages.flatMap(page=>page.clients).map(row=>row.id)).toEqual(['c1','c2']); expect(result.current.hasNextPage).toBe(false);
    const key=['clients','pages',100,'org','staff','TEAM']; expect(queryClient.getQueryData(key).pages).toHaveLength(2);
    expect(queryClient.getQueryData(clientOptionsKey())).toBeUndefined();
    api.getClients.mockResolvedValue({clients:[{id:'c3',name:'Refreshed'}],total:1});
    await act(()=>queryClient.invalidateQueries({queryKey:CLIENTS_ROOT_KEY}));
    await waitFor(()=>expect(result.current.data.pages[0].clients[0].id).toBe('c3')); queryClient.clear();
  });
  it('keeps failed or malformed pages unavailable instead of fabricating a complete list', async () => {
    api.getClients.mockResolvedValue({clients:'invalid',total:1});
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const {result}=renderHook(()=>useClientPages({scope:['other-org','staff']}),{wrapper:wrapperFor(queryClient)});
    await waitFor(()=>expect(result.current.isError).toBe(true)); expect(result.current.data).toBeUndefined();queryClient.clear();
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
      .filter((path) => !allowed.has(basename(path)))
      .filter((path) => readFileSync(path, 'utf8').includes('api.getClients('));
    expect(offenders).toEqual([]);
  });

  it('never caches a client list under the bare [\'clients\'] key', () => {
    const offenders = sources(SOURCE_ROOT)
      .filter((path) => /queryKey:\s*\['clients'\s*\],\s*queryFn/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
