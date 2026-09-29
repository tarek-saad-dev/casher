import { describe, expect, it } from 'vitest';
import { resolveMonthRegenDateRange } from '@/lib/hr/dailyPayrollMonthRegen.service';

describe('resolveMonthRegenDateRange', () => {
  it('defaults to month start → today', () => {
    const r = resolveMonthRegenDateRange({ todayCairo: '2026-09-17' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fromDate).toBe('2026-09-01');
    expect(r.toDate).toBe('2026-09-17');
    expect(r.dates[0]).toBe('2026-09-01');
    expect(r.dates.at(-1)).toBe('2026-09-17');
    expect(r.dates).toHaveLength(17);
  });

  it('rejects future toDate', () => {
    const r = resolveMonthRegenDateRange({
      fromDate: '2026-09-01',
      toDate: '2026-09-20',
      todayCairo: '2026-09-17',
    });
    expect(r.ok).toBe(false);
  });
});
