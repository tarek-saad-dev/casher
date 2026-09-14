#!/usr/bin/env npx tsx
/**
 * Regenerate Abdou (EmpID 1192) daily payroll from first work day → today
 * using the saved branch payroll plan hourly rate.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const EMP_ID = 1192;
const NOTES = '[RegenAbdou] إعادة توليد يوميات عبدو بالساعة الجديدة ';
const REOPEN_REASON = 'إعادة توليد يوميات عبدو بعد تحديث الساعة';

function todayLocalYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '@/lib/services/employeeLedgerDualWrite'
  );
  const { countPostedDailyPayroll } = await import('@/lib/payroll/dailyPayrollGenerateCore');
  const {
    getEmpBranchWorkDayCloseState,
    reopenEmpBranchWorkDay,
  } = await import('@/lib/hr/empBranchWorkDayClose.service');

  const db = await getPool();
  const to = todayLocalYmd();

  const emp = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT EmpID, EmpName, ManualHourlyRate, HourlyRate, PayrollMethod
    FROM dbo.TblEmp WHERE EmpID = @empId
  `);
  console.log('EMP:', JSON.stringify(emp.recordset[0], null, 2));

  const plans = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT PlanID, BranchID, PayType, HourlyRate, DailyRate,
           CONVERT(varchar(10), EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(varchar(10), EffectiveTo, 23) AS EffectiveTo,
           IsActive
    FROM dbo.TblEmpBranchPayrollPlan
    WHERE EmpID = @empId AND IsActive = 1
    ORDER BY BranchID, EffectiveFrom DESC
  `);
  console.log('ACTIVE PLANS:', JSON.stringify(plans.recordset, null, 2));
  const activeHourly = plans.recordset.find(
    (p: { PayType: string; HourlyRate: number | null; IsActive: boolean }) =>
      p.PayType === 'hourly' && Number(p.HourlyRate) > 0,
  ) as { HourlyRate: number } | undefined;
  if (!activeHourly) {
    throw new Error('لا توجد خطة ساعة نشطة لعبدو');
  }
  const newRate = Number(activeHourly.HourlyRate);
  console.log(`Using plan hourly rate: ${newRate}`);

  // Align TblEmp rates with the plan the user saved (generate uses plan; keep emp row consistent).
  await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('rate', sql.Decimal(10, 4), newRate)
    .query(`
      UPDATE dbo.TblEmp
      SET ManualHourlyRate = @rate, HourlyRate = @rate
      WHERE EmpID = @empId
        AND (
          ISNULL(ManualHourlyRate, -1) <> @rate
          OR ISNULL(HourlyRate, -1) <> @rate
        )
    `);

  const before = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT
      COUNT(*) AS PayCount,
      MIN(HourlyRateSnapshot) AS MinRate,
      MAX(HourlyRateSnapshot) AS MaxRate,
      SUM(DailyWage) AS TotalWage,
      SUM(ActualHours) AS TotalHours
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = @empId
  `);
  console.log('BEFORE:', JSON.stringify(before.recordset[0], null, 2));

  const days = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT DISTINCT
      CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      a.BranchID
    FROM dbo.TblEmpAttendance a
    WHERE a.EmpID = @empId
      AND a.CheckInTime IS NOT NULL
      AND a.CheckOutTime IS NOT NULL
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
    ORDER BY WorkDate, a.BranchID
  `);

  const rows = days.recordset as Array<{ WorkDate: string; BranchID: number }>;
  console.log(`Attendance days to regen: ${rows.length} (through ${to})`);

  const actorRes = await db.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY CASE WHEN UserLevel IN (N'Admin', N'admin', N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID);

  let ok = 0;
  let skipPosted = 0;
  let skipClosedFail = 0;
  let fail = 0;

  for (const row of rows) {
    if (row.WorkDate > to) {
      console.log(`SKIP future ${row.WorkDate} branch=${row.BranchID}`);
      continue;
    }

    const posted = await countPostedDailyPayroll(db, row.WorkDate, row.BranchID, [EMP_ID]);
    if (posted > 0) {
      console.log(`SKIP posted ${row.WorkDate} branch=${row.BranchID}`);
      skipPosted += 1;
      continue;
    }

    try {
      if (Number.isFinite(actorUserId) && actorUserId > 0) {
        const closeView = await getEmpBranchWorkDayCloseState(row.BranchID, row.WorkDate);
        if (closeView.state === 'CLOSED') {
          await reopenEmpBranchWorkDay({
            branchId: row.BranchID,
            workDate: row.WorkDate,
            actorUserId,
            reopenReason: REOPEN_REASON,
          });
          console.log(`REOPENED ${row.WorkDate} branch=${row.BranchID}`);
        }
      }

      const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(
        row.WorkDate,
        {
          notesPrefix: NOTES,
          branchId: row.BranchID,
          empIds: [EMP_ID],
        },
      );
      console.log(
        `OK ${row.WorkDate} branch=${row.BranchID}: generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage} ledger=${JSON.stringify(ledgerSync ?? null)}`,
      );
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAIL ${row.WorkDate} branch=${row.BranchID}: ${msg}`);
      if (/closed|مقفل|مغلق/i.test(msg)) skipClosedFail += 1;
      else fail += 1;
    }
  }

  const after = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT
      COUNT(*) AS PayCount,
      MIN(HourlyRateSnapshot) AS MinRate,
      MAX(HourlyRateSnapshot) AS MaxRate,
      SUM(DailyWage) AS TotalWage,
      SUM(ActualHours) AS TotalHours
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = @empId
  `);
  console.log('AFTER:', JSON.stringify(after.recordset[0], null, 2));

  const byRate = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT HourlyRateSnapshot, COUNT(*) AS cnt, SUM(DailyWage) AS wage, SUM(ActualHours) AS hours
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = @empId
    GROUP BY HourlyRateSnapshot
    ORDER BY HourlyRateSnapshot
  `);
  console.log('BY RATE:', JSON.stringify(byRate.recordset, null, 2));

  const sample = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT
      CONVERT(varchar(10), WorkDate, 23) AS WorkDate,
      BranchID, HourlyRateSnapshot, ActualHours, DailyWage, Status
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = @empId
    ORDER BY WorkDate, BranchID
  `);
  console.log('ALL PAY:', JSON.stringify(sample.recordset, null, 2));

  console.log(
    `DONE ok=${ok} skipPosted=${skipPosted} skipClosedFail=${skipClosedFail} fail=${fail} rate=${newRate}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
