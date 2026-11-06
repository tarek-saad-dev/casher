import { NextRequest, NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { listPortalServicesForEmployee } from '@/lib/employee-portal/todayBookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (identity.mustChangePassword) {
    return NextResponse.json({ error: 'يجب تغيير كلمة المرور أولاً' }, { status: 403 });
  }

  const search = req.nextUrl.searchParams.get('q') ?? '';

  try {
    const services = await listPortalServicesForEmployee({
      tenantId: identity.tenantId,
      search,
    });
    // Names + duration only — never prices for staff portal privacy.
    return NextResponse.json({ services });
  } catch (error) {
    console.error('[employee-portal/services]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر تحميل الخدمات' }, { status: 500 });
  }
}
