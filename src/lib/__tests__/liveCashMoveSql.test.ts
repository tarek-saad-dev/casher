import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cashMoveHasReversalColumns,
  liveCashMoveAndClause,
  liveCashMovePredicate,
  resetCashMoveReversalColumnsCache,
} from '@/lib/treasury/liveCashMoveSql';

describe('liveCashMoveSql', () => {
  afterEach(() => {
    resetCashMoveReversalColumnsCache();
    vi.restoreAllMocks();
  });

  it('builds aliased reversal predicate', () => {
    expect(liveCashMovePredicate('cm')).toBe(
      'ISNULL(cm.IsReversed, 0) = 0 AND cm.ReversalOfCashMoveId IS NULL',
    );
    expect(liveCashMovePredicate()).toContain('ReversalOfCashMoveId IS NULL');
  });

  it('liveCashMoveAndClause is empty when columns are missing (pre-migration)', async () => {
    const pool = {
      request: () => ({
        query: async () => ({
          recordset: [{ reversalOf: 0, isReversed: 0 }],
        }),
      }),
    } as never;
    expect(await cashMoveHasReversalColumns(pool)).toBe(false);
    expect(await liveCashMoveAndClause(pool)).toBe('');
    expect(await liveCashMoveAndClause(pool, 'cm')).toBe('');
  });

  it('liveCashMoveAndClause includes predicate when columns exist', async () => {
    const pool = {
      request: () => ({
        query: async () => ({
          recordset: [{ reversalOf: 1, isReversed: 1 }],
        }),
      }),
    } as never;
    expect(await liveCashMoveAndClause(pool, 'cm')).toBe(
      ` AND ${liveCashMovePredicate('cm')}`,
    );
  });
});
