import type { Transaction } from 'mssql';

/** Minimal sale CashMove post input — wired from lib composition when DRVO-009 is active. */
export type PostSaleCashMoveInput = {
  saleInvId: number;
  invType: 'مبيعات';
  invDate: string | Date;
  invTime: string;
  clientId: number | null;
  amount: number;
  shiftMoveId: number;
  paymentMethodId: number;
  branchId: number;
  businessDayId: number;
  notes: string;
};

export type SaleCashMovePoster = (
  tx: Transaction,
  input: PostSaleCashMoveInput,
) => Promise<number>;
