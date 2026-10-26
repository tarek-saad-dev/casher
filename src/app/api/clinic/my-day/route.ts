import { NextRequest, NextResponse } from 'next/server';
import { getCairoCalendarDate } from '@/lib/businessDate';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { isClinicCalendarDate } from '@/apps/medical-records/application/appointmentHandoffPolicy';
import { resolveClinicalActorForUser } from '@/apps/medical-records/internal/repository';
import { listDoctorAppointments } from '@/apps/medical-records/internal/doctorWorklistRepository';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;

  const date = req.nextUrl.searchParams.get('date') ?? getCairoCalendarDate();
  if (!isClinicCalendarDate(date)) {
    return NextResponse.json({ error: 'تاريخ المواعيد غير صحيح' }, { status: 400, headers: NO_STORE });
  }

  try {
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    if (!actor || actor.kind !== 'human') {
      return NextResponse.json({
        code: 'CLINIC_DOCTOR_NOT_LINKED',
        error: 'حساب الدخول غير مربوط بطبيب. اطلب من إدارة العيادة ربط حسابك بالطبيب أولًا.',
      }, { status: 403, headers: NO_STORE });
    }
    const appointments = await listDoctorAppointments({
      tenantId: auth.tenantId,
      branchId: auth.activeBranchId,
      userId: auth.userId,
      practitionerEmpId: actor.empId,
      date,
    });
    return NextResponse.json({
      practitionerEmpId: actor.empId, date, appointments,
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'تعذر تحميل جدول الطبيب' }, { status: 500, headers: NO_STORE });
  }
}
