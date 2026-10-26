import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { resolveClinicalActorForUser } from '@/apps/medical-records/internal/repository';
import {
  createTreatmentPlan, listTreatmentPlans,
} from '@/apps/medical-records/internal/treatmentPlanRepository';
import {
  parseTreatmentUuid, validateTreatmentPlan, TreatmentPlanConflict,
} from '@/apps/medical-records/application/treatmentPlanPolicy';

const NO_STORE = { 'Cache-Control': 'no-store' };
async function doctorContext() {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
  if (!actor || actor.kind !== 'human') {
    return NextResponse.json({
      code: 'CLINIC_DOCTOR_NOT_LINKED',
      error: 'خطة الجلسات متاحة لحساب الطبيب المرتبط بالعيادة فقط.',
    }, { status: 403, headers: NO_STORE });
  }
  return {
    tenantId: auth.tenantId, branchId: auth.activeBranchId,
    userId: auth.userId, practitionerEmpId: actor.empId,
  };
}

export async function GET(req: NextRequest) {
  const auth = await doctorContext();
  if (auth instanceof NextResponse) return auth;
  const encounterId = parseTreatmentUuid(req.nextUrl.searchParams.get('encounterId'));
  if (!encounterId) {
    return NextResponse.json({ error: 'رقم الزيارة غير صحيح' }, { status: 400, headers: NO_STORE });
  }
  try {
    const plans = await listTreatmentPlans({ ...auth, encounterId });
    return NextResponse.json({ plans }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof TreatmentPlanConflict) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ error: 'تعذر تحميل خطة الجلسات. تأكد من Migration 016.' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  const auth = await doctorContext();
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'بيانات الخطة غير صحيحة' }, { status: 400, headers: NO_STORE });
  }
  const encounterId = parseTreatmentUuid(body.encounterId);
  const valid = validateTreatmentPlan(body);
  if (!encounterId || !valid.ok) {
    return NextResponse.json({
      error: !encounterId ? 'رقم الزيارة غير صحيح' : valid.error,
    }, { status: 400, headers: NO_STORE });
  }
  try {
    const planId = await createTreatmentPlan({ ...auth, encounterId, ...valid });
    return NextResponse.json({ planId }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof TreatmentPlanConflict) {
      return NextResponse.json({ error: err.message, code: err.code }, {
        status: err.code === 'NOT_FOUND' ? 404 : 409, headers: NO_STORE,
      });
    }
    return NextResponse.json({ error: 'تعذر إنشاء خطة العلاج. تأكد من Migration 016.' }, { status: 500, headers: NO_STORE });
  }
}
