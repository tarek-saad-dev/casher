import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const CAT_NAME  = 'يوميات الموظفين';
const CAT_TYPE  = 'مصروفات';

interface PendingRow {
  ID:         number;
  EmpID:      number;
  EmpName:    string;
  DailyWage:  number;
  Notes:      string | null;
}

interface RepairRow {
  ID:         number;
  EmpID:      number;
  EmpName:    string;
  CashMoveID: number;
  DailyWage:  number;
}

interface EmpMapping {
  EmpID:           number;
  RevenueExpINID:  number;
  RevenueCatName:  string;
}

// POST /api/payroll/daily/post-to-cash
// Body: { workDate: "YYYY-MM-DD" }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workDate } = body;

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const payrollMonth = workDate.substring(0, 7) + '-01';
    const nowTime      = new Date().toTimeString().substring(0, 5);
    const db           = await getPool();

    // ── 1. Ensure expense category exists (CatName + ExpINType only, no Description) ──
    const catCheck = await db.request()
      .input('CatName',   sql.NVarChar(200), CAT_NAME)
      .input('ExpINType', sql.NVarChar(50),  CAT_TYPE)
      .query(`SELECT ExpINID FROM dbo.TblExpINCat WHERE CatName = @CatName AND ExpINType = @ExpINType`);

    let expenseExpINID: number;
    if (catCheck.recordset.length > 0) {
      expenseExpINID = catCheck.recordset[0].ExpINID;
    } else {
      const catIns = await db.request()
        .input('CatName',   sql.NVarChar(200), CAT_NAME)
        .input('ExpINType', sql.NVarChar(50),  CAT_TYPE)
        .query(`INSERT INTO dbo.TblExpINCat (CatName, ExpINType) OUTPUT INSERTED.ExpINID VALUES (@CatName, @ExpINType);`);
      expenseExpINID = catIns.recordset[0].ExpINID;
    }

    // ── 2. Find fully-unposted Earned rows (Status=Earned, CashMoveID IS NULL, EmployeeIncomeCashMoveID IS NULL) ──
    const pendingResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT p.ID, p.EmpID, e.EmpName, p.DailyWage, p.Notes
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        WHERE p.WorkDate = @WorkDate
          AND p.Status   IN (N'Generated', N'Earned')
          AND p.CashMoveID IS NULL
          AND ISNULL(p.EmployeeIncomeCashMoveID, 0) = 0
      `);
    const pendingRows: PendingRow[] = pendingResult.recordset;

    // ── 3. Find repair rows (PostedToCashMove, CashMoveID set, EmployeeIncomeCashMoveID NULL) ──
    const repairResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT p.ID, p.EmpID, e.EmpName, p.CashMoveID, p.DailyWage
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        WHERE p.WorkDate   = @WorkDate
          AND p.Status     = N'PostedToCashMove'
          AND p.CashMoveID IS NOT NULL
          AND ISNULL(p.EmployeeIncomeCashMoveID, 0) = 0
      `);
    const repairRows: RepairRow[] = repairResult.recordset;

    if (pendingRows.length === 0 && repairRows.length === 0) {
      return NextResponse.json({
        success:     true,
        workDate,
        postedCount: 0,
        repairedCount: 0,
        message:     'لا توجد يوميات مكتسبة غير محولة أو تحتاج إصلاح لهذا اليوم',
      });
    }

    // ── 4. Load revenue mappings for all affected employees ──────────────────
    const allEmpIDs = [
      ...new Set([
        ...pendingRows.map(r => r.EmpID),
        ...repairRows.map(r => r.EmpID),
      ]),
    ];

    const mappingResult = await db.request()
      .query(`
        SELECT m.EmpID, e.EmpName, m.ExpINID AS RevenueExpINID, c.CatName AS RevenueCatName
        FROM dbo.TblExpCatEmpMap m
        INNER JOIN dbo.TblEmp e        ON e.EmpID    = m.EmpID
        INNER JOIN dbo.TblExpINCat c   ON c.ExpINID  = m.ExpINID
        WHERE m.EmpID    IN (${allEmpIDs.join(',')})
          AND m.TxnKind  = N'revenue'
          AND m.IsActive = 1
      `);
    const mappings: EmpMapping[] = mappingResult.recordset;
    const mappingMap = new Map<number, EmpMapping>(mappings.map(m => [m.EmpID, m]));

    // ── 5. Validate: all pending rows must have a revenue mapping ─────────────
    const missingMapping = pendingRows.filter(r => !mappingMap.has(r.EmpID));
    if (missingMapping.length > 0) {
      return NextResponse.json({
        error: 'بعض الموظفين لا يملكون تصنيف إيراد مربوط — لم يتم الترحيل',
        missingEmployees: missingMapping.map(r => ({ EmpID: r.EmpID, EmpName: r.EmpName })),
      }, { status: 400 });
    }

    // ── 6. Fetch current max invID to assign business document numbers ────────
    const maxInvIDResult = await db.request()
      .query(`SELECT ISNULL(MAX(invID), 0) AS maxInvID FROM dbo.TblCashMove`);
    let nextInvID: number = (maxInvIDResult.recordset[0].maxInvID as number) + 1;

    // ── 7. Process inside a single transaction ────────────────────────────────
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      let postedCount    = 0;
      let repairedCount  = 0;
      let skippedCount   = 0;
      const missingMappings: Array<{ EmpID: number; EmpName: string }> = [];

      // ── 6a. Full post: new pending rows ──────────────────────────────────────
      for (const row of pendingRows) {
        const mapping  = mappingMap.get(row.EmpID)!;
        const empNotes = row.Notes ?? `يومية موظف — ${row.EmpName} — ${workDate}`;

        // Duplicate guard for expense row
        const dupExpReq = new sql.Request(transaction);
        const dupExpCheck = await dupExpReq
          .input('EmpID_e',        sql.Int,           row.EmpID)
          .input('invDate_e',      sql.Date,          workDate)
          .input('PayrollMonth_e', sql.Date,          payrollMonth)
          .input('GrandTolal_e',   sql.Decimal(18,2), row.DailyWage)
          .query(`
            SELECT ID FROM dbo.TblCashMove
            WHERE EmpID = @EmpID_e AND invDate = @invDate_e
              AND PayrollMonth = @PayrollMonth_e AND IsPayrollDeduction = 1
              AND GrandTolal = @GrandTolal_e AND inOut = N'out'
          `);

        let expCashMoveID: number;
        if (dupExpCheck.recordset.length > 0) {
          expCashMoveID = dupExpCheck.recordset[0].ID;
        } else {
          const expReq = new sql.Request(transaction);
          const expResult = await expReq
            .input('invID',        sql.Int,            nextInvID++)
            .input('invDate',      sql.Date,           workDate)
            .input('invTime',      sql.NVarChar(10),   nowTime)
            .input('ExpINID',      sql.Int,            expenseExpINID)
            .input('GrandTolal',   sql.Decimal(18, 2), row.DailyWage)
            .input('EmpID',        sql.Int,            row.EmpID)
            .input('Notes',        sql.NVarChar(sql.MAX), `يومية موظف - ${row.EmpName} - ${workDate}`)
            .input('PayrollMonth', sql.Date,           payrollMonth)
            .query(`
              INSERT INTO dbo.TblCashMove
                (invID, invType, invDate, invTime, ExpINID, GrandTolal, inOut, EmpID, Notes,
                 IsPayrollDeduction, IsEmployeePayrollIncome, PayrollMonth)
              OUTPUT INSERTED.ID
              VALUES (@invID, N'مصروفات', @invDate, @invTime, @ExpINID, @GrandTolal, N'out',
                      @EmpID, @Notes, 1, 0, @PayrollMonth);
            `);
          expCashMoveID = expResult.recordset[0].ID;
        }

        // Duplicate guard for employee income row
        const dupIncReq = new sql.Request(transaction);
        const dupIncCheck = await dupIncReq
          .input('EmpID_i',        sql.Int,           row.EmpID)
          .input('invDate_i',      sql.Date,          workDate)
          .input('PayrollMonth_i', sql.Date,          payrollMonth)
          .input('GrandTolal_i',   sql.Decimal(18,2), row.DailyWage)
          .query(`
            SELECT ID FROM dbo.TblCashMove
            WHERE EmpID = @EmpID_i AND invDate = @invDate_i
              AND PayrollMonth = @PayrollMonth_i AND IsEmployeePayrollIncome = 1
              AND GrandTolal = @GrandTolal_i AND inOut = N'in'
          `);

        let incCashMoveID: number;
        if (dupIncCheck.recordset.length > 0) {
          incCashMoveID = dupIncCheck.recordset[0].ID;
        } else {
          const incReq = new sql.Request(transaction);
          const incResult = await incReq
            .input('invID',        sql.Int,            nextInvID++)
            .input('invDate',      sql.Date,           workDate)
            .input('invTime',      sql.NVarChar(10),   nowTime)
            .input('RevExpINID',   sql.Int,            mapping.RevenueExpINID)
            .input('GrandTolal',   sql.Decimal(18, 2), row.DailyWage)
            .input('EmpID',        sql.Int,            row.EmpID)
            .input('Notes',        sql.NVarChar(sql.MAX), `إيراد يومية موظف - ${row.EmpName} - ${workDate}`)
            .input('PayrollMonth', sql.Date,           payrollMonth)
            .query(`
              INSERT INTO dbo.TblCashMove
                (invID, invType, invDate, invTime, ExpINID, GrandTolal, inOut, EmpID, Notes,
                 IsPayrollDeduction, IsEmployeePayrollIncome, PayrollMonth)
              OUTPUT INSERTED.ID
              VALUES (@invID, N'ايرادات', @invDate, @invTime, @RevExpINID, @GrandTolal, N'in',
                      @EmpID, @Notes, 0, 1, @PayrollMonth);
            `);
          incCashMoveID = incResult.recordset[0].ID;
        }

        // Update TblEmpDailyPayroll
        const updReq = new sql.Request(transaction);
        await updReq
          .input('CashMoveID',              sql.Int, expCashMoveID)
          .input('EmployeeIncomeCashMoveID', sql.Int, incCashMoveID)
          .input('PayrollID',               sql.Int, row.ID)
          .query(`
            UPDATE dbo.TblEmpDailyPayroll
            SET CashMoveID = @CashMoveID,
                EmployeeIncomeCashMoveID = @EmployeeIncomeCashMoveID,
                Status    = N'PostedToCashMove',
                UpdatedAt = GETDATE()
            WHERE ID = @PayrollID;
          `);

        postedCount++;
      }

      // ── 6b. Repair: already-posted rows missing EmployeeIncomeCashMoveID ─────
      for (const row of repairRows) {
        const mapping = mappingMap.get(row.EmpID);
        if (!mapping) {
          skippedCount++;
          missingMappings.push({ EmpID: row.EmpID, EmpName: row.EmpName });
          continue;
        }

        // Duplicate guard
        const dupRepReq = new sql.Request(transaction);
        const dupRepCheck = await dupRepReq
          .input('EmpID_r',        sql.Int,           row.EmpID)
          .input('invDate_r',      sql.Date,          workDate)
          .input('PayrollMonth_r', sql.Date,          payrollMonth)
          .input('GrandTolal_r',   sql.Decimal(18,2), row.DailyWage)
          .query(`
            SELECT ID FROM dbo.TblCashMove
            WHERE EmpID = @EmpID_r AND invDate = @invDate_r
              AND PayrollMonth = @PayrollMonth_r AND IsEmployeePayrollIncome = 1
              AND GrandTolal = @GrandTolal_r AND inOut = N'in'
          `);

        let repIncCashMoveID: number;
        if (dupRepCheck.recordset.length > 0) {
          repIncCashMoveID = dupRepCheck.recordset[0].ID;
        } else {
          const repIncReq = new sql.Request(transaction);
          const repIncResult = await repIncReq
            .input('invID',        sql.Int,            nextInvID++)
            .input('invDate',      sql.Date,           workDate)
            .input('invTime',      sql.NVarChar(10),   nowTime)
            .input('RevExpINID',   sql.Int,            mapping.RevenueExpINID)
            .input('GrandTolal',   sql.Decimal(18, 2), row.DailyWage)
            .input('EmpID',        sql.Int,            row.EmpID)
            .input('Notes',        sql.NVarChar(sql.MAX), `إيراد يومية موظف - ${row.EmpName} - ${workDate}`)
            .input('PayrollMonth', sql.Date,           payrollMonth)
            .query(`
              INSERT INTO dbo.TblCashMove
                (invID, invType, invDate, invTime, ExpINID, GrandTolal, inOut, EmpID, Notes,
                 IsPayrollDeduction, IsEmployeePayrollIncome, PayrollMonth)
              OUTPUT INSERTED.ID
              VALUES (@invID, N'ايرادات', @invDate, @invTime, @RevExpINID, @GrandTolal, N'in',
                      @EmpID, @Notes, 0, 1, @PayrollMonth);
            `);
          repIncCashMoveID = repIncResult.recordset[0].ID;
        }

        const repUpdReq = new sql.Request(transaction);
        await repUpdReq
          .input('EmployeeIncomeCashMoveID', sql.Int, repIncCashMoveID)
          .input('PayrollID',               sql.Int, row.ID)
          .query(`
            UPDATE dbo.TblEmpDailyPayroll
            SET EmployeeIncomeCashMoveID = @EmployeeIncomeCashMoveID,
                UpdatedAt = GETDATE()
            WHERE ID = @PayrollID;
          `);

        repairedCount++;
      }

      await transaction.commit();

      return NextResponse.json({
        success:        true,
        workDate,
        postedCount,
        repairedCount,
        skippedCount,
        missingMappings,
      });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/post-to-cash] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
