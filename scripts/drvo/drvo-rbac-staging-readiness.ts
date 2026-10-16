#!/usr/bin/env npx tsx
/**
 * DRVO RBAC / entitlement schema inspection: READ ONLY.
 * Uses only the staging-only drvo_agent login and the VPS loopback listener.
 * Does not load dotenv, execute SQL files, back up, or apply migrations.
 */
import sql from 'mssql';
import { existsSync } from 'node:fs';

async function main() {
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(file)) throw new Error('REFUSED: run from isolated staging checkout only');
  }
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing staging-only DB credential');
  const host = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = Number(process.env.DRVO_STAGING_DB_PORT || '1433');
  if (host !== '127.0.0.1' || port !== 1433) throw new Error('REFUSED: loopback SQL only');
  const pool = await new sql.ConnectionPool({
    server: host, port, database: 'last132_agent', user: 'drvo_agent', password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 10000, requestTimeout: 10000,
  }).connect();
  try {
    const identity = (await pool.request().query(
      "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, HAS_DBACCESS(N'last132') AS productionAccess",
    )).recordset[0];
    if (identity?.db !== 'last132_agent' ||
        String(identity?.login).toLowerCase() !== 'drvo_agent' ||
        identity?.productionAccess !== 0) {
      throw new Error('REFUSED: staging identity or production isolation not proven');
    }
    const result = await pool.request().query(`
      SELECT v.TableName,
        CASE WHEN OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NULL THEN N'MISSING' ELSE N'PRESENT' END AS TableState
      FROM (VALUES (N'Tenant'), (N'TenantMembership'), (N'Location'),
        (N'DrvoTenantRole'), (N'DrvoTenantRolePermission'),
        (N'DrvoTenantRoleAssignment'), (N'DrvoTenantModuleEntitlement')) v(TableName)
      ORDER BY v.TableName;
    `);
    const columns = await pool.request().query(`
      SELECT v.ColumnName,
        CASE WHEN COL_LENGTH(N'dbo.TenantMembership', v.ColumnName) IS NULL THEN N'MISSING' ELSE N'PRESENT' END AS ColumnState
      FROM (VALUES (N'TenantId'), (N'MembershipId'), (N'LegacyUserId')) v(ColumnName);
    `);
    console.log('DRVO_RBAC_STAGING_READ_ONLY');
    console.log('DATABASE=last132_agent LOGIN=drvo_agent PRODUCTION_ACCESS=0');
    for (const row of result.recordset) console.log(`TABLE ${row.TableName} ${row.TableState}`);
    for (const row of columns.recordset) console.log(`MEMBERSHIP_COLUMN ${row.ColumnName} ${row.ColumnState}`);
    console.log('BACKUP_RESTORE_VERIFIED=NO MIGRATION_APPLIED=NO');
    if (result.recordset.some(row => row.TableState !== 'PRESENT') ||
        columns.recordset.some(row => row.ColumnState !== 'PRESENT')) {
      console.log('SCHEMA_READY=NO');
      process.exitCode = 2;
    } else {
      console.log('SCHEMA_OBJECTS_PRESENT=YES (constraints, data, and backup still require review)');
    }
  } finally {
    await pool.close();
  }
}
main().catch(error => {
  console.error('DRVO_RBAC_STAGING_PREFLIGHT_FAIL:', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
