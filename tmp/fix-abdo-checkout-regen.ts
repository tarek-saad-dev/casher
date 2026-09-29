#!/usr/bin/env npx tsx
/**
 * عبدو (EmpID 1192) — CAMP_CAESAR:
 * Set checkout to 02:00 on all worked days, regenerate daily payroll + ledger.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const EMP_ID = 1192;
const BRANCH_ID = 3;
const CHECKOUT = '02:00';
const NOTES = '[OpsFix] عبدو — توحيد الانصراف 02:00 وإعادة توليد اليومية';

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { saveAdminAttendance } = await import('../src/modules/attendance');
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '../src/lib/services/employeeLedgerDualWrite'
  );
  const { syncHourlyWageLedgerForEmployees } = await import(
    '../src/lib/services/employeeLedgerDualWrite'
  );

  const db = await getPool();
  const today = getCairoBusinessDate();

  const att = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .input('from', sql.Date, '2026-09-01')
    .input('to', sql.Date, today)
    .query(`
      SELECT
        CONVERT(varchar(10), WorkDate, 120) AS WorkDate,
        Status,
        CONVERT(varchar(5), CheckInTime, 108) AS CheckInTime,
        CONVERT(varchar(5), CheckOutTime, 108) AS CheckOutTime
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = @branchId
        AND WorkDate >= @from AND WorkDate <= @to
      ORDER BY WorkDate
    `);

  const rows = att.recordset as Array<{
    WorkDate: string;
    Status: string | null;
    CheckInTime: string | null;
    CheckOutTime: string | null;
  }>;

  const summary = {
    checkoutUpdated: [] as string[],
    checkoutAlreadyOk: [] as string[],
    skippedDayOff: [] as string[],
    payroll: [] as Array<Record<string, unknown>>,
    ledger: [] as Array<Record<string, unknown>>,
    failures: [] as string[],
  };

  for (const row of rows) {
    const status = String(row.Status ?? '');
    if (['DayOff', 'Absent', 'Excused'].includes(status) || !row.CheckInTime) {
      summary.skippedDayOff.push(`${row.WorkDate}:${status || 'no_checkin'}`);
      continue;
    }

    const checkIn = row.CheckInTime;
    const needsCheckoutFix = row.CheckOutTime !== CHECKOUT;

    try {
      if (needsCheckoutFix) {
        await saveAdminAttendance({
          branchId: BRANCH_ID,
          empId: EMP_ID,
          workDate: row.WorkDate,
          checkInTime: checkIn,
          checkOutTime: CHECKOUT,
          notes: `${NOTES} (كان ${row.CheckOutTime ?? '—'})`,
        });
        summary.checkoutUpdated.push(
          `${row.WorkDate}: ${row.CheckOutTime ?? 'null'} → ${CHECKOUT}`,
        );
        console.log(`ATT ${row.WorkDate} ${checkIn}→${CHECKOUT} (was ${row.CheckOutTime})`);
      } else {
        summary.checkoutAlreadyOk.push(row.WorkDate);
        console.log(`ATT ${row.WorkDate} already ${CHECKOUT}`);
      }

      const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(
        row.WorkDate,
        {
          notesPrefix: '[OpsFix][ABDO] ',
          branchId: BRANCH_ID,
          empIds: [EMP_ID],
        },
      );

      // Ensure ledger even if generate touched 0 rows (already Generated)
      const heal = await syncHourlyWageLedgerForEmployees(db, row.WorkDate, BRANCH_ID, [
        EMP_ID,
      ]);

      summary.payroll.push({
        workDate: row.WorkDate,
        generatedCount: result.generatedCount,
        totalHours: result.totalHours,
        totalWage: result.totalWage,
        ledgerSync,
        heal,
      });
      console.log(
        `PAY ${row.WorkDate} gen=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage} ledger=${JSON.stringify(ledgerSync)} heal=${JSON.stringify(heal)}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failures.push(`${row.WorkDate}: ${msg}`);
      console.error(`FAIL ${row.WorkDate}: ${msg}`);
    }
  }

  // Final verification
  const verify = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .input('from', sql.Date, '2026-09-01')
    .input('to', sql.Date, today)
    .query(`
      SELECT
        CONVERT(varchar(10), a.WorkDate, 120) AS workDate,
        a.Status AS attStatus,
        CONVERT(varchar(5), a.CheckInTime, 108) AS checkIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS checkOut,
        p.Status AS payStatus,
        CAST(p.DailyWage AS float) AS dailyWage,
        CAST(p.ActualHours AS float) AS hours,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage' AND ISNULL(l.IsVoided,0)=0
        ) THEN 1 ELSE 0 END AS hasActiveLedger,
        (
          SELECT TOP 1 CAST(l.Amount AS float)
          FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage' AND ISNULL(l.IsVoided,0)=0
        ) AS ledgerAmount
      FROM dbo.TblEmpAttendance a
      LEFT JOIN dbo.TblEmpDailyPayroll p
        ON p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
      WHERE a.EmpID = @empId AND a.BranchID = @branchId
        AND a.WorkDate >= @from AND a.WorkDate <= @to
      ORDER BY a.WorkDate
    `);

  summary.ledger = verify.recordset as Array<Record<string, unknown>>;

  const fs = await import('fs');
  const out = path.join(__dirname, 'abdo-checkout-regen-result.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    checkoutUpdated: summary.checkoutUpdated,
    checkoutAlreadyOk: summary.checkoutAlreadyOk,
    skippedDayOff: summary.skippedDayOff,
    failures: summary.failures,
    verify: summary.ledger,
  }, null, 2));
  console.log(`wrote ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
