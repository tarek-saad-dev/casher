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
  /** Nullable when the invoice head has no business day. */
  businessDayId: number | null;
  notes: string;
};

export type SaleTreasuryOwnershipProbe = (
  tx: Transaction,
  input: { saleInvId: number; invType: 'مبيعات' },
) => Promise<boolean>;

export type SaleCashMoveReplacer = (
  tx: Transaction,
  input: ReplaceSaleCashMoveInput,
) => Promise<number | null>;

export type SaleCashMoveRemover = (
  tx: Transaction,
  input: { saleInvId: number; invType: 'مبيعات' },
) => Promise<{ treasuryOwned: boolean }>;
