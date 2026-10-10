import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { findIndustryPack } from '@/packs';
import { defaultOnboardingDeps, onboardBusiness } from '@/platform/onboarding/wizard/coordinator';
import { parseOnboardingRequest } from '@/platform/onboarding/wizard/parseRequest';
import { platformErrorResponse, readJsonBody } from '../../_shared/platformErrors';

export const runtime = 'nodejs';

/**
 * POST /api/admin/platform/tenants/onboarding — Create Business from the onboarding wizard.
 * Core provisioning (provisionTenant) runs once; setup stages follow and report per stage.
 * 201 when the business exists, even if a setup stage needs attention (see `complete`).
 */
export async function POST(req: NextRequest) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  try {
    const request = parseOnboardingRequest(await readJsonBody(req));
    const result = await onboardBusiness(
      request,
      { actorUserId: auth.userId, actorUserName: auth.userName },
      defaultOnboardingDeps(findIndustryPack),
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/onboarding] POST error:', err);
    return NextResponse.json({ error: 'Business creation failed' }, { status: 500 });
  }
}
