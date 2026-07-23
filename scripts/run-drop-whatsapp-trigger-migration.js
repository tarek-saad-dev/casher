#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Drop legacy trg_TblinvServDetail_WhatsAppNotification (idempotent).
 * Uses CLOUD_* / DB_* env like other migration runners.
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

async function main() {
  if (!config.server || !config.database || !config.user) {
    console.error('Missing DB connection env (CLOUD_DB_* / DB_*)');
    process.exit(1);
  }

  console.log(`Connecting to ${config.server}/${config.database}...`);
  const pool = await sql.connect(config);
  const dbName = (await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n;
  console.log('Connected DB:', dbName);

  const before = await pool.request().query(`
    SELECT name, is_disabled
    FROM sys.triggers
    WHERE name = N'trg_TblinvServDetail_WhatsAppNotification'
  `);
  console.log('Before:', before.recordset);

  const sqlPath = path.join(
    __dirname,
    '..',
    'db',
    'migrations',
    'drop-tblinvservdetail-whatsapp-trigger.sql',
  );
  const script = fs.readFileSync(sqlPath, 'utf8');
  // mssql driver does not split GO batches — strip GO lines
  const batches = script
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
    await pool.request().query(batch);
  }

  const after = await pool.request().query(`
    SELECT name, is_disabled
    FROM sys.triggers
    WHERE name = N'trg_TblinvServDetail_WhatsAppNotification'
  `);
  console.log('After:', after.recordset);
  if (after.recordset.length === 0) {
    console.log('OK: trigger removed (or was already absent)');
  } else {
    console.error('FAIL: trigger still present');
    process.exit(1);
  }

  await pool.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
