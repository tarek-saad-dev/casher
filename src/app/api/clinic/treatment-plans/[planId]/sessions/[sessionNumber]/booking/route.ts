import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { resolveClinicalActorForUser } from '@/apps/medical-records/internal/repository';
import {
  parseTreatmentUuid, parseTreatmentInteger, TreatmentPlanConflict,
} from '@/apps/medical-records/application/treatmentPlanPolicy';
import { attachTreatmentSessionBooking } from '@/apps/medical-records/internal/treatmentPlanRepository';

type Ctx = { params: Promise<{ planId: string; sessionNumber: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Link existing Booking; never create appointments or record false completion. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
  if (!actor || actor.kind !== 'human') {
    return NextResponse.json({ error: 'الطبيب المسؤول فقط يقدر يربط الجلسات.' }, {
      status: 403, headers: NO_STORE,
    });
  }
  const routeParams = await params;
  const planId = parseTreatmentUuid(routeParams.planId);
  const sessionNumber = parseTreatmentInteger(routeParams.sessionNumber, 50);
  if (!planId || sessionNumber === null) {
    return NextResponse.json({ error: 'الجلسة المطلوبة غير صحيحة' }, { status: 400, headers: NO_STORE });
  }
  let bookingId: number | null = null;
  try {
    const value: unknown = await req.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      bookingId = parseTreatmentInteger((value as Record<string, unknown>).bookingId, 2147483647);
    }
  } catch { /* malformed JSON */ }
  if (bookingId === null) {
    return NextResponse.json({ error: 'ادخل رقم حجز صحيح من Booking' }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await attachTreatmentSessionBooking({
      tenantId: auth.tenantId, branchId: auth.activeBranchId,
      userId: auth.userId, practitionerEmpId: actor.empId,
      planId, sessionNumber, bookingId,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof TreatmentPlanConflict) {
      return NextResponse.json({ error: err.message, code: err.code }, {
        status: err.code === 'NOT_FOUND' ? 404 : 409, headers: NO_STORE,
      });
    }
    return NextResponse.json({ error: 'تعذر ربط الجلسة بالحجز. تأكد من Migration 016.' }, {
      status: 500, headers: NO_STORE,
    });
  }
}
