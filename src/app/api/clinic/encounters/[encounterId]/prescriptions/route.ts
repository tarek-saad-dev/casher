import { NextRequest, NextResponse } from 'next/server';
import {
  createPrescriptionDraft,
  getEncounterWorkspace,
  resolveClinicalActorForUser,
} from '@/apps/medical-records/internal/repository';
import type { ClinicPrescriptionItem } from '@/apps/medical-records/public';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';

type Ctx = { params: Promise<{ encounterId: string }> };

function optionalText(value: unknown, max: number): string | null {
  const text = String(value ?? '').trim().slice(0, max);
  return text || null;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const { encounterId } = await params;

  try {
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    if (!actor || actor.kind !== 'human') {
      return NextResponse.json(
        { error: 'اربط حساب الدخول بطبيب قبل إنشاء روشتة.' },
        { status: 403 },
      );
    }

    const workspace = await getEncounterWorkspace(auth.tenantId, encounterId);
    if (!workspace) {
      return NextResponse.json({ error: 'الزيارة غير موجودة' }, { status: 404 });
    }
    const encounter = workspace.encounter as Record<string, unknown>;
    if (Number(encounter.PractitionerEmpID) !== actor.empId) {
      return NextResponse.json({ error: 'الروشتة لازم ينشئها طبيب الزيارة.' }, { status: 403 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: ClinicPrescriptionItem[] = rawItems.slice(0, 30).map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        medicationName: String(item.medicationName ?? '').trim().slice(0, 200),
        strength: optionalText(item.strength, 100),
        dosage: optionalText(item.dosage, 100),
        route: optionalText(item.route, 100),
        frequency: optionalText(item.frequency, 100),
        duration: optionalText(item.duration, 100),
        instructions: optionalText(item.instructions, 1000),
      };
    });
    if (!items.length || items.some((item) => !item.medicationName)) {
      return NextResponse.json({ error: 'أضف دواء واحد على الأقل باسم صحيح.' }, { status: 400 });
    }

    const prescriptionId = await createPrescriptionDraft({
      tenantId: auth.tenantId,
      encounterId,
      actor,
      notes: optionalText(body.notes, 4000),
      items,
    });
    return NextResponse.json({ prescriptionId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر إنشاء الروشتة';
    console.error('[api/clinic/encounters/[encounterId]/prescriptions] POST error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
