import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError, apiGet, request } from './api';
import { app } from './app-state';
import { useStore } from './store';

/** Hydrate a GET from the encrypted main-process cache while its live request runs. */
export function useLocalFirstQuery<T>(options: {
  queryKey: QueryKey;
  path: string;
  params?: Record<string, string>;
  enabled?: boolean;
  interval: number;
}) {
  const qc = useQueryClient();
  const scope = useStore(app, (s) => `${s.auth?.server?.origin ?? ''}:${s.bootstrap?.user?.id ?? ''}:${s.bootstrap?.user?.organizationId ?? ''}`);
  const keyJson = JSON.stringify(options.queryKey);
  const key = useMemo(() => [...JSON.parse(keyJson) as QueryKey, { scope }], [keyJson, scope]);
  const path = options.path;
  const paramsKey = JSON.stringify(options.params ?? {});
  const query = useQuery<T>({
    queryKey: key,
    queryFn: ({ signal }) => apiGet<T>(path, options.params, signal),
    enabled: options.enabled,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchInterval: (q) => q.state.error instanceof ApiError && (q.state.error.forbidden || q.state.error.status === 404) ? false : document.visibilityState === 'visible' ? options.interval : Math.max(options.interval, 60_000),
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 2,
  });
  useEffect(() => {
    if (options.enabled === false || qc.getQueryData(key) !== undefined) return;
    const controller = new AbortController();
    void request<T>('GET', path, { query: JSON.parse(paramsKey) as Record<string, string>, signal: controller.signal, headers: { 'X-WS-Local-Read': '1' } }).then((hit) => {
      // Never replace a live result, resurrect a refused request, or populate a retired account.
      const state = qc.getQueryState(key);
      if (!controller.signal.aborted && state && state.data === undefined && state.error === null) qc.setQueryData(key, hit.data, { updatedAt: 0 });
    }, () => undefined);
    return () => controller.abort();
  }, [qc, key, path, paramsKey, options.enabled]);
  useEffect(() => app.subscribe(() => {
    const s = app.get();
    const current = `${s.auth?.server?.origin ?? ''}:${s.bootstrap?.user?.id ?? ''}:${s.bootstrap?.user?.organizationId ?? ''}`;
    if (current !== scope) {
      void qc.cancelQueries({ queryKey: key, exact: true });
      qc.removeQueries({ queryKey: key, exact: true });
    }
  }), [qc, key, scope]);
  const denied = query.error instanceof ApiError && (query.error.forbidden || query.error.status === 404);
  return { ...query, data: denied ? undefined : query.data };
}
