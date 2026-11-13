import path from 'path';
import type { ConnectionPool } from 'mssql';
import type { DrvoMigrationDefinition } from '../types';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';

const SCHEMA = path.join(
  __dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '024-pos-sale-idempotency', 'schema.sql',
);

async function verifyPosSaleIdempotencySchema(pool: ConnectionPool) {
  const failures: string[] = [];
  const exists = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblPosSaleRequest', N'U') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(exists.recordset[0]?.Ready) !== 1) {
    return { ok: false, failures: ['Missing dbo.TblPosSaleRequest'] };
  }
  for (const column of [
    'TenantId', 'RequestID', 'UserID', 'BranchID', 'PayloadHash',
    'Status', 'InvID', 'InvType', 'CreatedAtUtc', 'CompletedAtUtc',
  ]) {
    const r = await pool.request().input('column', column).query(
      "SELECT CASE WHEN COL_LENGTH(N'dbo.TblPosSaleRequest', @column) IS NULL THEN 0 ELSE 1 END AS Ready",
    );
    if (Number(r.recordset[0]?.Ready) !== 1) failures.push('Missing ' + column);
  }
  for (const constraint of [
    'PK_TblPosSaleRequest', 'FK_TblPosSaleRequest_Tenant',
    'CK_TblPosSaleRequest_Status', 'CK_TblPosSaleRequest_Hash',
    'CK_TblPosSaleRequest_Invoice',
  ]) {
    const r = await pool.request().input('name', constraint).query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM sys.objects
        WHERE parent_object_id = OBJECT_ID(N'dbo.TblPosSaleRequest') AND name = @name
      ) THEN 1 ELSE 0 END AS Ready;
    `);
    if (Number(r.recordset[0]?.Ready) !== 1) failures.push('Missing ' + constraint);
  }
  return { ok: failures.length === 0, failures };
}

export const posSaleIdempotencyMigration: DrvoMigrationDefinition = {
  migrationId: 24,
  migrationKey: 'pos-sale-idempotency',
  name: 'Tenant-owned serializable POS invoice request ID and replay ledger',
  dependencies: ['master-data-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive ledger only. Disable POS_SALE_IDEMPOTENCY_ENABLED to leave invoice posting unchanged; retain recorded request IDs. Never drop financially referenced rows.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyPosSaleIdempotencySchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyPosSaleIdempotencySchema(ctx.pool)).ok;
  },
};
