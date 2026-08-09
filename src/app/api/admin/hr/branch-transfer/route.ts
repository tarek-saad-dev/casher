import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthResult,
  requireTemporaryTransferAccess,
} from '@/lib/api-auth';
import {
  cancelTemporaryBranchTransfer,
  createTemporaryBranchTransfer,
  listTemporaryBranchTransfers,
  previewTemporaryBranchTransfer,
} from '@/lib/hr/temporaryBranchTransfer';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';
import {
  resolveDestinationBranchId,
  resolveTransferAccessFlags,
} from '@/lib/hr/branchTransferApiHelpers';

export const runtime = 'nodejs';

/**
 * GET /api/admin/hr/branch-transfer?from=&to=&empId=&activeOnly=
 * List temporary transfers in a date range (history + audit).
 */
export async function GET(req: NextRequest) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const from = String(searchParams.get('from') || '');
    const to = String(searchParams.get('to') || '');
    const empIdRaw = searchParams.get('empId');
    const empId = empIdRaw != null && empIdRaw !== '' ? Number(empIdRaw) : null;
    const activeOnly = searchParams.get('activeOnly') === 'true';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json(
        { ok: false, error: 'from/to مطلوبان بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const transfers = await listTemporaryBranchTransfers({
      fromDate: from,
      toDate: to,
      empId: empId != null && Number.isFinite(empId) ? empId : null,
      activeOnly,
    });

    return NextResponse.json({ ok: true, transfers });
  } catch (err) {
    console.error('[admin/hr/branch-transfer GET]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحميل سجل النقل' }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/branch-transfer — apply temporary transfer (supports past dates + relocate).
 */
export async function POST(req: NextRequest) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const empId = Number(body.empId);
    const workDate = String(body.workDate || '');
    const reason = String(body.reason || '');
    const toBranchId = await resolveDestinationBranchId(body);

    if (!Number.isFinite(empId) || !toBranchId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ ok: false, error: 'معاملات ناقصة' }, { status: 400 });
    }

    const draft = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      relocateAttendance: body.relocateAttendance === true,
    });
    const flags = await resolveTransferAccessFlags(
      auth,
      draft.sourceBranch?.branchId ?? auth.activeBranchId,
      toBranchId,
    );

    const result = await createTemporaryBranchTransfer({
      empId,
      toBranchId,
      workDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      reason,
      createdByUserId: auth.userId,
      forceDespiteBlockers: body.forceDespiteBlockers === true,
      relocateAttendance: body.relocateAttendance === true,
      fromBranchId: body.fromBranchId != null ? Number(body.fromBranchId) : undefined,
      ...flags,
    });

    return NextResponse.json({
      ok: true,
      transferId: result.transferId,
      fromBranchId: result.fromBranchId,
      toBranchId,
      forced: result.forced,
      relocatedAttendance: result.relocatedAttendance,
      message: result.relocatedAttendance
        ? 'تم النقل مع نقل الحضور/اليومية لفرع الوجهة'
        : result.forced
          ? 'تم تطبيق النقل رغم التحذيرات'
          : 'تم تطبيق النقل',
    });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[admin/hr/branch-transfer POST]', err);
    return NextResponse.json({ ok: false, error: 'فشل تطبيق النقل' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/hr/branch-transfer — soft-cancel active transfer for workDate.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const empId = Number(body.empId);
    const workDate =
      String(body.workDate || new URL(req.url).searchParams.get('workDate') || '');
    const reason = String(body.reason || 'إلغاء النقل من صفحة الموارد البشرية');

    if (!Number.isFinite(empId) || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ ok: false, error: 'معاملات ناقصة' }, { status: 400 });
    }

    const result = await cancelTemporaryBranchTransfer({
      empId,
      workDate,
      reason,
      actorUserId: auth.userId,
    });

    return NextResponse.json({
      ok: true,
      cancelledTransferId: result.cancelledTransferId,
      message: 'تم إلغاء النقل',
    });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[admin/hr/branch-transfer DELETE]', err);
    return NextResponse.json({ ok: false, error: 'فشل إلغاء النقل' }, { status: 500 });
  }
}
