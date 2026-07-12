import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
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
export async function POST(req: NextRequest) {
  try {
    const { workDate } = await req.json();

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }

    const db = await getPool();

    const alreadyPostedCount = await countPostedDailyPayroll(db, workDate);

    const generatedResult = await db
      .request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate AND Status IN (N'Generated', N'Earned')
      `);
    const generatedExists: boolean = generatedResult.recordset[0].cnt > 0;

    const { missing, excluded } = await validateDailyPayrollAttendance(db, workDate);

    return NextResponse.json({
      ok: missing.length === 0,
      missing,
      excluded,
      alreadyPostedCount,
      generatedExists,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/validate-attendance] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
