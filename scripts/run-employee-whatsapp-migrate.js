#!/usr/bin/env node
/* eslint-disable no-console */

const sql = require('mssql');
const dotenv = require('dotenv');
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
    encrypt: true,
    trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

async function main() {
  console.log('Connecting...');
  const pool = await sql.connect(config);
  console.log('Connected');

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp'
    )
    BEGIN
      ALTER TABLE dbo.TblEmp ADD WhatsApp NVARCHAR(30) NULL;
    END
  `);

  const colCheck = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp'
  `);

  if (colCheck.recordset[0].cnt === 1) {
    await pool.request().query(`
      UPDATE dbo.TblEmp
      SET WhatsApp = NULLIF(LTRIM(RTRIM(Mobile)), N'')
      WHERE WhatsApp IS NULL
        AND Mobile IS NOT NULL
        AND LTRIM(RTRIM(Mobile)) <> N'';
    `);
  }

  const check = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp'
  `);

  console.log('WhatsApp column ready:', check.recordset[0].cnt === 1);
  await pool.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
