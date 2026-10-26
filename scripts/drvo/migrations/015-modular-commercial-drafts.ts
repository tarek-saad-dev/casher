import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(__dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '015-modular-commercial-drafts', 'schema.sql');

export const MODULAR_COMMERCIAL_DRAFTS_MIGRATION_KEY = 'modular-commercial-drafts';

export async function verifyModularCommercialDraftSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const structure: Array<{ name: string; columns: string[]; indexes: string[] }> = [
    {
      name: 'ModularPriceCatalog',
      columns: ['CatalogId','CatalogCode','Version','IndustryCode','CurrencyCode','Status','CreatedAt','UpdatedAt'],
      indexes: ['UX_ModularPriceCatalog_CodeVersion','IX_ModularPriceCatalog_IndustryStatus'],
    },
    {
      name: 'ModularPriceCatalogItem',
      columns: ['CatalogId','ItemKind','ItemCode','MonthlyMinor','CreatedAt'],
      indexes: [],
    },
    {
      name: 'TenantModularDraft',
      columns: ['DraftId','TenantId','CatalogId','BillingCycle','BranchCount','Revision','Status','CreatedAt','UpdatedAt'],
      indexes: ['UX_TenantModularDraft_CurrentTenant','IX_TenantModularDraft_TenantHistory'],
    },
    { name: 'TenantModularDraftApp', columns: ['DraftId','AppCode'], indexes: [] },
  ];
  for (const table of structure) {
    const fullName = 'dbo.' + table.name;
    const exists = await pool.request().input('tableName', fullName).query(
      "SELECT CASE WHEN OBJECT_ID(@tableName, N'U') IS NULL THEN 0 ELSE 1 END AS ok;");
    if (Number(exists.recordset[0]?.ok) !== 1) {
      failures.push('Missing ' + fullName);
      continue;
    }
    for (const column of table.columns) {
      const r = await pool.request().input('tableName', fullName).input('column', column).query(
        'SELECT CASE WHEN COL_LENGTH(@tableName, @column) IS NULL THEN 0 ELSE 1 END AS ok;');
      if (Number(r.recordset[0]?.ok) !== 1) failures.push('Missing ' + fullName + '.' + column);
    }
    for (const index of table.indexes) {
      const r = await pool.request().input('tableName', fullName).input('name', index).query(
        'SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(@tableName) AND name=@name) THEN 1 ELSE 0 END AS ok;');
      if (Number(r.recordset[0]?.ok) !== 1) failures.push('Missing index ' + index);
    }
  }
  for (const [table, constraint] of [
    ['ModularPriceCatalogItem', 'FK_ModularPriceCatalogItem_Catalog'],
    ['TenantModularDraft', 'FK_TenantModularDraft_Tenant'],
    ['TenantModularDraft', 'FK_TenantModularDraft_Catalog'],
    ['TenantModularDraftApp', 'FK_TenantModularDraftApp_Draft'],
  ] as const) {
    const r = await pool.request().input('tableName', 'dbo.' + table).input('fk', constraint).query(
      'SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID(@tableName) AND name=@fk AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;');
    if (Number(r.recordset[0]?.ok) !== 1) failures.push('Missing or untrusted FK ' + constraint);
  }
  for (const [table, constraint] of [
    ['ModularPriceCatalog', 'CK_ModularPriceCatalog_Status'],
    ['ModularPriceCatalogItem', 'CK_ModularPriceCatalogItem_Kind'],
    ['ModularPriceCatalogItem', 'CK_ModularPriceCatalogItem_Amount'],
    ['TenantModularDraft', 'CK_TenantModularDraft_Status'],
    ['TenantModularDraft', 'CK_TenantModularDraft_Cycle'],
  ] as const) {
    const r = await pool.request().input('tableName', 'dbo.' + table).input('checkName', constraint).query(
      'SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(@tableName) AND name=@checkName AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;');
    if (Number(r.recordset[0]?.ok) !== 1) failures.push('Missing or untrusted CHECK ' + constraint);
  }
  // This first migration must NEVER seed an approved catalog or a tenant contract.
  return { ok: failures.length === 0, failures };
}

export const modularCommercialDraftsMigration: DrvoMigrationDefinition = {
  migrationId: 15,
  migrationKey: MODULAR_COMMERCIAL_DRAFTS_MIGRATION_KEY,
  name: 'DRVO modular price catalog and tenant draft-selection foundation (no paid entitlements)',
  dependencies: ['commercial-subscription-tenant-apps', 'tenant-plan-requests'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy: 'Additive new tables only; roll back application code and leave draft/catalog tables intact. Never drop tenant history.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyModularCommercialDraftSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyModularCommercialDraftSchema(ctx.pool)).ok;
  },
};
