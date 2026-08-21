/**
 * Bootstrap client — ETag + in-memory cache + stale-while-revalidate.
 * Prefetch on /operations entry; modal must not block on a cold wait if cached.
 */

import type { V2PublicBootstrapResponse } from '@/lib/booking/v2Frontend/publicSafeDtos';

const BOOTSTRAP_URL = '/api/public/booking/v2/bootstrap';

/** Client soft freshness — server Cache-Control is max-age=30, SWR=120. */
const FRESH_MS = 30_000;
const STALE_MS = 120_000;

type BootstrapCache = {
  body: V2PublicBootstrapResponse;
  etag: string | null;
  fetchedAt: number;
};

let memory: BootstrapCache | null = null;
let inflight: Promise<BootstrapCache> | null = null;

export function getCachedBootstrap(): BootstrapCache | null {
  return memory;
}

export function clearBootstrapClientCache(): void {
  memory = null;
  inflight = null;
}

function ageMs(cache: BootstrapCache, now = Date.now()): number {
  return now - cache.fetchedAt;
}

export function isBootstrapFresh(now = Date.now()): boolean {
  return !!memory && ageMs(memory, now) < FRESH_MS;
}

export function isBootstrapUsable(now = Date.now()): boolean {
  return !!memory && ageMs(memory, now) < STALE_MS;
}

async function fetchBootstrapNetwork(opts?: {
  etag?: string | null;
  signal?: AbortSignal;
}): Promise<BootstrapCache | 'not-modified'> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts?.etag) headers['If-None-Match'] = opts.etag;

  const res = await fetch(BOOTSTRAP_URL, {
    method: 'GET',
    headers,
    signal: opts?.signal,
    // Prefer our SWR; still allow browser HTTP cache to help.
    cache: 'no-cache',
  });

  if (res.status === 304 && memory) {
    memory = { ...memory, fetchedAt: Date.now() };
    return 'not-modified';
  }

  if (!res.ok) {
    throw new Error(`bootstrap ${res.status}`);
  }

  const body = (await res.json()) as V2PublicBootstrapResponse;
  if (!body?.ok) {
    throw new Error('bootstrap invalid');
  }

  const etag = res.headers.get('ETag') || res.headers.get('etag');
  const next: BootstrapCache = {
    body,
    etag,
    fetchedAt: Date.now(),
  };
  memory = next;
  return next;
}

/**
 * Returns cached bootstrap immediately when present; revalidates in background
 * when stale. Awaiting this never blocks on network if a usable cache exists.
 */
export async function loadBootstrapSWR(opts?: {
  signal?: AbortSignal;
  force?: boolean;
}): Promise<{
  body: V2PublicBootstrapResponse;
  etag: string | null;
  fromCache: boolean;
  revalidating: boolean;
}> {
  const now = Date.now();
  const force = opts?.force === true;

  if (!force && memory && isBootstrapFresh(now)) {
    return {
      body: memory.body,
      etag: memory.etag,
      fromCache: true,
      revalidating: false,
    };
  }

  if (!force && memory && isBootstrapUsable(now)) {
    // Stale-while-revalidate: serve stale, refresh in background.
    void revalidateBootstrap({ signal: opts?.signal });
    return {
      body: memory.body,
      etag: memory.etag,
      fromCache: true,
      revalidating: true,
    };
  }

  // Cold or expired beyond SWR window — must await network (or share inflight).
  const cache = await revalidateBootstrap({ signal: opts?.signal, force });
  return {
    body: cache.body,
    etag: cache.etag,
    fromCache: false,
    revalidating: false,
  };
}

export async function revalidateBootstrap(opts?: {
  signal?: AbortSignal;
  force?: boolean;
}): Promise<BootstrapCache> {
  if (inflight && !opts?.force) return inflight;

  const run = (async () => {
    const result = await fetchBootstrapNetwork({
      etag: memory?.etag ?? null,
      signal: opts?.signal,
    });
    if (result === 'not-modified') {
      if (!memory) throw new Error('bootstrap 304 without cache');
      return memory;
    }
    return result;
  })();

  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}
