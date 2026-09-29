import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type { TreasuryWritePorts } from '@/lib/treasuryComposition';
import { findRegistryByKey } from '../internal/idempotencyStore';

export type CreateExpenseInput = {
  locationId: number;
  amount: number;
  categoryId: number;
  paymentMethodId: number;
  notes?: string | null;
  idempotencyKey: string;
  sourceRef?: string;
  invTime?: string | null;
  historical?: {
    businessDayId: number;
    businessDate: string;
    shiftInstanceId: number | null;
  };
};

export type CreateExpenseResult = {
  cashMoveId: number;
  idempotentReplay: boolean;
};

export async function createExpenseThroughTreasury(
  tx: Transaction,
  ports: TreasuryWritePorts,
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
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
      throw new Error('لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تسجيل مصروف');
    }
    businessDayId = ctx.businessDayId;
    businessDate = ctx.businessDate;
    shiftInstanceId = ctx.shiftInstanceId;
  }

  const catRes = await new sql.Request(tx)
    .input('expINID', sql.Int, input.categoryId)
    .query(`
      SELECT ExpINID FROM dbo.TblExpINCat
      WHERE ExpINID = @expINID AND ExpINType = N'مصروفات'
    `);
  if (catRes.recordset.length === 0) {
    throw new Error('فئة المصروف غير صالحة');
  }

  const pmRes = await new sql.Request(tx)
    .input('pmId', sql.Int, input.paymentMethodId)
    .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId`);
  if (pmRes.recordset.length === 0) {
    throw new Error('طريقة الدفع غير موجودة');
  }

  const sourceRef = input.sourceRef ?? `expense:${input.idempotencyKey}`;
  const cashMoveId = await ports.moneyMovement.post(tx, ports.actor, {
    tenantId: ports.tenantId,
    locationId: input.locationId,
    businessDayId,
    businessDate,
    shiftInstanceId,
    amount: input.amount,
    direction: 'out',
    reason: 'expense',
    invType: 'expense',
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
