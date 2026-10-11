import { NextRequest, NextResponse } from 'next/server';
import {
  completeEncounter,
  getEncounterWorkspace,
  resolveClinicalActorForUser,
  saveEncounterDraft,
  upsertPatientProfile,
} from '@/apps/medical-records/internal/repository';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';

type Ctx = { params: Promise<{ encounterId: string }> };

function cleanNullable(value: unknown, max = 10000): string | null {
  const text = String(value ?? '').trim().slice(0, max);
  return text || null;
}

function parseFollowUp(value: unknown): Date | null {
  if (value == null || String(value).trim() === '') return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('تاريخ المتابعة غير صحيح');
  return date;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const { encounterId } = await params;

  try {
    const workspace = await getEncounterWorkspace(auth.tenantId, encounterId);
    if (!workspace) {
      return NextResponse.json({ error: 'الزيارة غير موجودة' }, { status: 404 });
    }
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    const encounter = workspace.encounter as Record<string, unknown>;
    const assigned =
      actor?.kind === 'human' &&
      Number(encounter.PractitionerEmpID) === Number(actor.empId);

    if (!assigned) {
      return NextResponse.json({
        encounter: {
          ...encounter,
          ClinicalNotes: null,
          DiagnosisSummary: null,
          VitalsJson: null,
          FollowUpAt: null,
        },
        patientProfile: null,
        history: [],
        prescriptions: [],
        clinicalAccess: {
          linked: actor?.kind === 'human',
          practitionerEmpId: actor?.kind === 'human' ? actor.empId : null,
          assigned: false,
        },
      });
    }

    return NextResponse.json({
      ...workspace,
      clinicalAccess: {
        linked: true,
        practitionerEmpId: actor.empId,
        assigned: true,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر تحميل الزيارة';
    console.error('[api/clinic/encounters/[encounterId]] GET error:', message);
    return NextResponse.json({ error: 'تعذر تحميل الزيارة' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const { encounterId } = await params;

  try {
    const actor = await resolveClinicalActorForUser(auth.tenantId, auth.userId);
    if (!actor || actor.kind !== 'human') {
      return NextResponse.json(
        { error: 'اربط حساب الدخول بطبيب قبل تسجيل بيانات طبية أو تشخيص.' },
        { status: 403 },
      );
    }

    const current = await getEncounterWorkspace(auth.tenantId, encounterId);
    if (!current) {
      return NextResponse.json({ error: 'الزيارة غير موجودة' }, { status: 404 });
    }
    const encounter = current.encounter as Record<string, unknown>;
    if (Number(encounter.PractitionerEmpID) !== actor.empId) {
      return NextResponse.json(
        { error: 'الطبيب المربوط بهذا الحساب ليس الطبيب المسؤول عن الزيارة.' },
        { status: 403 },
      );
    }

    if (String(encounter.Status) !== 'in_progress') {
      return NextResponse.json(
        { error: 'الزيارة ليست في حالة جارية ولا يمكن تعديلها.' },
        { status: 409 },
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action === 'complete' ? 'complete' : 'save';
    const vitals =
      body.vitals && typeof body.vitals === 'object' && !Array.isArray(body.vitals)
        ? (body.vitals as Record<string, unknown>)
        : null;
    const followUpAt = parseFollowUp(body.followUpAt);

    const profile =
      body.patientProfile && typeof body.patientProfile === 'object'
        ? (body.patientProfile as Record<string, unknown>)
        : null;
    if (profile) {
      await upsertPatientProfile(
        auth.tenantId,
        Number(encounter.ClientID),
        {
          bloodType: cleanNullable(profile.bloodType, 8),
          allergies: cleanNullable(profile.allergies),
          chronicConditions: cleanNullable(profile.chronicConditions),
          currentMedications: cleanNullable(profile.currentMedications),
          emergencyContactName: cleanNullable(profile.emergencyContactName, 100),
          emergencyContactPhone: cleanNullable(profile.emergencyContactPhone, 32),
          notes: cleanNullable(profile.notes),
        },
        auth.userId,
      );
    }

    const mutation = {
      tenantId: auth.tenantId,
      encounterId,
      actor,
      clinicalNotes: cleanNullable(body.clinicalNotes),
      diagnosisSummary: cleanNullable(body.diagnosisSummary),
      vitals,
      followUpAt,
    };

    if (action === 'complete') {
      await completeEncounter(mutation);
    } else {
      await saveEncounterDraft(mutation);
    }

    const updated = await getEncounterWorkspace(auth.tenantId, encounterId);
    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر حفظ الزيارة';
    console.error('[api/clinic/encounters/[encounterId]] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
