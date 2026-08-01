import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { assignPartnerHomeBranch } from '@/lib/branch/partnerHomeBranch';
import { BranchDomainError } from '@/lib/branch';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/partners/[userId]/branch
 * Body: { branchId: number }
 * Sets the partner's home/default branch (login + partners report scope).
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
) {
  try {
    const auth = await requireAdmin();
    if (!isAuthResult(auth)) return auth;

    const { userId: raw } = await ctx.params;
    const userId = Number(raw);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: 'معرف مستخدم غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const branchId = Number(body?.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return NextResponse.json({ error: 'معرف الفرع مطلوب' }, { status: 400 });
    }

    const result = await assignPartnerHomeBranch({
      userId,
      branchId,
      actorUserId: auth.userId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/partners/[userId]/branch] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
