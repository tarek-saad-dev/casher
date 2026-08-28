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

type Row = Record<string, unknown>;

function fmt(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : String(n ?? '');
}

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();

  // 1) All GapReview / OpsFill tagged payroll (any date)
  const tagged = await db.request().query(`
    SELECT
      p.ID AS PayId,
      p.EmpID,
      e.EmpName,
      CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.BranchID,
      b.BranchName,
      p.DailyWage,
      p.Status,
      CASE
        WHEN p.Notes LIKE N'%[GapReview]%' THEN N'GapReview'
        WHEN p.Notes LIKE N'%[OpsFill]%' THEN N'OpsFill'
        ELSE N'other'
      END AS Source,
      CASE WHEN l.ID IS NULL THEN 0 ELSE 1 END AS HasLedger,
      l.Amount AS LedgerAmount,
      l.BranchID AS LedgerBranch,
      LEFT(p.Notes, 80) AS NotesShort,
      p.CreatedAt,
      p.UpdatedAt
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll'
      AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage'
      AND l.IsVoided = 0
    WHERE p.Notes LIKE N'%[GapReview]%'
       OR p.Notes LIKE N'%[OpsFill]%'
    ORDER BY e.EmpName, p.WorkDate
  `);

  console.log('=== TAGGED GENERATIONS (GapReview + OpsFill) ===');
  console.log('Total rows:', tagged.recordset.length);
  console.table(
  (tagged.recordset as Row[]).map((r) => ({
    EmpName: r.EmpName,
    WorkDate: r.WorkDate,
    Branch: r.BranchName,
    DailyWage: fmt(r.DailyWage),
    Source: r.Source,
    Ledger: r.HasLedger ? '✓' : (Number(r.DailyWage) > 0 ? '✗ MISSING' : '— zero'),
    Status: r.Status,
  })),
  );

  // 2) Per-employee summary for tagged
  const byEmp = await db.request().query(`
    SELECT
      e.EmpID,
      e.EmpName,
      SUM(CASE WHEN p.Notes LIKE N'%[GapReview]%' THEN 1 ELSE 0 END) AS GapReviewDays,
      SUM(CASE WHEN p.Notes LIKE N'%[OpsFill]%' THEN 1 ELSE 0 END) AS OpsFillDays,
      COUNT(*) AS TotalTagged,
      SUM(p.DailyWage) AS TotalWage,
      SUM(CASE WHEN p.DailyWage > 0 AND l.ID IS NULL THEN 1 ELSE 0 END) AS MissingLedgerPositive
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
    WHERE p.Notes LIKE N'%[GapReview]%'
       OR p.Notes LIKE N'%[OpsFill]%'
    GROUP BY e.EmpID, e.EmpName
    ORDER BY e.EmpName
  `);

  console.log('\n=== PER EMPLOYEE (tagged only) ===');
  console.table(
    (byEmp.recordset as Row[]).map((r) => ({
      EmpName: r.EmpName,
      GapReview: r.GapReviewDays,
      OpsFill: r.OpsFillDays,
      Total: r.TotalTagged,
      TotalWage: fmt(r.TotalWage),
      MissingLedger: r.MissingLedgerPositive,
    })),
  );

  // 3) August 2026 — all Generated payroll per employee (full month context)
  const augAll = await db.request().query(`
    SELECT
      e.EmpID,
      e.EmpName,
      COUNT(*) AS GeneratedDays,
      SUM(p.DailyWage) AS TotalWage,
      SUM(CASE WHEN p.DailyWage > 0 AND l.ID IS NULL THEN 1 ELSE 0 END) AS MissingLedger,
      SUM(CASE WHEN p.Notes LIKE N'%[GapReview]%' THEN 1 ELSE 0 END) AS GapReviewDays,
      SUM(CASE WHEN p.Notes LIKE N'%[OpsFill]%' THEN 1 ELSE 0 END) AS OpsFillDays
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
    WHERE p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-31'
      AND p.Status = N'Generated'
    GROUP BY e.EmpID, e.EmpName
    HAVING SUM(CASE WHEN p.Notes LIKE N'%[GapReview]%' OR p.Notes LIKE N'%[OpsFill]%' THEN 1 ELSE 0 END) > 0
        OR SUM(CASE WHEN p.DailyWage > 0 AND l.ID IS NULL THEN 1 ELSE 0 END) > 0
    ORDER BY e.EmpName
  `);

  console.log('\n=== AUGUST 2026 — employees with tagged gen OR ledger gap ===');
  console.table(
    (augAll.recordset as Row[]).map((r) => ({
      EmpName: r.EmpName,
      Days: r.GeneratedDays,
      TotalWage: fmt(r.TotalWage),
      GapReview: r.GapReviewDays,
      OpsFill: r.OpsFillDays,
      MissingLedger: r.MissingLedger,
    })),
  );

  // 4) Recent activity last 4 hours (any source)
  const recent = await db.request().query(`
    SELECT
      e.EmpName,
      CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      b.BranchName,
      p.DailyWage,
      p.Status,
      CASE
        WHEN p.Notes LIKE N'%[GapReview]%' THEN N'GapReview'
        WHEN p.Notes LIKE N'%[OpsFill]%' THEN N'OpsFill'
        WHEN p.Notes LIKE N'%NightlyClose%' THEN N'NightlyClose'
        ELSE N'manual/other'
      END AS Source,
      CASE WHEN l.ID IS NULL AND p.DailyWage > 0 THEN N'MISSING' ELSE N'ok' END AS Ledger,
      COALESCE(p.UpdatedAt, p.CreatedAt) AS TouchedAt
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
    WHERE COALESCE(p.UpdatedAt, p.CreatedAt) >= DATEADD(HOUR, -4, SYSDATETIME())
    ORDER BY TouchedAt DESC
  `);

  console.log('\n=== LAST 4 HOURS — any payroll touch ===');
  console.log('Rows:', recent.recordset.length);
  console.table(
    (recent.recordset as Row[]).map((r) => ({
      EmpName: r.EmpName,
      WorkDate: r.WorkDate,
      Branch: r.BranchName,
      Wage: fmt(r.DailyWage),
      Source: r.Source,
      Ledger: r.Ledger,
      TouchedAt: r.TouchedAt,
    })),
  );

  // 5) Any positive-wage Generated missing ledger in August (all employees)
  const gaps = await db.request().query(`
    SELECT e.EmpName, CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.DailyWage, b.BranchName, LEFT(p.Notes, 60) AS Notes
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-31'
      AND p.Status = N'Generated' AND p.DailyWage > 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
          AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
      )
    ORDER BY e.EmpName, p.WorkDate
  `);

  console.log('\n=== AUGUST POSITIVE-WAGE MISSING LEDGER (all employees) ===');
  console.log('Count:', gaps.recordset.length);
  if (gaps.recordset.length) console.table(gaps.recordset);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
