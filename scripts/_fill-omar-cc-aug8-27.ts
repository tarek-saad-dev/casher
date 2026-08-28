/**
 * Omar (EmpID 25) Camp Caesar August 2026-08-08 → 2026-08-27:
 * Set attendance 13:00 → 00:00 on working days, generate missing payroll.
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

const EMP_ID = 25;
const BRANCH_ID = 3; // كامب شيزار
const FROM = '2026-08-08';
const TO = '2026-08-27';
const CHECK_IN = '13:00';
const CHECK_OUT = '00:00';
const NOTES = '[OpsFill][CC] حضور عمر 13:00→00:00';
const REOPEN_REASON = 'تصحيح حضور وتوليد يوميات عمر — كامب شيزار';

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

async function removePayroll(
  db: Awaited<ReturnType<typeof import('@/lib/db')['getPool']>>,
  sql: typeof import('@/lib/db')['sql'],
  payrollId: number,
): Promise<void> {
  await db
    .request()
    .input('payrollId', sql.Int, payrollId)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = N'إعادة توليد بعد تصحيح حضور عمر',
          UpdatedAt = SYSDATETIME()
      WHERE RefType = N'TblEmpDailyPayroll'
        AND RefID = @payrollId
        AND EntryReason = N'hourly_wage'
        AND IsVoided = 0
    `);
  await db
    .request()
    .input('payrollId', sql.Int, payrollId)
    .query(`DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @payrollId`);
}

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');
  const { deriveAttendanceStatusAfterFill } = await import('@/lib/hr/finalize-incomplete-attendance');
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

  const summary = {
    skippedDayOff: 0,
    attInserted: 0,
    attUpdated: 0,
    attUnchanged: 0,
    payrollRegenerated: 0,
    payrollGenerated: 0,
    payrollSkipPosted: 0,
    payrollSkipUnchanged: 0,
    failures: [] as string[],
    reopened: [] as string[],
    reclosed: [] as string[],
  };

  const dates = eachDateInclusive(FROM, TO);
  console.log(`Omar EmpID=${EMP_ID} Camp Caesar ${FROM}→${TO} ${CHECK_IN}→${CHECK_OUT}`);

  for (const workDate of dates) {
    let wasClosed = false;
    try {
      const closeView = await getEmpBranchWorkDayCloseState(BRANCH_ID, workDate);
      wasClosed = closeView.state === 'CLOSED';
      if (wasClosed) {
        await reopenEmpBranchWorkDay({
          branchId: BRANCH_ID,
          workDate,
          actorUserId,
          reopenReason: REOPEN_REASON,
        });
        summary.reopened.push(workDate);
        console.log(`REOPEN ${workDate}`);
      }

      const attRes = await db
        .request()
        .input('empId', sql.Int, EMP_ID)
        .input('branchId', sql.Int, BRANCH_ID)
        .input('workDate', sql.Date, workDate)
        .query(`
          SELECT TOP 1 ID, Status,
            CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
            CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime
          FROM dbo.TblEmpAttendance
          WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
        `);
      const existing = attRes.recordset[0] as
        | {
            ID: number;
            Status: string | null;
            CheckInTime: string | null;
            CheckOutTime: string | null;
          }
        | undefined;

      if (existing?.Status === 'DayOff') {
        summary.skippedDayOff++;
        console.log(`SKIP DayOff ${workDate}`);
        continue;
      }

      const { status, lateMinutes, earlyLeaveMinutes } = deriveAttendanceStatusAfterFill({
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        schedStart: CHECK_IN,
        schedEnd: CHECK_OUT,
      });

      const needsAttUpdate =
        !existing ||
        existing.CheckInTime !== CHECK_IN ||
        existing.CheckOutTime !== CHECK_OUT ||
        existing.Status === 'DayOff';

      if (needsAttUpdate) {
        if (existing) {
          await persistNightlyDefaultFillAttendance({
            db,
            mode: 'update',
            attendanceId: existing.ID,
            branchId: BRANCH_ID,
            checkInTime: CHECK_IN,
            checkOutTime: CHECK_OUT,
            status,
            lateMinutes,
            earlyLeaveMinutes,
            notes: NOTES,
            scheduledStart: CHECK_IN,
            scheduledEnd: CHECK_OUT,
          });
          summary.attUpdated++;
          console.log(`ATT update ${workDate} ${CHECK_IN}→${CHECK_OUT} (${status})`);
        } else {
          await persistNightlyDefaultFillAttendance({
            db,
            mode: 'insert',
            branchId: BRANCH_ID,
            empId: EMP_ID,
            workDate,
            checkInTime: CHECK_IN,
            checkOutTime: CHECK_OUT,
            status,
            lateMinutes,
            earlyLeaveMinutes,
            notes: NOTES,
            scheduledStart: CHECK_IN,
            scheduledEnd: CHECK_OUT,
          });
          summary.attInserted++;
          console.log(`ATT insert ${workDate} ${CHECK_IN}→${CHECK_OUT} (${status})`);
        }
      } else {
        summary.attUnchanged++;
        console.log(`ATT ok ${workDate}`);
      }

      const payRes = await db
        .request()
        .input('empId', sql.Int, EMP_ID)
        .input('branchId', sql.Int, BRANCH_ID)
        .input('workDate', sql.Date, workDate)
        .query(`
          SELECT TOP 1 ID, Status FROM dbo.TblEmpDailyPayroll
          WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
        `);
      const payRow = payRes.recordset[0] as { ID: number; Status: string } | undefined;

      const posted = await countPostedDailyPayroll(db, workDate, BRANCH_ID, [EMP_ID]);
      if (posted > 0) {
        summary.payrollSkipPosted++;
        console.log(`SKIP payroll posted ${workDate}`);
        continue;
      }

      if (payRow && !needsAttUpdate) {
        summary.payrollSkipUnchanged++;
        console.log(`SKIP payroll ok ${workDate}`);
        continue;
      }

      if (payRow && payRow.Status !== 'PostedToCashMove') {
        await removePayroll(db, sql, payRow.ID);
        console.log(`PAY removed ${workDate} id=${payRow.ID}`);
      }

      const { result } = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
        notesPrefix: '[OpsFill][CC] ',
        branchId: BRANCH_ID,
        empIds: [EMP_ID],
      });

      if (result.generatedCount > 0) {
        if (payRow) summary.payrollRegenerated++;
        else summary.payrollGenerated++;
        console.log(
          `PAY ${workDate} generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage}`,
        );
      } else {
        summary.failures.push(`${workDate}: payroll not generated`);
        console.log(`PAY WARN no rows ${workDate}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failures.push(`${workDate}: ${msg}`);
      console.error(`FAIL ${workDate}: ${msg}`);
    } finally {
      if (wasClosed) {
        try {
          await persistEmpBranchWorkDayClosed({
            branchId: BRANCH_ID,
            workDate,
            actorUserId,
          });
          summary.reclosed.push(workDate);
          console.log(`RECLOSE ${workDate}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.failures.push(`${workDate} reclose: ${msg}`);
        }
      }
    }
  }

  const verify = await db.request().query(`
    WITH MonthDays AS (
      SELECT CAST('${FROM}' AS date) AS WorkDate
      UNION ALL SELECT DATEADD(DAY, 1, WorkDate) FROM MonthDays WHERE WorkDate < '${TO}'
    )
    SELECT
      CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate,
      a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      p.DailyWage, p.ActualHours, p.Status AS PayStatus
    FROM MonthDays d
    LEFT JOIN dbo.TblEmpAttendance a
      ON a.EmpID = ${EMP_ID} AND a.BranchID = ${BRANCH_ID} AND a.WorkDate = d.WorkDate
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = ${EMP_ID} AND p.BranchID = ${BRANCH_ID} AND p.WorkDate = d.WorkDate
    ORDER BY d.WorkDate
    OPTION (MAXRECURSION 366)
  `);

  console.log('\n=== VERIFY ===');
  console.table(verify.recordset);
  console.log('\n=== SUMMARY ===');
  console.log(summary);

  process.exit(summary.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
