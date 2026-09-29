import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '006-treasury-movement-registry',
  'schema.sql',
);

export async function verifyTreasuryMovementSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const check = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NULL THEN 0 ELSE 1 END AS registry,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL THEN 0 ELSE 1 END AS reversalOf,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL THEN 0 ELSE 1 END AS isReversed,
      CASE WHEN COL_LENGTH(N'dbo.TreasuryMovementRegistry', N'TenantId') IS NULL THEN 0 ELSE 1 END AS tenantCol,
      CASE WHEN COL_LENGTH(N'dbo.TreasuryMovementRegistry', N'IdempotencyKey') IS NULL THEN 0 ELSE 1 END AS idemCol,
      CASE WHEN COL_LENGTH(N'dbo.TreasuryMovementRegistry', N'Fingerprint') IS NULL THEN 0 ELSE 1 END AS fpCol,
      CASE WHEN COL_LENGTH(N'dbo.TreasuryMovementRegistry', N'Kind') IS NULL THEN 0 ELSE 1 END AS kindCol,
      CASE WHEN COL_LENGTH(N'dbo.TreasuryMovementRegistry', N'CashMoveId') IS NULL THEN 0 ELSE 1 END AS cashCol;
  `);
  const row = check.recordset[0] as Record<string, number> | undefined;
  if (!row || Number(row.registry) !== 1) failures.push('TreasuryMovementRegistry missing');
  if (!row || Number(row.reversalOf) !== 1) failures.push('TblCashMove.ReversalOfCashMoveId missing');
  if (!row || Number(row.isReversed) !== 1) failures.push('TblCashMove.IsReversed missing');
  if (row && Number(row.registry) === 1) {
    if (Number(row.tenantCol) !== 1) failures.push('TreasuryMovementRegistry.TenantId missing');
    if (Number(row.idemCol) !== 1) failures.push('TreasuryMovementRegistry.IdempotencyKey missing');
    if (Number(row.fpCol) !== 1) failures.push('TreasuryMovementRegistry.Fingerprint missing');
    if (Number(row.kindCol) !== 1) failures.push('TreasuryMovementRegistry.Kind missing');
    if (Number(row.cashCol) !== 1) failures.push('TreasuryMovementRegistry.CashMoveId missing');
  }

  const ux = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = N'UX_TreasuryMovementRegistry_Tenant_Idempotency'
        AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
        AND is_unique = 1
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(ux.recordset[0]?.ok) !== 1) {
    failures.push('Missing unique index UX_TreasuryMovementRegistry_Tenant_Idempotency');
  }

  const fkTenant = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.foreign_keys
      WHERE name = N'FK_TreasuryMovementRegistry_Tenant'
        AND parent_object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(fkTenant.recordset[0]?.ok) !== 1) {
    failures.push('Missing FK_TreasuryMovementRegistry_Tenant');
  }

  return { ok: failures.length === 0, failures };
}

export const treasuryMovementRegistryMigration: DrvoMigrationDefinition = {
  migrationId: 6,
  migrationKey: 'treasury-movement-registry',
  name: 'DRVO-007 Treasury movement registry',
  dependencies: ['platform-bootstrap'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'mixed',
    risk: 'HIGH',
    requiresBackup: true,
    lockProfile: 'potentially-blocking',
    rollbackStrategy: 'Restore the approved backup; manual down migration is intentionally not automated for TblCashMove changes.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyTreasuryMovementSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyTreasuryMovementSchema(ctx.pool);
    return report.ok;
  },
};
