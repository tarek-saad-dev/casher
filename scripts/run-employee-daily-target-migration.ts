#!/usr/bin/env npx tsx
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  });

  const text = fs.readFileSync(
    path.join(__dirname, '..', 'db/migrations/create-employee-daily-target-system.sql'),
    'utf8',
  );
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log('batches', batches.length);

  for (let i = 0; i < batches.length; i++) {
    console.log('running batch', i + 1);
    await pool.request().batch(batches[i]);
  }

  const check = await pool.request().query(`
    SELECT t.name FROM sys.tables t
    WHERE t.name IN (N'TblEmpTargetPlan', N'TblEmpTargetTier', N'TblEmpDailyTarget')
    ORDER BY t.name
  `);
  console.table(check.recordset);

  const counts = await pool.request().query(`
    SELECT N'plan' AS t, COUNT(*) AS c FROM dbo.TblEmpTargetPlan
    UNION ALL SELECT N'tier', COUNT(*) FROM dbo.TblEmpTargetTier
    UNION ALL SELECT N'daily', COUNT(*) FROM dbo.TblEmpDailyTarget
  `);
  console.table(counts.recordset);

  for (let i = 0; i < batches.length; i++) {
    await pool.request().batch(batches[i]);
  }
  console.log('Idempotent re-run OK');
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
