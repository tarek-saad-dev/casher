import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(__dirname, '..', '..', '..', 'db', 'drvo-migrations', '014-tenant-plan-requests', 'schema.sql');

export async function verifyTenantPlanRequestSchema(pool: ConnectionPool): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const table = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TenantPlanChangeRequest', N'U') IS NULL THEN 0 ELSE 1 END AS ok;`);
  if (Number(table.recordset[0]?.ok) !== 1) return { ok: false, failures: ['Missing TenantPlanChangeRequest'] };
  for (const column of [
    'RequestId','TenantId','FromPlanCode','RequestedPlanCode','BillingCycle','QuotedAmountEgp',
    'SubscriptionRevision','Status','RequestedByUserId','CreatedAt','UpdatedAt',
    'ReviewedAt','ReviewedByUserId','ReviewNote',
  ]) {
    const r = await pool.request().input('column', column).query(`
      SELECT CASE WHEN COL_LENGTH(N'dbo.TenantPlanChangeRequest', @column) IS NULL THEN 0 ELSE 1 END AS ok;`);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push('Missing TenantPlanChangeRequest.' + column);
  }
  for (const index of ['UX_TenantPlanChangeRequest_PendingTenant','IX_TenantPlanChangeRequest_Queue','IX_TenantPlanChangeRequest_TenantHistory']) {
    const r = await pool.request().input('name', index).query(`
      SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.TenantPlanChangeRequest') AND name=@name)
        THEN 1 ELSE 0 END AS ok;`);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push('Missing index ' + index);
  }
  return { ok: failures.length === 0, failures };
}

export const tenantPlanRequestsMigration: DrvoMigrationDefinition = {
  migrationId: 14,
  migrationKey: 'tenant-plan-requests',
  name: 'DRVO tenant plan quote and manual review requests (no payment collection)',
  dependencies: ['commercial-subscription-tenant-apps'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema', risk: 'LOW', requiresBackup: false, lockProfile: 'short',
    rollbackStrategy: 'Additive only; revert the feature code without dropping the request/audit table.',
  },
  async apply(ctx) { await executeSqlFile(ctx.pool, SCHEMA); },
  async verify(ctx) { return verifyTenantPlanRequestSchema(ctx.pool); },
  async reconcileBaseline(ctx) { return (await verifyTenantPlanRequestSchema(ctx.pool)).ok; },
};
