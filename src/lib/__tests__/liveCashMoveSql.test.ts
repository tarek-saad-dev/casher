import { afterEach, describe, expect, it } from 'vitest';
import {
  cashMoveHasReversalColumns,
  liveCashMoveAndClause,
  liveCashMovePredicate,
  resetCashMoveReversalColumnsCache,
  setCashMoveReversalColumnsCacheForTests,
} from '@/lib/treasury/liveCashMoveSql';

describe('liveCashMoveSql', () => {
  afterEach(() => {
    resetCashMoveReversalColumnsCache();
  });

  it('defaults to safe 1=1 until columns are proven present', () => {
    expect(liveCashMovePredicate('cm')).toBe('1=1');
    expect(liveCashMovePredicate()).toBe('1=1');
  });

  it('emits reversal filter only after cache confirms columns exist', () => {
    setCashMoveReversalColumnsCacheForTests(true);
    expect(liveCashMovePredicate('cm')).toBe(
      'ISNULL(cm.IsReversed, 0) = 0 AND cm.ReversalOfCashMoveId IS NULL',
    );
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
    expect(liveCashMovePredicate('cm')).toBe('1=1');
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
      ' AND ISNULL(cm.IsReversed, 0) = 0 AND cm.ReversalOfCashMoveId IS NULL',
    );
    expect(liveCashMovePredicate('cm')).toContain('ReversalOfCashMoveId');
  });
});
