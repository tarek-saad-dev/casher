import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { evaluateTenantGoLive } from '@/platform/onboarding/goLiveReadiness';
import { invalidTenantIdResponse } from '../../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/** GET /api/admin/platform/tenants/:tenantId/go-live */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  const report = await evaluateTenantGoLive(tenantId);
  if (!report) {
    return NextResponse.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 },
    );
  }
  return NextResponse.json(report);
}
