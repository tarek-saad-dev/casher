import { NextRequest, NextResponse } from 'next/server';
import { requireBranchAdminAccess } from '@/lib/branch/context';
import { getBranchSmokeRun } from '@/lib/branch/branchSmokeService';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; runId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const { id, runId } = await ctx.params;
    const branchId = Number(id);
    const smokeRunId = Number(runId);
    if (!Number.isFinite(branchId) || !Number.isFinite(smokeRunId)) {
      return NextResponse.json({ ok: false, error: 'معرف غير صالح' }, { status: 400 });
    }
    const smokeRun = await getBranchSmokeRun(branchId, smokeRunId);
    return NextResponse.json({ ok: true, smokeRun });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/smoke GET]', err);
    return NextResponse.json({ ok: false, error: 'فشل قراءة الـ smoke' }, { status: 500 });
  }
}
