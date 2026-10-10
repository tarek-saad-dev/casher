import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { tenantLockResource } from './tenantLockResource';

export class TenantLockTimeoutError extends Error {
  readonly resource: string;

  constructor(resource: string) {
    super(`Tenant lock busy: ${resource}`);
    this.name = 'TenantLockTimeoutError';
    this.resource = resource;
  }
}

/** Transaction-owned exclusive applock on a tenant-scoped resource. */
export async function acquireTenantApplock(
  tx: Transaction,
  tenantId: string,
  parts: readonly string[],
  timeoutMs = 10000,
): Promise<string> {
  const resource = tenantLockResource(tenantId, parts);
  const result = await new sql.Request(tx)
    .input('resource', sql.NVarChar(255), resource)
    .input('timeout', sql.Int, timeoutMs)
    .query(`
      DECLARE @result INT;
      EXEC @result = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = @timeout;
      SELECT @result AS lockResult;
    `);
  const lockResult = Number(result.recordset[0]?.lockResult);
  if (lockResult !== 0 && lockResult !== 1) {
    throw new TenantLockTimeoutError(resource);
  }
  return resource;
}

/** One lock for subscription, installed-app and limit mutations of a tenant. */
export const TENANT_COMMERCIAL_LOCK_PARTS = ['platform', 'commercial'] as const;
