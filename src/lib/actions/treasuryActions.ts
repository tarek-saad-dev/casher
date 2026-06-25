/**
 * Treasury domain actions — single execution path for transfer and close-day.
 *
 * All operations run inside a transaction passed from the audit wrapper.
 */

import { sql } from '@/lib/db';

export interface TreasuryTransferInput {
  amount: number;
  fromPaymentMethodId: number;
  toPaymentMethodId: number;
  notes?: string;
  transferDate?: string;
  userId: number;
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
  newDay: number;
  shiftMoveId?: number;
  reconciliations: Array<{
    paymentMethodId: number;
    systemAmount: number;
    countedAmount: number;
    notes?: string;
  }>;
  closedByUserId: number;
}

export interface CloseDayReconRow {
  id: number;
  paymentMethodId: number;
  systemAmount: number;
  countedAmount: number;
  variance: number;
  variancePercentage: number;
  status: 'acceptable' | 'warning' | 'critical';
  paymentMethodName: string;
  notes: string | null;
}

export interface CloseDayResult {
  newDay: number;
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
  connection: sql.Transaction,
  paymentMethodId: number,
  newDay?: number,
): Promise<number> {
  let query = `
    SELECT COALESCE(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE -GrandTolal END), 0) AS balance
    FROM dbo.TblCashMove
    WHERE PaymentMethodID = @pm
  `;
  if (newDay !== undefined) {
    query += ` AND CAST(invDate AS DATE) = (SELECT CAST(DayDate AS DATE) FROM dbo.TblNewDay WHERE ID = @day)`;
  }
  const req = new sql.Request(connection)
    .input('pm', sql.Int, paymentMethodId);
  if (newDay !== undefined) {
    req.input('day', sql.Int, newDay);
  }
  const result = await req.query(query);
  return result.recordset[0]?.balance ?? 0;
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
  } = input;

  let invDate: Date;
  let shiftMoveID: number | null = null;
  let invTime: string;

  if (transferDate) {
    const inputDate = new Date(transferDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (inputDate > today) {
      throw new Error('لا يمكن التحويل لتاريخ في المستقبل');
    }
    invDate = inputDate;
    invTime = '12:00';
  } else {
    const dayResult = await new sql.Request(connection).query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      throw new Error('لا يوجد يوم عمل مفتوح — لا يمكن تنفيذ التحويل');
    }
    const activeDay = dayResult.recordset[0];
    invDate = activeDay.NewDay;

    const shiftResult = await new sql.Request(connection)
      .input('shiftUserID', sql.Int, userId)
      .query(`
        SELECT TOP 1 ID, ShiftID FROM [dbo].[TblShiftMove]
        WHERE Status = 1 AND ID IN (
          SELECT ID FROM [dbo].[TblShiftMove] WHERE Status = 1
        )
        ORDER BY ID DESC
      `);
    if (shiftResult.recordset.length === 0) {
      throw new Error('لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تنفيذ التحويل');
    }
    const activeShift = shiftResult.recordset[0];
    shiftMoveID = activeShift.ID;

    const now = new Date();
    invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // Validate payment methods exist
  const pmCheck = await new sql.Request(connection)
    .input('fromPmId', sql.Int, fromPaymentMethodId)
    .input('toPmId', sql.Int, toPaymentMethodId)
    .query(`
      SELECT PaymentID, PaymentMethod FROM dbo.TblPaymentMethods
      WHERE PaymentID IN (@fromPmId, @toPmId)
    `);
  if (pmCheck.recordset.length !== 2) {
    throw new Error('إحدى طرق الدفع غير موجودة');
  }

  const fromPm = pmCheck.recordset.find((pm) => pm.PaymentID === fromPaymentMethodId);
  const toPm = pmCheck.recordset.find((pm) => pm.PaymentID === toPaymentMethodId);

  // Get or create transfer categories
  let transferIncomeCategory: number;
  let transferExpenseCategory: number;

  if (transferDate) {
    const incomeCatRes = await new sql.Request(connection).query(`
      SELECT TOP 1 ExpINID FROM dbo.TblExpINCat
      WHERE ExpINType = N'ايرادات' AND (CatName LIKE N'%تحويل%' OR IsActive = 1)
      ORDER BY CASE WHEN CatName LIKE N'%تحويل%' THEN 0 ELSE 1 END, ExpINID
    `);
    if (incomeCatRes.recordset.length === 0) throw new Error('لا توجد تصنيفات إيرادات صالحة للتحويل');
    transferIncomeCategory = incomeCatRes.recordset[0].ExpINID;

    const expenseCatRes = await new sql.Request(connection).query(`
      SELECT TOP 1 ExpINID FROM dbo.TblExpINCat
      WHERE ExpINType = N'مصروفات' AND IsActive = 1
      ORDER BY ExpINID
    `);
    if (expenseCatRes.recordset.length === 0) throw new Error('لا توجد تصنيفات مصروفات صالحة للتحويل');
    transferExpenseCategory = expenseCatRes.recordset[0].ExpINID;
  } else {
    let expCatResult = await new sql.Request(connection).query(`
      SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'مصروفات' AND CatName LIKE N'%تحويل%'
    `);
    if (expCatResult.recordset.length === 0) {
      const insertCat = await new sql.Request(connection).query(`
        INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (N'تحويل بين طرق الدفع', N'مصروفات')
      `);
      transferExpenseCategory = insertCat.recordset[0].ExpINID;
    } else {
      transferExpenseCategory = expCatResult.recordset[0].ExpINID;
    }

    let incCatResult = await new sql.Request(connection).query(`
      SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'ايرادات' AND CatName LIKE N'%تحويل%'
    `);
    if (incCatResult.recordset.length === 0) {
      const insertCat = await new sql.Request(connection).query(`
        INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (N'تحويل بين طرق الدفع', N'ايرادات')
      `);
      transferIncomeCategory = insertCat.recordset[0].ExpINID;
    } else {
      transferIncomeCategory = incCatResult.recordset[0].ExpINID;
    }
  }

  const transferAmount = Number(amount);
  const transferNotes =
    notes?.trim() || `تحويل من ${fromPm?.PaymentMethod} إلى ${toPm?.PaymentMethod}`;

  // Generate invIDs
  const expenseInvIdResult = await new sql.Request(connection).query(`
    SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID FROM [dbo].[TblCashMove] WITH (TABLOCKX)
    WHERE invType = N'مصروفات'
  `);
  const expenseInvID = expenseInvIdResult.recordset[0].newInvID;

  const incomeInvIdResult = await new sql.Request(connection).query(`
    SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID FROM [dbo].[TblCashMove] WITH (TABLOCKX)
    WHERE invType = N'ايرادات'
  `);
  const incomeInvID = incomeInvIdResult.recordset[0].newInvID;

  // Create expense record
  const expenseReq = new sql.Request(connection)
    .input('invID', sql.Int, expenseInvID)
    .input('invType', sql.NVarChar(20), 'مصروفات')
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), invTime)
    .input('ClientID', sql.Int, null)
    .input('expINID', sql.Int, transferExpenseCategory)
    .input('amount', sql.Decimal(10, 2), transferAmount)
    .input('inOut', sql.NVarChar(10), 'out')
    .input('notes', sql.NVarChar(sql.MAX), transferDate
      ? `تحويل إلى ${toPm?.PaymentMethod}: ${transferNotes}`
      : `${transferNotes} (تحويل إلى ${toPm?.PaymentMethod})`)
    .input('shiftMoveID', sql.Int, shiftMoveID)
    .input('paymentMethodID', sql.Int, fromPaymentMethodId);

  const expInsert = await expenseReq.query(`
    INSERT INTO [dbo].[TblCashMove]
      (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
    OUTPUT INSERTED.ID
    VALUES
      (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
  `);
  const expenseId = expInsert.recordset[0].ID;

  // Create income record
  const incomeReq = new sql.Request(connection)
    .input('invID', sql.Int, incomeInvID)
    .input('invType', sql.NVarChar(20), 'ايرادات')
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), invTime)
    .input('ClientID', sql.Int, null)
    .input('expINID', sql.Int, transferIncomeCategory)
    .input('amount', sql.Decimal(10, 2), transferAmount)
    .input('inOut', sql.NVarChar(10), 'in')
    .input('notes', sql.NVarChar(sql.MAX), transferDate
      ? `تحويل من ${fromPm?.PaymentMethod}: ${transferNotes}`
      : `${transferNotes} (تحويل من ${fromPm?.PaymentMethod})`)
    .input('shiftMoveID', sql.Int, shiftMoveID)
    .input('paymentMethodID', sql.Int, toPaymentMethodId);

  const incInsert = await incomeReq.query(`
    INSERT INTO [dbo].[TblCashMove]
      (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
    OUTPUT INSERTED.ID
    VALUES
      (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
  `);
  const incomeId = incInsert.recordset[0].ID;

  return {
    expenseId,
    incomeId,
    expenseInvID,
    incomeInvID,
    amount: transferAmount,
    fromPaymentMethodId: fromPaymentMethodId,
    toPaymentMethodId: toPaymentMethodId,
    fromPaymentMethod: fromPm?.PaymentMethod,
    toPaymentMethod: toPm?.PaymentMethod,
    notes: transferNotes,
    transferDate: transferDate || invDate,
    shiftMoveId: shiftMoveID,
  };
}

export async function closeTreasuryDay(
  connection: sql.Transaction,
  input: CloseDayInput,
): Promise<CloseDayResult> {
  const { newDay, shiftMoveId, reconciliations, closedByUserId } = input;

  // Idempotency guard: prevent duplicate reconciliation rows for the same day
  const existingRecon = await new sql.Request(connection)
    .input('newDay', sql.Int, newDay)
    .query(`SELECT TOP 1 ID FROM dbo.TblTreasuryCloseRecon WHERE NewDay = @newDay`);
  if (existingRecon.recordset.length > 0) {
    throw new Error('تم تقفيل هذا اليوم مسبقاً — لا يمكن إنشاء تسويات جديدة');
  }

  // Update TblNewDay status
  await new sql.Request(connection)
    .input('id', sql.Int, newDay)
    .query(`UPDATE dbo.TblNewDay SET Status = 0 WHERE ID = @id`);

  const reconciliationIds: number[] = [];
  const variances: CloseDayReconRow[] = [];

  for (const recon of reconciliations) {
    const variance = recon.countedAmount - recon.systemAmount;
    const status = getVarianceStatus(variance, recon.systemAmount);

    const insertResult = await new sql.Request(connection)
      .input('newDay', sql.Int, newDay)
      .input('shiftMoveId', sql.Int, shiftMoveId || null)
      .input('paymentMethodId', sql.Int, recon.paymentMethodId)
      .input('systemAmount', sql.Decimal(18, 2), recon.systemAmount)
      .input('countedAmount', sql.Decimal(18, 2), recon.countedAmount)
      .input('notes', sql.NVarChar, recon.notes || null)
      .input('closedByUserId', sql.Int, closedByUserId)
      .query(`
        INSERT INTO [dbo].[TblTreasuryCloseRecon]
          ([NewDay], [ShiftMoveID], [PaymentMethodID], [SystemAmount], [CountedAmount], [Notes], [ClosedByUserID])
        VALUES
          (@newDay, @shiftMoveId, @paymentMethodId, @systemAmount, @countedAmount, @notes, @closedByUserId);
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
