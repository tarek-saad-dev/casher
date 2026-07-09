import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql, allocateInvID } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  EmployeeLedgerDualWriteError,
  formatLedgerEntryDate,
  syncAdvanceLedgerForDeductionCashMove,
} from '@/lib/services/employeeLedgerDualWrite';
import { scheduleEmployeeAdvanceWhatsApp } from '@/lib/services/employeeAdvanceWhatsAppNotify';

// GET /api/deductions — List employee deductions with optional filters
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const url = new URL(req.url);
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const employeeId = url.searchParams.get('employeeId');
    const today = url.searchParams.get('today'); // "1" = today only
    const paymentMethodId = url.searchParams.get('paymentMethodId');

    let whereClause = "WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out' AND cat.CatName LIKE N'%سلف%'";
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

    if (employeeId) {
      whereClause += ' AND EXISTS (SELECT 1 FROM dbo.TblExpCatEmpMap m WHERE m.ExpINID = cm.ExpINID AND m.EmpID = @employeeId AND m.TxnKind = N\'advance\')';
      request.input('employeeId', sql.Int, parseInt(employeeId));
    }

    if (paymentMethodId && paymentMethodId !== 'all') {
      whereClause += ' AND cm.PaymentMethodID = @paymentMethodId';
      request.input('paymentMethodId', sql.Int, parseInt(paymentMethodId));
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
        u.UserName,
        emp.EmpID,
        emp.EmpName
      FROM [dbo].[TblCashMove] cm
      LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
      LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      LEFT JOIN [dbo].[TblExpCatEmpMap map ON cm.ExpINID = map.ExpINID AND map.TxnKind = N\'advance\'
      LEFT JOIN [dbo].[TblEmp] emp ON map.EmpID = emp.EmpID
      ${whereClause}
      ORDER BY cm.ID DESC
    `);

    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/deductions] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/deductions — Create a new deduction (employee loan + corresponding income)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ──── Validation ────
    if (!body.employeeId || body.employeeId <= 0) {
      return NextResponse.json({ error: 'يجب اختيار الموظف' }, { status: 400 });
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
    console.log(`[deductions] ──── SAVE DEDUCTION START ──── UserID=${userID}, EmployeeID=${body.employeeId}`);

    // ──── Enforce active business day ────
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      console.error(`[deductions]   ❌ REJECTED: no active business day`);
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح — لا يمكن تسجيل خصم' }, { status: 400 });
    }
    const activeDay = dayResult.recordset[0];
    const invDate = activeDay.NewDay;
    console.log(`[deductions]   Active Day: ID=${activeDay.ID}, NewDay=${invDate}`);

    // ──── Enforce active shift for THIS user ────
    const shiftResult = await db.request()
      .input('shiftUserID', sql.Int, userID)
      .query(`
        SELECT TOP 1 ID, UserID, ShiftID FROM [dbo].[TblShiftMove]
        WHERE Status = 1 AND UserID = @shiftUserID
        ORDER BY ID DESC
      `);
    if (shiftResult.recordset.length === 0) {
      console.error(`[deductions]   ❌ REJECTED: no active shift for UserID=${userID}`);
      return NextResponse.json({ error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تسجيل خصم' }, { status: 400 });
    }
    const activeShift = shiftResult.recordset[0];
    const shiftMoveID = activeShift.ID;
    console.log(`[deductions]   Active Shift: ID=${shiftMoveID}, UserID=${activeShift.UserID}`);

    // ──── Get employee info and advance category ────
    const empResult = await db.request()
      .input('employeeId', sql.Int, body.employeeId)
      .query(`
        SELECT e.EmpID, e.EmpName, 
               adv.ExpINID AS AdvanceExpINID, adv.CatName AS AdvanceCatName
        FROM dbo.TblEmp e
        OUTER APPLY (
          SELECT TOP 1 m.ExpINID, cat.CatName
          FROM dbo.TblExpCatEmpMap m
          JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
          WHERE m.EmpID = e.EmpID AND m.TxnKind = N\'advance\' AND m.IsActive = 1
            AND cat.ExpINType = N'مصروفات'
          ORDER BY m.ModifiedDate DESC, m.ID DESC
        ) adv
        WHERE e.EmpID = @employeeId AND ISNULL(e.isActive, 1) = 1
      `);

    if (empResult.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود أو غير نشط' }, { status: 400 });
    }

    const employee = empResult.recordset[0];
    if (!employee.AdvanceExpINID) {
      return NextResponse.json({ error: 'لم يتم العثور على تصنيف سلف للموظف' }, { status: 400 });
    }

    // ──── Get or create "معادلة" income category ────
    let settlementExpINID: number = 0;
    const settlementCatName = 'معادلة';
    
    const existSettlementCat = await db.request()
      .input('catName', sql.NVarChar(200), settlementCatName)
      .input('expType', sql.NVarChar(50), 'ايرادات')
      .query(`
        SELECT ExpINID FROM dbo.TblExpINCat
        WHERE CatName = @catName AND ExpINType = @expType
      `);

    if (existSettlementCat.recordset.length > 0) {
      settlementExpINID = existSettlementCat.recordset[0].ExpINID;
    } else {
      const catRes = await db.request()
        .input('catName', sql.NVarChar(200), settlementCatName)
        .input('expType', sql.NVarChar(50), 'ايرادات')
        .query(`
          INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
          OUTPUT INSERTED.ExpINID
          VALUES (@catName, @expType)
        `);
      settlementExpINID = catRes.recordset[0].ExpINID;
    }

    // ──── Prepare values ────
    const amount = Math.max(0, body.amount);
    const now = new Date();
    const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
    const notesText = body.notes || `خصم من راتب ${employee.EmpName}`;

    // ──── Transaction ────
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    console.log(`[deductions]   Transaction started (SERIALIZABLE)`);

    try {
      // Allocate invID safely (no TABLOCKX)
      const deductionInvID = await allocateInvID(transaction, 'TblCashMove', 'مصروفات', 5000);

      // Insert deduction (employee loan)
      const deductionReq = new sql.Request(transaction);
      deductionReq
        .input('invID',           sql.Int,              deductionInvID)
        .input('invType',         sql.NVarChar(20),     N('مصروفات'))
        .input('invDate',         sql.Date,             invDate)
        .input('invTime',         sql.NVarChar(50),     invTime)
        .input('ClientID',        sql.Int,              null)
        .input('ExpINID',         sql.Int,              employee.AdvanceExpINID)
        .input('GrandTolal',      sql.Decimal(10, 2),   amount)
        .input('inOut',           sql.NVarChar(5),      N('out'))
        .input('Notes',           sql.NVarChar(sql.MAX), notesText)
        .input('ShiftMoveID',     sql.Int,              shiftMoveID)
        .input('PaymentMethodID', sql.Int,              body.paymentMethodId);

      const deductionResult = await deductionReq.query(`
        INSERT INTO [dbo].[TblCashMove] (
          invID, invType, invDate, invTime, ClientID,
          ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
        )
        OUTPUT INSERTED.ID
        VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID,
          @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
        )
      `);
      const deductionCashMoveId = deductionResult.recordset[0].ID as number;
      console.log(`[deductions]   ✅ Deduction inserted: invID=${deductionInvID}, cashMoveId=${deductionCashMoveId}, Employee=${employee.EmpName}, Amount=${amount}`);

      const ledgerResult = await syncAdvanceLedgerForDeductionCashMove(db, transaction, {
        empId: employee.EmpID,
        cashMoveId: deductionCashMoveId,
        entryDate: formatLedgerEntryDate(invDate),
        amount,
        createdByUserId: userID,
      });

      // Allocate income invID safely (no TABLOCKX)
      const incomeInvID = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

      // Insert corresponding income (معادلة)
      const incomeReq = new sql.Request(transaction);
      incomeReq
        .input('invID',           sql.Int,              incomeInvID)
        .input('invType',         sql.NVarChar(20),     N('ايرادات'))
        .input('invDate',         sql.Date,             invDate)
        .input('invTime',         sql.NVarChar(50),     invTime)
        .input('ClientID',        sql.Int,              null)
        .input('ExpINID',         sql.Int,              settlementExpINID)
        .input('GrandTolal',      sql.Decimal(10, 2),   amount)
        .input('inOut',           sql.NVarChar(5),      N('in'))
        .input('Notes',           sql.NVarChar(sql.MAX), `معادلة خصم ${employee.EmpName}`)
        .input('ShiftMoveID',     sql.Int,              shiftMoveID)
        .input('PaymentMethodID', sql.Int,              body.paymentMethodId);

      await incomeReq.query(`
        INSERT INTO [dbo].[TblCashMove] (
          invID, invType, invDate, invTime, ClientID,
          ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID,
          @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
        )
      `);
      console.log(`[deductions]   ✅ Settlement income inserted: invID=${incomeInvID}, Amount=${amount}`);

      await transaction.commit();
      console.log(`[deductions]   ✅ COMMITTED — deductionInvID=${deductionInvID}, incomeInvID=${incomeInvID}`);
      console.log(`[deductions] ──── SAVE DEDUCTION COMPLETE ────`);

      scheduleEmployeeAdvanceWhatsApp({
        empId: employee.EmpID,
        employeeName: employee.EmpName,
        invID: deductionInvID,
        amount,
        paymentMethodId: body.paymentMethodId,
        notes: notesText,
      });

      return NextResponse.json({
        deductionInvID,
        deductionCashMoveId,
        incomeInvID,
        employeeName: employee.EmpName,
        categoryName: employee.AdvanceCatName,
        amount,
        ledgerDualWrite: ledgerResult.ledgerDualWrite,
        ledgerSync: ledgerResult.outcome ?? null,
      }, { status: 201 });
    } catch (err) {
      if (err instanceof EmployeeLedgerDualWriteError) {
        const rollbackReason = err.message;
        console.error(`[deductions]   ❌ ROLLING BACK — ledger error: ${rollbackReason}`);
        try { await transaction.rollback(); } catch (rbErr) {
          console.error(`[deductions]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`);
        }
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      const rollbackReason = err instanceof Error ? err.message : String(err);
      console.error(`[deductions]   ❌ ROLLING BACK — reason: ${rollbackReason}`);
      try { await transaction.rollback(); } catch (rbErr) {
        console.error(`[deductions]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`);
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[deductions] ❌ POST /api/deductions FAILED: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Helper: N() is just identity but clarifies intent for NVarChar literals
function N(s: string) { return s; }
