import dotenv from 'dotenv';
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
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

  // Delete any leftover PH1GTEST smoke cash moves / day that blocked NewDay delete
  const cm = await pool.request().query(`
    SELECT ID, Notes, BusinessDayID FROM dbo.TblCashMove
    WHERE BranchID = 2 AND Notes LIKE N'%[SMOKE]%'
  `);
  console.log('leftover smoke cashmoves', cm.recordset);
  for (const row of cm.recordset) {
    await pool.request().input('id', sql.Int, row.ID).query(`
      DELETE FROM dbo.TblCashMove WHERE ID = @id AND BranchID = 2
    `);
  }

  const days = await pool.request().query(`
    SELECT ID, NewDay FROM dbo.TblNewDay WHERE BranchID = 2 AND NewDay = '2026-07-26'
  `);
  console.log('ph days', days.recordset);
  for (const d of days.recordset) {
    await pool.request().input('id', sql.Int, d.ID).query(`
      DELETE FROM dbo.TblShiftMove WHERE BusinessDayID = @id AND BranchID = 2;
      DELETE FROM dbo.TblNewDay WHERE ID = @id AND BranchID = 2;
    `);
  }

  // Remaining operational counts
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID=2) AS Bookings,
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID=2) AS Queue,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID=2) AS Attendance,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID=2) AS Payroll,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID=2) AS Ledger,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget WHERE BranchID=2) AS Targets,
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID=2) AS CashMoves,
      (SELECT COUNT(*) FROM dbo.TblEmp WHERE EmpName LIKE N'%SMOKE%') AS SmokeEmps,
      (SELECT LifecycleStatus FROM dbo.TblBranch WHERE BranchID=2) AS Lifecycle,
      (SELECT CAST(IsActive AS INT) FROM dbo.TblBranch WHERE BranchID=2) AS IsActive,
      (SELECT CAST(PublicBookingEnabled AS INT) FROM dbo.TblBranch WHERE BranchID=2) AS PublicBooking,
      (SELECT Status FROM dbo.TblBranchSmokeRun WHERE SmokeRunID=3) AS Run3Status,
      (SELECT CleanupStatus FROM dbo.TblBranchSmokeRun WHERE SmokeRunID=3) AS Run3Cleanup,
      (SELECT COUNT(*) FROM dbo.TblBranchSmokeArtifact WHERE SmokeRunID=3 AND CleanupStatus <> N'CLEANED') AS PendingArts
  `);
  console.log(counts.recordset[0]);

  const out = {
    capturedAt: new Date().toISOString(),
    smokeRunId: 3,
    postCleanup: counts.recordset[0],
  };
  fs.writeFileSync(
    path.join('scripts/branch-smoke/_phase1m-smoke-after-cleanup.json'),
    JSON.stringify(out, null, 2),
  );
  await pool.close();
}
main();
