import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { getPool } from '@/lib/db';
import { evaluateCommercialAccess } from '@/platform/commercial/commercialAccess';
import { tenantExists } from '@/platform/commercial/planRepository';
import { invalidTenantIdResponse } from '../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/** GET /api/admin/platform/tenants/:tenantId/commercial-access — policy report (not enforcement). */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  const pool = await getPool();
  if (!(await tenantExists(pool, tenantId))) {
    return NextResponse.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, { status: 404 });
  }
  const report = await evaluateCommercialAccess(tenantId, { executor: pool });
  return NextResponse.json(report);
}
