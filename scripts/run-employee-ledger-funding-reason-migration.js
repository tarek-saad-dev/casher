#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Runs db/migrations/add-employee-ledger-employee-funding-reason.sql
 * Adds employee_funding to CK_TblEmpLedgerEntry_EntryReason (idempotent).
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
  'add-employee-ledger-employee-funding-reason.sql',
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
  console.log(`Running ${batches.length} batch(es) from add-employee-ledger-employee-funding-reason.sql ...\n`);

  let batchNum = 0;
  for (const batch of batches) {
    batchNum += 1;
    try {
      await pool.request().query(batch);
      console.log(`✓ Batch ${batchNum} ok`);
    } catch (err) {
      console.error(`\n✗ Batch ${batchNum} failed:`, err.message);
      await pool.close();
      process.exit(1);
    }
  }

  const check = await pool.request().query(`
    SELECT cc.definition
    FROM sys.check_constraints cc
    WHERE cc.name = N'CK_TblEmpLedgerEntry_EntryReason'
      AND cc.parent_object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry')
  `);
  const definition = String(check.recordset[0]?.definition ?? '');
  const allowed = definition.includes('employee_funding');
  console.log('\nConstraint definition:', definition);
  console.log(allowed ? '✓ employee_funding is allowed' : '✗ employee_funding still missing');

  await pool.close();
  process.exit(allowed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
