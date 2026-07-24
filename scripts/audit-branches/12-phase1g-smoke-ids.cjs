/** Resolve GLEEM operator + bookable emp for Phase 1G smoke. */
const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool } = await connectReadOnly();
  try {
    const u = await pool.request().query(`
      SELECT TOP 3 uba.UserID, u.UserName
      FROM dbo.TblUserBranchAccess uba
      INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
      INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
      WHERE b.BranchCode = N'GLEEM'
        AND uba.CanOperate = 1 AND uba.IsActive = 1
        AND ISNULL(u.isDeleted, 0) = 0
      ORDER BY uba.UserID
    `);
    const e = await pool.request().query(`
      SELECT TOP 3 ea.EmpID, em.EmpName
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblEmp em ON em.EmpID = ea.EmpID
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      WHERE b.BranchCode = N'GLEEM'
        AND ea.IsActive = 1 AND ea.CanReceiveBookings = 1
        AND ISNULL(em.isActive, 1) = 1
      ORDER BY ea.EmpID
    `);
    const gleemFp = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Bookings b
           INNER JOIN dbo.TblBranch br ON br.BranchID = b.BranchID AND br.BranchCode = N'GLEEM') AS BookingsGleem,
        (SELECT COUNT(*) FROM dbo.QueueTickets q
           INNER JOIN dbo.TblBranch br ON br.BranchID = q.BranchID AND br.BranchCode = N'GLEEM') AS QueueGleem
    `);
    console.log(JSON.stringify({ users: u.recordset, emps: e.recordset, gleemFp: gleemFp.recordset[0] }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
