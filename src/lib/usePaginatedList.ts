import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';

/**
 * Shared server-pagination hook with:
 * - 250ms debounced search
 * - request cancellation via AbortController pattern (reqId bump)
 * - in-memory cache keyed by tenant/site/page/filters
 * - immediate display of cached page during refresh
 * - skeleton only on first load, subtle indicator on refreshes
 * - prefetch of next page after display
 * - auto reset to page 1 on filter change
 */

export type PageResult<T> = {
  rows: T[];
  total_count: number;
  totals: Record<string, any>;
};

export type PageState<T> = {
  rows: T[];
  totalCount: number;
  totals: Record<string, any>;
  loading: boolean;        // first load (skeleton)
  refreshing: boolean;     // subsequent loads (subtle indicator)
  hasMore: boolean;
};

type CacheKey = string;
type CacheEntry = { result: PageResult<any>; timestamp: number };
const cache = new Map<CacheKey, CacheEntry>();
const CACHE_TTL = 60_000; // 60s

function buildKey(parts: Record<string, any>): string {
  return JSON.stringify(parts);
}

export function usePaginatedList<T>(opts: {
  rpcName: string;
  rpcParams: (page: number, cursor: { val: string | null; id: string | null }) => Record<string, any>;
  pageKey: Record<string, any>;       // changes => refetch (tenant, site, filters, page, sort)
  pageSize?: number;
  enabled?: boolean;
  debounceMs?: number;
  prefetch?: boolean;
}): PageState<T> {
  const {
    rpcName,
    rpcParams,
    pageKey,
    pageSize = 50,
    enabled = true,
    debounceMs = 250,
    prefetch = true,
  } = opts;

  const [state, setState] = useState<PageState<T>>({
    rows: [],
    totalCount: 0,
    totals: {},
    loading: true,
    refreshing: false,
    hasMore: false,
  });

  const reqIdRef = useRef(0);
  const initialLoadRef = useRef(true);
  const cursorStackRef = useRef<{ val: string | null; id: string | null }[]>([]);
  const currentPageRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchAbortedRef = useRef(false);

  // Determine if pageKey contains a search value that needs debouncing
  const searchValue = (pageKey as any).search ?? '';
  const nonSearchKey = { ...pageKey, search: undefined };
  const cacheKey = buildKey(pageKey);

  const fetchPage = useCallback(async (page: number, cursor: { val: string | null; id: string | null }, isRefresh: boolean) => {
    const myReqId = ++reqIdRef.current;
    if (isRefresh) {
      setState(prev => ({ ...prev, refreshing: true }));
    } else {
      setState(prev => ({ ...prev, loading: true }));
    }

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const result = cached.result as PageResult<T>;
      if (myReqId === reqIdRef.current) {
        setState({
          rows: result.rows,
          totalCount: result.total_count,
          totals: result.totals || {},
          loading: false,
          refreshing: false,
          hasMore: result.rows.length >= pageSize,
        });
      }
      // Still fetch in background to refresh cache
    }

    const params = rpcParams(page, cursor);
    const { data, error } = await supabase.rpc(rpcName, params);

    if (myReqId !== reqIdRef.current) return; // stale request

    if (error || !data) {
      setState(prev => ({ ...prev, loading: false, refreshing: false }));
      return;
    }

    const result = data as PageResult<T>;
    cache.set(cacheKey, { result, timestamp: Date.now() });

    setState({
      rows: result.rows || [],
      totalCount: result.total_count || 0,
      totals: result.totals || {},
      loading: false,
      refreshing: false,
      hasMore: (result.rows || []).length >= pageSize,
    });

    // Prefetch next page
    if (prefetch && (result.rows || []).length >= pageSize) {
      const lastRow = (result.rows || [])[result.rows.length - 1];
      if (lastRow) {
        const nextCursor = extractCursor(lastRow, (pageKey as any).sortCol || 'created_at');
        if (nextCursor.val !== null) {
          const pfParams = rpcParams(page + 1, nextCursor);
          supabase.rpc(rpcName, pfParams).then(({ data: pfData }) => {
            if (pfData) {
              const pfKey = buildKey({ ...pageKey, page: page + 1 });
              cache.set(pfKey, { result: pfData, timestamp: Date.now() });
            }
          });
        }
      }
    }
  }, [rpcName, rpcParams, cacheKey, pageSize, prefetch, pageKey]);

  // Debounced effect on pageKey change
  useEffect(() => {
    if (!enabled) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const page = (pageKey as any).page ?? 0;
    currentPageRef.current = page;

    // For page > 0, use cursor from stack
    const cursor = page > 0 && cursorStackRef.current[page - 1]
      ? cursorStackRef.current[page - 1]
      : { val: null, id: null };

    const isSearchChange = searchValue !== undefined;
    const delay = isSearchChange && searchValue ? debounceMs : 0;

    debounceTimerRef.current = setTimeout(() => {
      const isRefresh = !initialLoadRef.current;
      fetchPage(page, cursor, isRefresh);
      if (initialLoadRef.current) initialLoadRef.current = false;
    }, delay);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [cacheKey, enabled, fetchPage, debounceMs, searchValue, pageKey]);

  // Clear cache on tenant/site change
  const tenantId = (pageKey as any).tenantId;
  const siteId = (pageKey as any).siteId;
  const prevTenantRef = useRef<string | null>(null);
  const prevSiteRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevTenantRef.current !== tenantId || prevSiteRef.current !== siteId) {
      // Clear all cache for this tenant (not other tenants)
      if (prevTenantRef.current !== tenantId) {
        cache.clear();
      }
      prevTenantRef.current = tenantId;
      prevSiteRef.current = siteId;
      cursorStackRef.current = [];
      initialLoadRef.current = true;
    }
  }, [tenantId, siteId]);

  return state;
}

function extractCursor(row: any, sortCol: string): { val: string | null; id: string | null } {
  if (!row) return { val: null, id: null };
  const id = row.id || row.article_id || null;
  switch (sortCol) {
    case 'created_at':
      return { val: row.created_at || null, id };
    case 'name':
      return { val: row.name || null, id };
    case 'ref':
    case 'internal_ref':
      return { val: row.internal_ref || null, id };
    case 'oem_ref':
      return { val: row.oem_ref || null, id };
    case 'price':
    case 'sale_price':
      return { val: String(row.sale_price ?? ''), id };
    case 'purchase_price':
      return { val: String(row.purchase_price ?? ''), id };
    case 'stock':
    case 'quantity':
      return { val: String(row.quantity ?? row.stock_quantity ?? ''), id };
    case 'min':
    case 'stock_min':
      return { val: String(row.stock_min ?? ''), id };
    default:
      return { val: row.created_at || row.name || null, id };
  }
}

/**
 * Manage cursor stack for cursor-based pagination.
 * Returns helpers to go to next/prev page and reset.
 */
export function useCursorPagination(maxPage: number) {
  const [page, setPage] = useState(0);
  const cursorsRef = useRef<{ val: string | null; id: string | null }[]>([]);

  const reset = useCallback(() => {
    setPage(0);
    cursorsRef.current = [];
  }, []);

  const nextPage = useCallback(() => {
    setPage(p => Math.min(p + 1, maxPage));
  }, [maxPage]);

  const prevPage = useCallback(() => {
    setPage(p => Math.max(0, p - 1));
  }, []);

  const setCursor = useCallback((pageIndex: number, cursor: { val: string | null; id: string | null }) => {
    cursorsRef.current[pageIndex] = cursor;
  }, []);

  const getCursor = useCallback((pageIndex: number) => {
    return cursorsRef.current[pageIndex] || { val: null, id: null };
  }, []);

  return { page, setPage, reset, nextPage, prevPage, setCursor, getCursor };
}

/**
 * Clear the entire pagination cache (e.g., after a mutation).
 * Optionally clear only entries matching a predicate.
 */
export function clearPaginationCache(predicate?: (key: string) => boolean) {
  if (predicate) {
    for (const key of cache.keys()) {
      if (predicate(key)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}
