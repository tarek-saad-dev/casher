import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTemporaryTransferAccess } from '@/lib/api-auth';
import {
  listRelocateDestinationBranches,
  previewRelocateEmployeeDayBranch,
  relocateEmployeeDayBranch,
} from '@/lib/hr/relocateEmployeeDayBranch';

export const runtime = 'nodejs';

/**
 * GET /api/admin/hr/daily-payroll/relocate-branch?fromBranchId=
 * Destination branches for the move-day modal.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const fromBranchId = Number(new URL(req.url).searchParams.get('fromBranchId'));
    if (!Number.isFinite(fromBranchId) || fromBranchId <= 0) {
      return NextResponse.json({ ok: false, error: 'fromBranchId مطلوب' }, { status: 400 });
    }
    const destinations = await listRelocateDestinationBranches(fromBranchId);
    return NextResponse.json({ ok: true, destinations });
  } catch (err) {
    console.error('[daily-payroll/relocate-branch GET]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحميل الفروع' }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/daily-payroll/relocate-branch
 * Body: { empId, workDate, fromBranchId, toBranchId, reason, previewOnly? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const empId = Number(body.empId);
    const workDate = String(body.workDate || '');
    const fromBranchId = Number(body.fromBranchId);
    const toBranchId = Number(body.toBranchId);
    const reason = String(body.reason || '');
    const previewOnly = body.previewOnly === true;

    if (
      !Number.isFinite(empId) ||
      !Number.isFinite(fromBranchId) ||
      !Number.isFinite(toBranchId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(workDate)
    ) {
      return NextResponse.json({ ok: false, error: 'معاملات ناقصة' }, { status: 400 });
    }

    if (previewOnly) {
      const preview = await previewRelocateEmployeeDayBranch({
        empId,
        workDate,
        fromBranchId,
        toBranchId,
      });
      return NextResponse.json({ ok: true, preview });
    }

    const result = await relocateEmployeeDayBranch({
      empId,
      workDate,
      fromBranchId,
      toBranchId,
      reason,
      actorUserId: auth.userId,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: `تم نقل يوم ${workDate} إلى ${result.preview.toBranch?.branchName ?? 'الفرع الوجهة'}`,
    });
  } catch (err: unknown) {
    const e = err as {
      message?: string;
      code?: string;
      status?: number;
      preview?: unknown;
    };
    console.error('[daily-payroll/relocate-branch POST]', err);
    return NextResponse.json(
      {
        ok: false,
        error: e.message ?? 'فشل نقل اليوم لفرع آخر',
        code: e.code,
        preview: e.preview,
      },
      { status: e.status ?? 500 },
    );
  }
}
