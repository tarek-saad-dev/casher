import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import {
  validateDailyPayrollAttendance,
  countPostedDailyPayroll,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import type { PayrollValidationReason } from '@/lib/payroll/dailyPayrollHrRules';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationMissing {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

export interface ValidationExcluded {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

// POST /api/payroll/daily/validate-attendance
// Body: { workDate } — BranchID never from body (Phase 1L)
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const body = await req.json();
    if (body.branchId != null || body.BranchID != null) {
      return NextResponse.json(
        { error: 'BranchID في الطلب غير مسموح' },
        { status: 400 },
      );
    }

    const { workDate } = body;

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const branchId = branch.branchId;

    const db = await getPool();

    const alreadyPostedCount = await countPostedDailyPayroll(db, workDate, branchId);

    const generatedResult = await db
      .request()
      .input('WorkDate', sql.Date, workDate)
      .input('BranchID', sql.Int, branchId)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate
          AND BranchID = @BranchID
          AND Status IN (N'Generated', N'Earned')
      `);
    const generatedExists: boolean = generatedResult.recordset[0].cnt > 0;

    const { missing, excluded } = await validateDailyPayrollAttendance(db, workDate, {
      branchId,
    });

    return NextResponse.json({
      ok: missing.length === 0,
      missing,
      excluded,
      alreadyPostedCount,
      generatedExists,
      branchId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/validate-attendance] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
