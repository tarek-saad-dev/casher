import type { MoneyDirection } from '../public/moneyMovement';
import type { LegacyInvType } from './movementMapping';

export type ReversalPosting = {
  direction: MoneyDirection;
  invType: 'income' | 'expense';
  legacyInvType: LegacyInvType;
  storedAmount: number;
};

/**
 * Keep the original invType and inOut, and store the negated amount.
 *
 * Income lists and full-day / MTD totals sum GrandTolal for ايرادات with no
 * inOut filter. Expense lists and reports keep مصروفات + inOut = out.
 * Payment-method balances sign by inOut. A same-direction negative row nets
 * all three. Live-read predicates hide both rows so the delete UX still
 * looks like removal.
 */
export function buildReversalPosting(original: {
  inOut: string;
  invType: string;
  amount: number;
}): ReversalPosting {
  const amount = Math.abs(Number(original.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Treasury reversal requires a positive original amount');
  }
  const direction: MoneyDirection = original.inOut === 'out' ? 'out' : 'in';
  const expense = original.invType === 'مصروفات';
  return {
    direction,
    invType: expense ? 'expense' : 'income',
    legacyInvType: expense ? 'مصروفات' : 'ايرادات',
    storedAmount: -amount,
  };
}

export function signedPaymentEffect(amount: number, direction: MoneyDirection): number {
  return direction === 'in' ? amount : -amount;
}
