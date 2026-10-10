import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { buildJobTenantContext, isTenantContextError } from '@/platform/tenant/tenantContext';
import { runWithMessagingTenant } from './messagingTenantScope';

async function isActiveTenant(tenantId: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT 1 AS ok FROM dbo.Tenant WHERE TenantId = @tenantId AND Status = N'active';`);
  return result.recordset.length > 0;
}

/**
 * Internal messaging APIs (requireSystemJobAuth). A session caller acts in its own tenant; a
 * cron-bearer caller has no tenant and must name one (`x-tenant-id` header or `tenantId` query),
 * which must be an active tenant. Otherwise 400 — never a default tenant.
 */
export async function runWithSystemJobMessagingTenant(
  jobAuth: { tenantId: string | null },
  req: NextRequest,
  detail: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  if (jobAuth.tenantId) {
    return runWithMessagingTenant({ tenantId: jobAuth.tenantId, source: 'staff', detail }, fn);
  }
  const requested = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId');
  let tenantId: string;
  try {
    tenantId = buildJobTenantContext(requested, detail).tenantId;
  } catch (err) {
    if (!isTenantContextError(err)) throw err;
    return NextResponse.json(
      { ok: false, error: 'tenantId is required for system-job calls', code: 'TENANT_REQUIRED' },
      { status: 400 },
    );
  }
  if (!(await isActiveTenant(tenantId))) {
    return NextResponse.json(
      { ok: false, error: 'Unknown or inactive tenant', code: 'TENANT_NOT_FOUND' },
      { status: 404 },
    );
  }
  return runWithMessagingTenant({ tenantId, source: 'system-job', detail }, fn);
}
