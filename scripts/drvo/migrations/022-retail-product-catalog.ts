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
  '022-retail-product-catalog',
  'schema.sql',
);

const TBLPRO_COLS = [
  'ProductCode',
  'Brand',
  'Description',
  'StockUnit',
  'UnitsPerPack',
  'SuggestedRetailPrice',
  'MinStockThreshold',
  'SupplierRef',
  'CreatedAt',
  'UpdatedAt',
] as const;

export async function verifyRetailProductCatalogSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const col of TBLPRO_COLS) {
    const r = await pool.request().input('col', col).query(`
      SELECT CASE WHEN COL_LENGTH(N'dbo.TblPro', @col) IS NULL THEN 0 ELSE 1 END AS ok;
    `);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing TblPro.${col}`);
  }

  const uq = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.TblPro')
        AND name = N'UQ_TblPro_Tenant_ProductCode'
        AND is_disabled = 0
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(uq.recordset[0]?.ok) !== 1) {
    failures.push('Missing index UQ_TblPro_Tenant_ProductCode');
  }

  const policy = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblInventoryStockPolicy', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(policy.recordset[0]?.ok) !== 1) {
    failures.push('Missing TblInventoryStockPolicy');
  } else {
    for (const col of [
      'TenantId',
      'AllowNegativeStock',
      'OpeningStockRegistered',
      'NegativeBalancesReconciled',
      'StrictModeActivatedAt',
    ]) {
      const r = await pool.request().input('col', col).query(`
        SELECT CASE WHEN COL_LENGTH(N'dbo.TblInventoryStockPolicy', @col) IS NULL THEN 0 ELSE 1 END AS ok;
      `);
      if (Number(r.recordset[0]?.ok) !== 1) {
        failures.push(`Missing TblInventoryStockPolicy.${col}`);
      }
    }
  }

  const costSnap = await pool.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.TblinvServDetail', N'UnitCostSnapshot') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(costSnap.recordset[0]?.ok) !== 1) {
    failures.push('Missing TblinvServDetail.UnitCostSnapshot');
  }

  return { ok: failures.length === 0, failures };
}

export const retailProductCatalogMigration: DrvoMigrationDefinition = {
  migrationId: 22,
  migrationKey: 'retail-product-catalog',
  name: 'Retail product catalog fields, stock policy, and sale cost snapshot',
  dependencies: ['master-data-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive columns/tables only. Retain ProductCode and policy rows; do not drop historical movements. Disable strict stock mode via TblInventoryStockPolicy.AllowNegativeStock=1 if needed.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyRetailProductCatalogSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyRetailProductCatalogSchema(ctx.pool)).ok;
  },
};
