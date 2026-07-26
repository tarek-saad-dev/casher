import { NextRequest, NextResponse } from 'next/server';
import { getActiveBranchContext, requireBranchAdminAccess } from '@/lib/branch/context';
import { getBranchById } from '@/lib/branch/repository';
import { serializeBranch } from '@/lib/branch/serializeBranch';
import { updateBranchSetupFields } from '@/lib/branch/updateBranchSetup';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

function parseBranchId(id: string): number | null {
  const branchId = Number(id);
  if (!Number.isFinite(branchId) || branchId <= 0) return null;
  return branchId;
}

/**
 * GET /api/admin/branches/[id]
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await ctx.params;
    const branchId = parseBranchId(id);
    if (branchId == null) {
      return NextResponse.json({ ok: false, error: 'معرف فرع غير صالح' }, { status: 400 });
    }
    const [branch, active] = await Promise.all([getBranchById(branchId), getActiveBranchContext()]);
    if (!branch) {
      return NextResponse.json({ ok: false, error: 'الفرع غير موجود' }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      activeBranchId: active?.branchId ?? null,
      branch: serializeBranch(branch),
    });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/[id] GET]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحميل الفرع' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/branches/[id]
 * Updates contact / hours / timezone. Safe identity fields only —
 * does not change lifecycle or public booking.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await ctx.params;
    const branchId = parseBranchId(id);
    if (branchId == null) {
      return NextResponse.json({ ok: false, error: 'معرف فرع غير صالح' }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const updated = await updateBranchSetupFields({
      branchId,
      address: body.address === undefined ? undefined : (body.address as string | null),
      phone: body.phone === undefined ? undefined : (body.phone as string | null),
      timeZone: body.timeZone === undefined ? undefined : String(body.timeZone),
      defaultOpenTime:
        body.defaultOpenTime === undefined
          ? undefined
          : (body.defaultOpenTime as string | null),
      defaultCloseTime:
        body.defaultCloseTime === undefined
          ? undefined
          : (body.defaultCloseTime as string | null),
      businessDayCutoffTime:
        body.businessDayCutoffTime === undefined
          ? undefined
          : (body.businessDayCutoffTime as string | null),
      // Admin hub may edit contact/hours on live branches; lifecycle gates stay elsewhere.
      requireSetupLifecycle: false,
      actorUserId: admin.userId,
      reason: 'Admin branches hub PATCH contact/hours',
    });

    return NextResponse.json({
      ok: true,
      message: 'تم حفظ بيانات الفرع',
      branch: serializeBranch(updated),
    });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/[id] PATCH]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحديث الفرع' }, { status: 500 });
  }
}
