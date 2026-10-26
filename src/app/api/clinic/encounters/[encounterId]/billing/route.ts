import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTenantApp } from '@/lib/api-auth';
import { parseClinicEncounterId } from '@/apps/medical-records/application/clinicBillingPolicy';
import { getClinicBillingPreview } from '@/apps/medical-records/internal/clinicBillingRepository';

type Ctx = { params: Promise<{ encounterId: string }> };
const noStore = { 'Cache-Control': 'no-store' };

/** Only administrative billing metadata. No diagnosis, history or prescriptions. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;
  const raw = (await params).encounterId;
  const encounterId = parseClinicEncounterId(raw);
  if (!encounterId) {
    return NextResponse.json({ error: 'رقم الزيارة غير صحيح' }, { status: 400, headers: noStore });
  }
  try {
    const preview = await getClinicBillingPreview({
      tenantId: auth.tenantId, branchId: auth.activeBranchId, encounterId,
    });
    if (!preview) {
      return NextResponse.json({ error: 'الزيارة غير موجودة في الفرع الحالي' }, { status: 404, headers: noStore });
    }
    return NextResponse.json(preview, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'تعذر تحميل بيانات الحساب. تأكد من تطبيق Migration 015.' }, { status: 500, headers: noStore });
  }
}
