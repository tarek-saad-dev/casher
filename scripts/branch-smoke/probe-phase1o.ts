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

  const proCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblPro'
    ORDER BY ORDINAL_POSITION
  `);

  const durCols = proCols.recordset.filter((c: { COLUMN_NAME: string }) =>
    /dur|min|time|serv|price|name|type/i.test(c.COLUMN_NAME),
  );

  const hasSPrice1 = proCols.recordset.some(
    (c: { COLUMN_NAME: string }) => c.COLUMN_NAME === 'SPrice1',
  );
  const hasPName = proCols.recordset.some(
    (c: { COLUMN_NAME: string }) => c.COLUMN_NAME === 'PName',
  );
  const nameCol = hasPName ? 'PName' : 'ProName';

  const serv = await pool.request().query(`
    SELECT TOP 20 ProID, ${nameCol} AS PName, ProType, PPrice, DurationMinutes
    FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0 ORDER BY ProID
  `);

  const priceCnt = await pool.request().query(`
    SELECT
      COUNT(*) AS ActiveRows,
      SUM(CASE WHEN ISNULL(PPrice,0)>0 THEN 1 ELSE 0 END) AS WithPPrice,
      SUM(CASE WHEN ISNULL(DurationMinutes,0)>0 THEN 1 ELSE 0 END) AS WithDur,
      SUM(CASE WHEN LOWER(ISNULL(ProType,N'')) IN (N'serv', N'service') THEN 1 ELSE 0 END) AS ServType
    FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0
  `);

  const users = await pool.request().query(`
    SELECT UserID, UserName, ISNULL(isDeleted,0) AS isDeleted
    FROM dbo.TblUser
    ORDER BY UserID
  `);

  const partnerShareCols = await pool.request().query(`
    SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblBranchPartnerShare'
    ORDER BY ORDINAL_POSITION
  `);

  // branch settings / policy tables?
  const tables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Branch%Setting%' OR TABLE_NAME LIKE '%Branch%Config%'
       OR TABLE_NAME LIKE '%Branch%Policy%' OR TABLE_NAME LIKE '%Setup%'
    ORDER BY TABLE_NAME
  `);

  const gleemHours = await pool.request().query(`
    SELECT TOP 5 EmpID, DayOfWeek,
      CONVERT(varchar(8), StartTime, 108) AS StartTime,
      CONVERT(varchar(8), EndTime, 108) AS EndTime
    FROM dbo.TblEmpWorkSchedule
    WHERE EmpID IN (SELECT TOP 3 EmpID FROM dbo.TblEmpBranchAssignment WHERE BranchID=1 AND IsActive=1)
    ORDER BY EmpID, DayOfWeek
  `);

  // check schedule for BranchID column
  const schedCols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='TblEmpWorkSchedule' ORDER BY ORDINAL_POSITION
  `);

  const out = {
    hasSPrice1,
    nameCol,
    durCols,
    priceCnt: priceCnt.recordset[0],
    servSample: serv.recordset,
    users: users.recordset,
    partnerShareCols: partnerShareCols.recordset,
    configTables: tables.recordset,
    gleemHoursSample: gleemHours.recordset,
    schedCols: schedCols.recordset,
  };
  fs.writeFileSync(path.join(__dirname, '_phase1o-probe.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
