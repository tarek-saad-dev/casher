import { describe, it, expect } from 'vitest';
import { appendTreasuryCashMoveFilters } from '@/lib/services/treasuryCashMoveFilters';

describe('appendTreasuryCashMoveFilters', () => {
  it('scopes day filter to active-branch business day / shift', () => {
    const where: string[] = ['cm.BranchID = @branchId'];
    const params: Record<string, string | number> = {};

    appendTreasuryCashMoveFilters(where, params, { newDay: '2026-08-15' });

    expect(where.some((c) => c.includes('sm.BranchID = @branchId'))).toBe(true);
    expect(where.some((c) => c.includes('TblNewDay'))).toBe(true);
    expect(params.newDay).toBe('2026-08-15');
  });

  it('rejects matching via other-branch shifts even without newDay', () => {
    const where: string[] = ['cm.BranchID = @branchId'];
    const params: Record<string, string | number> = {};

    appendTreasuryCashMoveFilters(where, params, {});

    expect(where).toContain('(sm.ID IS NULL OR sm.BranchID = @branchId)');
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
