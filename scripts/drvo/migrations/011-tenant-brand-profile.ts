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
  '011-tenant-brand-profile',
  'schema.sql',
);

export const TENANT_BRAND_PROFILE_MIGRATION_KEY = 'tenant-brand-profile';

const REQUIRED_COLUMNS = [
  'TenantId',
  'DisplayName',
  'LogoUrl',
  'Phone',
  'Address',
  'PrimaryColor',
  'AccentColor',
  'ReceiptFooter',
  'Timezone',
  'PublicBookingOrigins',
  'Revision',
  'CreatedAt',
  'UpdatedAt',
  'UpdatedByUserId',
];

const REQUIRED_CONSTRAINTS = [
  'PK_TenantBrandProfile',
  'FK_TenantBrandProfile_Tenant',
  'CK_TenantBrandProfile_DisplayName',
  'CK_TenantBrandProfile_LogoUrl',
  'CK_TenantBrandProfile_PrimaryColor',
  'CK_TenantBrandProfile_AccentColor',
  'CK_TenantBrandProfile_Origins',
];

/** Read-only verification. */
export async function verifyTenantBrandProfileSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  const table = await pool
    .request()
    .query(`SELECT CASE WHEN OBJECT_ID(N'dbo.TenantBrandProfile', N'U') IS NULL THEN 0 ELSE 1 END AS ok;`);
  if (Number(table.recordset[0]?.ok) !== 1) {
    return { ok: false, failures: ['Missing table dbo.TenantBrandProfile'] };
  }

  for (const column of REQUIRED_COLUMNS) {
    const c = await pool
      .request()
      .input('column', column)
      .query(
        `SELECT CASE WHEN COL_LENGTH(N'dbo.TenantBrandProfile', @column) IS NULL THEN 0 ELSE 1 END AS ok;`,
      );
    if (Number(c.recordset[0]?.ok) !== 1) failures.push(`Missing column dbo.TenantBrandProfile.${column}`);
  }
  if (failures.length) return { ok: false, failures };

  for (const name of REQUIRED_CONSTRAINTS) {
    const r = await pool
      .request()
      .input('name', name)
      .query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.objects WHERE name = @name) THEN 1 ELSE 0 END AS ok;`);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing constraint ${name}`);
  }

  const missing = await pool.request().query(`
    SELECT t.Code FROM dbo.Tenant t WITH (NOLOCK)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.TenantBrandProfile b WITH (NOLOCK) WHERE b.TenantId = t.TenantId);
  `);
  for (const row of missing.recordset as Array<{ Code: string }>) {
    failures.push(`Tenant ${row.Code} has no TenantBrandProfile`);
  }

  return { ok: failures.length === 0, failures };
}

export const tenantBrandProfileMigration: DrvoMigrationDefinition = {
  migrationId: 11,
  migrationKey: TENANT_BRAND_PROFILE_MIGRATION_KEY,
  name: 'DRVO-017 Tenant brand profile (display name, logo, contact, colors, receipt footer, timezone, booking origins)',
  dependencies: ['platform-core', 'platform-bootstrap'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'mixed',
    risk: 'LOW',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive schema: roll back by reverting the application commit (pre-DRVO-017 code never reads dbo.TenantBrandProfile and ignores the admin.tenant page row), then forward-fix. Dropping the table is not a normal rollback and needs explicit approval before any real use.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyTenantBrandProfileSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyTenantBrandProfileSchema(ctx.pool);
    return report.ok;
  },
};
