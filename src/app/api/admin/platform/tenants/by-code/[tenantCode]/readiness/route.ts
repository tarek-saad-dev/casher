import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { findIndustryPack } from '@/packs';
import { getTenantByCode } from '@/platform/onboarding/provisionTenant';
import { evaluateTenantReadiness } from '@/platform/onboarding/tenantReadiness';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantCode: string }> };

/** GET /api/admin/platform/tenants/by-code/:tenantCode/readiness */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantCode } = await params;
  const tenant = await getTenantByCode(tenantCode);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, { status: 404 });
  }

  const report = await evaluateTenantReadiness(tenant.tenantId, undefined, {
    resolvePack: findIndustryPack,
  });
  return NextResponse.json(report);
}
