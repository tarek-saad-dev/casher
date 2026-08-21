/**
 * Booking V2 B8 — bounded LRU map (process L1). Never unbounded on serverless.
 */

export type BoundedLruOptions = {
  maxEntries: number;
  /** Soft memory budget in bytes; eviction when exceeded (best-effort). */
  maxBytes?: number;
  sizeOf?: (value: unknown) => number;
};

export type BoundedLruStats = {
  size: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
};

export class BoundedLruCache<V> {
  private readonly map = new Map<string, V>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (value: V) => number;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(opts: BoundedLruOptions) {
    this.maxEntries = Math.max(1, Math.floor(opts.maxEntries));
    this.maxBytes = opts.maxBytes ?? Number.POSITIVE_INFINITY;
    this.sizeOf = (opts.sizeOf as (v: V) => number) ?? (() => 1);
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, v);
    this.hits++;
    return v;
  }

  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): void {
    const nextSize = this.sizeOf(value);
    if (this.map.has(key)) {
      const prev = this.map.get(key)!;
      this.bytes -= this.sizeOf(prev);
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += nextSize;
    this.evictIfNeeded();
  }

  delete(key: string): boolean {
    const prev = this.map.get(key);
    if (prev === undefined) return false;
    this.bytes -= this.sizeOf(prev);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  stats(): BoundedLruStats {
    return {
      size: this.map.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private evictIfNeeded(): void {
    while (
      this.map.size > this.maxEntries ||
      (Number.isFinite(this.maxBytes) && this.bytes > this.maxBytes)
    ) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest == null) break;
      const prev = this.map.get(oldest)!;
      this.bytes -= this.sizeOf(prev);
      this.map.delete(oldest);
      this.evictions++;
    }
  }
}
