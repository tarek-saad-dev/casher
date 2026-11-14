import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '023-customer-education-occupation-profile', 'schema.sql',
);

export async function verifyCustomerProfileSchema(pool: ConnectionPool) {
  const failures: string[] = [];
  for (const column of ['CustomerCategory', 'EducationLevel', 'InstitutionName', 'Occupation']) {
    const result = await pool.request().input('column', column).query(`
      SELECT CASE WHEN COL_LENGTH(N'dbo.TblClient', @column) IS NOT NULL THEN 1 ELSE 0 END AS ok
    `);
    if (Number(result.recordset[0]?.ok) !== 1) failures.push('Missing TblClient.' + column);
  }
  return { ok: failures.length === 0, failures };
}

export const customerEducationOccupationProfileMigration: DrvoMigrationDefinition = {
  migrationId: 23,
  migrationKey: 'customer-education-occupation-profile',
  name: 'Optional customer student education or adult occupation fields',
  dependencies: ['master-data-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy: 'Nullable additive columns only. Roll back application form/API usage; leave columns and existing records intact.',
  },
  async apply(ctx) { await executeSqlFile(ctx.pool, SCHEMA); },
  async verify(ctx) { return verifyCustomerProfileSchema(ctx.pool); },
  async reconcileBaseline(ctx) { return (await verifyCustomerProfileSchema(ctx.pool)).ok; },
};
