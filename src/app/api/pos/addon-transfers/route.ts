import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import { resolveBranchDayAndShiftForWrite, branchErrorResponse } from '@/lib/branch/operationalGates';
import { listPendingAddonTransfers } from '@/lib/booking/addonTransfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;
  try {
    const session = await getSession();
    if (!session?.UserID || !session.TenantId) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }
    const gate = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gate.ok) return NextResponse.json({ items: [], count: 0, reason: 'no_open_shift' });
    const items = await listPendingAddonTransfers({
      branchId: gate.branch.branchId, tenantId: String(session.TenantId),
    });
    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    const mapped = branchErrorResponse(error);
    if (mapped) return NextResponse.json({ items: [], count: 0, reason: 'no_open_shift' });
    console.error('[pos/addon-transfers]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر تحميل طلبات الخدمات الإضافية' }, { status: 503 });
  }
}
