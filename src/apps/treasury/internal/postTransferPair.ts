import 'server-only';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { PostCommand } from '../public/moneyMovement';
import { postMoneyMovement } from './postMovement';
import { findRegistryRowsByTransferGroup } from './idempotencyStore';

export type TransferPairInput = {
  tenantId: string;
  locationId: number;
  businessDayId: number;
  businessDate?: string | null;
  shiftInstanceId: number | null;
  amount: number;
  sourceRef: string;
  transferGroupKey: string;
  fromPaymentMethodId: number;
  toPaymentMethodId: number;
  expenseCategoryId: number;
  incomeCategoryId: number;
  expenseNotes: string;
  incomeNotes: string;
  invTime?: string | null;
};

export type TransferPairResult = {
  expenseCashMoveId: number;
  incomeCashMoveId: number;
  idempotentReplay: boolean;
};

export async function postTransferPair(
  tx: Transaction,
  actor: ActorContext,
  input: TransferPairInput,
): Promise<TransferPairResult> {
  const existing = await findRegistryRowsByTransferGroup(
    tx,
    input.tenantId,
    input.transferGroupKey,
  );
  if (existing.length >= 2) {
    const outRow = existing.find((r) => r.Kind === 'transfer_out');
    const inRow = existing.find((r) => r.Kind === 'transfer_in');
    if (outRow && inRow) {
      return {
        expenseCashMoveId: outRow.CashMoveId,
        incomeCashMoveId: inRow.CashMoveId,
        idempotentReplay: true,
      };
    }
  }

  const base: Omit<PostCommand, 'direction' | 'reason' | 'idempotencyKey' | 'paymentMethodId' | 'categoryId' | 'notes' | 'invType'> = {
    tenantId: input.tenantId,
    locationId: input.locationId,
    businessDayId: input.businessDayId,
    businessDate: input.businessDate,
    shiftInstanceId: input.shiftInstanceId,
    amount: input.amount,
    sourceRef: input.sourceRef,
    transferGroupKey: input.transferGroupKey,
    invTime: input.invTime,
  };

  const expenseCashMoveId = await postMoneyMovement(tx, actor, {
    ...base,
    direction: 'out',
    reason: 'transfer_out',
    invType: 'expense',
    paymentMethodId: input.fromPaymentMethodId,
    categoryId: input.expenseCategoryId,
    notes: input.expenseNotes,
    idempotencyKey: `${input.transferGroupKey}:out`,
  });

  try {
    const incomeCashMoveId = await postMoneyMovement(tx, actor, {
      ...base,
      direction: 'in',
      reason: 'transfer_in',
      invType: 'income',
      paymentMethodId: input.toPaymentMethodId,
      categoryId: input.incomeCategoryId,
      notes: input.incomeNotes,
      idempotencyKey: `${input.transferGroupKey}:in`,
    });

    return { expenseCashMoveId, incomeCashMoveId, idempotentReplay: false };
  } catch (err) {
    throw err;
  }
}
