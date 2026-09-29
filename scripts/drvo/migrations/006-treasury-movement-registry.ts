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

async function treasurySchemaReady(pool: ConnectionPool): Promise<boolean> {
  const check = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NULL THEN 0 ELSE 1 END AS registry,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL THEN 0 ELSE 1 END AS reversalOf,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL THEN 0 ELSE 1 END AS isReversed;
  `);
  const row = check.recordset[0];
  return (
    !!row &&
    Number(row.registry) === 1 &&
    Number(row.reversalOf) === 1 &&
    Number(row.isReversed) === 1
  );
}

export const treasuryMovementRegistryMigration: DrvoMigrationDefinition = {
  migrationId: 6,
  migrationKey: 'treasury-movement-registry',
  name: 'DRVO-007 Treasury movement registry',
  dependencies: ['platform-bootstrap'],
  checksum: checksumFile(SCHEMA),
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    const ok = await treasurySchemaReady(ctx.pool);
    return {
      ok,
      failures: ok ? [] : ['TreasuryMovementRegistry or reversal columns missing'],
    };
  },
  async reconcileBaseline(ctx) {
    return treasurySchemaReady(ctx.pool);
  },
};
