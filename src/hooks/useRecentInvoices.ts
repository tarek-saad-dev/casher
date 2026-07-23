'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RecentInvoicesFilterState,
  RecentInvoicesQueryParams,
  RecentInvoicesResponse,
} from '@/lib/recentInvoices.types';
import {
  buildRecentInvoicesCacheKey,
  buildRecentInvoicesQueryString,
  filtersToQueryParams,
} from '@/lib/recentInvoicesQuery';
import { subscribeRecentInvoicesInvalidation } from '@/lib/recentInvoicesCache';

interface UseRecentInvoicesOptions {
  enabled: boolean;
  filters: RecentInvoicesFilterState;
  debouncedQuery: string;
  /**
   * Active branch id, if known client-side (e.g. from session/`/api/branches/active`).
   * Not sent to the server — the server independently re-validates the active branch and
   * filters by it. Included here only to key the client-side response cache per branch so
   * that switching branches doesn't surface another branch's cached invoices.
   */
  branchId?: number | null;
}

interface UseRecentInvoicesResult {
  items: RecentInvoicesResponse['items'];
  total: number;
  hasMore: boolean;
  isInitialLoading: boolean;
  isFetching: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  resetList: () => void;
}

const responseCache = new Map<string, { data: RecentInvoicesResponse; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000;

function mergeUniqueItems(
  existing: RecentInvoicesResponse['items'],
  incoming: RecentInvoicesResponse['items'],
) {
  const seen = new Set(existing.map((item) => item.InvID));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.InvID)) {
      seen.add(item.InvID);
      merged.push(item);
    }
  }
  return merged;
}

async function fetchRecentInvoices(
  params: RecentInvoicesQueryParams,
  cursor: number | null,
  signal: AbortSignal,
): Promise<RecentInvoicesResponse> {
  const query = buildRecentInvoicesQueryString(params, cursor);
  const response = await fetch(`/api/sales/recent-invoices?${query}`, { signal });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'تعذر تحميل الفواتير');
  }

  return data as RecentInvoicesResponse;
}

export function useRecentInvoices({
  enabled,
  filters,
  debouncedQuery,
  branchId,
}: UseRecentInvoicesOptions): UseRecentInvoicesResult {
  const [items, setItems] = useState<RecentInvoicesResponse['items']>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreInFlightRef = useRef(false);

  const queryParams = useMemo(() => {
    const params = filtersToQueryParams(filters);
    params.q = debouncedQuery.trim() || undefined;
    params.branchId = branchId ?? undefined;
    return params;
  }, [filters, debouncedQuery, branchId]);

  const cacheKey = useMemo(() => buildRecentInvoicesCacheKey(queryParams), [queryParams]);

  const resetList = useCallback(() => {
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setNextCursor(null);
  }, []);

  const applyResponse = useCallback(
    (data: RecentInvoicesResponse, append: boolean) => {
      setItems((current) => (append ? mergeUniqueItems(current, data.items) : data.items));
      setTotal(data.total);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      responseCache.set(cacheKey, { data, fetchedAt: Date.now() });
    },
    [cacheKey],
  );

  const fetchPage = useCallback(
    async (append: boolean, cursor: number | null, background: boolean) => {
      if (!enabled) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const requestId = ++requestIdRef.current;

      if (append) {
        setIsLoadingMore(true);
      } else if (background && items.length > 0) {
        setIsFetching(true);
      } else {
        setIsInitialLoading(true);
      }

      setError(null);

      try {
        const data = await fetchRecentInvoices(queryParams, cursor, controller.signal);
        if (requestId !== requestIdRef.current) return;
        applyResponse(data, append);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل الفواتير');
      } finally {
        if (requestId === requestIdRef.current) {
          setIsInitialLoading(false);
          setIsFetching(false);
          setIsLoadingMore(false);
          loadMoreInFlightRef.current = false;
        }
      }
    },
    [enabled, queryParams, applyResponse, items.length],
  );

  const refetch = useCallback(async () => {
    resetList();
    await fetchPage(false, null, false);
  }, [fetchPage, resetList]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    await fetchPage(true, nextCursor, false);
  }, [fetchPage, hasMore, nextCursor]);

  useEffect(() => {
    if (!enabled) return;

    const cached = responseCache.get(cacheKey);
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

    if (cached) {
      applyResponse(cached.data, false);
      if (isFresh) return;
      void fetchPage(false, null, true);
      return;
    }

    resetList();
    void fetchPage(false, null, false);
  }, [enabled, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    return subscribeRecentInvoicesInvalidation(() => {
      responseCache.delete(cacheKey);
      void refetch();
    });
  }, [enabled, cacheKey, refetch]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    items,
    total,
    hasMore,
    isInitialLoading,
    isFetching,
    isLoadingMore,
    error,
    refetch,
    loadMore,
    resetList,
  };
}
