import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { openEncounter } from '@/apps/medical-records/internal/repository';
import type { ClinicVisitType } from '@/apps/medical-records/public';

const VISIT_TYPES = new Set<ClinicVisitType>(['new', 'follow_up', 'procedure']);

export async function POST(req: NextRequest) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const clientId = Number(body.clientId);
    const practitionerEmpId = Number(body.practitionerEmpId);
    const visitType = String(body.visitType ?? 'new') as ClinicVisitType;
    const chiefComplaint = String(body.chiefComplaint ?? '').trim().slice(0, 1000) || null;

    if (!Number.isInteger(clientId) || clientId <= 0) {
      return NextResponse.json({ error: 'اختار مريض صحيح' }, { status: 400 });
    }
    if (!Number.isInteger(practitionerEmpId) || practitionerEmpId <= 0) {
      return NextResponse.json({ error: 'اختار الطبيب' }, { status: 400 });
    }
    if (!VISIT_TYPES.has(visitType)) {
      return NextResponse.json({ error: 'نوع الزيارة غير صحيح' }, { status: 400 });
    }

    const encounterId = await openEncounter({
      tenantId: auth.tenantId,
      clientId,
      practitionerEmpId,
      locationId: auth.tenant.activeLocation.locationId,
      visitType,
      chiefComplaint,
      actorUserId: auth.userId,
    });

    return NextResponse.json({ encounterId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر بدء الزيارة';
    console.error('[api/clinic/encounters] POST error:', message);
    return NextResponse.json({ error: 'تعذر بدء الزيارة' }, { status: 500 });
  }
}
