/**
 * Booking V2 B8 — L2 shared cache adapter interface (Redis-compatible later).
 * Not required in this phase — L1 process memory is the default.
 */

import type { HotAvailabilityDayRecord } from '@/lib/booking/cache/HotAvailabilityTypes';

export type HotAvailabilityL2Store = {
  get(key: string): Promise<HotAvailabilityDayRecord | null>;
  set(key: string, value: HotAvailabilityDayRecord, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteMany?(keys: string[]): Promise<void>;
};

/** No-op L2 — always miss. Ready for Redis adapter swap. */
export function createNullHotAvailabilityL2Store(): HotAvailabilityL2Store {
  return {
    async get() {
      return null;
    },
    async set() {
      /* no-op */
    },
    async delete() {
      /* no-op */
    },
    async deleteMany() {
      /* no-op */
    },
  };
}

/**
 * In-memory L2 for multi-instance simulation / tests (shared Map).
 * Not process-bounded — use only in tests.
 */
export function createMemoryHotAvailabilityL2Store(shared?: {
  map: Map<string, HotAvailabilityDayRecord>;
}): HotAvailabilityL2Store {
  const map = shared?.map ?? new Map<string, HotAvailabilityDayRecord>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async deleteMany(keys) {
      for (const k of keys) map.delete(k);
    },
  };
}
