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
import { isSystemJobAuthResult, requireSystemJobAuth } from '@/lib/api-auth';
import { listActiveBranches } from '@/lib/branch';

function resolveWorkDate(override?: string): string {
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  const now = new Date();
  const hour = now.getHours();
  const target = new Date(now);
  if (hour < 6) target.setDate(target.getDate() - 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

// POST /api/payroll/daily/auto-generate — Phase 1L: per active branch
export async function POST(req: NextRequest) {
  try {
    const jobAuth = await requireSystemJobAuth(req);
    if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

    const body = await req.json().catch(() => ({}));
    if (body?.branchId != null || body?.BranchID != null) {
      return NextResponse.json(
        { ok: false, error: 'BranchID في الطلب غير مسموح' },
        { status: 400 },
      );
    }
    const workDate = resolveWorkDate(body?.workDate);
    const db = await getPool();
    const branches = await listActiveBranches();

    let employeesCount = 0;
    let totalHours = 0;
    let totalWages = 0;
    let anyGenerated = false;
    let anyIncomplete = false;
    let allPosted = branches.length > 0;
    let ledgerDualWrite: unknown = undefined;
    let ledgerSync: unknown = null;
    const branchErrors: string[] = [];
    const allMissing: ValidationMissing[] = [];

    for (const branch of branches) {
      const postedCount = await countPostedDailyPayroll(db, workDate, branch.branchId);
      if (postedCount > 0) {
        continue;
      }
      allPosted = false;

      const { missing } = await validateDailyPayrollAttendance(db, workDate, {
        branchId: branch.branchId,
      });
      if (missing.length > 0) {
        anyIncomplete = true;
        allMissing.push(...missing);
        branchErrors.push(`${branch.branchCode}: attendance incomplete (${missing.length})`);
        continue;
      }

      try {
        const { result, ledgerDualWrite: ld, ledgerSync: ls } =
          await runDailyPayrollGenerateWithOptionalLedger(workDate, {
            notesPrefix: `[Auto][${branch.branchCode}] `,
            branchId: branch.branchId,
          });
        employeesCount += result.generatedCount;
        totalHours += Number(result.totalHours) || 0;
        totalWages += Number(result.totalWage) || 0;
        ledgerDualWrite = ld;
        ledgerSync = ls ?? null;
        anyGenerated = true;
      } catch (branchErr) {
        const msg = branchErr instanceof Error ? branchErr.message : String(branchErr);
        branchErrors.push(`${branch.branchCode}: ${msg}`);
      }
    }

    if (branches.length === 0) {
      return NextResponse.json({
        ok: true,
        status: 'no_eligible_employees',
        workDate,
        message: 'لا يوجد فروع نشطة',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
      });
    }

    if (allPosted && !anyGenerated) {
      return NextResponse.json({
        ok: false,
        status: 'already_posted',
        workDate,
        message: 'يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها.',
      }, { status: 409 });
    }

    if (anyIncomplete && !anyGenerated) {
      await logAutoGenResult(db, workDate, false, allMissing, 0, 0, 0);
      return NextResponse.json({
        ok: false,
        status: 'attendance_incomplete',
        workDate,
        message: 'لم يتم توليد اليوميات تلقائيًا بسبب نقص بيانات الحضور والانصراف',
        missing: allMissing,
        branchErrors,
      }, { status: 422 });
    }

    if (!anyGenerated) {
      return NextResponse.json({
        ok: true,
        status: 'no_eligible_employees',
        workDate,
        message: branchErrors.length
          ? `فشل التوليد: ${branchErrors.join(' | ')}`
          : 'لا يوجد موظفون مؤهلون لنظام الرواتب',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
        branchErrors,
      });
    }

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
      ledgerSync,
      branchErrors: branchErrors.length ? branchErrors : undefined,
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
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ workDate, lastRun: null });
    }

    const row = result.recordset[0];
    return NextResponse.json({
      workDate,
      lastRun: {
        success: Boolean(row.Success),
        employeesCount: row.EmployeesCount,
        totalHours: row.TotalHours,
        totalWages: row.TotalWages,
        missing: row.MissingJson ? JSON.parse(String(row.MissingJson)) : [],
        createdAt: row.CreatedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function logAutoGenResult(
  db: Awaited<ReturnType<typeof getPool>>,
  workDate: string,
  success: boolean,
  missing: ValidationMissing[],
  employeesCount: number,
  totalHours: number,
  totalWages: number,
): Promise<void> {
  try {
    await db.request()
      .input('WorkDate', sql.Date, workDate)
      .input('Success', sql.Bit, success ? 1 : 0)
      .input('EmployeesCount', sql.Int, employeesCount)
      .input('TotalHours', sql.Decimal(12, 2), totalHours)
      .input('TotalWages', sql.Decimal(12, 2), totalWages)
      .input('MissingJson', sql.NVarChar(sql.MAX), JSON.stringify(missing))
      .query(`
        INSERT INTO dbo.TblAutoGenLog (
          WorkDate, Success, EmployeesCount, TotalHours, TotalWages, MissingJson, CreatedAt
        )
        VALUES (
          @WorkDate, @Success, @EmployeesCount, @TotalHours, @TotalWages, @MissingJson, SYSDATETIME()
        )
      `);
  } catch (err) {
    console.error('[auto-generate] log failed:', err);
  }
}
