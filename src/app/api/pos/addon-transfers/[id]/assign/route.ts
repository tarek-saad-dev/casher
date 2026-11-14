import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import { resolveBranchDayAndShiftForWrite, branchErrorResponse } from '@/lib/branch/operationalGates';
import { assignAddonTransfer, ExtraServiceTransferError } from '@/lib/booking/addonTransfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;
  const session = await getSession();
  if (!session?.UserID || !session.TenantId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  const { id } = await params;
  const requestId = Number(id);
  const body = await req.json().catch(() => null) as
    | { empId?: number; startAt?: string } | null;
  if (!Number.isSafeInteger(requestId) || requestId <= 0 ||
      !Number.isSafeInteger(Number(body?.empId)) ||
      typeof body?.startAt !== 'string') {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
  }
  try {
    const gate = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gate.ok) return gate.response;
    const result = await assignAddonTransfer({
      requestId, assignedEmpId: Number(body.empId), proposedStartAt: body.startAt,
      tenantId: String(session.TenantId), branchId: gate.branch.branchId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = branchErrorResponse(error);
    if (mapped) return mapped;
    if (error instanceof ExtraServiceTransferError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[pos/addon-transfer-assign]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر تأكيد نقل الخدمة — لم يتم حجزها' }, { status: 503 });
  }
}
