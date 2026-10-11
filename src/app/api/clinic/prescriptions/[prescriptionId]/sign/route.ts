import { NextRequest, NextResponse } from 'next/server';
import {
  resolveClinicalActorForUser,
  signPrescription,
} from '@/apps/medical-records/internal/repository';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';

type Ctx = { params: Promise<{ prescriptionId: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const { prescriptionId } = await params;

  try {
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    if (!actor || actor.kind !== 'human') {
      return NextResponse.json(
        { error: 'اربط حساب الدخول بطبيب قبل توقيع الروشتة.' },
        { status: 403 },
      );
    }
    await signPrescription({
      tenantId: auth.tenantId,
      prescriptionId,
      actor,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر توقيع الروشتة';
    console.error('[api/clinic/prescriptions/[prescriptionId]/sign] POST error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
