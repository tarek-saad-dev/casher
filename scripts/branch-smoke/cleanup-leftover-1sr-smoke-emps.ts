/**
 * Soft-deactivate leftover Phase 1S / 1SR smoke employees on Camp Caesar.
 * Preserves EmpID=12 زياد.
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const ZIAD = 12;
const BRANCH = 3;

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const pool = await getPool();

  const emps = await pool.request().query(`
    SELECT EmpID, EmpName, isActive
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%[[]SMOKE 1SR]%'
       OR EmpName LIKE N'%[[]SMOKE 1S]%'
    ORDER BY EmpID
  `);

  for (const e of emps.recordset) {
    const empId = Number(e.EmpID);
    if (empId === ZIAD) continue;
    await pool.request().input('e', sql.Int, empId).query(`
      UPDATE dbo.TblEmp SET isActive = 0 WHERE EmpID = @e;
      UPDATE dbo.TblEmpBranchAssignment
        SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE EmpID = @e AND BranchID = ${BRANCH} AND IsActive = 1;
      UPDATE dbo.TblEmpBranchWorkSchedule
        SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE EmpID = @e AND BranchID = ${BRANCH} AND IsActive = 1;
      UPDATE dbo.TblEmpBranchPayrollPlan
        SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE EmpID = @e AND BranchID = ${BRANCH} AND IsActive = 1;
    `);
    console.log(`deactivated emp ${empId} ${e.EmpName}`);
  }

  // Soft-delete smoke products
  await pool.request().query(`
    UPDATE dbo.TblPro SET isDeleted = 1
    WHERE ProName LIKE N'%[[]SMOKE 1SR]%' OR ProName LIKE N'%[[]SMOKE 1S]%'
  `);

  // Mark failed runs cleanup
  await pool.request().query(`
    UPDATE dbo.TblBranchSmokeRun
    SET CleanupStatus = N'COMPLETED', Status = CASE WHEN Status = N'RUNNING' THEN N'FAILED' ELSE Status END
    WHERE SmokeRunID IN (19, 20) AND ISNULL(CleanupStatus, N'NONE') <> N'COMPLETED'
  `);

  const roster = await pool.request().input('b', sql.Int, BRANCH).query(`
    SELECT a.EmpID, e.EmpName, a.IsActive, a.CanReceiveBookings
    FROM dbo.TblEmpBranchAssignment a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    WHERE a.BranchID = @b AND a.IsActive = 1
  `);
  console.log('active CC roster', roster.recordset);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
