import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getBranchByCode } from '@/lib/branch/repository';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import {
  previewTemporaryBranchTransfer,
  createTemporaryBranchTransfer,
  cancelTemporaryBranchTransfer,
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
 * POST /api/operations/employees/[empId]/temporary-transfer/preview
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requirePageAccess('/operations');
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
    // Resolve source first for access check via preview (preview resolves source internally)
    const preview = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId: destId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      allowSetupDestination: smokePreview,
      ...(await accessFlags(
        auth.userId,
        null, // filled after — preview returns source; re-check below
        destId,
        { isSuperAdmin: auth.isSuperAdmin },
      )),
    });

    const flags = await accessFlags(
      auth.userId,
      preview.sourceBranch?.branchId ?? auth.activeBranchId,
      destId,
      { isSuperAdmin: auth.isSuperAdmin },
    );
    const preview2 = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId: destId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      allowSetupDestination: smokePreview,
      ...flags,
    });

    return NextResponse.json({ ok: true, preview: preview2 });
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
