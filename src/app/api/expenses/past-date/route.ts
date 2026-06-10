import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRole, isAuthResult } from '@/lib/api-auth';

// POST /api/expenses/past-date - Add expense for past dates
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager', 'accountant']);
  if (!isAuthResult(auth)) return auth;

  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const body = await req.json();
    const { invDate, invTime, amount, expINID, paymentMethodId, notes } = body;

    // Validation
    if (!invDate)
      return NextResponse.json({ error: "التاريخ مطلوب" }, { status: 400 });
    if (!amount || Number(amount) <= 0)
      return NextResponse.json(
        { error: "قيمة المصروف يجب أن تكون أكبر من صفر" },
        { status: 400 },
      );
    if (!expINID)
      return NextResponse.json(
        { error: "يجب اختيار تصنيف المصروف" },
        { status: 400 },
      );
    if (!paymentMethodId)
      return NextResponse.json(
        { error: "يجب اختيار طريقة الدفع" },
        { status: 400 },
      );

    // Validate that the date is in the past or today
    const inputDate = new Date(invDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (inputDate > today) {
      return NextResponse.json(
        { error: "لا يمكن إضافة مصروف لتاريخ في المستقبل" },
        { status: 400 },
      );
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1. Validate category exists and is expense type
      const catResult = await new sql.Request(transaction).input(
        "expINID",
        sql.Int,
        expINID,
      ).query(`
          SELECT ExpINID, CatName FROM [dbo].[TblExpINCat]
          WHERE ExpINID = @expINID AND ExpINType = N'مصروفات'
        `);

      if (catResult.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json(
          { error: "فئة المصروف غير صالحة" },
          { status: 400 },
        );
      }
      const catName = catResult.recordset[0].CatName;

      // 2. Generate safe invID scoped to مصروفات in TblCashMove
      const invIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'مصروفات'
      `);
      const newInvID = invIdResult.recordset[0].newInvID;

      // 3. Prepare values
      const finalAmount = Math.max(0, Number(amount));
      const finalInvTime = invTime || "12:00";
      const notesText = notes?.trim() || catName;

      // 4. Insert into TblCashMove for past date
      const cashReq = new sql.Request(transaction);
      cashReq
        .input("invID", sql.Int, newInvID)
        .input("invType", sql.NVarChar(20), "مصروفات")
        .input("invDate", sql.Date, invDate)
        .input("invTime", sql.NVarChar(50), finalInvTime)
        .input("ClientID", sql.Int, null)
        .input("expINID", sql.Int, expINID)
        .input("amount", sql.Decimal(10, 2), finalAmount)
        .input("inOut", sql.NVarChar(10), "out")
        .input("notes", sql.NVarChar(sql.MAX), notesText)
        .input("shiftMoveID", sql.Int, null) // No shift for past dates
        .input("paymentMethodID", sql.Int, paymentMethodId); // Use provided payment method

      const insertResult = await cashReq.query(`
        INSERT INTO [dbo].[TblCashMove]
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        OUTPUT
          INSERTED.ID, INSERTED.invID, INSERTED.invDate, INSERTED.invTime,
          INSERTED.ExpINID, INSERTED.GrandTolal AS Amount, INSERTED.Notes
        VALUES
          (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
      `);

      await transaction.commit();

      const newRecord = insertResult.recordset[0];

      return NextResponse.json({
        success: true,
        message: "تم إضافة المصروف للتاريخ المحدد بنجاح",
        data: {
          ID: newRecord.ID,
          invID: newRecord.invID,
          invDate: newRecord.invDate,
          invTime: newRecord.invTime,
          ExpINID: newRecord.ExpINID,
          Amount: newRecord.Amount,
          Notes: newRecord.Notes,
          CreatedByUserID: newRecord.CreatedByUserID,
          CategoryName: catName,
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/expenses/past-date] POST error:", message);
    return NextResponse.json(
      { error: "فشل إضافة المصروف: " + message },
      { status: 500 },
    );
  }
}
