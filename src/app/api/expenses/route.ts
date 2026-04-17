import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { CreateExpensePayload } from '@/lib/types';

// GET /api/expenses — List expenses with optional filters
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const url = new URL(req.url);
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const catId = url.searchParams.get('catId');
    const shiftId = url.searchParams.get('shiftId');
    const today = url.searchParams.get('today'); // "1" = today only

    let whereClause = "WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out'";
    const request = db.request();

    if (today === '1') {
      // Use the current open business day date
      whereClause += ` AND cm.invDate = (SELECT TOP 1 NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC)`;
    } else {
      if (dateFrom) {
        whereClause += ' AND cm.invDate >= @dateFrom';
        request.input('dateFrom', sql.Date, dateFrom);
      }
      if (dateTo) {
        whereClause += ' AND cm.invDate <= @dateTo';
        request.input('dateTo', sql.Date, dateTo);
      }
    }

    if (catId) {
      whereClause += ' AND cm.ExpINID = @catId';
      request.input('catId', sql.Int, parseInt(catId));
    }

    if (shiftId) {
      whereClause += ' AND cm.ShiftMoveID = @shiftId';
      request.input('shiftId', sql.Int, parseInt(shiftId));
    }

    const result = await request.query(`
      SELECT
        cm.ID,
        cm.invID,
        cm.invDate,
        cm.invTime,
        cm.ExpINID,
        ISNULL(cat.CatName, N'—') AS CatName,
        cm.GrandTolal,
        cm.Notes,
        cm.ShiftMoveID,
        cm.PaymentMethodID,
        pm.PaymentMethod,
        u.UserName
      FROM [dbo].[TblCashMove] cm
      LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
      LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      ${whereClause}
      ORDER BY cm.ID DESC
    `);

    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/expenses — Create a new expense (single TblCashMove row)
export async function POST(req: NextRequest) {
  try {
    const body: CreateExpensePayload = await req.json();

    // ──── Validation ────
    if (!body.expINID || body.expINID <= 0) {
      return NextResponse.json({ error: 'يجب اختيار فئة المصروف' }, { status: 400 });
    }
    if (!body.amount || body.amount <= 0) {
      return NextResponse.json({ error: 'يجب إدخال مبلغ صحيح أكبر من صفر' }, { status: 400 });
    }
    if (!body.paymentMethodId) {
      return NextResponse.json({ error: 'يجب اختيار طريقة الدفع' }, { status: 400 });
    }

    // ──── Session enforcement ────
    const sessionUser = await getSession();
    if (!sessionUser) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }
    const userID = sessionUser.UserID;

    const db = await getPool();
    console.log(`[expenses] ──── SAVE EXPENSE START ──── UserID=${userID}`);

    // ──── Enforce active business day ────
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      console.error(`[expenses]   ❌ REJECTED: no active business day`);
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح — لا يمكن تسجيل مصروف' }, { status: 400 });
    }
    const activeDay = dayResult.recordset[0];
    const invDate = activeDay.NewDay;
    console.log(`[expenses]   Active Day: ID=${activeDay.ID}, NewDay=${invDate}`);

    // ──── Enforce active shift for THIS user ────
    const shiftResult = await db.request()
      .input('shiftUserID', sql.Int, userID)
      .query(`
        SELECT TOP 1 ID, UserID, ShiftID FROM [dbo].[TblShiftMove]
        WHERE Status = 1 AND UserID = @shiftUserID
        ORDER BY ID DESC
      `);
    if (shiftResult.recordset.length === 0) {
      console.error(`[expenses]   ❌ REJECTED: no active shift for UserID=${userID}`);
      return NextResponse.json({ error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تسجيل مصروف' }, { status: 400 });
    }
    const activeShift = shiftResult.recordset[0];
    const shiftMoveID = activeShift.ID;
    console.log(`[expenses]   Active Shift: ID=${shiftMoveID}, UserID=${activeShift.UserID}`);

    // ──── Validate category belongs to مصروفات ────
    const catResult = await db.request()
      .input('expINID', sql.Int, body.expINID)
      .query(`
        SELECT ExpINID, CatName FROM [dbo].[TblExpINCat]
        WHERE ExpINID = @expINID AND ExpINType = N'مصروفات'
      `);
    if (catResult.recordset.length === 0) {
      return NextResponse.json({ error: 'فئة المصروف غير صالحة' }, { status: 400 });
    }
    const catName = catResult.recordset[0].CatName;

    // ──── Prepare values ────
    const amount = Math.max(0, body.amount);
    const now = new Date();
    const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
    const notesText = body.notes || catName;

    // ──── Transaction ────
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    console.log(`[expenses]   Transaction started (SERIALIZABLE)`);

    try {
      // Generate safe invID scoped to مصروفات in TblCashMove
      const invIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'مصروفات'
      `);
      const newInvID = invIdResult.recordset[0].newInvID;
      console.log(`[expenses]   Generated invID=${newInvID} for invType=مصروفات`);

      // Insert into TblCashMove
      const cashReq = new sql.Request(transaction);
      cashReq
        .input('invID',           sql.Int,              newInvID)
        .input('invType',         sql.NVarChar(20),     N('مصروفات'))
        .input('invDate',         sql.Date,             invDate)
        .input('invTime',         sql.NVarChar(50),     invTime)
        .input('ClientID',        sql.Int,              null)
        .input('ExpINID',         sql.Int,              body.expINID)
        .input('GrandTolal',      sql.Decimal(10, 2),   amount)
        .input('inOut',           sql.NVarChar(5),      N('out'))
        .input('Notes',           sql.NVarChar(sql.MAX), notesText)
        .input('ShiftMoveID',     sql.Int,              shiftMoveID)
        .input('PaymentMethodID', sql.Int,              body.paymentMethodId);

      await cashReq.query(`
        INSERT INTO [dbo].[TblCashMove] (
          invID, invType, invDate, invTime, ClientID,
          ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID,
          @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
        )
      `);
      console.log(`[expenses]   ✅ TblCashMove inserted: invID=${newInvID}, ExpINID=${body.expINID} (${catName}), GrandTolal=${amount}, inOut=out, ShiftMoveID=${shiftMoveID}`);

      await transaction.commit();
      console.log(`[expenses]   ✅ COMMITTED — invID=${newInvID}`);
      console.log(`[expenses] ──── SAVE EXPENSE COMPLETE ────`);

      return NextResponse.json({ invID: newInvID, catName, amount }, { status: 201 });
    } catch (err) {
      const rollbackReason = err instanceof Error ? err.message : String(err);
      console.error(`[expenses]   ❌ ROLLING BACK — reason: ${rollbackReason}`);
      try { await transaction.rollback(); } catch (rbErr) {
        console.error(`[expenses]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`);
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[expenses] ❌ POST /api/expenses FAILED: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Helper: N() is just identity but clarifies intent for NVarChar literals
function N(s: string) { return s; }
