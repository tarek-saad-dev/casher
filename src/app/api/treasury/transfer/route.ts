import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// POST /api/treasury/transfer - Transfer between payment methods on past date
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json(
        { error: "يجب تسجيل الدخول أولاً" },
        { status: 401 },
      );

    const body = await req.json();
    const {
      transferDate,
      amount,
      fromPaymentMethodId,
      toPaymentMethodId,
      notes,
    } = body;

    // Validation
    if (!transferDate)
      return NextResponse.json({ error: "التاريخ مطلوب" }, { status: 400 });
    if (!amount || Number(amount) <= 0)
      return NextResponse.json(
        { error: "المبلغ يجب أن يكون أكبر من صفر" },
        { status: 400 },
      );
    if (!fromPaymentMethodId)
      return NextResponse.json(
        { error: "طريقة الدفع المصدر مطلوبة" },
        { status: 400 },
      );
    if (!toPaymentMethodId)
      return NextResponse.json(
        { error: "طريقة الدفع الهدف مطلوبة" },
        { status: 400 },
      );

    if (fromPaymentMethodId === toPaymentMethodId) {
      return NextResponse.json(
        { error: "يجب اختيار طرق دفع مختلفة" },
        { status: 400 },
      );
    }

    // Validate that the date is in the past or today
    const inputDate = new Date(transferDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (inputDate > today) {
      return NextResponse.json(
        { error: "لا يمكن التحويل لتاريخ في المستقبل" },
        { status: 400 },
      );
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1. Validate payment methods exist
      const pmCheck = await new sql.Request(transaction)
        .input("fromPmId", sql.Int, fromPaymentMethodId)
        .input("toPmId", sql.Int, toPaymentMethodId).query(`
          SELECT PaymentID, PaymentMethod 
          FROM dbo.TblPaymentMethods 
          WHERE PaymentID IN (@fromPmId, @toPmId)
        `);

      if (pmCheck.recordset.length !== 2) {
        await transaction.rollback();
        return NextResponse.json(
          { error: "إحدى طرق الدفع غير موجودة" },
          { status: 400 },
        );
      }

      const fromPm = pmCheck.recordset.find(
        (pm) => pm.PaymentID === fromPaymentMethodId,
      );
      const toPm = pmCheck.recordset.find(
        (pm) => pm.PaymentID === toPaymentMethodId,
      );

      // 2. Get valid transfer categories
      const transferIncomeCategory = 2069; // Specific income category for transfers

      const expenseCatRes = await new sql.Request(transaction).query(`
        SELECT TOP 1 ExpINID 
        FROM dbo.TblExpINCat 
        WHERE ExpINType = N'مصروفات' AND IsActive = 1
        ORDER BY ExpINID
      `);

      if (expenseCatRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json(
          { error: "لا توجد تصنيفات مصروفات صالحة للتحويل" },
          { status: 400 },
        );
      }

      const transferExpenseCategory = expenseCatRes.recordset[0].ExpINID;

      // 3. Generate invIDs for both transactions
      const expenseInvIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'مصروفات'
      `);
      const expenseInvID = expenseInvIdResult.recordset[0].newInvID;

      const incomeInvIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'ايرادات'
      `);
      const incomeInvID = incomeInvIdResult.recordset[0].newInvID;

      const transferAmount = Number(amount);
      const transferNotes =
        notes?.trim() ||
        `تحويل من ${fromPm?.PaymentMethod} إلى ${toPm?.PaymentMethod}`;

      // 4. Create expense record (money coming out of source payment method)
      const expenseReq = new sql.Request(transaction);
      expenseReq
        .input("invID", sql.Int, expenseInvID)
        .input("invType", sql.NVarChar(20), "مصروفات")
        .input("invDate", sql.Date, transferDate)
        .input("invTime", sql.NVarChar(50), "12:00")
        .input("ClientID", sql.Int, null)
        .input("expINID", sql.Int, transferExpenseCategory)
        .input("amount", sql.Decimal(10, 2), transferAmount)
        .input("inOut", sql.NVarChar(10), "out")
        .input(
          "notes",
          sql.NVarChar(sql.MAX),
          `تحويل إلى ${toPm?.PaymentMethod}: ${transferNotes}`,
        )
        .input("shiftMoveID", sql.Int, null)
        .input("paymentMethodID", sql.Int, fromPaymentMethodId);

      await expenseReq.query(`
        INSERT INTO [dbo].[TblCashMove]
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        VALUES
          (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
      `);

      // 5. Create income record (money going into target payment method)
      const incomeReq = new sql.Request(transaction);
      incomeReq
        .input("invID", sql.Int, incomeInvID)
        .input("invType", sql.NVarChar(20), "ايرادات")
        .input("invDate", sql.Date, transferDate)
        .input("invTime", sql.NVarChar(50), "12:00")
        .input("ClientID", sql.Int, null)
        .input("expINID", sql.Int, transferIncomeCategory)
        .input("amount", sql.Decimal(10, 2), transferAmount)
        .input("inOut", sql.NVarChar(10), "in")
        .input(
          "notes",
          sql.NVarChar(sql.MAX),
          `تحويل من ${fromPm?.PaymentMethod}: ${transferNotes}`,
        )
        .input("shiftMoveID", sql.Int, null)
        .input("paymentMethodID", sql.Int, toPaymentMethodId);

      await incomeReq.query(`
        INSERT INTO [dbo].[TblCashMove]
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        VALUES
          (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
      `);

      await transaction.commit();

      return NextResponse.json({
        success: true,
        message: "تم التحويل بنجاح",
        data: {
          transferDate,
          amount: transferAmount,
          fromPaymentMethod: fromPm?.PaymentMethod,
          toPaymentMethod: toPm?.PaymentMethod,
          expenseInvID,
          incomeInvID,
          notes: transferNotes,
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/treasury/transfer] POST error:", message);
    return NextResponse.json(
      { error: "فشل التحويل: " + message },
      { status: 500 },
    );
  }
}
