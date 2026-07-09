#!/usr/bin/env node
const sql = require('mssql');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const invId = parseInt(process.argv[2] || '7304', 10);

const config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER,
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_NAME,
  user: process.env.CLOUD_DB_USER || process.env.DB_USER,
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.CLOUD_DB_ENCRYPT === 'true' || process.env.CLOUD_DB_SERVER?.includes('windows.net'),
    trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
};

async function main() {
  const pool = await sql.connect(config);
  console.log('DB:', config.database);

  const col = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME IN ('WhatsApp', 'Mobile')
  `);
  console.log('TblEmp phone columns:', col.recordset.map((r) => r.COLUMN_NAME));

  const inv = await pool.request().input('id', sql.Int, invId).query(`
    SELECT d.EmpID, e.EmpName, e.Mobile, e.WhatsApp, p.ProName AS ServiceName
    FROM dbo.TblinvServDetail d
    LEFT JOIN dbo.TblEmp e ON d.EmpID = e.EmpID
    LEFT JOIN dbo.TblPro p ON d.ProID = p.ProID
    WHERE d.invID = @id AND d.invType = N'مبيعات'
  `);
  console.log(`Invoice ${invId} lines:`, JSON.stringify(inv.recordset, null, 2));

  await pool.close();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
