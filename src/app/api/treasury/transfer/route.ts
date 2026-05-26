import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// POST /api/treasury/transfer — Transfer amount between payment methods
// Body: { amount: number, fromPaymentMethodId: number, toPaymentMethodId: number, notes?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { amount, fromPaymentMethodId, toPaymentMethodId, notes } = body;

    // ──── Validation ────
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'يجب إدخال مبلغ صحيح أكبر من صفر' }, { status: 400 });
    }
    if (!fromPaymentMethodId) {
      return NextResponse.json({ error: 'يجب اختيار طريقة الدفع المصدر (من)' }, { status: 400 });
    }
    if (!toPaymentMethodId) {
      return NextResponse.json({ error: 'يجب اختيار طريقة الدفع الهدف (إلى)' }, { status: 400 });
    }
    if (fromPaymentMethodId === toPaymentMethodId) {
      return NextResponse.json({ error: 'لا يمكن التحويل لنفس طريقة الدفع' }, { status: 400 });
    }

    // ──── Session enforcement ────
    const sessionUser = await getSession();
    if (!sessionUser) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }
    const userID = sessionUser.UserID;

    const db = await getPool();

    // ──── Enforce active business day ────
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح — لا يمكن تنفيذ التحويل' }, { status: 400 });
    }
    const activeDay = dayResult.recordset[0];
    const invDate = activeDay.NewDay;

    // ──── Enforce active shift for THIS user ────
    const shiftResult = await db.request()
      .input('shiftUserID', sql.Int, userID)
      .query(`
        SELECT TOP 1 ID, UserID, ShiftID FROM [dbo].[TblShiftMove]
        WHERE Status = 1 AND UserID = @shiftUserID
        ORDER BY ID DESC
      `);
    if (shiftResult.recordset.length === 0) {
      return NextResponse.json({ error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تنفيذ التحويل' }, { status: 400 });
    }
    const activeShift = shiftResult.recordset[0];
    const shiftMoveID = activeShift.ID;

    // ──── Validate payment methods exist ────
    const pmResult = await db.request()
      .input('fromId', sql.Int, fromPaymentMethodId)
      .input('toId', sql.Int, toPaymentMethodId)
      .query(`
        SELECT PaymentID, PaymentMethod FROM [dbo].[TblPaymentMethods]
        WHERE PaymentID IN (@fromId, @toId)
      `);
    if (pmResult.recordset.length !== 2) {
      return NextResponse.json({ error: 'إحدى طرق الدفع غير موجودة' }, { status: 400 });
    }
    const fromPm = pmResult.recordset.find((r: any) => r.PaymentID === fromPaymentMethodId);
    const toPm = pmResult.recordset.find((r: any) => r.PaymentID === toPaymentMethodId);

    // ──── Get expense category for transfers (or create default) ────
    // Look for a category named "تحويل" under مصروفات
    let expCatResult = await db.request().query(`
      SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'مصروفات' AND CatName LIKE N'%تحويل%'
    `);
    
    let expenseCatId: number;
    if (expCatResult.recordset.length === 0) {
      // Create a default transfer category
      const insertCat = await db.request().query(`
        INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (N'تحويل بين طرق الدفع', N'مصروفات')
      `);
      expenseCatId = insertCat.recordset[0].ExpINID;
    } else {
      expenseCatId = expCatResult.recordset[0].ExpINID;
    }

    // ──── Get income category for transfers ────
    let incCatResult = await db.request().query(`
      SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'ايرادات' AND CatName LIKE N'%تحويل%'
    `);
    
    let incomeCatId: number;
    if (incCatResult.recordset.length === 0) {
      // Create a default transfer category
      const insertCat = await db.request().query(`
        INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (N'تحويل بين طرق الدفع', N'ايرادات')
      `);
      incomeCatId = insertCat.recordset[0].ExpINID;
    } else {
      incomeCatId = incCatResult.recordset[0].ExpINID;
    }

    // ──── Transaction ────
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const now = new Date();
      const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
      const transferAmount = Number(amount);
      const notesText = notes?.trim() || `تحويل من ${fromPm.PaymentMethod} إلى ${toPm.PaymentMethod}`;

      // 1. Generate invID for expense (out)
      const expInvIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'مصروفات'
      `);
      const expInvID = expInvIdResult.recordset[0].newInvID;

      // 2. Insert expense record (out from source payment method)
      const expReq = new sql.Request(transaction);
      expReq
        .input('invID', sql.Int, expInvID)
        .input('invType', sql.NVarChar(20), N('مصروفات'))
        .input('invDate', sql.Date, invDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ClientID', sql.Int, null)
        .input('ExpINID', sql.Int, expenseCatId)
        .input('GrandTolal', sql.Decimal(10, 2), transferAmount)
        .input('inOut', sql.NVarChar(5), N('out'))
        .input('Notes', sql.NVarChar(sql.MAX), `${notesText} (تحويل إلى ${toPm.PaymentMethod})`)
        .input('ShiftMoveID', sql.Int, shiftMoveID)
        .input('PaymentMethodID', sql.Int, fromPaymentMethodId);

      const expInsert = await expReq.query(`
        INSERT INTO [dbo].[TblCashMove] (
          invID, invType, invDate, invTime, ClientID,
          ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID,
          @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
        );
        SELECT SCOPE_IDENTITY() AS ID;
      `);
      const expenseId = expInsert.recordset[0].ID;

      // 3. Generate invID for income (in)
      const incInvIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'ايرادات'
      `);
      const incInvID = incInvIdResult.recordset[0].newInvID;

      // 4. Insert income record (in to target payment method)
      const incReq = new sql.Request(transaction);
      incReq
        .input('invID', sql.Int, incInvID)
        .input('invType', sql.NVarChar(20), N('ايرادات'))
        .input('invDate', sql.Date, invDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ClientID', sql.Int, null)
        .input('ExpINID', sql.Int, incomeCatId)
        .input('GrandTolal', sql.Decimal(10, 2), transferAmount)
        .input('inOut', sql.NVarChar(5), N('in'))
        .input('Notes', sql.NVarChar(sql.MAX), `${notesText} (تحويل من ${fromPm.PaymentMethod})`)
        .input('ShiftMoveID', sql.Int, shiftMoveID)
        .input('PaymentMethodID', sql.Int, toPaymentMethodId);

      const incInsert = await incReq.query(`
        INSERT INTO [dbo].[TblCashMove] (
          invID, invType, invDate, invTime, ClientID,
          ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID,
          @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
        );
        SELECT SCOPE_IDENTITY() AS ID;
      `);
      const incomeId = incInsert.recordset[0].ID;

      await transaction.commit();

      return NextResponse.json({
        success: true,
        expenseId,
        incomeId,
        amount: transferAmount,
        fromPaymentMethod: fromPm.PaymentMethod,
        toPaymentMethod: toPm.PaymentMethod,
        notes: notesText
      }, { status: 201 });

    } catch (err) {
      try { await transaction.rollback(); } catch {}
      throw err;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/treasury/transfer] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Helper: N() is just identity but clarifies intent for NVarChar literals
function N(s: string) { return s; }
