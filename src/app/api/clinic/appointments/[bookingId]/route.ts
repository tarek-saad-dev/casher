import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { parseClinicBookingId } from '@/apps/medical-records/application/appointmentHandoffPolicy';
import {
  ClinicAppointmentConflict,
  transitionClinicAppointment,
} from '@/apps/medical-records/internal/appointmentHandoffRepository';
import type { ClinicVisitType } from '@/apps/medical-records/public/types';

type Ctx = { params: Promise<{ bookingId: string }> };
const visitTypes = new Set<ClinicVisitType>(['new', 'follow_up', 'procedure']);

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const { bookingId: rawBookingId } = await params;
  const bookingId = parseClinicBookingId(rawBookingId);
  if (bookingId === null) {
    return NextResponse.json({ error: 'رقم الحجز غير صحيح' }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'الطلب غير صحيح' }, { status: 400 });
  }
  if (body.action !== 'arrive' && body.action !== 'start') {
    return NextResponse.json({ error: 'عملية غير مدعومة' }, { status: 400 });
  }
  const visitType = body.visitType === undefined ? 'new' : body.visitType;
  if (body.action === 'start' && !visitTypes.has(visitType as ClinicVisitType)) {
    return NextResponse.json({ error: 'نوع الزيارة غير صحيح' }, { status: 400 });
  }
  try {
    const result = await transitionClinicAppointment({
      tenantId: auth.tenantId,
      branchId: auth.activeBranchId,
      locationId: auth.tenant.activeLocation.locationId,
      bookingId,
      actorUserId: auth.userId,
      action: body.action,
      visitType: body.action === 'start' ? (visitType as ClinicVisitType) : undefined,
    });
    return NextResponse.json(result, {
      status: result.reused ? 200 : body.action === 'start' ? 201 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof ClinicAppointmentConflict) {
      const status = err.code === 'NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json({ error: 'تعذر تحديث الحجز أو بدء الكشف' }, { status: 500 });
  }
}
