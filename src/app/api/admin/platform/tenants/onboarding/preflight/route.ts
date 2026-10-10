import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { findIndustryPack } from '@/packs';
import { parseOnboardingRequest } from '@/platform/onboarding/wizard/parseRequest';
import { preflightOnboarding } from '@/platform/onboarding/wizard/preflight';
import { platformErrorResponse, readJsonBody } from '../../../_shared/platformErrors';

export const runtime = 'nodejs';

/** POST /api/admin/platform/tenants/onboarding/preflight — read-only checks before Create Business. */
export async function POST(req: NextRequest) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  try {
    const request = parseOnboardingRequest(await readJsonBody(req));
    return NextResponse.json(await preflightOnboarding(request, findIndustryPack));
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/onboarding/preflight] POST error:', err);
    return NextResponse.json({ error: 'Preflight failed' }, { status: 500 });
  }
}
