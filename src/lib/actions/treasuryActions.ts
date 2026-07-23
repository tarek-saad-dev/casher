/**
 * Treasury domain actions — single execution path for transfer and close-day.
 *
 * All operations run inside a transaction passed from the audit wrapper.
 */

import { sql, allocateInvID } from '@/lib/db';

export interface TreasuryTransferInput {
  amount: number;
  fromPaymentMethodId: number;
  toPaymentMethodId: number;
  notes?: string;
  /** Explicit past-date transfer — mutually exclusive with the current business day. */
  transferDate?: string;
  /** Current business-day date (from gated session context) — used when transferDate is absent. */
  invDate?: string;
  /** Branch-scoped open shift, if any. Not required for past-date transfers. */
  shiftMoveId?: number | null;
  userId: number;
  requestId?: string;
  /** Never trust browser branchId — always resolved from gated session context or explicit past-date resolution. */
  branchId: number;
  /** Nullable only for legacy — new writes should always resolve a real business day. */
  businessDayId: number | null;
}

export interface TreasuryTransferResult {
  expenseId: number;
  incomeId: number;
  expenseInvID: number;
  incomeInvID: number;
  amount: number;
  fromPaymentMethodId: number;
  toPaymentMethodId: number;
  fromPaymentMethod: string;
  toPaymentMethod: string;
  notes: string;
  transferDate: string | Date;
  shiftMoveId: number | null;
}

export interface CloseDayInput {
  newDay: string;
  branchId: number;
  shiftMoveId?: number;
  reconciliations: Array<{
    paymentMethodId: number | null;
    systemAmount: number;
    countedAmount: number;
    notes?: string;
  }>;
  closedByUserId: number;
}

export interface CloseDayReconRow {
  id: number;
  paymentMethodId: number | null;
  systemAmount: number;
  countedAmount: number;
  variance: number;
  variancePercentage: number;
  status: 'acceptable' | 'warning' | 'critical';
  paymentMethodName: string;
  notes: string | null;
}

export interface CloseDayResult {
  newDay: string;
  reconciliationIds: number[];
  variances: CloseDayReconRow[];
  closedByUserId: number;
}

const VARIANCE_THRESHOLD = 50;

function getVarianceStatus(variance: number, systemAmount: number): CloseDayReconRow['status'] {
  const absVariance = Math.abs(variance);
  const percentage = systemAmount !== 0 ? (absVariance / Math.abs(systemAmount)) * 100 : 0;
  if (absVariance <= VARIANCE_THRESHOLD) return 'acceptable';
  if (percentage <= 5) return 'warning';
  return 'critical';
}

export async function getPaymentMethodBalance(
  connection: sql.Transaction | sql.ConnectionPool,
  paymentMethodId: number,
  options?: { newDay?: string; asOfDate?: string },
): Promise<number> {
  let query = `
    SELECT COALESCE(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE -GrandTolal END), 0) AS balance
    FROM dbo.TblCashMove
    WHERE PaymentMethodID = @pm
  `;
  if (options?.asOfDate) {
    query += ` AND invDate < DATEADD(day, 1, CAST(@asOfDate AS DATE))`;
  } else if (options?.newDay !== undefined) {
    query += ` AND CAST(invDate AS DATE) = @day`;
  }
  const req = new sql.Request(connection as any).input('pm', sql.Int, paymentMethodId);
  if (options?.asOfDate) {
    req.input('asOfDate', sql.Date, options.asOfDate);
  } else if (options?.newDay !== undefined) {
    req.input('day', sql.Date, options.newDay);
  }
  const result = await req.query(query);
  return result.recordset[0]?.balance ?? 0;
}

function throwWithStatus(message: string, statusCode: number): never {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  throw err;
}

export async function executeTreasuryTransfer(
  connection: sql.Transaction,
  input: TreasuryTransferInput,
): Promise<TreasuryTransferResult> {
  const {
    amount,
    fromPaymentMethodId,
    toPaymentMethodId,
    notes,
    transferDate,
    userId,
    requestId = 'unknown',
    branchId,
    businessDayId,
  } = input;

  const log = (msg: string, data?: unknown) => {
    console.log(`[transfer:${requestId}] ${msg}`, data ?? '');
  };
  const logError = (msg: string, err: unknown) => {
    console.error(`[transfer:${requestId}] ${msg}`, err);
  };

  log('Starting transfer', {
    amount,
    fromPaymentMethodId,
    toPaymentMethodId,
    transferDate: transferDate ?? 'current',
    userId,
  });

  // Branch, business day and (for current-day transfers) the shift are resolved by the
  // caller from gated session context — never trust browser branchId here.
  let invDate: Date | string;
  let shiftMoveID: number | null = input.shiftMoveId ?? null;
  let invTime: string;

  if (transferDate) {
    const inputDate = new Date(transferDate);
    if (isNaN(inputDate.getTime())) {
      throw new Error('تاريخ التحويل غير صالح');
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (inputDate > today) {
      throw new Error('لا يمكن التحويل لتاريخ في المستقبل');
    }
    invDate = inputDate;
    invTime = '12:00';
    log('Historical date resolved', { step: 'date-resolve:complete', invDate: invDate.toISOString().split('T')[0], invTime, branchId });
  } else {
    invDate = input.invDate ?? new Date();
    const now = new Date();
    invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
    log('Current business day resolved', { invDate, businessDayId, branchId, shiftMoveID });
  }

  if (fromPaymentMethodId === toPaymentMethodId) {
    throwWithStatus('يجب اختيار طرق دفع مختلفة', 400);
  }

  // Validate payment methods exist
  log('Payment method lookup:start', { step: 'payment-method-lookup:start' });
  const pmCheck = await new sql.Request(connection)
    .input('fromPmId', sql.Int, fromPaymentMethodId)
    .input('toPmId', sql.Int, toPaymentMethodId)
    .query(`
      SELECT PaymentID, PaymentMethod FROM dbo.TblPaymentMethods
      WHERE PaymentID IN (@fromPmId, @toPmId)
    `);
  log('Payment method lookup:complete', { step: 'payment-method-lookup:complete' });
  if (pmCheck.recordset.length !== 2) {
    throwWithStatus('إحدى طرق الدفع غير موجودة', 404);
  }

  const fromPm = pmCheck.recordset.find((pm) => pm.PaymentID === fromPaymentMethodId);
  const toPm = pmCheck.recordset.find((pm) => pm.PaymentID === toPaymentMethodId);

  // Data integrity: names must exist after validation
  if (!fromPm?.PaymentMethod || typeof fromPm.PaymentMethod !== 'string' || fromPm.PaymentMethod.trim().length === 0) {
    logError('Data integrity error: missing source payment method name', { fromPm });
    throw new Error('بيانات طريقة الدفع المصدر غير مكتملة');
  }
  if (!toPm?.PaymentMethod || typeof toPm.PaymentMethod !== 'string' || toPm.PaymentMethod.trim().length === 0) {
    logError('Data integrity error: missing destination payment method name', { toPm });
    throw new Error('بيانات طريقة الدفع الهدف غير مكتملة');
  }

  log('Payment methods resolved', { from: fromPm.PaymentMethod, to: toPm.PaymentMethod });

  // Balance check: ensure source has enough funds as of the transfer date
  const balanceOpts = transferDate ? { asOfDate: transferDate } : undefined;
  log('Balance calculation:start', { step: 'balance-calculation:start', fromPaymentMethodId, asOfDate: transferDate ?? 'all-time' });
  const fromBalance = await getPaymentMethodBalance(connection, fromPaymentMethodId, balanceOpts);
  log('Balance calculation:complete', { step: 'balance-calculation:complete', fromBalance, amount });
  if (fromBalance < amount) {
    throwWithStatus('رصيد طريقة الدفع المصدر غير كافٍ', 409);
  }

  // Get or create transfer categories (unified for current and past-date transfers)
  let transferIncomeCategory: number;
  let transferExpenseCategory: number;

  log('Category lookup:start', { step: 'category-lookup:expense:start' });
  const expCatResult = await new sql.Request(connection).query(`
    SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
    WHERE ExpINType = N'مصروفات' AND CatName LIKE N'%تحويل%'
    ORDER BY ExpINID
  `);
  if (expCatResult.recordset.length === 0) {
    log('Category lookup:create-expense', { step: 'category-lookup:expense:create' });
    const insertCat = await new sql.Request(connection).query(`
      INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (N'تحويل بين طرق الدفع', N'مصروفات')
    `);
    transferExpenseCategory = insertCat.recordset[0].ExpINID;
    log('Created expense transfer category', { transferExpenseCategory });
  } else {
    transferExpenseCategory = expCatResult.recordset[0].ExpINID;
  }
  log('Category lookup:complete', { step: 'category-lookup:expense:complete', transferExpenseCategory });

  log('Category lookup:start', { step: 'category-lookup:income:start' });
  const incCatResult = await new sql.Request(connection).query(`
    SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
    WHERE ExpINType = N'ايرادات' AND CatName LIKE N'%تحويل%'
    ORDER BY ExpINID
  `);
  if (incCatResult.recordset.length === 0) {
    log('Category lookup:create-income', { step: 'category-lookup:income:create' });
    const insertCat = await new sql.Request(connection).query(`
      INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (N'تحويل بين طرق الدفع', N'ايرادات')
    `);
    transferIncomeCategory = insertCat.recordset[0].ExpINID;
    log('Created income transfer category', { transferIncomeCategory });
  } else {
    transferIncomeCategory = incCatResult.recordset[0].ExpINID;
  }
  log('Category lookup:complete', { step: 'category-lookup:income:complete', transferIncomeCategory });

  const transferAmount = Number(amount);
  const transferNotes =
    notes?.trim() || `تحويل من ${fromPm.PaymentMethod} إلى ${toPm.PaymentMethod}`;

  // Allocate invIDs safely using application locks (no TABLOCKX)
  log('invID allocation:start', { step: 'invID-allocation:expense:start' });
  const expenseInvID = await allocateInvID(connection as sql.Transaction, 'TblCashMove', 'مصروفات', 5000);
  log('invID allocation:complete', { step: 'invID-allocation:expense:complete', expenseInvID });

  log('invID allocation:start', { step: 'invID-allocation:income:start' });
  const incomeInvID = await allocateInvID(connection as sql.Transaction, 'TblCashMove', 'ايرادات', 5000);
  log('invID allocation:complete', { step: 'invID-allocation:income:complete', incomeInvID });

  // Create expense record
  const expenseReq = new sql.Request(connection)
    .input('invID', sql.Int, expenseInvID)
    .input('invType', sql.NVarChar(20), 'مصروفات')
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), invTime)
    .input('ClientID', sql.Int, null)
    .input('expINID', sql.Int, transferExpenseCategory)
    .input('amount', sql.Decimal(10, 2), transferAmount)
    .input('inOut', sql.NVarChar(5), 'out')
    .input('notes', sql.NVarChar(sql.MAX), transferDate
      ? `تحويل إلى ${toPm.PaymentMethod}: ${transferNotes}`
      : `${transferNotes} (تحويل إلى ${toPm.PaymentMethod})`)
    .input('shiftMoveID', sql.Int, shiftMoveID)
    .input('paymentMethodID', sql.Int, fromPaymentMethodId)
    .input('branchID', sql.Int, branchId)
    .input('businessDayID', sql.Int, businessDayId);

  let expenseId: number;
  try {
    log('insert-outgoing:start', { step: 'insert-outgoing:start', expenseInvID });
    const expInsert = await expenseReq.query(`
      INSERT INTO [dbo].[TblCashMove]
        (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID)
      OUTPUT INSERTED.ID
      VALUES
        (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID, @branchID, @businessDayID)
    `);
    expenseId = expInsert.recordset[0].ID;
    log('insert-outgoing:complete', { step: 'insert-outgoing:complete', expenseId, expenseInvID });
  } catch (err) {
    logError('Failed to insert expense record', err);
    throw new Error('فشل إنشاء سجل المصروف');
  }

  // Create income record
  const incomeReq = new sql.Request(connection)
    .input('invID', sql.Int, incomeInvID)
    .input('invType', sql.NVarChar(20), 'ايرادات')
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), invTime)
    .input('ClientID', sql.Int, null)
    .input('expINID', sql.Int, transferIncomeCategory)
    .input('amount', sql.Decimal(10, 2), transferAmount)
    .input('inOut', sql.NVarChar(5), 'in')
    .input('notes', sql.NVarChar(sql.MAX), transferDate
      ? `تحويل من ${fromPm.PaymentMethod}: ${transferNotes}`
      : `${transferNotes} (تحويل من ${fromPm.PaymentMethod})`)
    .input('shiftMoveID', sql.Int, shiftMoveID)
    .input('paymentMethodID', sql.Int, toPaymentMethodId)
    .input('branchID', sql.Int, branchId)
    .input('businessDayID', sql.Int, businessDayId);

  let incomeId: number;
  try {
    log('insert-incoming:start', { step: 'insert-incoming:start', incomeInvID });
    const incInsert = await incomeReq.query(`
      INSERT INTO [dbo].[TblCashMove]
        (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID)
      OUTPUT INSERTED.ID
      VALUES
        (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID, @branchID, @businessDayID)
    `);
    incomeId = incInsert.recordset[0].ID;
    log('insert-incoming:complete', { step: 'insert-incoming:complete', incomeId, incomeInvID });
  } catch (err) {
    logError('Failed to insert income record', err);
    throw new Error('فشل إنشاء سجل الإيراد');
  }

  log('Transfer completed successfully', { expenseId, incomeId });

  return {
    expenseId,
    incomeId,
    expenseInvID,
    incomeInvID,
    amount: transferAmount,
    fromPaymentMethodId: fromPaymentMethodId,
    toPaymentMethodId: toPaymentMethodId,
    fromPaymentMethod: fromPm.PaymentMethod,
    toPaymentMethod: toPm.PaymentMethod,
    notes: transferNotes,
    transferDate: transferDate || invDate,
    shiftMoveId: shiftMoveID,
  };
}

export async function closeTreasuryDay(
  connection: sql.Transaction,
  input: CloseDayInput,
): Promise<CloseDayResult> {
  const { newDay, branchId, shiftMoveId, reconciliations, closedByUserId } = input;

  // Resolve the business day ID from its date within the active branch
  const dayLookup = await new sql.Request(connection)
    .input('newDay', sql.Date, newDay)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblNewDay
      WHERE NewDay = @newDay AND BranchID = @branchId
    `);
  const dayId = dayLookup.recordset[0]?.ID;
  if (!dayId) {
    throw new Error('لا يوجد يوم عمل مطابق للتاريخ المحدد في الفرع النشط');
  }

  // Idempotency guard: prevent duplicate reconciliation rows for the same day
  // TblTreasuryCloseRecon.NewDay stores the day ID (int), not the date.
  const existingRecon = await new sql.Request(connection)
    .input('dayId', sql.Int, dayId)
    .query(`SELECT TOP 1 ID FROM dbo.TblTreasuryCloseRecon WHERE NewDay = @dayId`);
  if (existingRecon.recordset.length > 0) {
    throw new Error('تم تقفيل هذا اليوم مسبقاً — لا يمكن إنشاء تسويات جديدة');
  }

  // Update TblNewDay status for this branch day only
  await new sql.Request(connection)
    .input('id', sql.Int, dayId)
    .input('branchId', sql.Int, branchId)
    .query(`
      UPDATE dbo.TblNewDay
      SET Status = 0
      WHERE ID = @id AND BranchID = @branchId
    `);

  const reconciliationIds: number[] = [];
  const variances: CloseDayReconRow[] = [];

  for (const recon of reconciliations) {
    const variance = recon.countedAmount - recon.systemAmount;
    const status = getVarianceStatus(variance, recon.systemAmount);

    const insertResult = await new sql.Request(connection)
      .input('dayId', sql.Int, dayId)
      .input('shiftMoveId', sql.Int, shiftMoveId || null)
      .input('paymentMethodId', sql.Int, recon.paymentMethodId)
      .input('systemAmount', sql.Decimal(18, 2), recon.systemAmount)
      .input('countedAmount', sql.Decimal(18, 2), recon.countedAmount)
      .input('notes', sql.NVarChar, recon.notes || null)
      .input('closedByUserId', sql.Int, closedByUserId)
      .input('branchId', sql.Int, branchId)
      .query(`
        INSERT INTO [dbo].[TblTreasuryCloseRecon]
          ([NewDay], [ShiftMoveID], [PaymentMethodID], [SystemAmount], [CountedAmount], [Notes], [ClosedByUserID], [BranchID])
        VALUES
          (@dayId, @shiftMoveId, @paymentMethodId, @systemAmount, @countedAmount, @notes, @closedByUserId, @branchId);
        SELECT SCOPE_IDENTITY() AS ID;
      `);

    const reconId = insertResult.recordset[0].ID;
    reconciliationIds.push(reconId);

    const pmResult = await new sql.Request(connection)
      .input('paymentMethodId', sql.Int, recon.paymentMethodId)
      .query(`SELECT PaymentMethod FROM [dbo].[TblPaymentMethods] WHERE PaymentID = @paymentMethodId`);

    const paymentMethodName = pmResult.recordset[0]?.PaymentMethod || '';
    const variancePercentage = recon.systemAmount !== 0
      ? (variance / Math.abs(recon.systemAmount)) * 100
      : 0;

    variances.push({
      id: reconId,
      paymentMethodId: recon.paymentMethodId,
      systemAmount: recon.systemAmount,
      countedAmount: recon.countedAmount,
      variance,
      variancePercentage,
      status,
      paymentMethodName,
      notes: recon.notes || null,
    });
  }

  return {
    newDay,
    reconciliationIds,
    variances,
    closedByUserId,
  };
}
