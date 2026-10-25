import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { getCairoCalendarDate } from '@/lib/businessDate';
import { isClinicCalendarDate } from '@/apps/medical-records/application/appointmentHandoffPolicy';
import { listClinicAppointments } from '@/apps/medical-records/internal/appointmentHandoffRepository';

export async function GET(req: NextRequest) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const date = req.nextUrl.searchParams.get('date') ?? getCairoCalendarDate();
  if (!isClinicCalendarDate(date)) {
    return NextResponse.json({ error: 'تاريخ المواعيد غير صحيح' }, { status: 400 });
  }
  try {
    const appointments = await listClinicAppointments({
      tenantId: auth.tenantId,
      branchId: auth.activeBranchId,
      date,
    });
    return NextResponse.json({ appointments }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'تعذر تحميل مواعيد العيادة' }, { status: 500 });
  }
}
