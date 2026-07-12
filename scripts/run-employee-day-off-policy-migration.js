#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Runs db/migrations/add-employee-day-off-policy.sql
 * Safe to re-run (idempotent column, constraint, backfill).
 */

const sql = require('mssql');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || 'HawaiRestaurant',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.CLOUD_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
    trustServerCertificate:
      process.env.CLOUD_DB_TRUST_CERT === 'true' ||
      process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
  },
  connectionTimeout: 60000,
  requestTimeout: 120000,
};

const MIGRATION_FILE = path.join(
  __dirname,
  '..',
  'db',
  'migrations',
  'add-employee-day-off-policy.sql',
);

function splitSqlBatches(content) {
  return content
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);
}

async function main() {
  if (!config.server || !config.user) {
    console.error('Missing DB credentials. Set DB_SERVER / DB_USER / DB_PASSWORD in .env');
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error('Migration file not found:', MIGRATION_FILE);
    process.exit(1);
  }

  const batches = splitSqlBatches(fs.readFileSync(MIGRATION_FILE, 'utf8'));
  console.log('Connecting to', config.server, '/', config.database, '...');
  const pool = await sql.connect(config);
  console.log(`Running ${batches.length} batch(es) from add-employee-day-off-policy.sql ...\n`);

  let batchNum = 0;
  for (const batch of batches) {
    batchNum += 1;
    try {
      const result = await pool.request().query(batch);
      if (result.recordsets?.length) {
        for (const rs of result.recordsets) {
          if (Array.isArray(rs) && rs.length > 0) {
            console.log(`\n[Batch ${batchNum} result]`);
            console.table(rs);
          }
        }
      }
    } catch (err) {
      console.error(`\n✗ Batch ${batchNum} failed:`, err.message);
      await pool.close();
      process.exit(1);
    }
  }

  const summary = await pool.request().query(`
    SELECT ISNULL(DayOffPolicy, N'NULL') AS DayOffPolicy, COUNT(*) AS cnt
    FROM dbo.TblEmp GROUP BY DayOffPolicy ORDER BY DayOffPolicy
  `);
  console.log('\n── Counts by DayOffPolicy ──');
  console.table(summary.recordset);

  await pool.close();
  console.log('\n✅ DayOffPolicy migration complete.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
