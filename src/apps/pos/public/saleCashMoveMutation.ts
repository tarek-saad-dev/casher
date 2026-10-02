import type { Transaction } from 'mssql';

/** Input for Treasury-owned sale CashMove replace on invoice edit. */
export type ReplaceSaleCashMoveInput = {
  saleInvId: number;
  invType: 'مبيعات';
  invDate: string | Date;
  invTime: string;
  clientId: number | null;
  amount: number;
  shiftMoveId: number | null;
  paymentMethodId: number;
  branchId: number;
  businessDayId: number;
  notes: string;
};

export type SaleCashMoveReplacer = (
  tx: Transaction,
  input: ReplaceSaleCashMoveInput,
) => Promise<number | null>;

export type SaleCashMoveRemover = (
  tx: Transaction,
  input: { saleInvId: number; invType: 'مبيعات' },
) => Promise<{ treasuryOwned: boolean }>;
