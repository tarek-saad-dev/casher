/**
 * Structural Platform Core schema verification (columns, uniques, indexes).
 * Table presence alone is NOT sufficient for baseline.
 */
import type { ConnectionPool } from 'mssql';

export type PlatformCoreStructureReport = {
  ok: boolean;
  failures: string[];
};

async function columnExists(
  pool: ConnectionPool,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await pool.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.${table}', N'${column}') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  return Number(r.recordset[0]?.ok) === 1;
}

async function indexExists(pool: ConnectionPool, indexName: string): Promise<boolean> {
  const r = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.indexes WHERE name = N'${indexName}' AND object_id IS NOT NULL
    ) THEN 1 ELSE 0 END AS ok;
  `);
  return Number(r.recordset[0]?.ok) === 1;
}

async function uniqueConstraintOrIndexExists(
  pool: ConnectionPool,
  name: string,
): Promise<boolean> {
  const r = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.indexes WHERE name = N'${name}'
      UNION ALL
      SELECT 1 FROM sys.key_constraints WHERE name = N'${name}'
    ) THEN 1 ELSE 0 END AS ok;
  `);
  return Number(r.recordset[0]?.ok) === 1;
}

async function tableExists(pool: ConnectionPool, name: string): Promise<boolean> {
  const r = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.${name}', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  return Number(r.recordset[0]?.ok) === 1;
}

const REQUIRED: Array<{
  table: string;
  columns: string[];
  uniques?: string[];
  indexes?: string[];
}> = [
  {
    table: 'Tenant',
    columns: ['TenantId', 'Code', 'Name', 'Status', 'DefaultTimezone'],
    uniques: ['UQ_Tenant_Code', 'PK_Tenant'],
  },
  {
    table: 'Location',
    columns: ['LocationId', 'TenantId', 'LegacyBranchId', 'BranchCode', 'Timezone', 'Status'],
    uniques: ['UQ_Location_Tenant_BranchCode', 'UQ_Location_Tenant_LegacyBranchId', 'PK_Location'],
  },
  {
    table: 'TenantMembership',
    columns: ['MembershipId', 'TenantId', 'LegacyUserId'],
    uniques: ['UQ_TenantMembership_Tenant_User', 'PK_TenantMembership'],
  },
  {
    table: 'LegacyIdMap',
    columns: ['TenantId', 'EntityName', 'LegacyKey', 'DrvoId'],
    uniques: ['PK_LegacyIdMap'],
  },
  {
    table: 'PlatformOutbox',
    columns: [
      'Id',
      'TenantId',
      'AggregateType',
      'AggregateId',
      'EventType',
      'Payload',
      'IdempotencyKey',
      'OccurredAt',
      'Status',
    ],
    uniques: ['PK_PlatformOutbox'],
    indexes: ['UX_PlatformOutbox_Tenant_Idempotency'],
  },
  {
    table: 'AppRegistry',
    columns: ['AppCode', 'DisplayName', 'EntitledSeparately'],
    uniques: ['PK_AppRegistry'],
  },
  {
    table: 'TenantAppEntitlement',
    columns: ['TenantId', 'AppCode', 'Enabled'],
    uniques: ['PK_TenantAppEntitlement'],
  },
  {
    table: 'SalonPackConfig',
    columns: ['TenantId', 'PackCode', 'ManifestJson', 'UpdatedAt'],
    uniques: ['PK_SalonPackConfig'],
  },
];

export async function verifyPlatformCoreStructure(
  pool: ConnectionPool,
): Promise<PlatformCoreStructureReport> {
  const failures: string[] = [];

  for (const spec of REQUIRED) {
    if (!(await tableExists(pool, spec.table))) {
      failures.push(`Missing table dbo.${spec.table}`);
      continue;
    }
    for (const col of spec.columns) {
      if (!(await columnExists(pool, spec.table, col))) {
        failures.push(`Missing column dbo.${spec.table}.${col}`);
      }
    }
    for (const uq of spec.uniques ?? []) {
      if (!(await uniqueConstraintOrIndexExists(pool, uq))) {
        failures.push(`Missing unique/PK ${uq} on dbo.${spec.table}`);
      }
    }
    for (const ix of spec.indexes ?? []) {
      if (!(await indexExists(pool, ix))) {
        failures.push(`Missing index ${ix} on dbo.${spec.table}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}
