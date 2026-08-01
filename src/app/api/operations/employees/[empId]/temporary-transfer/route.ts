import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getBranchByCode, listUserValidBranchAccess } from '@/lib/branch/repository';
import {
  createTemporaryBranchTransfer,
  cancelTemporaryBranchTransfer,
  previewTemporaryBranchTransfer,
} from '@/lib/hr/temporaryBranchTransfer';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ empId: string }> };

async function accessFlags(
  userId: number,
  fromBranchId: number | null,
  toBranchId: number,
  opts?: { isSuperAdmin?: boolean },
) {
  const access = await listUserValidBranchAccess(userId);
  const canOperateOrSwitch = (branchId: number) =>
    access.some((a) => a.branchId === branchId && (a.canOperate || a.canSwitch));
  const canOperateAnywhere = access.some((a) => a.canOperate || a.canSwitch);
  // Destination: allow any active transfer target when the caller can operate somewhere
  // (matches schedule-control destination list). Superadmin always allowed.
  return {
    callerHasSourceAccess:
      opts?.isSuperAdmin === true ||
      fromBranchId == null ||
      canOperateOrSwitch(fromBranchId),
    callerHasDestinationAccess:
      opts?.isSuperAdmin === true ||
      canOperateOrSwitch(toBranchId) ||
      canOperateAnywhere,
  };
}

/**
 * POST /api/operations/employees/[empId]/temporary-transfer
 * Apply transfer. Never trusts body.fromBranchId as authority.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = await req.json();
    const workDate = String(body.workDate || '');
    const reason = String(body.reason || '');
    const toBranchCode = body.toBranchCode ? String(body.toBranchCode).toUpperCase() : null;
    let toBranchId = body.toBranchId != null ? Number(body.toBranchId) : null;
    if (!toBranchId && toBranchCode) {
      const b = await getBranchByCode(toBranchCode);
      toBranchId = b?.branchId ?? null;
    }
    if (!Number.isFinite(empId) || !toBranchId || !workDate) {
      return NextResponse.json({ ok: false, error: 'معاملات ناقصة' }, { status: 400 });
    }

    const smokePreview = body.smokePreview === true;
    const draft = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      allowSetupDestination: smokePreview,
    });
    const flags = await accessFlags(
      auth.userId,
      draft.sourceBranch?.branchId ?? auth.activeBranchId,
      toBranchId,
      { isSuperAdmin: auth.isSuperAdmin },
    );
    if (smokePreview && auth.isSuperAdmin) {
      flags.callerHasDestinationAccess = true;
      flags.callerHasSourceAccess = true;
    }

    const result = await createTemporaryBranchTransfer({
      empId,
      toBranchId,
      workDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      reason,
      createdByUserId: auth.userId,
      allowSetupDestination: smokePreview,
      ...flags,
      // If client sends fromBranchId, service rejects mismatch with resolved source
      fromBranchId: body.fromBranchId != null ? Number(body.fromBranchId) : undefined,
    });

    return NextResponse.json({
      ok: true,
      transferId: result.transferId,
      fromBranchId: result.fromBranchId,
      toBranchId,
      message: 'تم تطبيق النقل الطارئ',
    });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[temporary-transfer POST]', err);
    return NextResponse.json({ ok: false, error: 'فشل تطبيق النقل' }, { status: 500 });
  }
}

/**
 * DELETE /api/operations/employees/[empId]/temporary-transfer
 * Soft-cancel active transfer for workDate.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = await req.json().catch(() => ({}));
    const workDate =
      String(body.workDate || new URL(req.url).searchParams.get('workDate') || '');
    const reason = String(body.reason || 'إلغاء النقل الطارئ');
    if (!Number.isFinite(empId) || !workDate) {
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
      message: 'تم إلغاء النقل الطارئ',
    });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[temporary-transfer DELETE]', err);
    return NextResponse.json({ ok: false, error: 'فشل إلغاء النقل' }, { status: 500 });
  }
}
