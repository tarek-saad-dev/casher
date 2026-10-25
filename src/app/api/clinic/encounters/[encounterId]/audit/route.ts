import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { resolveClinicalActorForUser } from '@/apps/medical-records/internal/repository';
import { listEncounterAuditForClinician } from '@/apps/medical-records/internal/encounterAuditRepository';
import { isAuthenticatedClinicalReader, isClinicUuid } from '@/apps/medical-records/application/encounterAuditPolicy';

type Context = { params: Promise<{ encounterId: string }> };
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

function hidden(): NextResponse {
  return NextResponse.json({ error: 'غير موجود', code: 'NOT_FOUND' }, { status: 404, headers: NO_STORE });
}

/** No patient identifiers, clinical content or audit metadata in this endpoint. */
export async function GET(_request: NextRequest, { params }: Context) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;

  const { encounterId } = await params;
  if (!isClinicUuid(encounterId)) return hidden();

  try {
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    if (!isAuthenticatedClinicalReader(actor, auth.userId)) return hidden();

    const events = await listEncounterAuditForClinician({
      tenantId: auth.tenantId,
      encounterId,
      actor,
    });
    if (events === null) return hidden();

    return NextResponse.json({ events }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: 'تعذر تحميل سجل المراجعة' },
      { status: 500, headers: NO_STORE },
    );
  }
}
