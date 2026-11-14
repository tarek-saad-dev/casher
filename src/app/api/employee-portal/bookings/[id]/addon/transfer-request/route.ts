import { NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { requestAddonTransfer, ExtraServiceTransferError } from '@/lib/booking/addonTransfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
export async function POST(req: Request, { params }: Ctx) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  if (identity.mustChangePassword) {
    return NextResponse.json({ error: 'يجب تغيير كلمة المرور أولًا' }, { status: 403 });
  }
  const { id } = await params;
  const bookingId = Number(id);
  const body = await req.json().catch(() => null) as { proId?: number } | null;
  const proId = Number(body?.proId);
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0 ||
      !Number.isSafeInteger(proId) || proId <= 0) {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
  }
  try {
    const result = await requestAddonTransfer({
      bookingId, originalEmpId: identity.empId, tenantId: identity.tenantId, proId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ExtraServiceTransferError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[staff/addon-transfer-request]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر إرسال طلب التحويل للكاشير' }, { status: 503 });
  }
}
