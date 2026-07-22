#!/usr/bin/env npx tsx
/**
 * Phase 1B foundation migration runner.
 * Requires cloud / last132 unless --expected-database=<name> is provided.
 * Never prints secrets, passwords, or connection strings.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';
import { spawnSync } from 'child_process';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const MIGRATION_NAME = 'add-multi-branch-foundation.sql';
const DEFAULT_REQUIRED_DB = 'last132';
const DEFAULT_REQUIRED_MODE = 'cloud';

function parseArgs(argv: string[]) {
  let expectedDatabase = DEFAULT_REQUIRED_DB;
  let mode = (process.env.AUDIT_DB_TARGET || DEFAULT_REQUIRED_MODE).toLowerCase();
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    }
  }
  return { expectedDatabase, mode };
}

function buildConfig(mode: string): sql.config {
  const useLocal = mode === 'local';
  if (useLocal) {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: {
        encrypt: process.env.LOCAL_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
        trustServerCertificate:
          process.env.LOCAL_DB_TRUST_CERT === 'true' ||
          process.env.DB_TRUST_CERT === 'true' ||
          true,
        enableArithAbort: true,
      },
      requestTimeout: 120000,
    };
  }
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.CLOUD_DB_ENCRYPT !== 'false' && process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  };
}

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = buildConfig(mode);

  if (!config.server || !config.user || !config.database) {
    console.error('Missing database connection environment (server/user/database).');
    process.exit(1);
  }

  console.log('Phase 1B migration runner');
  console.log(`  selected mode: ${mode}`);
  console.log(`  server name: ${config.server}`);
  console.log(`  database name: ${config.database}`);
  console.log(`  migration name: ${MIGRATION_NAME}`);
  console.log(`  expected database: ${expectedDatabase}`);

  if (mode !== 'cloud' && expectedDatabase === DEFAULT_REQUIRED_DB) {
    console.error('Refusing: selected mode must be cloud for default last132 target.');
    process.exit(1);
  }

  if (config.database !== expectedDatabase) {
    console.error(
      `Refusing: connected database "${config.database}" does not match expected "${expectedDatabase}".`,
    );
    console.error('Pass --expected-database=<name> explicitly to override.');
    process.exit(1);
  }

  const pool = await sql.connect(config);
  try {
    const openShifts = await pool.request().query(`
      SELECT COUNT(*) AS OpenShiftCount
      FROM dbo.TblShiftMove
      WHERE ISNULL(Status, 0) = 1
    `);
    const openShiftCount = Number(openShifts.recordset[0].OpenShiftCount);
    console.log(`  open shift count: ${openShiftCount}`);
    if (openShiftCount > 0) {
      console.warn('WARNING: Legacy open shifts exist.');
      console.warn('Phase 1B does not alter them.');
      console.warn('Continuing because maintenance mode was explicitly confirmed.');
    }

    const openDay = await pool.request().query(`
      SELECT COUNT(*) AS OpenDayCount
      FROM dbo.TblNewDay
      WHERE Status = 1
    `);
    console.log(`  open TblNewDay count: ${Number(openDay.recordset[0].OpenDayCount)} (will not modify)`);

    const existing = await pool.request().query(`
      SELECT t.name
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo'
        AND t.name IN (N'TblBranch', N'TblUserBranchAccess', N'TblEmpBranchAssignment')
      ORDER BY t.name
    `);
    console.log(
      `  existing foundation tables: ${
        existing.recordset.map((r: { name: string }) => r.name).join(', ') || '(none)'
      }`,
    );

    const sqlPath = path.join(__dirname, '..', 'db', 'migrations', MIGRATION_NAME);
    const text = fs.readFileSync(sqlPath, 'utf8');
    // Single-batch script (transaction inside SQL). Strip GO if present.
    const batches = text
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean);

    for (let i = 0; i < batches.length; i++) {
      console.log(`  running SQL batch ${i + 1}/${batches.length}`);
      await pool.request().batch(batches[i]);
    }
    console.log('  migration SQL finished');
  } finally {
    await pool.close();
  }

  console.log('  running verification...');
  const verify = spawnSync(
    'npx',
    [
      'tsx',
      path.join(__dirname, 'verify-multi-branch-foundation.ts'),
      `--expected-database=${expectedDatabase}`,
      `--mode=${mode}`,
    ],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env, shell: true },
  );
  if (verify.status !== 0) {
    console.error('Verification failed — exiting non-zero.');
    process.exit(verify.status ?? 1);
  }
  console.log('Phase 1B migration + verification OK');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
