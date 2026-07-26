import { NextRequest, NextResponse } from 'next/server';
import { requireBranchAdminAccess } from '@/lib/branch/context';
import { cleanupBranchSmokeRun } from '@/lib/branch/branchSmokeService';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; runId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const { id, runId } = await ctx.params;
    const branchId = Number(id);
    const smokeRunId = Number(runId);
    if (!Number.isFinite(branchId) || !Number.isFinite(smokeRunId)) {
      return NextResponse.json({ ok: false, error: 'معرف غير صالح' }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    if (body.branchId !== undefined && Number(body.branchId) !== branchId) {
      return NextResponse.json(
        { ok: false, error: 'BranchID في الجسم غير مسموح' },
        { status: 400 },
      );
    }

    const result = await cleanupBranchSmokeRun({
      branchId,
      smokeRunId,
      actorUserId: admin.userId,
      markArtifactsCleaned: body.markArtifactsCleaned !== false,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/smoke/cleanup]', err);
    return NextResponse.json({ ok: false, error: 'فشل تنظيف الـ smoke' }, { status: 500 });
  }
}
