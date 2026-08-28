import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
const m = Module as any;
const orig = m._load;
m._load = (r: string, ...a: unknown[]) => (r === 'server-only' ? {} : orig.call(m, r, ...a));

async function main() {
  const { getPool } = await import('@/lib/db');
  const { runDailyPayrollGenerateWithOptionalLedger, syncHourlyWageLedgerForEmployees } =
    await import('@/lib/services/employeeLedgerDualWrite');
  const db = await getPool();
  const gaps = await db.request().query(`
    SELECT a.EmpID, e.EmpName, CONVERT(varchar(10),a.WorkDate,23) WorkDate, a.BranchID
    FROM dbo.TblEmpAttendance a JOIN dbo.TblEmp e ON e.EmpID=a.EmpID
    WHERE a.WorkDate>='2026-08-01' AND a.WorkDate<='2026-08-27'
      AND a.Status IN (N'Present',N'Late',N'EarlyLeave')
      AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpDailyPayroll p
        WHERE p.EmpID=a.EmpID AND p.BranchID=a.BranchID AND p.WorkDate=a.WorkDate AND p.Status=N'Generated')
  `);
  let ok = 0;
  let fail = 0;
  for (const row of gaps.recordset as Array<{ EmpID: number; EmpName: string; WorkDate: string; BranchID: number }>) {
    try {
      const { result } = await runDailyPayrollGenerateWithOptionalLedger(row.WorkDate, {
        branchId: row.BranchID,
        empIds: [row.EmpID],
        notesPrefix: '[OpsFill][AUG-AUDIT] ',
      });
      if (result.generatedCount > 0) {
        await syncHourlyWageLedgerForEmployees(db, row.WorkDate, row.BranchID, [row.EmpID]);
        ok++;
        console.log('OK', row.EmpName, row.WorkDate);
      } else {
        fail++;
        console.log('SKIP', row.EmpName, row.WorkDate);
      }
    } catch (e) {
      fail++;
      console.log('ERR', row.EmpName, row.WorkDate, e instanceof Error ? e.message : e);
    }
  }
  console.log('done ok=', ok, 'fail=', fail);
}
main().catch((e) => { console.error(e); process.exit(1); });
