import { NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getMaskedBookingDetailForEmployee } from '@/lib/employee-portal/todayBookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (identity.mustChangePassword) {
    return NextResponse.json({ error: 'يجب تغيير كلمة المرور أولاً' }, { status: 403 });
  }

  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json({ error: 'حجز غير صالح' }, { status: 400 });
  }

  try {
    const booking = await getMaskedBookingDetailForEmployee({
      bookingId,
      empId: identity.empId,
      tenantId: identity.tenantId,
    });
    if (!booking) {
      return NextResponse.json({ error: 'الحجز غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ booking });
  } catch (error) {
    console.error('[employee-portal/bookings/id]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر تحميل الحجز' }, { status: 500 });
  }
}
