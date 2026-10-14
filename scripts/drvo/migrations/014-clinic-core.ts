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
  '014-clinic-core',
  'schema.sql',
);

export const CLINIC_CORE_MIGRATION_KEY = 'clinic-core';

export async function verifyClinicCoreSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  const app = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM dbo.AppRegistry WHERE AppCode = N'medical-records'
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(app.recordset[0]?.ok) !== 1) {
    failures.push('Missing AppRegistry medical-records');
  }

  for (const table of [
    'ClinicPatientProfile',
    'ClinicPractitioner',
    'ClinicEncounter',
    'ClinicPrescription',
    'ClinicPrescriptionItem',
    'ClinicClinicalAudit',
  ]) {
    const result = await pool.request()
      .input('name', table)
      .query(`
        SELECT CASE WHEN OBJECT_ID(N'dbo.' + @name, N'U') IS NULL THEN 0 ELSE 1 END AS ok;
      `);
    if (Number(result.recordset[0]?.ok) !== 1) {
      failures.push(`Missing table dbo.${table}`);
    }
  }

  for (const index of [
    ['Location', 'UX_Location_Tenant_LocationId'],
    ['ClinicPractitioner', 'UX_ClinicPractitioner_Tenant_User'],
    ['ClinicEncounter', 'UX_ClinicEncounter_Tenant_Id'],
    ['ClinicPrescription', 'UX_ClinicPrescription_Tenant_Id'],
  ] as const) {
    const result = await pool.request()
      .input('table', index[0])
      .input('index', index[1])
      .query(`
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE object_id = OBJECT_ID(N'dbo.' + @table) AND name = @index
        ) THEN 1 ELSE 0 END AS ok;
      `);
    if (Number(result.recordset[0]?.ok) !== 1) {
      failures.push(`Missing index ${index[1]}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

export const clinicCoreMigration: DrvoMigrationDefinition = {
  migrationId: 14,
  migrationKey: CLINIC_CORE_MIGRATION_KEY,
  name: 'DRVO Clinics outpatient medical records core',
  dependencies: [
    'commercial-subscription-tenant-apps',
    'master-data-tenancy',
  ],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'MEDIUM',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive clinical tables and one tenant/location unique index. Application rollback removes Clinic Pack exposure and leaves clinical data untouched for forward-fix; do not drop medical records during rollback.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyClinicCoreSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyClinicCoreSchema(ctx.pool);
    return report.ok;
  },
};
