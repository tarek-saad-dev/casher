import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import {
  empBranchWorkDayCloseErrorResponse,
  isEmpBranchWorkDayCloseError,
} from '@/lib/hr/empBranchWorkDayClose.http';
import { mapGenerateMissingReasonToBlockerCode } from '@/lib/hr/dailyPayrollReadiness.chain';
import {
  countPostedDailyPayroll,
  validateDailyPayrollAttendance,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import {
  EmployeeLedgerDualWriteError,
  runDailyPayrollGenerateWithOptionalLedger,
} from '@/lib/services/employeeLedgerDualWrite';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function businessCodeFromGenerateMissing(
  missing: Array<{ reason: string }>,
): string {
  const mapped = missing
    .map((m) => mapGenerateMissingReasonToBlockerCode(m.reason))
    .filter((c): c is NonNullable<typeof c> => c != null);
  const unique = [...new Set(mapped)];
  if (unique.length === 1) {
    return unique[0].toUpperCase(); // e.g. SALARY_CONFIG_MISSING, MISSING_CHECK_OUT
  }
  return 'PAYROLL_GENERATE_VALIDATION_FAILED';
}

// POST /api/payroll/daily/generate
// Body: { workDate: "YYYY-MM-DD", empIds?: number[] } — BranchID never from body (Phase 1L)
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
    const empIds: number[] | undefined = Array.isArray(body.empIds)
      ? [
          ...new Set(
            (body.empIds as unknown[])
              .map((n) => Number(n))
              .filter((n): n is number => Number.isFinite(n) && n > 0),
          ),
        ]
      : undefined;

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const branchId = branch.branchId;

    const db = await getPool();

    const postedCount = await countPostedDailyPayroll(db, workDate, branchId, empIds);
    if (postedCount > 0) {
      return NextResponse.json({
        error: 'يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها إلا بعد إلغاء أو تصحيح الترحيل.',
        alreadyPosted: true,
        code: 'PAYROLL_ALREADY_POSTED',
      }, { status: 409 });
    }

    const { missing } = await validateDailyPayrollAttendance(db, workDate, {
      branchId,
      empIds,
    });
    if (missing.length > 0) {
      return NextResponse.json({
        error: 'برجاء إكمال بيانات الحضور والانصراف أولاً',
        missing,
        ok: false,
        code: businessCodeFromGenerateMissing(missing),
      }, { status: 422 });
    }

    const { result, ledgerDualWrite, ledgerSync } =
      await runDailyPayrollGenerateWithOptionalLedger(workDate, {
        branchId,
        ...(empIds?.length ? { empIds } : {}),
      });

    return NextResponse.json({
      success: true,
      workDate: result.workDate,
      branchId,
      generatedCount: result.generatedCount,
      totalHours: result.totalHours,
      totalWage: result.totalWage,
      newRows: result.newRows,
      ledgerDualWrite,
      ledgerSync: ledgerSync ?? null,
      empIds: empIds?.length ? empIds : null,
    }, { status: 201 });

  } catch (err: unknown) {
    if (isEmpBranchWorkDayCloseError(err)) {
      return empBranchWorkDayCloseErrorResponse(err);
    }
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/generate] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
