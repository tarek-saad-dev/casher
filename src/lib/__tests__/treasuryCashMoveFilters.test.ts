import { afterEach, describe, expect, it } from 'vitest';
import { appendTreasuryCashMoveFilters } from '@/lib/services/treasuryCashMoveFilters';
import {
  resetCashMoveReversalColumnsCache,
  setCashMoveReversalColumnsCacheForTests,
} from '@/lib/treasury/liveCashMoveSql';

describe('appendTreasuryCashMoveFilters', () => {
  afterEach(() => {
    resetCashMoveReversalColumnsCache();
  });

  it('scopes day filter to active-branch business day / shift', () => {
    const where: string[] = ['cm.BranchID = @branchId'];
    const params: Record<string, string | number> = {};

    appendTreasuryCashMoveFilters(where, params, { newDay: '2026-08-15' });

    expect(where.some((c) => c.includes('sm.BranchID = @branchId'))).toBe(true);
    expect(where.some((c) => c.includes('TblNewDay'))).toBe(true);
    expect(params.newDay).toBe('2026-08-15');
  });

  it('rejects matching via other-branch shifts even without newDay', () => {
    setCashMoveReversalColumnsCacheForTests(true);
    const where: string[] = ['cm.BranchID = @branchId'];
    const params: Record<string, string | number> = {};

    appendTreasuryCashMoveFilters(where, params, {});

    expect(where).toContain('(sm.ID IS NULL OR sm.BranchID = @branchId)');
    expect(
      where.some(
        (clause) => clause.includes('IsReversed') && clause.includes('ReversalOfCashMoveId'),
      ),
    ).toBe(true);
  });

  it('uses safe live predicate before reversal columns exist', () => {
    const where: string[] = ['cm.BranchID = @branchId'];
    const params: Record<string, string | number> = {};
    appendTreasuryCashMoveFilters(where, params, {});
    expect(where).toContain('1=1');
    expect(where.join(' ')).not.toContain('ReversalOfCashMoveId');
  });

  it('allows unscoped legacy mode when branchScoped is false', () => {
    const where: string[] = ['1=1'];
    const params: Record<string, string | number> = {};

    appendTreasuryCashMoveFilters(
      where,
      params,
      { newDay: '2026-08-15' },
      { branchScoped: false },
    );

    expect(where).toContain('sm.NewDay = @newDay');
    expect(where.join(' ')).not.toContain('sm.BranchID');
  });
});
