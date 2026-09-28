#!/usr/bin/env npx tsx
/**
 * DRVO-003 platform core migration — staging database last132_agent only.
 * Refuses production database last132.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const MIGRATION_NAME = 'add-drvo-003-platform-core.sql';
const STAGING_DB = 'last132_agent';
const PRODUCTION_DB = 'last132';

function parseArgs(argv: string[]) {
  let expectedDatabase = STAGING_DB;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    }
  }
  return { expectedDatabase };
}

function buildConfig(): sql.config {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
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
  const { expectedDatabase } = parseArgs(process.argv.slice(2));
  const config = buildConfig();

  if (!config.server || !config.user || !config.database) {
    console.error('Missing database connection environment (server/user/database).');
    process.exit(1);
  }

  console.log('DRVO-003 platform core migration');
  console.log(`  server: ${config.server}`);
  console.log(`  database: ${config.database}`);
  console.log(`  expected: ${expectedDatabase}`);

  if (config.database === PRODUCTION_DB) {
    console.error(`Refusing: production database ${PRODUCTION_DB} must not be migrated by DRVO-003.`);
    process.exit(1);
  }

  if (config.database !== expectedDatabase) {
    console.error(
      `Refusing: connected database "${config.database}" does not match expected "${expectedDatabase}".`,
    );
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '..', 'db', 'migrations', MIGRATION_NAME);
  const text = fs.readFileSync(sqlPath, 'utf8');
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  const pool = await sql.connect(config);
  try {
    for (let i = 0; i < batches.length; i++) {
      console.log(`  batch ${i + 1}/${batches.length}`);
      await pool.request().batch(batches[i]);
    }
    console.log('Migration applied.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
