import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isDailyPayrollViewScope,
  resolveDailyPayrollViewScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/payroll/daily?workDate=YYYY-MM-DD&employeeScope=all|GLEEM|CAMP_CAESAR
// employeeScope is read-only visibility — does not switch session branch.
// Omitted employeeScope → active session branch only (legacy).
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate');
    const viewScope = await resolveDailyPayrollViewScope(searchParams.get('employeeScope'));
    if (!isDailyPayrollViewScope(viewScope)) return viewScope;

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const branchIds = viewScope.branchIds;
    if (branchIds.length === 0) {
      return NextResponse.json(
        { error: 'لا توجد فروع للعرض', code: 'NO_BRANCH_ACCESS' },
        { status: 403 },
      );
    }

    const db = await getPool();
    const reqDb = db.request().input('WorkDate', sql.Date, workDate);
    const idParams: string[] = [];
    branchIds.forEach((id, i) => {
      const name = `branchId${i}`;
      reqDb.input(name, sql.Int, id);
      idParams.push(`@${name}`);
    });

    const result = await reqDb.query(`
        SELECT
          p.ID,
          p.EmpID,
          p.BranchID,
          b.BranchCode,
          b.BranchName,
          e.EmpName,
          e.EmploymentType,
          e.PayrollMethod,
          p.HourlyRateSnapshot,
          e.DailyRate,
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
        INNER JOIN dbo.TblBranch b
          ON b.BranchID = p.BranchID
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
          AND p.BranchID IN (${idParams.join(', ')})
        ORDER BY b.BranchCode, e.EmpName
      `);

    // Annotate each row with needsIncomeRepair
    const annotatedRows = result.recordset.map((r: Record<string, unknown>) => ({
      ...r,
      BranchID: Number(r.BranchID),
      BranchCode: String(r.BranchCode ?? ''),
      BranchName: String(r.BranchName ?? ''),
      needsIncomeRepair:
        r.Status === 'PostedToCashMove' &&
        r.CashMoveID !== null &&
        (r.EmployeeIncomeCashMoveID === null || r.EmployeeIncomeCashMoveID === undefined),
    })) as Array<Record<string, unknown> & {
      BranchID: number;
      BranchCode: string;
      BranchName: string;
      EmpID: number;
      EmpName: string;
      Status: string;
      ActualHours: number | null;
      DailyWage: number | null;
      CashMoveAmount: number | null;
      IncomeCashMoveAmount: number | null;
      RevenueExpINID: number | null;
      needsIncomeRepair: boolean;
    }>;

    // Employees with Generated/Earned status but no revenue mapping
    const missingMappingEmps = annotatedRows
      .filter((r) => ['Generated', 'Earned'].includes(String(r.Status)) && !r.RevenueExpINID)
      .map((r) => ({ EmpID: r.EmpID, EmpName: r.EmpName, BranchID: r.BranchID }));

    const postedRows = annotatedRows.filter((r) => r.Status === 'PostedToCashMove');
    const generatedRows = annotatedRows.filter((r) =>
      ['Generated', 'Earned'].includes(String(r.Status)),
    );
    const repairRows = annotatedRows.filter((r) => r.needsIncomeRepair);

    const summary = {
      total: annotatedRows.length,
      totalWage: annotatedRows.reduce((s, r) => s + (Number(r.DailyWage) || 0), 0),
      totalHours: annotatedRows.reduce((s, r) => s + (Number(r.ActualHours) || 0), 0),
      postedCount: postedRows.length,
      generatedCount: generatedRows.length,
      earnedCount: generatedRows.length,
      repairCount: repairRows.length,
      totalExpenseAmount: postedRows.reduce((s, r) => s + (Number(r.CashMoveAmount) || 0), 0),
      totalEmployeeIncomeAmount: postedRows
        .filter((r) => !r.needsIncomeRepair)
        .reduce((s, r) => s + (Number(r.IncomeCashMoveAmount) || 0), 0),
    };

    /** Same EmpID with payroll rows in >1 BranchID on this WorkDate (split rows deferred). */
    const byEmp = new Map<number, Set<number>>();
    for (const r of annotatedRows) {
      const empId = Number(r.EmpID);
      const branchId = Number(r.BranchID);
      if (!byEmp.has(empId)) byEmp.set(empId, new Set());
      byEmp.get(empId)!.add(branchId);
    }
    const sameDayMultiBranchEmployees = [...byEmp.entries()]
      .filter(([, branches]) => branches.size > 1)
      .map(([empId, branches]) => {
        const sample = annotatedRows.find((r) => Number(r.EmpID) === empId);
        return {
          empId,
          empName: String(sample?.EmpName ?? `#${empId}`),
          branchIds: [...branches].sort((a, b) => a - b),
          note: 'same_day_multi_branch_deferred',
        };
      });

    return NextResponse.json({
      success: true,
      workDate,
      employeeScope: viewScope.employeeScope,
      branchIds: viewScope.branchIds,
      branches: viewScope.branches,
      /** @deprecated single-branch callers — first view branch */
      branchId: viewScope.branchIds[0],
      rows: annotatedRows,
      summary,
      missingMappingEmps,
      sameDayMultiBranchEmployees,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
