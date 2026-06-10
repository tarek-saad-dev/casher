import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRole, isAuthResult } from '@/lib/api-auth';
import { requireApprovalOrExecute } from '@/lib/approvalWorkflow';

// POST /api/treasury/transfer — Transfer amount between payment methods
// Body: { amount: number, fromPaymentMethodId: number, toPaymentMethodId: number, notes?: string, transferDate?: string }
// If transferDate is provided, creates transfer for that date (past date support)
// If no transferDate, enforces active business day and shift
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRole(['admin', 'manager', 'accountant']);
    if (!isAuthResult(auth)) return auth; // 401 or 403
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const body = await req.json();
    const {
      transferDate,
      amount,
      fromPaymentMethodId,
      toPaymentMethodId,
      notes,
    } = body;

    // Validation
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "المبلغ يجب أن يكون أكبر من صفر" },
        { status: 400 },
      );
    }
    if (!fromPaymentMethodId) {
      return NextResponse.json(
        { error: "طريقة الدفع المصدر مطلوبة" },
        { status: 400 },
      );
    }
    if (!toPaymentMethodId) {
      return NextResponse.json(
        { error: "طريقة الدفع الهدف مطلوبة" },
        { status: 400 },
      );
    }
    if (fromPaymentMethodId === toPaymentMethodId) {
      return NextResponse.json(
        { error: "يجب اختيار طرق دفع مختلفة" },
        { status: 400 },
      );
    }

    // Approval workflow check
    const workflow = await requireApprovalOrExecute({
      userId:      session.UserID,
      userName:    session.UserName,
      requestType: 'treasury_transfer',
      actionMethod:'TRANSFER',
      endpointPath:'/api/treasury/transfer',
      newData: { amount, fromPaymentMethodId, toPaymentMethodId, notes, transferDate, userId: session.UserID },
      riskLevel: 'high',
    });
    if (workflow.pendingApproval)
      return NextResponse.json({ success: true, pendingApproval: true, approvalId: workflow.approvalId, message: workflow.message });
    if (workflow.executed)
      return NextResponse.json({ success: true, message: workflow.message });

    const db = await getPool();

    let invDate: Date;
    let shiftMoveID: number | null = null;
    let invTime: string;

    if (transferDate) {
      // Past date transfer mode - validate date is not in future
      const inputDate = new Date(transferDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      if (inputDate > today) {
        return NextResponse.json(
          { error: "لا يمكن التحويل لتاريخ في المستقبل" },
          { status: 400 },
        );
      }
      invDate = inputDate;
      invTime = "12:00";
    } else {
      // Current day transfer mode - enforce active business day and shift
      const dayResult = await db.request().query(`
        SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
      `);
      if (dayResult.recordset.length === 0) {
        return NextResponse.json(
          { error: "لا يوجد يوم عمل مفتوح — لا يمكن تنفيذ التحويل" },
          { status: 400 },
        );
      }
      const activeDay = dayResult.recordset[0];
      invDate = activeDay.NewDay;

      // Enforce active shift for THIS user
      const shiftResult = await db.request()
        .input("shiftUserID", sql.Int, session.UserID)
        .query(`
          SELECT TOP 1 ID, UserID, ShiftID FROM [dbo].[TblShiftMove]
          WHERE Status = 1 AND UserID = @shiftUserID
          ORDER BY ID DESC
        `);
      if (shiftResult.recordset.length === 0) {
        return NextResponse.json(
          { error: "لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تنفيذ التحويل" },
          { status: 400 },
        );
      }
      const activeShift = shiftResult.recordset[0];
      shiftMoveID = activeShift.ID;

      const now = new Date();
      invTime = `${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}`;
    }

    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1. Validate payment methods exist
      const pmCheck = await new sql.Request(transaction)
        .input("fromPmId", sql.Int, fromPaymentMethodId)
        .input("toPmId", sql.Int, toPaymentMethodId)
        .query(`
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

      // 2. Get or create transfer categories
      let transferIncomeCategory: number;
      let transferExpenseCategory: number;

      if (transferDate) {
        // For past date transfers, use hardcoded or first available categories
        const incomeCatRes = await new sql.Request(transaction).query(`
          SELECT TOP 1 ExpINID 
          FROM dbo.TblExpINCat 
          WHERE ExpINType = N'ايرادات' AND (CatName LIKE N'%تحويل%' OR IsActive = 1)
          ORDER BY CASE WHEN CatName LIKE N'%تحويل%' THEN 0 ELSE 1 END, ExpINID
        `);
        if (incomeCatRes.recordset.length === 0) {
          await transaction.rollback();
          return NextResponse.json(
            { error: "لا توجد تصنيفات إيرادات صالحة للتحويل" },
            { status: 400 },
          );
        }
        transferIncomeCategory = incomeCatRes.recordset[0].ExpINID;

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
        transferExpenseCategory = expenseCatRes.recordset[0].ExpINID;
      } else {
        // For current transfers, get/create transfer categories
        let expCatResult = await new sql.Request(transaction).query(`
          SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
          WHERE ExpINType = N'مصروفات' AND CatName LIKE N'%تحويل%'
        `);

        if (expCatResult.recordset.length === 0) {
          const insertCat = await new sql.Request(transaction).query(`
            INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
            OUTPUT INSERTED.ExpINID
            VALUES (N'تحويل بين طرق الدفع', N'مصروفات')
          `);
          transferExpenseCategory = insertCat.recordset[0].ExpINID;
        } else {
          transferExpenseCategory = expCatResult.recordset[0].ExpINID;
        }

        let incCatResult = await new sql.Request(transaction).query(`
          SELECT TOP 1 ExpINID FROM [dbo].[TblExpINCat]
          WHERE ExpINType = N'ايرادات' AND CatName LIKE N'%تحويل%'
        `);

        if (incCatResult.recordset.length === 0) {
          const insertCat = await new sql.Request(transaction).query(`
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
        notes?.trim() ||
        `تحويل من ${fromPm?.PaymentMethod} إلى ${toPm?.PaymentMethod}`;

      // 3. Generate invID for expense (out)
      const expenseInvIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'مصروفات'
      `);
      const expenseInvID = expenseInvIdResult.recordset[0].newInvID;

      // 4. Generate invID for income (in)
      const incomeInvIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblCashMove] WITH (TABLOCKX)
        WHERE invType = N'ايرادات'
      `);
      const incomeInvID = incomeInvIdResult.recordset[0].newInvID;

      // 5. Create expense record (money coming out of source payment method)
      const expenseReq = new sql.Request(transaction);
      expenseReq
        .input("invID", sql.Int, expenseInvID)
        .input("invType", sql.NVarChar(20), "مصروفات")
        .input("invDate", sql.Date, invDate)
        .input("invTime", sql.NVarChar(50), invTime)
        .input("ClientID", sql.Int, null)
        .input("expINID", sql.Int, transferExpenseCategory)
        .input("amount", sql.Decimal(10, 2), transferAmount)
        .input("inOut", sql.NVarChar(10), "out")
        .input(
          "notes",
          sql.NVarChar(sql.MAX),
          transferDate
            ? `تحويل إلى ${toPm?.PaymentMethod}: ${transferNotes}`
            : `${transferNotes} (تحويل إلى ${toPm?.PaymentMethod})`,
        )
        .input("shiftMoveID", sql.Int, shiftMoveID)
        .input("paymentMethodID", sql.Int, fromPaymentMethodId);

      const expInsert = await expenseReq.query(`
        INSERT INTO [dbo].[TblCashMove]
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        OUTPUT INSERTED.ID
        VALUES
          (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
      `);
      const expenseId = expInsert.recordset[0].ID;

      // 6. Create income record (money going into target payment method)
      const incomeReq = new sql.Request(transaction);
      incomeReq
        .input("invID", sql.Int, incomeInvID)
        .input("invType", sql.NVarChar(20), "ايرادات")
        .input("invDate", sql.Date, invDate)
        .input("invTime", sql.NVarChar(50), invTime)
        .input("ClientID", sql.Int, null)
        .input("expINID", sql.Int, transferIncomeCategory)
        .input("amount", sql.Decimal(10, 2), transferAmount)
        .input("inOut", sql.NVarChar(10), "in")
        .input(
          "notes",
          sql.NVarChar(sql.MAX),
          transferDate
            ? `تحويل من ${fromPm?.PaymentMethod}: ${transferNotes}`
            : `${transferNotes} (تحويل من ${fromPm?.PaymentMethod})`,
        )
        .input("shiftMoveID", sql.Int, shiftMoveID)
        .input("paymentMethodID", sql.Int, toPaymentMethodId);

      const incInsert = await incomeReq.query(`
        INSERT INTO [dbo].[TblCashMove]
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        OUTPUT INSERTED.ID
        VALUES
          (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
      `);
      const incomeId = incInsert.recordset[0].ID;

      await transaction.commit();

      return NextResponse.json({
        success: true,
        message: "تم التحويل بنجاح",
        expenseId,
        incomeId,
        expenseInvID,
        incomeInvID,
        amount: transferAmount,
        fromPaymentMethod: fromPm?.PaymentMethod,
        toPaymentMethod: toPm?.PaymentMethod,
        notes: transferNotes,
        transferDate: transferDate || invDate,
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
