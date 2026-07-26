#!/usr/bin/env npx tsx
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || '',
    user: process.env.CLOUD_DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  });

  const pro = await pool.request().query(`
    SELECT COUNT(*) AS c,
           SUM(CASE WHEN ISNULL(isDeleted,0)=0 THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN ISNULL(isDeleted,0)=0 AND LOWER(ISNULL(ProType,N'')) IN (N'serv',N'service') THEN 1 ELSE 0 END) AS activeServ
    FROM dbo.TblPro
  `);

  const allPro = await pool.request().query(`
    SELECT ProID, ProName, ProType, PPrice, SPrice1, DurationMinutes, ISNULL(isDeleted,0) AS del
    FROM dbo.TblPro ORDER BY ProID
  `);

  const emps = await pool.request().query(`
    SELECT EmpID, EmpName, Job, ISNULL(isActive,1) AS isActive
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%عايدة%' OR EmpName LIKE N'%طارق%' OR EmpName LIKE N'%ذياد%'
       OR EmpName LIKE N'%زياد%' OR EmpName LIKE N'%عمر%' OR EmpName LIKE N'%Aida%'
       OR EmpName LIKE N'%Tarek%' OR EmpName LIKE N'%Omar%' OR EmpName LIKE N'%Ziad%'
  `);

  const qbsCols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='QueueBookingSettings' ORDER BY ORDINAL_POSITION
  `);

  const out = { pro: pro.recordset[0], allPro: allPro.recordset, emps: emps.recordset, qbsCols: qbsCols.recordset };
  fs.writeFileSync(path.join(__dirname, '_phase1o-probe2.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
