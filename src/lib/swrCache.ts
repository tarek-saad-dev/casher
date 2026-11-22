/**
 * Tiny stale-while-revalidate cache for read-only lookup GETs (client only).
 *
 * Returning to a screen shows the last known data instantly, then refreshes it
 * in the background — the "SPA feel" without a data library. In-flight
 * requests for the same key are shared, so two components asking for the same
 * lookup cause one request.
 *
 * Use ONLY for lookups whose brief staleness is harmless (staff lists, payment
 * methods, categories). Never for prices used to build a sale, balances or
 * anything financial: those must be fetched fresh.
 *
 * Keys must include every scope that changes the answer (tenant/branch).
 */

type Entry = { data: unknown; at: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 200;

function remember(key: string, data: unknown) {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { data, at: Date.now() });
}

function same(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function load<T>(key: string, url: string, init?: RequestInit): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fetch(url, init)
    .then(async (res) => {
      if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
      return (await res.json()) as T;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Deliver cached data (if any) synchronously through `onData`, then fetch fresh
 * data and deliver it again when it differs. Returns a cancel function so a
 * component can ignore late results after unmount / scope change.
 */
export function swrGetJson<T>(
  key: string,
  url: string,
  onData: (data: T, meta: { fromCache: boolean }) => void,
  opts: { onError?: (err: unknown) => void; init?: RequestInit } = {},
): () => void {
  let cancelled = false;
  const cached = store.get(key);
  if (cached) onData(cached.data as T, { fromCache: true });

  load<T>(key, url, opts.init)
    .then((fresh) => {
      if (cancelled) return;
      const previous = store.get(key);
      remember(key, fresh);
      if (!previous || !same(previous.data, fresh)) onData(fresh, { fromCache: false });
    })
    .catch((err) => {
      if (!cancelled) opts.onError?.(err);
    });

  return () => {
    cancelled = true;
  };
}

/** Peek without fetching (e.g. to decide whether to show a loading state). */
export function hasCached(key: string): boolean {
  return store.has(key);
}

/** Drop cached entries whose key starts with `prefix` (call after mutations). */
export function invalidateCache(prefix = ''): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
