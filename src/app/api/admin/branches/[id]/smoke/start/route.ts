import { NextRequest, NextResponse } from 'next/server';
import { requireBranchAdminAccess } from '@/lib/branch/context';
import { startBranchSmokeRun } from '@/lib/branch/branchSmokeService';
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
    const body = await req.json().catch(() => ({}));
    if (body.branchId !== undefined && Number(body.branchId) !== branchId) {
      return NextResponse.json(
        { ok: false, error: 'BranchID في الجسم غير مسموح' },
        { status: 400 },
      );
    }

    const run = await startBranchSmokeRun({
      branchId,
      actorUserId: admin.userId,
      purpose: String(body.purpose ?? 'phase1m-controlled-smoke'),
      beforeFingerprintJson:
        body.beforeFingerprintJson != null
          ? JSON.stringify(body.beforeFingerprintJson)
          : undefined,
    });

    return NextResponse.json({ ok: true, smokeRun: run });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/smoke/start]', err);
    return NextResponse.json({ ok: false, error: 'فشل بدء الـ smoke' }, { status: 500 });
  }
}
