import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import { resolveBranchDayAndShiftForWrite, branchErrorResponse } from '@/lib/branch/operationalGates';
import { getTransferAlternatives, ExtraServiceTransferError } from '@/lib/booking/addonTransfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;
  const session = await getSession();
  if (!session?.UserID || !session.TenantId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
  }
  try {
    const gate = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gate.ok) return gate.response;
    const preview = await getTransferAlternatives({
      requestId, branchId: gate.branch.branchId,
      tenantId: String(session.TenantId),
    });
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const mapped = branchErrorResponse(error);
    if (mapped) return mapped;
    if (error instanceof ExtraServiceTransferError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[pos/addon-alternatives]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر فحص مواعيد البدائل' }, { status: 503 });
  }
}
