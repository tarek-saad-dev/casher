import dotenv from 'dotenv';
import sql from 'mssql';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER!,
    database: process.env.CLOUD_DB_NAME!,
    user: process.env.CLOUD_DB_USER!,
    password: process.env.CLOUD_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true },
  });
  for (const t of [
    'QueueTickets',
    'TblEmpDailyPayroll',
    'TblEmpLedgerEntry',
    'TblEmpDailyTarget',
    'TblCashMove',
    'TblEmpAttendance',
    'TblNewDay',
  ]) {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='${t}'
        AND (COLUMN_NAME LIKE '%ID' OR COLUMN_NAME LIKE '%Id')
      ORDER BY ORDINAL_POSITION
    `);
    console.log(t + ':', r.recordset.map((x: { COLUMN_NAME: string }) => x.COLUMN_NAME).join(', '));
  }
  console.log(
    'runs',
    (
      await pool.request().query(`SELECT SmokeRunID, Status FROM dbo.TblBranchSmokeRun WHERE BranchID=2`)
    ).recordset,
  );
  console.log(
    'ph',
    (
      await pool
        .request()
        .query(
          `SELECT LifecycleStatus, IsActive, PublicBookingEnabled FROM dbo.TblBranch WHERE BranchID=2`,
        )
    ).recordset[0],
  );
  await pool.close();
}
main();
