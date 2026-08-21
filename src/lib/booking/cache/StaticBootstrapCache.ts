/**
 * Booking V2 B8 — static bootstrap cache (separate from live availability).
 * Branches / employees / services / settings / mappings / media.
 * Prepared for future CDN/HTTP caching — NOT mixed with hot availability.
 */

import { BoundedLruCache } from '@/lib/booking/cache/BoundedLruCache';

export type StaticBootstrapKind =
  | 'branches'
  | 'employees'
  | 'services'
  | 'booking_settings'
  | 'employee_branch_mapping'
  | 'media_refs';

export type StaticBootstrapEntry<T = unknown> = {
  kind: StaticBootstrapKind;
  scopeKey: string; // e.g. branchCode / 'global'
  revision: string;
  payload: T;
  builtAtMs: number;
};

function keyOf(kind: StaticBootstrapKind, scopeKey: string): string {
  return `static:${kind}:${scopeKey}`;
}

export type StaticBootstrapCache = {
  get<T>(kind: StaticBootstrapKind, scopeKey: string): StaticBootstrapEntry<T> | null;
  set<T>(entry: StaticBootstrapEntry<T>): void;
  invalidate(kind: StaticBootstrapKind, scopeKey?: string): void;
  clear(): void;
  size(): number;
};

export function createStaticBootstrapCache(opts?: {
  maxEntries?: number;
}): StaticBootstrapCache {
  const lru = new BoundedLruCache<StaticBootstrapEntry>({
    maxEntries: opts?.maxEntries ?? 256,
    sizeOf: () => 1,
  });

  return {
    get<T>(kind: StaticBootstrapKind, scopeKey: string) {
      const v = lru.get(keyOf(kind, scopeKey));
      return (v as StaticBootstrapEntry<T>) ?? null;
    },
    set<T>(entry: StaticBootstrapEntry<T>) {
      lru.set(keyOf(entry.kind, entry.scopeKey), entry as StaticBootstrapEntry);
    },
    invalidate(kind: StaticBootstrapKind, scopeKey?: string) {
      if (scopeKey != null) {
        lru.delete(keyOf(kind, scopeKey));
        return;
      }
      for (const k of lru.keys()) {
        if (k.startsWith(`static:${kind}:`)) lru.delete(k);
      }
    },
    clear() {
      lru.clear();
    },
    size() {
      return lru.stats().size;
    },
  };
}

let singleton: StaticBootstrapCache | null = null;

export function getStaticBootstrapCache(): StaticBootstrapCache {
  if (!singleton) singleton = createStaticBootstrapCache();
  return singleton;
}

export function __resetStaticBootstrapCacheForTests(): void {
  singleton = null;
}
