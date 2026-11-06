import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import { resolveBranchDayAndShiftForWrite, branchErrorResponse } from '@/lib/branch/operationalGates';
import { claimHandoffForPos } from '@/lib/booking/cashierHandoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/pos/barber-handoffs/[id]/claim
 * Soft-lock + cart hydration payload. Manual POS path remains independent.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const session = await getSession();
    if (!session?.UserID || !session.TenantId) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const { id } = await params;
    const handoffId = Number(id);
    if (!Number.isInteger(handoffId) || handoffId <= 0) {
      return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
    }

    const gated = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gated.ok) return gated.response;
    const result = await claimHandoffForPos({
      handoffId,
      branchId: gated.branch.branchId,
      tenantId: String(session.TenantId),
      userId: session.UserID,
    });

    if (!result.ok) {
      if (result.error === 'locked') {
        return NextResponse.json(
          { error: 'مفتوح على جهاز آخر', code: 'locked', lockedByUserId: result.lockedByUserId },
          { status: 409 },
        );
      }
      if (result.error === 'branch_mismatch') {
        return NextResponse.json({ error: 'فرع غير مطابق' }, { status: 403 });
      }
      return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/barber-handoffs/claim]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
