import 'server-only';
import { sql } from '@/lib/db';
import { BOOTSTRAP_TENANT_CODE } from '@/platform/tenant/types';
import type { SqlExecutor } from './planRepository';

export class BootstrapTenantProtectedError extends Error {
  readonly code = 'BOOTSTRAP_TENANT_PROTECTED' as const;
  readonly status = 409;

  constructor(operation: string) {
    super(
      `${BOOTSTRAP_TENANT_CODE} commercial and installed-app state is grandfathered and cannot be changed via ${operation}`,
    );
    this.name = 'BootstrapTenantProtectedError';
  }
}

/**
 * Explicit compatibility exception (DRVO-012): CASHER_BOOT keeps its
 * grandfathered internal/active subscription and every currently enabled app.
 * Platform mutation APIs must not change it.
 */
export async function assertNotBootstrapTenant(
  ex: SqlExecutor,
  tenantId: string,
  operation: string,
): Promise<void> {
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT Code FROM dbo.Tenant WHERE TenantId = @tenantId;`);
  const code = (result.recordset[0] as { Code?: string } | undefined)?.Code;
  if (code === BOOTSTRAP_TENANT_CODE) {
    throw new BootstrapTenantProtectedError(operation);
  }
}
