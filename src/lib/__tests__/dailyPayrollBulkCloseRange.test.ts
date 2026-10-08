import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetBulkCloseRangeLockForTests,
  bulkCloseRangeLockKey,
  listDatesInclusive,
  releaseBulkCloseRangeLock,
  summarizeBulkCloseBranchOutcomes,
  tryAcquireBulkCloseRangeLock,
  validateBulkCloseRangeParams,
} from '@/lib/hr/dailyPayrollBulkCloseRange.validation';

describe('dailyPayrollBulkCloseRange.validation', () => {
  afterEach(() => {
    __resetBulkCloseRangeLockForTests();
  });

  it('lists inclusive dates in order', () => {
    expect(listDatesInclusive('2026-03-01', '2026-03-03')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('rejects fromDate > toDate', () => {
    const r = validateBulkCloseRangeParams({
      fromDate: '2026-03-10',
      toDate: '2026-03-01',
      todayCairo: '2026-03-15',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fromDate/);
  });

  it('rejects ranges longer than 31 days', () => {
    const r = validateBulkCloseRangeParams({
      fromDate: '2026-01-01',
      toDate: '2026-02-05',
      todayCairo: '2026-09-01',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/31/);
  });

  it('allows exactly 31 days ending on today', () => {
    const r = validateBulkCloseRangeParams({
      fromDate: '2026-02-01',
      toDate: '2026-03-03',
      todayCairo: '2026-03-03',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dates).toHaveLength(31);
  });

  it('rejects future toDate', () => {
    const r = validateBulkCloseRangeParams({
      fromDate: '2026-03-01',
      toDate: '2026-03-10',
      todayCairo: '2026-03-05',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/مستقبلي/);
  });

  it('rejects invalid ymd', () => {
    const r = validateBulkCloseRangeParams({
      fromDate: '03-01-2026',
      toDate: '2026-03-02',
      todayCairo: '2026-03-15',
    });
    expect(r.ok).toBe(false);
  });

  it('process lock prevents concurrent bulk-close of any range within one tenant', () => {
    const keyA = bulkCloseRangeLockKey('TENANT-A', '2026-03-01', '2026-03-05');
    const keyB = bulkCloseRangeLockKey('tenant-a', '2026-04-01', '2026-04-02');
    expect(tryAcquireBulkCloseRangeLock(keyA)).toBe(true);
    expect(tryAcquireBulkCloseRangeLock(keyB)).toBe(false);
    releaseBulkCloseRangeLock(keyA);
    expect(tryAcquireBulkCloseRangeLock(keyB)).toBe(true);
    releaseBulkCloseRangeLock(keyB);
  });

  it('DRVO-013: tenants never block each other and a lock requires a tenant', () => {
    const keyA = bulkCloseRangeLockKey('tenant-a', '2026-03-01', '2026-03-05');
    const keyB = bulkCloseRangeLockKey('tenant-b', '2026-03-01', '2026-03-05');
    expect(keyA.key).not.toBe(keyB.key);
    expect(tryAcquireBulkCloseRangeLock(keyA)).toBe(true);
    expect(tryAcquireBulkCloseRangeLock(keyB)).toBe(true);
    releaseBulkCloseRangeLock(keyB);
    expect(tryAcquireBulkCloseRangeLock(bulkCloseRangeLockKey('tenant-a', '2026-05-01', '2026-05-01'))).toBe(false);
    releaseBulkCloseRangeLock(keyA);
    expect(() => bulkCloseRangeLockKey('', '2026-03-01', '2026-03-05')).toThrow();
  });

  it('summarizes branch outcomes for final report', () => {
    expect(
      summarizeBulkCloseBranchOutcomes([
        { outcome: 'closed' },
        { outcome: 'alreadyClosed' },
        { outcome: 'notReady' },
        { outcome: 'failed' },
        { outcome: 'closed' },
      ]),
    ).toEqual({
      branchesProcessed: 5,
      closed: 2,
      alreadyClosed: 1,
      notReady: 1,
      failed: 1,
    });
  });
});
