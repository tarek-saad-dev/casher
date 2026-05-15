import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/payroll/daily?workDate=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate');

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const db = await getPool();
    const result = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT
          p.ID,
          p.EmpID,
          e.EmpName,
          p.HourlyRateSnapshot,
          p.AttendanceID,
          p.WorkDate,
          p.SalaryHistoryID,
          p.ActualHours,
          p.DailyWage,
          p.Status,
          p.CashMoveID,
          p.EmployeeIncomeCashMoveID,
          p.Notes,
          p.CreatedAt,
          p.UpdatedAt,
          a.Status                                    AS AttendanceStatus,
          CONVERT(VARCHAR(5), a.CheckInTime,  108)   AS CheckInTime,
          CONVERT(VARCHAR(5), a.CheckOutTime, 108)   AS CheckOutTime,
          a.LateMinutes,
          cm_exp.GrandTolal AS CashMoveAmount,
          cm_exp.invDate    AS CashMoveDate,
          cm_inc.GrandTolal AS IncomeCashMoveAmount,
          cm_inc.invDate    AS IncomeCashMoveDate,
          rev_map.ExpINID   AS RevenueExpINID,
          rev_cat.CatName   AS RevenueCatName
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmp e
          ON e.EmpID = p.EmpID
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.ID = p.AttendanceID
        LEFT JOIN dbo.TblCashMove cm_exp
          ON cm_exp.ID = p.CashMoveID
        LEFT JOIN dbo.TblCashMove cm_inc
          ON cm_inc.ID = p.EmployeeIncomeCashMoveID
        LEFT JOIN dbo.TblExpCatEmpMap rev_map
          ON rev_map.EmpID = p.EmpID AND rev_map.TxnKind = N'revenue' AND rev_map.IsActive = 1
        LEFT JOIN dbo.TblExpINCat rev_cat
          ON rev_cat.ExpINID = rev_map.ExpINID
        WHERE p.WorkDate = @WorkDate
        ORDER BY e.EmpName
      `);

    // Annotate each row with needsIncomeRepair
    const annotatedRows = result.recordset.map((r: any) => ({
      ...r,
      needsIncomeRepair:
        r.Status === 'PostedToCashMove' &&
        r.CashMoveID !== null &&
        (r.EmployeeIncomeCashMoveID === null || r.EmployeeIncomeCashMoveID === undefined),
    }));

    // Employees with Generated/Earned status but no revenue mapping
    const missingMappingEmps = annotatedRows
      .filter((r: any) => ['Generated', 'Earned'].includes(r.Status) && !r.RevenueExpINID)
      .map((r: any) => ({ EmpID: r.EmpID, EmpName: r.EmpName }));

    const postedRows    = annotatedRows.filter((r: any) => r.Status === 'PostedToCashMove');
    const generatedRows = annotatedRows.filter((r: any) => ['Generated', 'Earned'].includes(r.Status));
    const repairRows    = annotatedRows.filter((r: any) => r.needsIncomeRepair);

    const summary = {
      total:                   annotatedRows.length,
      totalWage:               annotatedRows.reduce((s: number, r: any) => s + (r.DailyWage ?? 0), 0),
      totalHours:              annotatedRows.reduce((s: number, r: any) => s + (r.ActualHours ?? 0), 0),
      postedCount:             postedRows.length,
      generatedCount:          generatedRows.length,
      earnedCount:             generatedRows.length,
      repairCount:             repairRows.length,
      totalExpenseAmount:      postedRows.reduce((s: number, r: any) => s + (r.CashMoveAmount ?? 0), 0),
      totalEmployeeIncomeAmount: postedRows
        .filter((r: any) => !r.needsIncomeRepair)
        .reduce((s: number, r: any) => s + (r.IncomeCashMoveAmount ?? 0), 0),
    };

    return NextResponse.json({ success: true, workDate, rows: annotatedRows, summary, missingMappingEmps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
