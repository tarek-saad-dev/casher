import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type { TreasuryWritePorts } from '@/lib/treasuryComposition';
import { findRegistryByKey } from '../internal/idempotencyStore';

export type CreateIncomeInput = {
  locationId: number;
  amount: number;
  categoryId: number;
  paymentMethodId: number;
  notes?: string | null;
  invTime?: string | null;
  idempotencyKey: string;
  sourceRef?: string;
  historical?: {
    businessDayId: number;
    businessDate: string;
    shiftInstanceId: number | null;
  };
};

export type CreateIncomeResult = {
  cashMoveId: number;
  idempotentReplay: boolean;
};

export async function createIncomeThroughTreasury(
  tx: Transaction,
  ports: TreasuryWritePorts,
  input: CreateIncomeInput,
): Promise<CreateIncomeResult> {
  const prior = await findRegistryByKey(tx, ports.tenantId, input.idempotencyKey);

  let businessDayId: number;
  let businessDate: string | undefined;
  let shiftInstanceId: number | null;

  if (input.historical) {
    businessDayId = input.historical.businessDayId;
    businessDate = input.historical.businessDate;
    shiftInstanceId = input.historical.shiftInstanceId;
  } else {
    const ctx = await ports.calendar.resolveFinancialWriteContext(tx, ports.actor, {
      locationId: input.locationId,
    });
    if (ctx.scope !== 'SHIFT' || ctx.shiftInstanceId == null) {
      throw new Error('لا توجد وردية مفتوحة. يجب فتح وردية قبل تسجيل الإيراد.');
    }
    businessDayId = ctx.businessDayId;
    businessDate = ctx.businessDate;
    shiftInstanceId = ctx.shiftInstanceId;
  }

  const catRes = await new sql.Request(tx)
    .input('expInId', sql.Int, input.categoryId)
    .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expInId`);
  if (catRes.recordset.length === 0) {
    throw new Error('تصنيف الإيراد غير موجود');
  }

  const pmRes = await new sql.Request(tx)
    .input('pmId', sql.Int, input.paymentMethodId)
    .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId`);
  if (pmRes.recordset.length === 0) {
    throw new Error('طريقة الدفع غير موجودة');
  }

  const sourceRef = input.sourceRef ?? `income:${input.idempotencyKey}`;
  const cashMoveId = await ports.moneyMovement.post(tx, ports.actor, {
    tenantId: ports.tenantId,
    locationId: input.locationId,
    businessDayId,
    businessDate,
    shiftInstanceId,
    amount: input.amount,
    direction: 'in',
    reason: 'income',
    invType: 'income',
    sourceRef,
    paymentMethodId: input.paymentMethodId,
    categoryId: input.categoryId,
    notes: input.notes,
    invTime: input.invTime,
    idempotencyKey: input.idempotencyKey,
  });

  return {
    cashMoveId,
    idempotentReplay: prior != null && prior.CashMoveId === cashMoveId,
  };
}
