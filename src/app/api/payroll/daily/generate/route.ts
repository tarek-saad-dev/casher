import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import {
  countPostedDailyPayroll,
  validateDailyPayrollAttendance,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import {
  EmployeeLedgerDualWriteError,
  runDailyPayrollGenerateWithOptionalLedger,
} from '@/lib/services/employeeLedgerDualWrite';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/payroll/daily/generate
// Body: { workDate: "YYYY-MM-DD" } — BranchID never from body (Phase 1L)
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
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const branchId = branch.branchId;

    const db = await getPool();

    const postedCount = await countPostedDailyPayroll(db, workDate, branchId);
    if (postedCount > 0) {
      return NextResponse.json({
        error: 'يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها إلا بعد إلغاء أو تصحيح الترحيل.',
        alreadyPosted: true,
      }, { status: 409 });
    }

    const { missing } = await validateDailyPayrollAttendance(db, workDate, {
      branchId,
    });
    if (missing.length > 0) {
      return NextResponse.json({
        error: 'برجاء إكمال بيانات الحضور والانصراف أولاً',
        missing,
        ok: false,
      }, { status: 422 });
    }

    const { result, ledgerDualWrite, ledgerSync } =
      await runDailyPayrollGenerateWithOptionalLedger(workDate, { branchId });

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
    }, { status: 201 });

  } catch (err: unknown) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/generate] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
