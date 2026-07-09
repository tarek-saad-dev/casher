import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { ValidationMissing } from '../validate-attendance/route';
import {
  countPostedDailyPayroll,
  validateDailyPayrollAttendance,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import {
  EmployeeLedgerDualWriteError,
  runDailyPayrollGenerateWithOptionalLedger,
} from '@/lib/services/employeeLedgerDualWrite';

function resolveWorkDate(override?: string): string {
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  const now = new Date();
  const hour = now.getHours();
  const target = new Date(now);
  if (hour < 6) target.setDate(target.getDate() - 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

// POST /api/payroll/daily/auto-generate
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authHeader = req.headers.get('authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const workDate = resolveWorkDate(body?.workDate);
    const db = await getPool();

    const postedCount = await countPostedDailyPayroll(db, workDate);
    if (postedCount > 0) {
      return NextResponse.json({
        ok: false,
        status: 'already_posted',
        workDate,
        message: 'يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها.',
      }, { status: 409 });
    }

    const eligibleResult = await db.request().query(`
      SELECT EmpID, EmpName, HourlyRate
      FROM dbo.TblEmp
      WHERE isActive = 1 AND IsPayrollEnabled = 1 AND SalaryType = N'Daily'
    `);
    if (eligibleResult.recordset.length === 0) {
      return NextResponse.json({
        ok: true,
        status: 'no_eligible_employees',
        workDate,
        message: 'لا يوجد موظفون مؤهلون لنظام الرواتب',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
      });
    }

    const missing = await validateDailyPayrollAttendance(db, workDate);
    if (missing.length > 0) {
      await logAutoGenResult(db, workDate, false, missing, 0, 0, 0);
      return NextResponse.json({
        ok: false,
        status: 'attendance_incomplete',
        workDate,
        message: 'لم يتم توليد اليوميات تلقائيًا بسبب نقص بيانات الحضور والانصراف',
        missing,
      }, { status: 422 });
    }

    const { result, ledgerDualWrite, ledgerSync } =
      await runDailyPayrollGenerateWithOptionalLedger(workDate, { notesPrefix: '[Auto] ' });

    const employeesCount = result.generatedCount;
    const totalHours = result.totalHours;
    const totalWages = result.totalWage;

    await logAutoGenResult(db, workDate, true, [], employeesCount, totalHours, totalWages);

    return NextResponse.json({
      ok: true,
      status: 'generated',
      workDate,
      message: 'تم توليد اليوميات تلقائيًا ولم يتم ترحيلها للخزنة بعد',
      employeesCount,
      totalHours: Number(totalHours),
      totalWages: Number(totalWages),
      ledgerDualWrite,
      ledgerSync: ledgerSync ?? null,
    });

  } catch (err: unknown) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/auto-generate] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate') ?? resolveWorkDate();

    const db = await getPool();
    const result = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1
          WorkDate, Success, EmployeesCount, TotalHours, TotalWages,
          MissingJson, CreatedAt
        FROM dbo.TblAutoGenLog
        WHERE WorkDate = @WorkDate
        ORDER BY CreatedAt DESC
      `).catch(() => ({ recordset: [] as Record<string, unknown>[] }));

    if (result.recordset.length === 0) {
      return NextResponse.json({ found: false, workDate });
    }

    const row = result.recordset[0];
    return NextResponse.json({
      found: true,
      workDate: row.WorkDate,
      success: row.Success,
      employeesCount: row.EmployeesCount,
      totalHours: row.TotalHours,
      totalWages: row.TotalWages,
      missing: row.MissingJson ? JSON.parse(String(row.MissingJson)) : [],
      createdAt: row.CreatedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function logAutoGenResult(
  db: { request: () => sql.Request },
  workDate: string,
  success: boolean,
  missing: ValidationMissing[],
  employeesCount: number,
  totalHours: number,
  totalWages: number,
) {
  try {
    await db.request()
      .input('WorkDate', sql.Date, workDate)
      .input('Success', sql.Bit, success ? 1 : 0)
      .input('EmployeesCount', sql.Int, employeesCount)
      .input('TotalHours', sql.Decimal(10, 2), totalHours)
      .input('TotalWages', sql.Decimal(12, 2), totalWages)
      .input('MissingJson', sql.NVarChar(sql.MAX), missing.length ? JSON.stringify(missing) : null)
      .query(`
        IF OBJECT_ID('dbo.TblAutoGenLog', 'U') IS NOT NULL
        BEGIN
          INSERT INTO dbo.TblAutoGenLog
            (WorkDate, Success, EmployeesCount, TotalHours, TotalWages, MissingJson, CreatedAt)
          VALUES
            (@WorkDate, @Success, @EmployeesCount, @TotalHours, @TotalWages, @MissingJson, GETDATE())
        END
      `);
  } catch {
    /* non-fatal */
  }
}
