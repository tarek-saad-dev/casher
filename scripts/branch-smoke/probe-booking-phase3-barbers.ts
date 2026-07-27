/**
 * Read-only live counts for Booking Phase 3 barbers.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const pool = await getPool();

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmp WHERE ISNULL(isActive,1)=1) AS ActiveEmployees,
      (SELECT COUNT(*) FROM dbo.TblEmp WHERE ISNULL(isActive,1)=1
        AND Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')) AS ActiveBarberJobs,
      (SELECT COUNT(*) FROM dbo.TblEmp WHERE EmpName LIKE N'%[[]TEST]%' OR EmpName LIKE N'%[[]SMOKE%') AS TestSmokeEmployees,
      (SELECT COUNT(DISTINCT ea.EmpID) FROM dbo.TblEmpBranchAssignment ea
        INNER JOIN dbo.TblBranch b ON b.BranchID=ea.BranchID
        WHERE ea.IsActive=1 AND b.BranchCode=N'GLEEM') AS GleemAssigned,
      (SELECT COUNT(DISTINCT ea.EmpID) FROM dbo.TblEmpBranchAssignment ea
        INNER JOIN dbo.TblBranch b ON b.BranchID=ea.BranchID
        INNER JOIN dbo.TblEmp e ON e.EmpID=ea.EmpID
        WHERE ea.IsActive=1 AND ea.CanReceiveBookings=1 AND b.BranchCode=N'GLEEM'
          AND ISNULL(e.isActive,1)=1) AS GleemCanBook,
      (SELECT COUNT(*) FROM dbo.TblEmp e
        WHERE ISNULL(e.isActive,1)=1
          AND NOT EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment ea WHERE ea.EmpID=e.EmpID AND ea.IsActive=1)
      ) AS ActiveNoAssignment,
      (SELECT COUNT(DISTINCT ea.EmpID) FROM dbo.TblEmpBranchAssignment ea
        INNER JOIN dbo.TblEmp e ON e.EmpID=ea.EmpID
        WHERE ea.IsActive=1 AND ea.CanReceiveBookings=1 AND ISNULL(e.isActive,1)=1
          AND NOT EXISTS (
            SELECT 1 FROM dbo.TblEmpBranchWorkSchedule s
            WHERE s.EmpID=ea.EmpID AND s.BranchID=ea.BranchID AND s.IsActive=1
          )
      ) AS CanBookNoWeeklySchedule
  `);

  const weekday = await pool.request().query(`
    SELECT s.DayOfWeek, COUNT(DISTINCT s.EmpID) AS EmpCount
    FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblBranch b ON b.BranchID=s.BranchID
    WHERE s.IsActive=1 AND b.BranchCode=N'GLEEM' AND ISNULL(s.CanReceiveBookings,1)=1
    GROUP BY s.DayOfWeek
    ORDER BY s.DayOfWeek
  `);

  const dupNames = await pool.request().query(`
    SELECT EmpName, COUNT(*) AS Cnt
    FROM dbo.TblEmp
    WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
    GROUP BY EmpName
    HAVING COUNT(*) > 1
  `);

  const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME=N'TblEmp'
      AND COLUMN_NAME LIKE N'%Image%' OR (TABLE_NAME=N'TblEmp' AND COLUMN_NAME LIKE N'%Photo%')
      OR (TABLE_NAME=N'TblEmp' AND COLUMN_NAME LIKE N'%Avatar%')
      OR (TABLE_NAME=N'TblEmp' AND COLUMN_NAME LIKE N'%Bio%')
    ORDER BY COLUMN_NAME
  `);

  // fix cols query - OR precedence issue
  const cols2 = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME=N'TblEmp'
      AND (
        COLUMN_NAME LIKE N'%Image%'
        OR COLUMN_NAME LIKE N'%Photo%'
        OR COLUMN_NAME LIKE N'%Avatar%'
        OR COLUMN_NAME LIKE N'%Bio%'
        OR COLUMN_NAME LIKE N'%Sort%'
        OR COLUMN_NAME LIKE N'%Display%'
      )
    ORDER BY COLUMN_NAME
  `);

  const { listGlobalPublicBarbers } = await import('../../src/lib/hr/barberGlobalCalendar');
  const global = await listGlobalPublicBarbers({ date: new Date().toISOString().slice(0, 10) });
  const ids = global.map((g) => g.empId);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);

  const out = {
    counts: counts.recordset[0],
    gleemWeekday: weekday.recordset,
    duplicateNames: dupNames.recordset,
    empImageLikeColumns: cols2.recordset,
    globalPublicBarbers: {
      count: global.length,
      duplicateEmpIds: dupIds,
      sample: global.slice(0, 5),
      branches: [...new Set(global.flatMap((g) => g.branches.map((b) => b.branchCode)))],
    },
  };
  fs.writeFileSync(
    path.join(__dirname, '_booking-phase3-barber-probe.json'),
    JSON.stringify(out, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
