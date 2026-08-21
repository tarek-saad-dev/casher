/**
 * Booking V2 B8 — single-flight / request coalescing.
 * Concurrent identical misses share one rebuild promise.
 */

export type SingleFlightStats = {
  flights: number;
  coalesced: number;
};

export function createSingleFlight<T>() {
  const inflight = new Map<string, Promise<T>>();
  let flights = 0;
  let coalesced = 0;

  return {
    async do(key: string, fn: () => Promise<T>): Promise<{ value: T; coalesced: boolean }> {
      const existing = inflight.get(key);
      if (existing) {
        coalesced++;
        return { value: await existing, coalesced: true };
      }
      flights++;
      const p = Promise.resolve()
        .then(fn)
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, p);
      return { value: await p, coalesced: false };
    },
    stats(): SingleFlightStats {
      return { flights, coalesced };
    },
    resetStats() {
      flights = 0;
      coalesced = 0;
    },
    pendingCount() {
      return inflight.size;
    },
  };
}
