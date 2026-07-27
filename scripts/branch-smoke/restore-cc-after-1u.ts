import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

async function main() {
  const { getPool } = await import('../../src/lib/db');
  const pool = await getPool();
  await pool.request().query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus = N'INTERNAL_LIVE', IsActive = 1,
        PublicBookingEnabled = 0, ExternalNotificationsEnabled = 1
    WHERE BranchID = 3;
    UPDATE dbo.QueueBookingSettings SET BookingEnabled = 0 WHERE BranchID = 3;
  `);
  const b = (
    await pool.request().query(`
      SELECT LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
      FROM dbo.TblBranch WHERE BranchID = 3
    `)
  ).recordset[0];
  const ziad = (
    await pool.request().query(`
      SELECT COUNT(*) AS C FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = 12 AND BranchID = 3 AND IsActive = 1
    `)
  ).recordset[0];
  const testActive = (
    await pool.request().query(`
      SELECT COUNT(*) AS C FROM dbo.TblEmp
      WHERE EmpName LIKE N'%[[]TEST]%' AND isActive = 1
    `)
  ).recordset[0];
  const smoke = (
    await pool.request().query(`
      SELECT SmokeRunID, Status, CleanupStatus FROM dbo.TblBranchSmokeRun WHERE SmokeRunID = 28
    `)
  ).recordset[0];
  console.log(JSON.stringify({ branch: b, ziadAsg: ziad.C, testActive: testActive.C, smoke }, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
