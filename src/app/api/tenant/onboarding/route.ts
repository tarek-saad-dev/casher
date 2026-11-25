import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { evaluateTenantGoLive } from '@/platform/onboarding/goLiveReadiness';
import { buildSelfServiceJourney } from '@/platform/onboarding/selfServiceJourney';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only: tenant always comes from the verified staff session, never a query parameter. */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const report = await evaluateTenantGoLive(auth.tenantId);
    if (!report || report.tenantId.toLowerCase() !== auth.tenantId.toLowerCase()) {
      return NextResponse.json(
        { ok: false, code: 'TENANT_NOT_FOUND', error: 'المنشأة غير موجودة.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, journey: buildSelfServiceJourney(report) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[tenant/onboarding] read failed:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, code: 'SETUP_UNAVAILABLE', error: 'تعذر تحميل خطوات التجهيز. حاول مرة تانية.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
