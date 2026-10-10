import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';
import {
  MASTER_DATA_TENANT_TABLES,
  type MasterDataTenantTable,
} from '../../../src/platform/masterData/tables';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '010-master-data-tenancy',
  'schema.sql',
);

export const MASTER_DATA_MIGRATION_KEY = 'master-data-tenancy';

/** (TenantId, surrogate id) unique per table — tenant-consistent reference targets. */
export const MASTER_DATA_TENANT_UNIQUES: Record<MasterDataTenantTable, string> = {
  TblClient: 'UX_TblClient_Tenant_ClientID',
  TblPro: 'UX_TblPro_Tenant_ProID',
  TblCat: 'UX_TblCat_Tenant_CatID',
  TblServicePackage: 'UX_TblServicePackage_Tenant_PackageID',
  TblServicePackageItem: 'UX_TblServicePackageItem_Tenant_PackageItemID',
  TblPaymentMethods: 'UX_TblPaymentMethods_Tenant_PaymentID',
  TblExpINCat: 'UX_TblExpINCat_Tenant_ExpINID',
  TblEmp: 'UX_TblEmp_Tenant_EmpID',
};

export const MASTER_DATA_REQUIRED_INDEXES: Array<{ table: MasterDataTenantTable; name: string }> = [
  { table: 'TblPro', name: 'IX_TblPro_Tenant_CatID' },
  { table: 'TblServicePackage', name: 'IX_TblServicePackage_Tenant_Kind_Active' },
  { table: 'TblExpINCat', name: 'IX_TblExpINCat_Tenant_Type' },
];

export type MasterDataNullTenantReport = {
  ok: boolean;
  nullCounts: Record<MasterDataTenantTable, number>;
};

/** Read-only: rows per master-data table whose TenantId is NULL (must all be zero). */
export async function verifyNoNullMasterDataTenant(
  pool: ConnectionPool,
): Promise<MasterDataNullTenantReport> {
  const nullCounts = {} as Record<MasterDataTenantTable, number>;
  for (const table of MASTER_DATA_TENANT_TABLES) {
    const exists = await pool
      .request()
      .input('name', `dbo.${table}`)
      .query(`SELECT CASE WHEN COL_LENGTH(@name, N'TenantId') IS NULL THEN 0 ELSE 1 END AS ok;`);
    if (Number(exists.recordset[0]?.ok) !== 1) {
      nullCounts[table] = -1;
      continue;
    }
    const r = await pool
      .request()
      .query(`SELECT COUNT_BIG(*) AS n FROM dbo.${table} WITH (NOLOCK) WHERE TenantId IS NULL;`);
    nullCounts[table] = Number(r.recordset[0]?.n ?? 0);
  }
  return { ok: Object.values(nullCounts).every((n) => n === 0), nullCounts };
}

/**
 * Read-only verification: column NOT NULL, FK to Tenant, tenant uniques/indexes,
 * zero NULL TenantId, and CASHER_BOOT still owns the CUT catalog it owned before.
 */
export async function verifyMasterDataTenancySchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const table of MASTER_DATA_TENANT_TABLES) {
    const col = await pool
      .request()
      .input('table', table)
      .query(`
        SELECT c.is_nullable, t.name AS typeName
        FROM sys.columns c
        JOIN sys.types t ON t.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID(N'dbo.' + @table) AND c.name = N'TenantId';
      `);
    const row = col.recordset[0] as { is_nullable: boolean | number; typeName: string } | undefined;
    if (!row) {
      failures.push(`Missing column dbo.${table}.TenantId`);
      continue;
    }
    if (row.typeName !== 'uniqueidentifier') failures.push(`dbo.${table}.TenantId must be uniqueidentifier`);
    if (Boolean(row.is_nullable)) failures.push(`dbo.${table}.TenantId must be NOT NULL`);

    const fk = await pool
      .request()
      .input('name', `FK_${table}_Tenant`)
      .query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = @name AND is_not_trusted = 0) THEN 1 ELSE 0 END AS ok;`);
    if (Number(fk.recordset[0]?.ok) !== 1) failures.push(`Missing trusted FK_${table}_Tenant`);

    const ux = await pool
      .request()
      .input('table', table)
      .input('name', MASTER_DATA_TENANT_UNIQUES[table])
      .query(`
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE object_id = OBJECT_ID(N'dbo.' + @table) AND name = @name AND is_unique = 1
        ) THEN 1 ELSE 0 END AS ok;
      `);
    if (Number(ux.recordset[0]?.ok) !== 1) failures.push(`Missing unique ${MASTER_DATA_TENANT_UNIQUES[table]}`);
  }
  if (failures.length) return { ok: false, failures };

  for (const { table, name } of MASTER_DATA_REQUIRED_INDEXES) {
    const ix = await pool
      .request()
      .input('table', table)
      .input('name', name)
      .query(`
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.' + @table) AND name = @name
        ) THEN 1 ELSE 0 END AS ok;
      `);
    if (Number(ix.recordset[0]?.ok) !== 1) failures.push(`Missing index ${name}`);
  }

  const pkgFk = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.foreign_keys
      WHERE name = N'FK_TblServicePackageItem_Package_Tenant' AND is_not_trusted = 0
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(pkgFk.recordset[0]?.ok) !== 1) {
    failures.push('Missing trusted FK_TblServicePackageItem_Package_Tenant');
  }

  const nulls = await verifyNoNullMasterDataTenant(pool);
  for (const [table, n] of Object.entries(nulls.nullCounts)) {
    if (n !== 0) failures.push(`dbo.${table} has ${n} row(s) with NULL TenantId`);
  }

  const crossTenantItems = await pool.request().query(`
    SELECT COUNT_BIG(*) AS n
    FROM dbo.TblServicePackageItem i WITH (NOLOCK)
    JOIN dbo.TblPro p WITH (NOLOCK) ON p.ProID = i.ProID
    WHERE p.TenantId <> i.TenantId;
  `);
  const crossItems = Number(crossTenantItems.recordset[0]?.n ?? 0);
  if (crossItems) failures.push(`${crossItems} package item(s) reference a service of another tenant`);

  const crossTenantPro = await pool.request().query(`
    SELECT COUNT_BIG(*) AS n
    FROM dbo.TblPro p WITH (NOLOCK)
    JOIN dbo.TblCat c WITH (NOLOCK) ON c.CatID = p.CatID
    WHERE c.TenantId <> p.TenantId;
  `);
  const crossPro = Number(crossTenantPro.recordset[0]?.n ?? 0);
  if (crossPro) failures.push(`${crossPro} service(s) reference a category of another tenant`);

  const boot = await pool.request().query(`
    SELECT COUNT_BIG(*) AS bootTenants FROM dbo.Tenant WITH (NOLOCK) WHERE Code = N'CASHER_BOOT';
  `);
  if (Number(boot.recordset[0]?.bootTenants ?? 0) !== 1) failures.push('CASHER_BOOT tenant missing');

  return { ok: failures.length === 0, failures };
}

export const masterDataTenancyMigration: DrvoMigrationDefinition = {
  migrationId: 10,
  migrationKey: MASTER_DATA_MIGRATION_KEY,
  name: 'DRVO-015 Shared master-data tenancy (TenantId on customers, catalog, payment methods, expense categories, employees)',
  dependencies: ['platform-core', 'platform-bootstrap'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'mixed',
    risk: 'HIGH',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive schema with CASHER_BOOT backfill: there is no safe app-only rollback once tenant-aware code is live, because pre-DRVO-015 code inserts master-data rows without TenantId and those inserts fail against the NOT NULL column. Roll back by forward-fix. If the application commit must be reverted, first restore the approved backup or relax TenantId to NULL under explicit approval. Dropping the DRVO-015 columns, keys or indexes is not a normal rollback and needs explicit approval before any real use.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyMasterDataTenancySchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyMasterDataTenancySchema(ctx.pool);
    return report.ok;
  },
};
