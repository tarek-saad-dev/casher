import { NextRequest, NextResponse } from 'next/server';
import { requireBranchAdminAccess } from '@/lib/branch/context';
import { transitionBranchLifecycle } from '@/lib/branch/branchLifecycleTransition';
import { isBranchLifecycleStatus } from '@/lib/branch/lifecycle';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await ctx.params;
    const branchId = Number(id);
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'معرف فرع غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    if (body.branchId !== undefined && Number(body.branchId) !== branchId) {
      return NextResponse.json(
        { ok: false, error: 'BranchID في الجسم غير مسموح', code: 'BRANCH_ACCESS_MISMATCH' },
        { status: 400 },
      );
    }
    if (!isBranchLifecycleStatus(body.targetStatus)) {
      return NextResponse.json({ ok: false, error: 'targetStatus غير صالح' }, { status: 400 });
    }

    const result = await transitionBranchLifecycle({
      branchId,
      targetStatus: body.targetStatus,
      actorUserId: admin.userId,
      reason: String(body.reason ?? ''),
      smokeRunId: body.smokeRunId != null ? Number(body.smokeRunId) : undefined,
    });

    return NextResponse.json({
      ok: true,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      branch: {
        branchId: result.branch.branchId,
        branchCode: result.branch.branchCode,
        lifecycleStatus: result.branch.lifecycleStatus,
        isActive: result.branch.isActive,
        publicBookingEnabled: result.branch.publicBookingEnabled,
      },
    });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/lifecycle-transition]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحويل الحالة' }, { status: 500 });
  }
}
