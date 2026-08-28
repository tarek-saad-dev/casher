import { describe, expect, it } from 'vitest';
import {
  buildFlowBoardCacheKey,
  getFlowBoardCacheEntry,
  setFlowBoardCacheEntry,
} from '@/lib/operations/flowBoardDayCache';

describe('flowBoardDayCache', () => {
  it('builds stable keys per scope and date', () => {
    expect(buildFlowBoardCacheKey('2026-08-28', 'all', 'present')).toBe('all:present:2026-08-28');
    expect(buildFlowBoardCacheKey('2026-08-28', 3, 'all')).toBe('b3:all:2026-08-28');
  });

  it('LRU evicts oldest when over capacity', () => {
    const cache = new Map();
    for (let i = 1; i <= 22; i++) {
      const day = String(i).padStart(2, '0');
      setFlowBoardCacheEntry(cache, `all:present:2026-08-${day}`, {
        ok: true,
        date: `2026-08-${day}`,
        barbers: [],
      });
    }
    expect(cache.size).toBe(21);
    expect(cache.has('all:present:2026-08-01')).toBe(false);
    expect(cache.has('all:present:2026-08-22')).toBe(true);
  });

  it('get touches entry for LRU', () => {
    const cache = new Map<string, { ok: boolean; date: string; barbers: unknown[] }>();
    setFlowBoardCacheEntry(cache, 'all:present:2026-08-01', { ok: true, date: '2026-08-01', barbers: [] });
    setFlowBoardCacheEntry(cache, 'all:present:2026-08-02', { ok: true, date: '2026-08-02', barbers: [] });
    getFlowBoardCacheEntry(cache, 'all:present:2026-08-01');
    for (let i = 3; i <= 22; i++) {
      const day = String(i).padStart(2, '0');
      setFlowBoardCacheEntry(cache, `all:present:2026-08-${day}`, {
        ok: true,
        date: `2026-08-${day}`,
        barbers: [],
      });
    }
    expect(cache.has('all:present:2026-08-01')).toBe(true);
    expect(cache.has('all:present:2026-08-02')).toBe(false);
  });
});
