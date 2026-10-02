import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { sql, getPool } from '@/lib/db';
import { evaluateTenantReadiness } from '@/platform/onboarding/tenantReadiness';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/** GET /api/admin/platform/tenants/:tenantId/readiness */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const pool = await getPool();
  const exists = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT 1 AS ok FROM dbo.Tenant WHERE TenantId = @tenantId;`);

  if (!exists.recordset.length) {
    return NextResponse.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, { status: 404 });
  }

  const report = await evaluateTenantReadiness(tenantId, pool);
  return NextResponse.json(report);
}
