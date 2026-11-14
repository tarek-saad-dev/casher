import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import { resolveBranchDayAndShiftForWrite, branchErrorResponse } from '@/lib/branch/operationalGates';
import { markHandoffCharged } from '@/lib/booking/cashierHandoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Repair a previously *paid* invoice link, never create a sale here. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;
  const session = await getSession();
  if (!session?.UserID || !session.TenantId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  const { id } = await params;
  const handoffId = Number(id);
  const body = await req.json().catch(() => null) as { invId?: number; invType?: string } | null;
  const invId = Number(body?.invId);
  if (!Number.isSafeInteger(handoffId) || handoffId <= 0 ||
      !Number.isSafeInteger(invId) || invId <= 0 ||
      (body?.invType !== undefined && body.invType !== 'مبيعات')) {
    return NextResponse.json({ error: 'بيانات الفاتورة غير صالحة' }, { status: 400 });
  }
  try {
    const gated = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gated.ok) return gated.response;
    const linked = await markHandoffCharged({
      handoffId,
      branchId: gated.branch.branchId,
      tenantId: String(session.TenantId),
      invId,
      invType: 'مبيعات',
    });
    if (!linked) {
      return NextResponse.json({
        error: 'تعذر الربط: راجع رقم الفاتورة والعميل والفرع والخدمات والمحصل',
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true, handoffId, invId });
  } catch (error) {
    const mapped = branchErrorResponse(error);
    if (mapped) return mapped;
    console.error('[pos/handoff-reconcile]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر تأكيد ربط الفاتورة، ولازم نراجع الحجز' }, { status: 503 });
  }
}
