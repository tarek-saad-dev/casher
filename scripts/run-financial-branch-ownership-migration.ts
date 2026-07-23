#!/usr/bin/env npx tsx
/**
 * Phase 1D financial branch-ownership migration runner.
 * Default: cloud / last132. Never prints secrets.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';
import { spawnSync } from 'child_process';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const MIGRATION_NAME = 'add-financial-branch-ownership.sql';

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
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
  if (mode === 'local') {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: {
        encrypt: process.env.LOCAL_DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 300000,
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
    requestTimeout: 300000,
  };
}

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config = buildConfig(mode);

  console.log('Phase 1D migration runner');
  console.log(`  selected mode: ${mode}`);
  console.log(`  server name: ${config.server}`);
  console.log(`  database name: ${config.database}`);
  console.log(`  migration name: ${MIGRATION_NAME}`);

  if (mode !== 'cloud' && expectedDatabase === 'last132') {
    console.error('Refusing: default last132 target requires cloud mode');
    process.exit(1);
  }
  if (config.database !== expectedDatabase) {
    console.error(
      `Refusing: database "${config.database}" != expected "${expectedDatabase}"`,
    );
    process.exit(1);
  }

  console.log('  NOTE: keep nightly + sync writers stopped for this window');
  console.log('  capturing pre-state...');
  const captureBefore = spawnSync(
    process.execPath,
    [path.join(__dirname, 'audit-branches/08-capture-phase1d-financial-state.cjs'), 'before'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env },
  );
  if (captureBefore.status !== 0) {
    process.exit(captureBefore.status ?? 1);
  }

  const pool = await sql.connect(config);
  try {
    const ctBefore = await pool.request().query(`
      SELECT OBJECT_NAME(object_id) AS table_name, is_track_columns_updated_on
      FROM sys.change_tracking_tables
      WHERE OBJECT_NAME(object_id) IN (N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon')
    `);
    console.log('  CT before:', JSON.stringify(ctBefore.recordset));

    const sqlPath = path.join(__dirname, '..', 'db', 'migrations', MIGRATION_NAME);
    const text = fs.readFileSync(sqlPath, 'utf8');
    const batches = text
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean);
    for (let i = 0; i < batches.length; i++) {
      console.log(`  running SQL batch ${i + 1}/${batches.length}`);
      await pool.request().batch(batches[i]);
    }
    console.log('  migration SQL finished');

    const ctAfter = await pool.request().query(`
      SELECT OBJECT_NAME(object_id) AS table_name, is_track_columns_updated_on
      FROM sys.change_tracking_tables
      WHERE OBJECT_NAME(object_id) IN (N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon')
    `);
    console.log('  CT after:', JSON.stringify(ctAfter.recordset));
  } finally {
    await pool.close();
  }

  console.log('  capturing post-state...');
  const captureAfter = spawnSync(
    process.execPath,
    [path.join(__dirname, 'audit-branches/08-capture-phase1d-financial-state.cjs'), 'after'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env },
  );
  if (captureAfter.status !== 0) {
    process.exit(captureAfter.status ?? 1);
  }

  console.log('  running verification...');
  const verify = spawnSync(
    'npx',
    [
      'tsx',
      path.join(__dirname, 'verify-financial-branch-ownership.ts'),
      `--expected-database=${expectedDatabase}`,
      `--mode=${mode}`,
    ],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env, shell: true },
  );
  if (verify.status !== 0) {
    console.error('Verification failed');
    process.exit(verify.status ?? 1);
  }
  console.log('Phase 1D migration + verification OK');
  console.log('  SYNC: keep sync stopped until local schema receives the same migration');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
