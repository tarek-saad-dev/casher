import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = (r: string, ...a: unknown[]) => (r === 'server-only' ? {} : orig.call(m, r, ...a));

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();
  const gaps = await db.request().query(`
    SELECT e.EmpName, CONVERT(varchar(10),a.WorkDate,23) AS WorkDate, a.BranchID AS AttBranch,
      b.BranchName AS AttBranchName,
      (SELECT TOP 1 p.BranchID FROM dbo.TblEmpDailyPayroll p
       WHERE p.EmpID=a.EmpID AND p.WorkDate=a.WorkDate AND p.Status=N'Generated') AS PayBranchAny
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID=a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
    WHERE a.WorkDate>='2026-08-01' AND a.WorkDate<='2026-08-27'
      AND a.Status IN (N'Present',N'Late',N'EarlyLeave')
      AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpDailyPayroll p
        WHERE p.EmpID=a.EmpID AND p.BranchID=a.BranchID AND p.WorkDate=a.WorkDate AND p.Status=N'Generated')
    ORDER BY e.EmpName, a.WorkDate`);
  console.log('GAPS', gaps.recordset.length);
  console.table(gaps.recordset);

  const summary = await db.request().query(`
    SELECT e.EmpName,
      COUNT(DISTINCT p.WorkDate) payDays,
      SUM(CASE WHEN p.DailyWage>0 AND l.ID IS NULL THEN 1 ELSE 0 END) missLedger,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget t WHERE t.EmpID=e.EmpID AND t.WorkDate BETWEEN '2026-08-01' AND '2026-08-27' AND t.TargetAmount>0) tgtDays,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget t WHERE t.EmpID=e.EmpID AND t.WorkDate BETWEEN '2026-08-01' AND '2026-08-27' AND t.TargetAmount>0
        AND NOT EXISTS (SELECT 1 FROM dbo.TblEmpLedgerEntry l2 WHERE l2.RefType IN (N'TblEmpDailyTarget',N'EmpDailyTarget') AND l2.RefID=t.ID AND l2.EntryReason=N'target' AND l2.IsVoided=0)) missTgtLedger
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpDailyPayroll p ON p.EmpID=e.EmpID AND p.WorkDate BETWEEN '2026-08-01' AND '2026-08-27' AND p.Status=N'Generated'
    LEFT JOIN dbo.TblEmpLedgerEntry l ON l.RefType=N'TblEmpDailyPayroll' AND l.RefID=p.ID AND l.EntryReason=N'hourly_wage' AND l.IsVoided=0
    WHERE EXISTS (SELECT 1 FROM dbo.TblEmpDailyPayroll px WHERE px.EmpID=e.EmpID AND px.WorkDate BETWEEN '2026-08-01' AND '2026-08-27')
       OR EXISTS (SELECT 1 FROM dbo.TblEmpAttendance ax WHERE ax.EmpID=e.EmpID AND ax.WorkDate BETWEEN '2026-08-01' AND '2026-08-27')
    GROUP BY e.EmpID, e.EmpName
    ORDER BY e.EmpName`);
  console.log('\nSUMMARY');
  console.table(summary.recordset);
}
main().catch((e) => { console.error(e); process.exit(1); });
