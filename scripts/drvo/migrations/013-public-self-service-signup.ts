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
  '013-public-self-service-signup',
  'schema.sql',
);

export const PUBLIC_SELF_SERVICE_SIGNUP_MIGRATION_KEY = 'public-self-service-signup';

export async function verifyPublicSelfServiceSignupSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const table = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.PublicSignupRegistration', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(table.recordset[0]?.ok) !== 1) {
    return { ok: false, failures: ['Missing table dbo.PublicSignupRegistration'] };
  }

  for (const column of [
    'SignupId','PhoneNormalized','Email','ContactName','BusinessName','IndustryCode',
    'NeedsJson','StartMode','IpHash','Status','TenantId','ErrorCode','CreatedAt','UpdatedAt','ProvisionedAt'
  ]) {
    const r = await pool.request()
      .input('column', column)
      .query(`SELECT CASE WHEN COL_LENGTH(N'dbo.PublicSignupRegistration', @column) IS NULL THEN 0 ELSE 1 END AS ok;`);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing PublicSignupRegistration.${column}`);
  }

  for (const index of [
    'UX_PublicSignupRegistration_Phone',
    'IX_PublicSignupRegistration_IpCreated',
    'UX_PublicSignupRegistration_Tenant',
  ]) {
    const r = await pool.request().input('name', index).query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id=OBJECT_ID(N'dbo.PublicSignupRegistration') AND name=@name
      ) THEN 1 ELSE 0 END AS ok;
    `);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing index ${index}`);
  }

  return { ok: failures.length === 0, failures };
}

export const publicSelfServiceSignupMigration: DrvoMigrationDefinition = {
  migrationId: 13,
  migrationKey: PUBLIC_SELF_SERVICE_SIGNUP_MIGRATION_KEY,
  name: 'DRVO public self-service signup control-plane table',
  dependencies: ['commercial-subscription-tenant-apps', 'master-data-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive table only. Application rollback ignores dbo.PublicSignupRegistration. Do not drop provisioned tenants during rollback; forward-fix the signup path instead.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyPublicSelfServiceSignupSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyPublicSelfServiceSignupSchema(ctx.pool);
    return report.ok;
  },
};
