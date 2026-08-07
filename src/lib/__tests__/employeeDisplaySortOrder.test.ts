import { describe, expect, it } from 'vitest';
import {
  coerceDisplaySortOrder,
  DEFAULT_EMP_DISPLAY_SORT_ORDER,
  normalizeDisplaySortOrder,
} from '@/lib/migrations/ensureEmployeeDisplaySortOrder';

describe('employee DisplaySortOrder helpers', () => {
  it('normalizes valid integers', () => {
    expect(normalizeDisplaySortOrder(10)).toEqual({ ok: true, value: 10 });
    expect(normalizeDisplaySortOrder('0')).toEqual({ ok: true, value: 0 });
    expect(normalizeDisplaySortOrder(null)).toEqual({
      ok: true,
      value: DEFAULT_EMP_DISPLAY_SORT_ORDER,
    });
  });

  it('rejects invalid values', () => {
    expect(normalizeDisplaySortOrder(1.5).ok).toBe(false);
    expect(normalizeDisplaySortOrder(-1).ok).toBe(false);
    expect(normalizeDisplaySortOrder('abc').ok).toBe(false);
  });

  it('coerces unknown to default', () => {
    expect(coerceDisplaySortOrder(undefined)).toBe(999);
    expect(coerceDisplaySortOrder('42')).toBe(42);
  });
});
