/**
 * Booking V2 B8 — hot cache observability (hit/miss/stale/rebuild/coalesce/evict).
 */

export type HotCacheEvent =
  | 'hit'
  | 'miss'
  | 'stale'
  | 'rebuild'
  | 'coalesced'
  | 'eviction'
  | 'revision_mismatch'
  | 'l2_hit'
  | 'l2_miss';

type LatencyBucket = {
  samples: number[];
};

const MAX_SAMPLES = 2_000;

export type HotCacheMetricsSnapshot = {
  hits: number;
  misses: number;
  staleServes: number;
  rebuilds: number;
  coalesced: number;
  evictions: number;
  revisionMismatches: number;
  l2Hits: number;
  l2Misses: number;
  hitRatio: number;
  warmP50Ms: number | null;
  warmP95Ms: number | null;
  coldP50Ms: number | null;
  coldP95Ms: number | null;
  rebuildP50Ms: number | null;
  rebuildP95Ms: number | null;
  approxBytes: number;
  entries: number;
};

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function pushSample(bucket: LatencyBucket, ms: number): void {
  if (!Number.isFinite(ms)) return;
  bucket.samples.push(ms);
  if (bucket.samples.length > MAX_SAMPLES) {
    bucket.samples.splice(0, bucket.samples.length - MAX_SAMPLES);
  }
}

export function createHotCacheMetrics() {
  let hits = 0;
  let misses = 0;
  let staleServes = 0;
  let rebuilds = 0;
  let coalesced = 0;
  let evictions = 0;
  let revisionMismatches = 0;
  let l2Hits = 0;
  let l2Misses = 0;
  const warm = { samples: [] as number[] };
  const cold = { samples: [] as number[] };
  const rebuild = { samples: [] as number[] };

  return {
    record(event: HotCacheEvent, latencyMs?: number): void {
      switch (event) {
        case 'hit':
          hits++;
          if (latencyMs != null) pushSample(warm, latencyMs);
          break;
        case 'miss':
          misses++;
          break;
        case 'stale':
          staleServes++;
          if (latencyMs != null) pushSample(warm, latencyMs);
          break;
        case 'rebuild':
          rebuilds++;
          if (latencyMs != null) {
            pushSample(rebuild, latencyMs);
            pushSample(cold, latencyMs);
          }
          break;
        case 'coalesced':
          coalesced++;
          break;
        case 'eviction':
          evictions++;
          break;
        case 'revision_mismatch':
          revisionMismatches++;
          break;
        case 'l2_hit':
          l2Hits++;
          break;
        case 'l2_miss':
          l2Misses++;
          break;
      }
    },
    snapshot(args?: { approxBytes?: number; entries?: number }): HotCacheMetricsSnapshot {
      const warmSorted = [...warm.samples].sort((a, b) => a - b);
      const coldSorted = [...cold.samples].sort((a, b) => a - b);
      const rebuildSorted = [...rebuild.samples].sort((a, b) => a - b);
      const denom = hits + misses;
      return {
        hits,
        misses,
        staleServes,
        rebuilds,
        coalesced,
        evictions,
        revisionMismatches,
        l2Hits,
        l2Misses,
        hitRatio: denom === 0 ? 0 : hits / denom,
        warmP50Ms: percentile(warmSorted, 50),
        warmP95Ms: percentile(warmSorted, 95),
        coldP50Ms: percentile(coldSorted, 50),
        coldP95Ms: percentile(coldSorted, 95),
        rebuildP50Ms: percentile(rebuildSorted, 50),
        rebuildP95Ms: percentile(rebuildSorted, 95),
        approxBytes: args?.approxBytes ?? 0,
        entries: args?.entries ?? 0,
      };
    },
    reset(): void {
      hits = misses = staleServes = rebuilds = coalesced = evictions = 0;
      revisionMismatches = l2Hits = l2Misses = 0;
      warm.samples.length = 0;
      cold.samples.length = 0;
      rebuild.samples.length = 0;
    },
  };
}

export type HotCacheMetrics = ReturnType<typeof createHotCacheMetrics>;

export function logHotCacheMetric(payload: Record<string, unknown>): void {
  console.info('[booking-hot-cache]', JSON.stringify({ ...payload, at: new Date().toISOString() }));
}
