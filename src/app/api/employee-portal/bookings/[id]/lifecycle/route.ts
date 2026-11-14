import { NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import {
  advanceStaffBookingPhase,
  STAFF_BOOKING_TRANSITIONS,
  type StaffBookingAction,
} from '@/lib/employee-portal/bookingLifecycle';

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
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json({ error: 'حجز غير صالح' }, { status: 400 });
  }
  const body = await req.json().catch(() => null) as { action?: string } | null;
  const action = body?.action;
  if (typeof action !== 'string' || !(action in STAFF_BOOKING_TRANSITIONS)) {
    return NextResponse.json({ error: 'مرحلة غير صالحة' }, { status: 400 });
  }
  const result = await advanceStaffBookingPhase({
    bookingId, empId: identity.empId, tenantId: identity.tenantId,
    action: action as StaffBookingAction,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
