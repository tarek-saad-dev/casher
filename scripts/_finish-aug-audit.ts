import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = (r: string, ...a: unknown[]) => (r === 'server-only' ? {} : orig.call(m, r, ...a));

const FROM = '2026-08-01';
const TO = '2026-08-27';
const BRANCHES = [1, 3];

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const {
    getEmpBranchWorkDayCloseState,
    reopenEmpBranchWorkDay,
    persistEmpBranchWorkDayClosed,
  } = await import('@/lib/hr/empBranchWorkDayClose.service');
  const { generateEmployeeDailyTargets } = await import(
    '@/lib/payroll/employee-target/employee-daily-target-generation.service'
  );
  const { reconcileEmployeeDailyTargetLedger } = await import(
    '@/lib/payroll/employee-target/employee-daily-target-ledger-query.service'
  );
  const { runDailyPayrollGenerateWithOptionalLedger, syncHourlyWageLedgerForEmployees } =
    await import('@/lib/services/employeeLedgerDualWrite');

  const db = await getPool();
  const actor = await db.request().query(`SELECT TOP 1 UserID AS id FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0 ORDER BY UserID`);
  const actorUserId = Number(actor.recordset[0]?.id) || 10;

  const dates: string[] = [];
  const d = new Date(`${FROM}T12:00:00`);
  const end = new Date(`${TO}T12:00:00`);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  const reopened: string[] = [];
  for (const workDate of dates) {
    for (const branchId of BRANCHES) {
      const st = await getEmpBranchWorkDayCloseState(branchId, workDate);
      if (st.state === 'CLOSED') {
        await reopenEmpBranchWorkDay({ branchId, workDate, actorUserId, reopenReason: 'إعادة حساب تارجت أغسطس' });
        reopened.push(`${workDate} b${branchId}`);
      }
    }
  }
  console.log('Reopened:', reopened);

  for (const workDate of dates) {
    for (const branchId of BRANCHES) {
      try {
        await generateEmployeeDailyTargets({ workDate, branchId, generatedByUserId: actorUserId, empIds: null });
      } catch (e) {
        console.error('target', workDate, branchId, e instanceof Error ? e.message : e);
      }
    }
  }

  const recon = await reconcileEmployeeDailyTargetLedger({ year: 2026, month: 8, dryRun: false }, actorUserId);
  console.log('Reconcile:', recon.totals, recon.repair);

  const attNoPay = await db.request().query(`
    SELECT a.EmpID, e.EmpName, CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate, a.BranchID
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    WHERE a.WorkDate >= '${FROM}' AND a.WorkDate <= '${TO}'
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
      AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpDailyPayroll p
        WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate AND p.Status = N'Generated'
      )
  `);
  console.log('Att without payroll:', attNoPay.recordset.length);

  let payGen = 0;
  for (const row of attNoPay.recordset as Array<{ EmpID: number; WorkDate: string; BranchID: number; EmpName: string }>) {
    try {
      const { result } = await runDailyPayrollGenerateWithOptionalLedger(row.WorkDate, {
        branchId: row.BranchID,
        empIds: [row.EmpID],
        notesPrefix: '[OpsFill][AUG-AUDIT] ',
      });
      if (result.generatedCount > 0) {
        await syncHourlyWageLedgerForEmployees(db, row.WorkDate, row.BranchID, [row.EmpID]);
        payGen++;
        console.log(`PAY ${row.EmpName} ${row.WorkDate} b${row.BranchID}`);
      }
    } catch (e) {
      console.error(`PAY FAIL ${row.EmpName} ${row.WorkDate}`, e instanceof Error ? e.message : e);
    }
  }

  for (const key of reopened) {
    const [workDate, b] = key.split(' b');
    await persistEmpBranchWorkDayClosed({ branchId: Number(b), workDate, actorUserId });
  }

  const missingPayLedger = await db.request().query(`
    SELECT COUNT(*) AS c FROM dbo.TblEmpDailyPayroll p
    WHERE p.WorkDate >= '${FROM}' AND p.WorkDate <= '${TO}' AND p.Status = N'Generated' AND p.DailyWage > 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
          AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0)
  `);
  const missingTgtLedger = await db.request().query(`
    SELECT COUNT(*) AS c FROM dbo.TblEmpDailyTarget t
    WHERE t.WorkDate >= '${FROM}' AND t.WorkDate <= '${TO}' AND t.TargetAmount > 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget') AND l.RefID = t.ID
          AND l.EntryReason = N'target' AND l.IsVoided = 0)
  `);
  const attGap = await db.request().query(`
    SELECT COUNT(*) AS c FROM dbo.TblEmpAttendance a
    WHERE a.WorkDate >= '${FROM}' AND a.WorkDate <= '${TO}'
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
      AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpDailyPayroll p
        WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate AND p.Status = N'Generated')
  `);

  console.log('FINAL missing payroll ledger:', missingPayLedger.recordset[0].c);
  console.log('FINAL missing target ledger:', missingTgtLedger.recordset[0].c);
  console.log('FINAL att without payroll:', attGap.recordset[0].c);
  console.log('Payroll generated this run:', payGen);
}

main().catch((e) => { console.error(e); process.exit(1); });
