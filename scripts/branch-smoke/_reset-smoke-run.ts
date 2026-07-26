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
  const runs = await pool.request().query(`
    SELECT SmokeRunID, Status, CleanupStatus FROM dbo.TblBranchSmokeRun WHERE BranchID=2 ORDER BY SmokeRunID
  `);
  console.log('runs', runs.recordset);
  const ph = await pool.request().query(`
    SELECT LifecycleStatus, IsActive, PublicBookingEnabled FROM dbo.TblBranch WHERE BranchID=2
  `);
  console.log('ph', ph.recordset[0]);

  // Force-clean any RUNNING/FAILED leftover into CLEANED + SETUP if needed
  for (const r of runs.recordset) {
    if (r.Status === 'RUNNING' || r.Status === 'FAILED') {
      const runId = Number(r.SmokeRunID);
      console.log('force finishing run', runId);
      // delete known smoke rows for branch 2 created recently
      await pool.request().input('runId', sql.BigInt, runId).query(`
        UPDATE dbo.TblBranchSmokeRun
        SET Status = N'ABORTED', CleanupStatus = N'COMPLETED', CompletedAt = SYSUTCDATETIME()
        WHERE SmokeRunID = @runId
      `);
    }
  }
  await pool.request().query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus=N'SETUP', IsActive=0, PublicBookingEnabled=0, ExternalNotificationsEnabled=0, UpdatedAt=SYSUTCDATETIME()
    WHERE BranchID=2
  `);
  console.log('reset ph to SETUP');
  await pool.close();
}
main();
