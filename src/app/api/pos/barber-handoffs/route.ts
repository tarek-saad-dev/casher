import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import {
  resolveBranchDayAndShiftForWrite,
  resolveOpenShiftBranchForRead,
  branchErrorResponse,
} from '@/lib/branch/operationalGates';
import { listPendingHandoffsForBranch } from '@/lib/booking/cashierHandoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/barber-handoffs
 * Optional inbox for the open-shift branch. Empty list is normal — POS stays usable.
 */
export async function GET() {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const session = await getSession();
    if (!session?.UserID || !session.TenantId) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    // This GET is polled every ~12s by the POS, so it takes the read-only fast path
    // (open shift's branch + access check). Claiming still uses the full write gate.
    let branchId: number;
    const shiftBranch = await resolveOpenShiftBranchForRead(session.UserID);
    if (shiftBranch) {
      branchId = shiftBranch.branchId;
    } else {
      const gated = await resolveBranchDayAndShiftForWrite(session.UserID);
      if (!gated.ok) {
        // No open shift / day → empty inbox (do not block POS UI).
        return NextResponse.json({ items: [], count: 0, reason: 'no_open_shift' });
      }
      branchId = gated.branch.branchId;
    }
    const items = await listPendingHandoffsForBranch({
      branchId,
      tenantId: String(session.TenantId),
      viewerUserId: session.UserID,
    });

    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    const mapped = branchErrorResponse(err);
    if (mapped) {
      return NextResponse.json({ items: [], count: 0, reason: 'no_open_shift' });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/barber-handoffs]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
