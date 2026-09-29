import { afterEach, describe, expect, it } from 'vitest';
import { buildReversalPosting, signedPaymentEffect } from '../internal/reversalPosting';
import {
  liveCashMovePredicate,
  resetCashMoveReversalColumnsCache,
  setCashMoveReversalColumnsCacheForTests,
} from '@/lib/treasury/liveCashMoveSql';

describe('treasury reversal posting', () => {
  afterEach(() => {
    resetCashMoveReversalColumnsCache();
  });

  it('nets an income on the same invType and inOut', () => {
    const posting = buildReversalPosting({ inOut: 'in', invType: 'ايرادات', amount: 100 });
    expect(posting.direction).toBe('in');
    expect(posting.legacyInvType).toBe('ايرادات');
    expect(posting.storedAmount).toBe(-100);
    expect(100 + posting.storedAmount).toBe(0);
    expect(
      signedPaymentEffect(100, 'in') + signedPaymentEffect(posting.storedAmount, posting.direction),
    ).toBe(0);
  });

  it('nets an expense that reports filter as مصروفات and inOut out', () => {
    const posting = buildReversalPosting({ inOut: 'out', invType: 'مصروفات', amount: 40.5 });
    expect(posting.direction).toBe('out');
    expect(posting.legacyInvType).toBe('مصروفات');
    expect(posting.storedAmount).toBe(-40.5);
    expect(40.5 + posting.storedAmount).toBe(0);
    expect(
      signedPaymentEffect(40.5, 'out') + signedPaymentEffect(posting.storedAmount, posting.direction),
    ).toBe(0);
  });

  it('hides reversed originals and reversal rows from live reads when schema ready', () => {
    setCashMoveReversalColumnsCacheForTests(true);
    const sqlText = liveCashMovePredicate('cm');
    expect(sqlText).toContain('cm.IsReversed');
    expect(sqlText).toContain('cm.ReversalOfCashMoveId IS NULL');
  });

  it('keeps live reads safe when reversal columns are absent', () => {
    expect(liveCashMovePredicate('cm')).toBe('1=1');
  });
});
