/**
 * Client-side LRU cache for operations flow-board payloads (per scope + date).
 * Makes day-to-day navigation instant when revisiting recent days.
 */

export type FlowBoardCacheEntry = {
  ok: boolean;
  date: string;
  generatedAt?: string;
  barbers: unknown[];
};

const MAX_ENTRIES = 21;

export function buildFlowBoardCacheKey(
  date: string,
  branchScope: string | number,
  presence: string,
): string {
  const scopeKey =
    branchScope === 'all' || branchScope === 'active' ? String(branchScope) : `b${branchScope}`;
  return `${scopeKey}:${presence}:${date}`;
}

export function getFlowBoardCacheEntry(
  cache: Map<string, FlowBoardCacheEntry>,
  key: string,
): FlowBoardCacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  // Touch for LRU
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setFlowBoardCacheEntry(
  cache: Map<string, FlowBoardCacheEntry>,
  key: string,
  entry: FlowBoardCacheEntry,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
