import { NextRequest, NextResponse } from 'next/server';
import { requireBranchAdminAccess } from '@/lib/branch/context';
import { evaluateBranchReadiness } from '@/lib/branch/branchReadinessService';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** POST — force re-evaluate readiness (same as GET; audit-friendly). */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await ctx.params;
    const branchId = Number(id);
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'معرف فرع غير صالح' }, { status: 400 });
    }
    const readiness = await evaluateBranchReadiness(branchId);
    return NextResponse.json({ ok: true, rechecked: true, readiness });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/readiness/recheck]', err);
    return NextResponse.json({ ok: false, error: 'فشل إعادة التقييم' }, { status: 500 });
  }
}
