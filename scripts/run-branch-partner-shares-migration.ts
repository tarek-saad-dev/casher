#!/usr/bin/env npx tsx
/**
 * Phase 1E partner-share migration runner. Default: cloud / last132.
 * Never prints secrets. Sync remains stopped/unused.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';
import { spawnSync } from 'child_process';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const MIGRATION_NAME = 'add-branch-partner-shares.sql';

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
    requestTimeout: 120000,
  };
}

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  if (mode !== 'cloud' && expectedDatabase === 'last132') {
    console.error('Refusing: default last132 requires cloud mode');
    process.exit(1);
  }
  const config = buildConfig(mode);
  console.log('Phase 1E partner-share migration runner');
  console.log(`  mode: ${mode}`);
  console.log(`  server: ${config.server}`);
  console.log(`  database: ${config.database}`);
  if (config.database !== expectedDatabase) {
    console.error(`Refusing: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  console.log('  NOTE: sync-service remains stopped/unused; cloud last132 is sole source of truth');

  spawnSync(
    process.execPath,
    [path.join(__dirname, 'audit-branches/09-capture-phase1e-report-baseline.cjs'), 'before'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env },
  );

  const pool = await sql.connect(config);
  try {
    const sqlPath = path.join(__dirname, '..', 'db', 'migrations', MIGRATION_NAME);
    const text = fs.readFileSync(sqlPath, 'utf8');
    const batches = text
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean);
    for (let i = 0; i < batches.length; i++) {
      console.log(`  SQL batch ${i + 1}/${batches.length}`);
      await pool.request().batch(batches[i]);
    }
  } finally {
    await pool.close();
  }

  spawnSync(
    process.execPath,
    [path.join(__dirname, 'audit-branches/09-capture-phase1e-report-baseline.cjs'), 'after'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env },
  );

  const verify = spawnSync(
    'npx',
    [
      'tsx',
      path.join(__dirname, 'verify-branch-financial-reporting.ts'),
      `--expected-database=${expectedDatabase}`,
      `--mode=${mode}`,
    ],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env, shell: true },
  );
  if (verify.status !== 0) process.exit(verify.status ?? 1);
  console.log('Phase 1E migration + verification OK');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
