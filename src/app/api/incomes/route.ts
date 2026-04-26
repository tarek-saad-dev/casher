import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// ─────────────────────── GET /api/incomes ───────────────────────
// Query params: fromDate, toDate, expInId?, paymentMethodId?, shiftMoveId?, search?
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const url = new URL(req.url);
    const fromDate = url.searchParams.get('fromDate');
    const toDate   = url.searchParams.get('toDate');
    const expInId  = url.searchParams.get('expInId');
    const pmId     = url.searchParams.get('paymentMethodId');
    const shiftId  = url.searchParams.get('shiftMoveId');
    const search   = url.searchParams.get('search');

    // Default: today
    const today = new Date().toISOString().split('T')[0];
    const from  = fromDate || today;
    const to    = toDate   || today;

    const req1 = db.request()
      .input('fromDate',        sql.Date,          from)
      .input('toDate',          sql.Date,          to)
      .input('expInId',         sql.Int,           expInId         ? parseInt(expInId)  : null)
      .input('paymentMethodId', sql.Int,           pmId            ? parseInt(pmId)     : null)
      .input('shiftMoveId',     sql.Int,           shiftId         ? parseInt(shiftId)  : null)
      .input('search',          sql.NVarChar(200), search || null);

    const itemsResult = await req1.query(`
      SELECT
        CM.ID,
        CM.invID,
        CM.invDate,
        CM.invTime,
        CM.ExpINID,
        ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
        CM.GrandTolal AS Amount,
        CM.Notes,
        CM.PaymentMethodID,
        ISNULL(PM.PaymentMethod, N'غير محدد') AS PaymentMethod,
        CM.ShiftMoveID,
        SM.NewDay,
        SM.StartDate,
        SM.StartTime,
        SM.EndDate,
        SM.EndTime,
        SM.Status AS ShiftStatus,
        U.UserID,
        U.UserName,
        S.ShiftID,
        S.ShiftName
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblExpINCat CAT        ON CM.ExpINID        = CAT.ExpINID
      LEFT JOIN dbo.TblPaymentMethods PM   ON CM.PaymentMethodID = PM.PaymentID
      LEFT JOIN dbo.TblShiftMove SM        ON CM.ShiftMoveID    = SM.ID
      LEFT JOIN dbo.TblUser U              ON SM.UserID         = U.UserID
      LEFT JOIN dbo.TblShift S             ON SM.ShiftID        = S.ShiftID
      WHERE CM.invType = N'ايرادات'
        AND CM.invDate >= @fromDate
        AND CM.invDate <= @toDate
        AND (@expInId         IS NULL OR CM.ExpINID        = @expInId)
        AND (@paymentMethodId IS NULL OR CM.PaymentMethodID = @paymentMethodId)
        AND (@shiftMoveId     IS NULL OR CM.ShiftMoveID    = @shiftMoveId)
        AND (
          @search IS NULL
          OR CM.Notes            LIKE N'%' + @search + N'%'
          OR CAT.CatName         LIKE N'%' + @search + N'%'
          OR PM.PaymentMethod    LIKE N'%' + @search + N'%'
        )
      ORDER BY CM.invDate DESC, CM.ID DESC
    `);

    // ── Summary ──
    const req2 = db.request()
      .input('fromDate', sql.Date, from)
      .input('toDate',   sql.Date, to);
    const summaryResult = await req2.query(`
      SELECT
        ISNULL(SUM(GrandTolal), 0)  AS TotalIncome,
        COUNT(*)                    AS IncomeCount,
        ISNULL(AVG(GrandTolal), 0)  AS AverageIncome,
        MIN(invDate)                AS FirstIncomeDate,
        MAX(invDate)                AS LastIncomeDate
      FROM dbo.TblCashMove
      WHERE invType = N'ايرادات'
        AND invDate >= @fromDate
        AND invDate <= @toDate
    `);

    // ── By Payment Method ──
    const req3 = db.request()
      .input('fromDate', sql.Date, from)
      .input('toDate',   sql.Date, to);
    const byPmResult = await req3.query(`
      SELECT
        CM.PaymentMethodID,
        ISNULL(PM.PaymentMethod, N'غير محدد') AS PaymentMethod,
        COUNT(*)                              AS IncomeCount,
        ISNULL(SUM(CM.GrandTolal), 0)        AS TotalIncome
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.invType = N'ايرادات'
        AND CM.invDate >= @fromDate
        AND CM.invDate <= @toDate
      GROUP BY CM.PaymentMethodID, PM.PaymentMethod
      ORDER BY TotalIncome DESC
    `);

    // ── By Category ──
    const req4 = db.request()
      .input('fromDate', sql.Date, from)
      .input('toDate',   sql.Date, to);
    const byCatResult = await req4.query(`
      SELECT
        CM.ExpINID,
        ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
        COUNT(*)                          AS IncomeCount,
        ISNULL(SUM(CM.GrandTolal), 0)    AS TotalIncome
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblExpINCat CAT ON CM.ExpINID = CAT.ExpINID
      WHERE CM.invType = N'ايرادات'
        AND CM.invDate >= @fromDate
        AND CM.invDate <= @toDate
      GROUP BY CM.ExpINID, CAT.CatName
      ORDER BY TotalIncome DESC
    `);

    // ── By Shift ──
    const req5 = db.request()
      .input('fromDate', sql.Date, from)
      .input('toDate',   sql.Date, to);
    const byShiftResult = await req5.query(`
      SELECT
        CM.ShiftMoveID,
        SM.NewDay,
        S.ShiftName,
        U.UserName,
        COUNT(*)                       AS IncomeCount,
        ISNULL(SUM(CM.GrandTolal), 0) AS TotalIncome
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblShift S      ON SM.ShiftID     = S.ShiftID
      LEFT JOIN dbo.TblUser U       ON SM.UserID      = U.UserID
      WHERE CM.invType = N'ايرادات'
        AND CM.invDate >= @fromDate
        AND CM.invDate <= @toDate
      GROUP BY CM.ShiftMoveID, SM.NewDay, S.ShiftName, U.UserName
      ORDER BY TotalIncome DESC
    `);

    return NextResponse.json({
      items:         itemsResult.recordset,
      summary:       summaryResult.recordset[0] ?? { TotalIncome: 0, IncomeCount: 0, AverageIncome: 0, FirstIncomeDate: null, LastIncomeDate: null },
      byPaymentMethod: byPmResult.recordset,
      byCategory:    byCatResult.recordset,
      byShift:       byShiftResult.recordset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────── POST /api/incomes ───────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const body = await req.json();
    const { invDate, amount, expInId, paymentMethodId, notes, shiftMoveId } = body;

    // ── Client-side validation ──
    if (!invDate) return NextResponse.json({ error: 'التاريخ مطلوب' }, { status: 400 });
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'قيمة الإيراد يجب أن تكون أكبر من صفر' }, { status: 400 });
    if (!expInId) return NextResponse.json({ error: 'يجب اختيار تصنيف الإيراد' }, { status: 400 });
    if (!paymentMethodId) return NextResponse.json({ error: 'يجب اختيار طريقة الدفع' }, { status: 400 });

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1. Resolve ShiftMoveID
      let resolvedShiftMoveId: number | null = shiftMoveId ?? null;
      if (!resolvedShiftMoveId) {
        const shiftReq = new sql.Request(transaction)
          .input('userID', sql.Int, session.UserID);
        const shiftRes = await shiftReq.query(`
          SELECT TOP 1 SM.ID AS ShiftMoveID
          FROM dbo.TblShiftMove SM
          WHERE SM.Status = 1
            AND SM.UserID = @userID
          ORDER BY SM.ID DESC
        `);
        if (shiftRes.recordset.length > 0) {
          resolvedShiftMoveId = shiftRes.recordset[0].ShiftMoveID;
        }
      }
      if (!resolvedShiftMoveId) {
        await transaction.rollback();
        return NextResponse.json({ error: 'لا توجد وردية مفتوحة. يجب فتح وردية قبل تسجيل الإيراد.' }, { status: 400 });
      }

      // 2. Validate category
      const catRes = await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expInId`);
      if (catRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'تصنيف الإيراد غير موجود' }, { status: 400 });
      }

      // 3. Validate payment method
      const pmRes = await new sql.Request(transaction)
        .input('pmId', sql.Int, paymentMethodId)
        .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId`);
      if (pmRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'طريقة الدفع غير موجودة' }, { status: 400 });
      }

      // 4. Generate next invID
      const invIdRes = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS NextInvID
        FROM dbo.TblCashMove WITH (UPDLOCK, HOLDLOCK)
        WHERE invType = N'ايرادات'
      `);
      const nextInvID = invIdRes.recordset[0].NextInvID;

      // 5. Insert
      const insertReq = new sql.Request(transaction)
        .input('invID',           sql.Int,              nextInvID)
        .input('invDate',         sql.Date,             invDate)
        .input('expInId',         sql.Int,              expInId)
        .input('amount',          sql.Decimal(10, 2),   Number(amount))
        .input('notes',           sql.NVarChar(sql.MAX), notes?.trim() || null)
        .input('shiftMoveId',     sql.Int,              resolvedShiftMoveId)
        .input('paymentMethodId', sql.Int,              paymentMethodId);

      const insertRes = await insertReq.query(`
        INSERT INTO dbo.TblCashMove
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        OUTPUT
          INSERTED.ID, INSERTED.invID, INSERTED.invDate, INSERTED.invTime,
          INSERTED.ExpINID, INSERTED.GrandTolal AS Amount, INSERTED.Notes,
          INSERTED.ShiftMoveID, INSERTED.PaymentMethodID
        VALUES
          (@invID, N'ايرادات', @invDate, CONVERT(nvarchar(8), GETDATE(), 108),
           NULL, @expInId, @amount, N'in', @notes, @shiftMoveId, @paymentMethodId)
      `);

      await transaction.commit();
      return NextResponse.json(insertRes.recordset[0], { status: 201 });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch {}
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
