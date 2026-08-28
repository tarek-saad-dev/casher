import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = function (r: string, ...a: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...a);
};

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();

  // Payroll touched in last ~2h (GapReview notes or recent CreatedAt)
  const recentPay = await db.request().query(`
    SELECT
      p.ID AS PayId,
      p.EmpID,
      e.EmpName,
      CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.BranchID,
      b.BranchName,
      p.DailyWage,
      p.Status,
      p.Notes,
      p.CreatedAt,
      p.UpdatedAt
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE (
      p.Notes LIKE N'%[GapReview]%'
      OR p.Notes LIKE N'%[OpsFill]%'
      OR p.UpdatedAt >= DATEADD(HOUR, -2, SYSDATETIME())
      OR p.CreatedAt >= DATEADD(HOUR, -2, SYSDATETIME())
    )
      AND p.WorkDate >= '2026-08-01'
    ORDER BY COALESCE(p.UpdatedAt, p.CreatedAt) DESC, p.WorkDate DESC
  `);

  console.log('RECENT PAYROLL ROWS:', recentPay.recordset.length);
  console.table(recentPay.recordset);

  const missing = await db.request().query(`
    SELECT
      p.ID AS PayId,
      p.EmpID,
      e.EmpName,
      CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.BranchID,
      b.BranchName,
      p.DailyWage,
      p.Status,
      p.Notes
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE p.Status = N'Generated'
      AND (
        p.Notes LIKE N'%[GapReview]%'
        OR p.Notes LIKE N'%[OpsFill]%'
        OR p.UpdatedAt >= DATEADD(HOUR, -2, SYSDATETIME())
        OR p.CreatedAt >= DATEADD(HOUR, -2, SYSDATETIME())
      )
      AND p.WorkDate >= '2026-08-01'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = N'TblEmpDailyPayroll'
          AND l.RefID = p.ID
          AND l.EntryReason = N'hourly_wage'
          AND l.IsVoided = 0
      )
    ORDER BY p.WorkDate, e.EmpName
  `);

  console.log('\nMISSING LEDGER (should be 0):', missing.recordset.length);
  if (missing.recordset.length) console.table(missing.recordset);

  const synced = await db.request().query(`
    SELECT
      p.ID AS PayId,
      e.EmpName,
      CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.DailyWage,
      l.ID AS LedgerId,
      l.Amount AS LedgerAmount,
      l.BranchID AS LedgerBranch
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll'
      AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage'
      AND l.IsVoided = 0
    WHERE (
      p.Notes LIKE N'%[GapReview]%'
      OR p.Notes LIKE N'%[OpsFill]%'
      OR p.UpdatedAt >= DATEADD(HOUR, -2, SYSDATETIME())
      OR p.CreatedAt >= DATEADD(HOUR, -2, SYSDATETIME())
    )
      AND p.WorkDate >= '2026-08-01'
    ORDER BY p.WorkDate, e.EmpName
  `);

  console.log('\nSYNCED PAIRS:', synced.recordset.length);
  console.table(synced.recordset);

  // Employees we touched this session
  const emps = ['كريم', 'عمر', 'عبدو', 'زياد'];
  for (const name of emps) {
    const r = await db.request().input('name', `%${name}%`).query(`
      SELECT
        e.EmpName,
        COUNT(*) AS payrollDays,
        SUM(CASE WHEN l.ID IS NULL THEN 1 ELSE 0 END) AS missingLedger
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
        AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
      WHERE e.EmpName LIKE @name
        AND p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-28'
        AND p.Status = N'Generated'
      GROUP BY e.EmpName
    `);
    if (r.recordset[0]) console.log('EMP SUMMARY:', r.recordset[0]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
