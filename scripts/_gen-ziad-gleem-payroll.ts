/**
 * Generate Ziad (EmpID 12) Gleem daily payroll for August 2026 + ledger dual-write.
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

const EMP_ID = 12;
const GLEEM_BRANCH_ID = 1;
const FROM = '2026-08-01';
const TO = '2026-08-31';
const REOPEN_REASON = 'توليد يوميات زياد بعد تصحيح الحضور في جليم';

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const day = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${mo}-${day}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
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
    persistEmpBranchWorkDayClosed,
  } = await import('@/lib/hr/empBranchWorkDayClose.service');

  const db = await getPool();
  const actorRes = await db.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY CASE WHEN UserLevel IN (N'Admin', N'admin', N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID);
  if (!Number.isFinite(actorUserId) || actorUserId <= 0) {
    throw new Error('لا يوجد مستخدم لإعادة فتح اليوم المقفل');
  }

  const dates = eachDateInclusive(FROM, TO);
  console.log(
    `Generate payroll زياد EmpID=${EMP_ID} Gleem ${FROM}→${TO} dualWrite=${process.env.EMP_LEDGER_DUAL_WRITE_ENABLED}`,
  );

  const summary = {
    ok: 0,
    skipPosted: 0,
    fail: 0,
    reopened: [] as string[],
    reclosed: [] as string[],
    hours: 0,
    wage: 0,
    ledgerInserted: 0,
    ledgerUpdated: 0,
    failures: [] as string[],
  };

  for (const workDate of dates) {
    const closeView = await getEmpBranchWorkDayCloseState(GLEEM_BRANCH_ID, workDate);
    const wasClosed = closeView.state === 'CLOSED';
    if (wasClosed) {
      await reopenEmpBranchWorkDay({
        branchId: GLEEM_BRANCH_ID,
        workDate,
        actorUserId,
        reopenReason: REOPEN_REASON,
      });
      summary.reopened.push(workDate);
      console.log(`REOPEN ${workDate}`);
    }

    const posted = await countPostedDailyPayroll(db, workDate, GLEEM_BRANCH_ID, [EMP_ID]);
    if (posted > 0) {
      summary.skipPosted++;
      console.log(`SKIP posted ${workDate}`);
    } else {
      try {
        const { result, ledgerDualWrite, ledgerSync } =
          await runDailyPayrollGenerateWithOptionalLedger(workDate, {
            notesPrefix: `[OpsFill][GLEEM] `,
            branchId: GLEEM_BRANCH_ID,
            empIds: [EMP_ID],
          });
        summary.ok++;
        summary.hours += Number(result.totalHours || 0);
        summary.wage += Number(result.totalWage || 0);
        summary.ledgerInserted += Number(ledgerSync?.inserted || 0);
        summary.ledgerUpdated += Number(ledgerSync?.updated || 0);
        console.log(
          `OK ${workDate} generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage} dual=${ledgerDualWrite} ledger=${JSON.stringify(ledgerSync ?? null)}`,
        );
      } catch (err) {
        summary.fail++;
        const msg = err instanceof Error ? err.message : String(err);
        summary.failures.push(`${workDate}: ${msg}`);
        console.error(`FAIL ${workDate}: ${msg}`);
      }
    }

    if (wasClosed) {
      try {
        await persistEmpBranchWorkDayClosed({
          branchId: GLEEM_BRANCH_ID,
          workDate,
          actorUserId,
        });
        summary.reclosed.push(workDate);
        console.log(`RECLOSE ${workDate}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.failures.push(`${workDate} reclose: ${msg}`);
        console.error(`RECLOSE FAIL ${workDate}: ${msg}`);
      }
    }
  }

  const pay = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('from', sql.Date, FROM)
    .input('to', sql.Date, TO)
    .query(`
      SELECT CONVERT(varchar(10), WorkDate, 23) AS WorkDate,
             ActualHours, DailyWage, Status
      FROM dbo.TblEmpDailyPayroll
      WHERE EmpID = @empId AND BranchID = ${GLEEM_BRANCH_ID}
        AND WorkDate >= @from AND WorkDate <= @to
      ORDER BY WorkDate
    `);

  let ledger: { recordset: unknown[] } = { recordset: [] };
  try {
    ledger = await db
      .request()
      .input('empId', sql.Int, EMP_ID)
      .input('from', sql.Date, FROM)
      .input('to', sql.Date, TO)
      .query(`
        SELECT CONVERT(varchar(10), EntryDate, 23) AS EntryDate,
               Amount, EntryReason, IsVoided
        FROM dbo.TblEmpLedgerEntry
        WHERE EmpID = @empId AND BranchID = ${GLEEM_BRANCH_ID}
          AND EntryReason = N'hourly_wage' AND IsVoided = 0
          AND EntryDate >= @from AND EntryDate <= @to
        ORDER BY EntryDate
      `);
  } catch (err) {
    console.error('ledger query failed', err instanceof Error ? err.message : err);
  }

  const wageSum = (pay.recordset as Array<{ DailyWage: number }>).reduce(
    (s, r) => s + Number(r.DailyWage || 0),
    0,
  );
  const ledgerSum = (ledger.recordset as Array<{ Amount: number }>).reduce(
    (s, r) => s + Number(r.Amount || 0),
    0,
  );

  console.log('\n=== PAYROLL ===');
  console.table(pay.recordset);
  console.log('\n=== LEDGER hourly_wage ===');
  console.table(ledger.recordset);
  console.log('\n=== SUMMARY ===');
  console.log(summary);
  console.log(
    `payrollDays=${pay.recordset.length} wageSum=${wageSum.toFixed(2)} ledgerDays=${ledger.recordset.length} ledgerSum=${ledgerSum.toFixed(2)}`,
  );

  process.exit(summary.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
