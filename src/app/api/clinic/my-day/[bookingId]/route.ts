import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { parseClinicBookingId } from '@/apps/medical-records/application/appointmentHandoffPolicy';
import { resolveClinicalActorForUser } from '@/apps/medical-records/internal/repository';
import {
  ClinicAppointmentConflict,
  transitionClinicAppointment,
} from '@/apps/medical-records/internal/appointmentHandoffRepository';
import type { ClinicVisitType } from '@/apps/medical-records/public/types';

type Ctx = { params: Promise<{ bookingId: string }> };
const visitTypes = new Set<ClinicVisitType>(['new', 'follow_up', 'procedure']);
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Doctor-only handoff: no receptionist check-in and no doctor ID supplied by client. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const { bookingId: rawBookingId } = await params;
  const bookingId = parseClinicBookingId(rawBookingId);
  if (bookingId === null) {
    return NextResponse.json({ error: 'رقم الحجز غير صحيح' }, { status: 400, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'الطلب غير صحيح' }, { status: 400, headers: NO_STORE });
  }

  if (body.action !== 'start') {
    return NextResponse.json({ error: 'الطبيب يقدر يبدأ الكشف فقط من جدول اليوم.' }, { status: 400, headers: NO_STORE });
  }
  const visitType = body.visitType ?? 'new';
  if (!visitTypes.has(visitType as ClinicVisitType)) {
    return NextResponse.json({ error: 'نوع الزيارة غير صحيح' }, { status: 400, headers: NO_STORE });
  }

  try {
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    if (!actor || actor.kind !== 'human') {
      return NextResponse.json({
        code: 'CLINIC_DOCTOR_NOT_LINKED',
        error: 'لازم يتم ربط حسابك بطبيب قبل بدء الكشف.',
      }, { status: 403, headers: NO_STORE });
    }

    const result = await transitionClinicAppointment({
      tenantId: auth.tenantId,
      branchId: auth.activeBranchId,
      locationId: auth.tenant.activeLocation.locationId,
      bookingId,
      actorUserId: auth.userId,
      expectedPractitionerEmpId: actor.empId,
      action: 'start',
      visitType: visitType as ClinicVisitType,
    });

    return NextResponse.json(result, {
      status: result.reused ? 200 : 201,
      headers: NO_STORE,
    });
  } catch (err) {
    if (err instanceof ClinicAppointmentConflict) {
      return NextResponse.json({
        error: err.message,
        code: err.code,
      }, { status: err.code === 'NOT_FOUND' ? 404 : 409, headers: NO_STORE });
    }
    return NextResponse.json({ error: 'تعذر بدء الكشف' }, { status: 500, headers: NO_STORE });
  }
}
