#!/usr/bin/env npx tsx
/**
 * Phase 1I audit — prints domain ownership registry + live BranchID coverage.
 * Read-only against cloud last132 by default.
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';
import {
  DOMAIN_OWNERSHIP_REGISTRY,
  GO_LIVE_BLOCKER_DOMAINS,
} from '../src/lib/branch/domainOwnershipRegistry';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) expectedDatabase = arg.slice('--expected-database='.length).trim();
    else if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length).trim().toLowerCase();
  }
  return { expectedDatabase, mode };
}

function buildConfig(mode: string): sql.config {
  if (mode === 'local') {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: { encrypt: process.env.LOCAL_DB_ENCRYPT === 'true', trustServerCertificate: true, enableArithAbort: true },
      requestTimeout: 180000,
    };
  }
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 180000,
  };
}

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  console.log('=== Phase 1I multibranch boundary audit ===');
  console.log(`mode=${mode} expectedDatabase=${expectedDatabase}`);
  console.log('\n--- registry ---');
  for (const d of DOMAIN_OWNERSHIP_REGISTRY) {
    const flag = d.goLiveBlocker ? ' [GO-LIVE BLOCKER]' : '';
    console.log(`  ${d.domain}: ${d.classification}${flag}`);
    console.log(`    roots=${d.roots.join(',') || '-'} masters=${d.masters.join(',') || '-'}`);
    console.log(`    ${d.notes}`);
  }
  console.log(`\nGo-live blockers: ${GO_LIVE_BLOCKER_DOMAINS.join(', ')}`);

  const pool = await sql.connect(buildConfig(mode));
  try {
    const dbName = (await pool.request().query(`SELECT DB_NAME() AS n`)).recordset[0].n;
    if (dbName !== expectedDatabase) {
      throw new Error(`Expected database ${expectedDatabase}, got ${dbName}`);
    }
    const branches = await pool.request().query(`
      SELECT BranchID, BranchCode, BranchName, IsActive FROM dbo.TblBranch ORDER BY BranchID
    `);
    console.log('\n--- branches ---');
    for (const b of branches.recordset) {
      console.log(`  ${b.BranchID} ${b.BranchCode} active=${b.IsActive}`);
    }

    const branchCols = await pool.request().query(`
      SELECT t.name AS table_name
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo' AND c.name = N'BranchID'
      ORDER BY t.name
    `);
    console.log(`\n--- tables with BranchID (${branchCols.recordset.length}) ---`);
    console.log(branchCols.recordset.map((r: { table_name: string }) => r.table_name).join(', '));

    const purchaseBranch = await pool.request().query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='TblinvPurchaseHead' AND COLUMN_NAME='BranchID'
    `);
    const attBranch = await pool.request().query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='TblEmpAttendance' AND COLUMN_NAME='BranchID'
    `);
    console.log(`\nTblinvPurchaseHead.BranchID present: ${purchaseBranch.recordset[0].c > 0}`);
    console.log(`TblEmpAttendance.BranchID present: ${attBranch.recordset[0].c > 0}`);
  } finally {
    await pool.close();
  }
  console.log('\nAudit complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
