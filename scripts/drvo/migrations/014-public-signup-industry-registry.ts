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
  '014-public-signup-industry-registry',
  'schema.sql',
);

export const PUBLIC_SIGNUP_INDUSTRY_REGISTRY_MIGRATION_KEY =
  'public-signup-industry-registry';

export async function verifyPublicSignupIndustryRegistrySchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const r = await pool.request().query(`
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID(N'dbo.PublicSignupRegistration')
          AND name=N'CK_PublicSignupRegistration_IndustryCode'
      ) THEN 1 ELSE 0 END AS hasGeneric,
      CASE WHEN EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID(N'dbo.PublicSignupRegistration')
          AND name=N'CK_PublicSignupRegistration_Industry'
      ) THEN 1 ELSE 0 END AS hasLegacy;
  `);
  const row = r.recordset[0] as { hasGeneric: number; hasLegacy: number };
  if (Number(row.hasGeneric) !== 1) failures.push('Missing generic signup IndustryCode check');
  if (Number(row.hasLegacy) !== 0) failures.push('Legacy enumerated signup industry check still exists');
  return { ok: failures.length === 0, failures };
}

export const publicSignupIndustryRegistryMigration: DrvoMigrationDefinition = {
  migrationId: 14,
  migrationKey: PUBLIC_SIGNUP_INDUSTRY_REGISTRY_MIGRATION_KEY,
  name: 'DRVO public signup industry registry decoupling',
  dependencies: ['public-self-service-signup'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy:
      'Application rollback still accepts salon/supermarket. The generic CHECK is stricter on shape but not on the list. Forward-fix source pack validation rather than restoring an enumerated DB constraint.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyPublicSignupIndustryRegistrySchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyPublicSignupIndustryRegistrySchema(ctx.pool);
    return report.ok;
  },
};
