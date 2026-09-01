import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTemporaryTransferAccess } from '@/lib/api-auth';
import { getBranchByCode } from '@/lib/branch/repository';
import { previewTemporaryBranchTransfer } from '@/lib/hr/temporaryBranchTransfer';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';
import { resolveTransferAccessFlags } from '@/lib/hr/branchTransferApiHelpers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ empId: string }> };

/**
 * POST /api/operations/employees/[empId]/temporary-transfer/preview
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const body = await req.json();
    const workDate = String(body.workDate || '');
    const toBranchCode = body.toBranchCode ? String(body.toBranchCode).toUpperCase() : null;
    const toBranchId = body.toBranchId != null ? Number(body.toBranchId) : null;

    let destId = toBranchId;
    if (!destId && toBranchCode) {
      const b = await getBranchByCode(toBranchCode);
      destId = b?.branchId ?? null;
    }
    if (!Number.isFinite(empId) || !destId || !workDate) {
      return NextResponse.json({ ok: false, error: 'معاملات ناقصة' }, { status: 400 });
    }

    const smokePreview = body.smokePreview === true;
    const relocateAttendance = body.relocateAttendance === true;
    const draft = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId: destId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      hintFromBranchId:
        body.fromBranchId != null ? Number(body.fromBranchId) : auth.activeBranchId,
      allowSetupDestination: smokePreview,
      relocateAttendance,
    });

    const flags = await resolveTransferAccessFlags(
      auth,
      draft.sourceBranch?.branchId ?? auth.activeBranchId,
      destId,
    );
    if (smokePreview && auth.isSuperAdmin) {
      flags.callerHasDestinationAccess = true;
      flags.callerHasSourceAccess = true;
    }

    const preview = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId: destId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      hintFromBranchId:
        body.fromBranchId != null ? Number(body.fromBranchId) : auth.activeBranchId,
      allowSetupDestination: smokePreview,
      relocateAttendance,
      ...flags,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[temporary-transfer/preview]', err);
    return NextResponse.json({ ok: false, error: 'فشل معاينة النقل' }, { status: 500 });
  }
}
