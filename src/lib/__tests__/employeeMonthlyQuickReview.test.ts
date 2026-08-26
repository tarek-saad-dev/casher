import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveQuickReviewWorkDate } from '@/lib/reports/employeeMonthlyQuickReview';

describe('resolveQuickReviewWorkDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses Cairo today when viewing the current month', () => {
    vi.setSystemTime(new Date('2026-08-26T10:00:00+03:00'));
    expect(resolveQuickReviewWorkDate(2026, 8)).toBe('2026-08-26');
  });

  it('uses last day of month for a past month', () => {
    vi.setSystemTime(new Date('2026-08-26T10:00:00+03:00'));
    expect(resolveQuickReviewWorkDate(2026, 7)).toBe('2026-07-31');
  });

  it('uses first day of a future month', () => {
    vi.setSystemTime(new Date('2026-08-26T10:00:00+03:00'));
    expect(resolveQuickReviewWorkDate(2026, 9)).toBe('2026-09-01');
  });
});
