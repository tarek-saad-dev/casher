import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

type Ctx = { params: Promise<{ id: string }> };

// ─────────────────────── GET /api/incomes/[id] ───────────────────────
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const incomeId = parseInt(id);
    if (isNaN(incomeId)) return NextResponse.json({ error: 'معرف الإيراد غير صالح' }, { status: 400 });

    const db = await getPool();
    const result = await db.request()
      .input('id', sql.Int, incomeId)
      .query(`
        SELECT
          CM.ID, CM.invID, CM.invType, CM.invDate, CM.invTime,
          CM.ExpINID, ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
          CM.GrandTolal AS Amount, CM.inOut, CM.Notes,
          CM.ShiftMoveID, SM.NewDay, U.UserName, S.ShiftName,
          CM.PaymentMethodID, ISNULL(PM.PaymentMethod, N'غير محدد') AS PaymentMethod
        FROM dbo.TblCashMove CM
        LEFT JOIN dbo.TblExpINCat CAT       ON CM.ExpINID        = CAT.ExpINID
        LEFT JOIN dbo.TblShiftMove SM       ON CM.ShiftMoveID    = SM.ID
        LEFT JOIN dbo.TblUser U             ON SM.UserID         = U.UserID
        LEFT JOIN dbo.TblShift S            ON SM.ShiftID        = S.ShiftID
        LEFT JOIN dbo.TblPaymentMethods PM  ON CM.PaymentMethodID = PM.PaymentID
        WHERE CM.ID = @id AND CM.invType = N'ايرادات'
      `);

    if (result.recordset.length === 0)
      return NextResponse.json({ error: 'الإيراد غير موجود' }, { status: 404 });

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/[id]] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────── PATCH /api/incomes/[id] ───────────────────────
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const { id } = await params;
    const incomeId = parseInt(id);
    if (isNaN(incomeId)) return NextResponse.json({ error: 'معرف الإيراد غير صالح' }, { status: 400 });

    const body = await req.json();
    const { invDate, amount, expInId, paymentMethodId, notes, shiftMoveId } = body;

    if (!invDate) return NextResponse.json({ error: 'التاريخ مطلوب' }, { status: 400 });
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'قيمة الإيراد يجب أن تكون أكبر من صفر' }, { status: 400 });
    if (!expInId) return NextResponse.json({ error: 'يجب اختيار تصنيف الإيراد' }, { status: 400 });
    if (!paymentMethodId) return NextResponse.json({ error: 'يجب اختيار طريقة الدفع' }, { status: 400 });

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // Verify record exists and is ايرادات
      const existsRes = await new sql.Request(transaction)
        .input('id', sql.Int, incomeId)
        .query(`SELECT 1 FROM dbo.TblCashMove WHERE ID = @id AND invType = N'ايرادات'`);
      if (existsRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'الإيراد غير موجود' }, { status: 404 });
      }

      // Validate category
      const catRes = await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expInId`);
      if (catRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'تصنيف الإيراد غير موجود' }, { status: 400 });
      }

      // Validate payment method
      const pmRes = await new sql.Request(transaction)
        .input('pmId', sql.Int, paymentMethodId)
        .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId`);
      if (pmRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'طريقة الدفع غير موجودة' }, { status: 400 });
      }

      // Update
      const updateRes = await new sql.Request(transaction)
        .input('id',             sql.Int,              incomeId)
        .input('invDate',        sql.Date,             invDate)
        .input('expInId',        sql.Int,              expInId)
        .input('amount',         sql.Decimal(10, 2),   Number(amount))
        .input('notes',          sql.NVarChar(sql.MAX), notes?.trim() || null)
        .input('paymentMethodId',sql.Int,              paymentMethodId)
        .input('shiftMoveId',    sql.Int,              shiftMoveId ?? null)
        .query(`
          UPDATE dbo.TblCashMove
          SET
            invDate         = @invDate,
            ExpINID         = @expInId,
            GrandTolal      = @amount,
            Notes           = @notes,
            PaymentMethodID = @paymentMethodId,
            ShiftMoveID     = COALESCE(@shiftMoveId, ShiftMoveID)
          OUTPUT
            INSERTED.ID, INSERTED.invID, INSERTED.invDate, INSERTED.invTime,
            INSERTED.ExpINID, INSERTED.GrandTolal AS Amount,
            INSERTED.Notes, INSERTED.ShiftMoveID, INSERTED.PaymentMethodID
          WHERE ID = @id AND invType = N'ايرادات'
        `);

      await transaction.commit();
      return NextResponse.json(updateRes.recordset[0]);
    } catch (innerErr) {
      try { await transaction.rollback(); } catch {}
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/[id]] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────── DELETE /api/incomes/[id] ───────────────────────
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const { id } = await params;
    const incomeId = parseInt(id);
    if (isNaN(incomeId)) return NextResponse.json({ error: 'معرف الإيراد غير صالح' }, { status: 400 });

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const existsRes = await new sql.Request(transaction)
        .input('id', sql.Int, incomeId)
        .query(`SELECT ID, invID, invDate, GrandTolal FROM dbo.TblCashMove WHERE ID = @id AND invType = N'ايرادات'`);
      if (existsRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'الإيراد غير موجود أو ليس من نوع إيرادات' }, { status: 404 });
      }

      const deleted = await new sql.Request(transaction)
        .input('id', sql.Int, incomeId)
        .query(`
          DELETE FROM dbo.TblCashMove
          OUTPUT DELETED.ID, DELETED.invID, DELETED.invDate, DELETED.GrandTolal AS Amount, DELETED.Notes
          WHERE ID = @id AND invType = N'ايرادات'
        `);

      await transaction.commit();
      return NextResponse.json({ success: true, deleted: deleted.recordset[0] });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch {}
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
