import { NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getMaskedTodayBookingsForEmployee } from '@/lib/employee-portal/todayBookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (identity.mustChangePassword) {
    return NextResponse.json({ error: 'يجب تغيير كلمة المرور أولاً' }, { status: 403 });
  }

  try {
    const bookings = await getMaskedTodayBookingsForEmployee({
      empId: identity.empId,
      tenantId: identity.tenantId,
    });
    return NextResponse.json({ bookings });
  } catch (error) {
    console.error('[employee-portal/bookings/today]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر تحميل الحجوزات' }, { status: 500 });
  }
}
