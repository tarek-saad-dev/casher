/**
 * Karim (EmpID 5) Gleem August 2026:
 * - Sundays → DayOff (إجازة), no payroll
 * - Skip future days from Fri 2026-08-28 onward
 * - Remaining missing payroll days: complete attendance if needed, then generate
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

const EMP_ID = 5;
const GLEEM_BRANCH_ID = 1;
const FROM = '2026-08-01';
const LAST_PAYROLL_DATE = '2026-08-27'; // Fri 28+ = future, skip
const NOTES = '[OpsFill][GLEEM] تصحيح حضور كريم أغسطس';
const REOPEN_REASON = 'تصحيح حضور وتوليد يوميات كريم في جليم';

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

function isSunday(workDate: string): boolean {
  return new Date(`${workDate}T12:00:00`).getDay() === 0;
}

function isFriday(workDate: string): boolean {
  return new Date(`${workDate}T12:00:00`).getDay() === 5;
}

/** Karim Gleem overnight checkout default when punch missing. */
const DEFAULT_CHECKOUT = '02:00';

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { saveAdminAttendance, persistNightlyDefaultFillAttendance } = await import(
    '@/modules/attendance'
  );
  const { unlockScheduleForWorkOnDayOff } = await import(
    '@/lib/hr/attendance/workOnDayOff.service'
  );
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

  const dates = eachDateInclusive(FROM, LAST_PAYROLL_DATE);
  console.log(
    `Karim EmpID=${EMP_ID} Gleem ${FROM}→${LAST_PAYROLL_DATE} (skip future from 2026-08-28)`,
  );

  const summary = {
    sundayDayOff: 0,
    attCompleted: 0,
    payrollOk: 0,
    payrollSkipExisting: 0,
    payrollSkipPosted: 0,
    payrollSkipSunday: 0,
    payrollFail: 0,
    reopened: [] as string[],
    reclosed: [] as string[],
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

    if (isSunday(workDate)) {
      await saveAdminAttendance({
        branchId: GLEEM_BRANCH_ID,
        empId: EMP_ID,
        workDate,
        status: 'DayOff',
        notes: `${NOTES} — إجازة أحد`,
      });
      summary.sundayDayOff++;

      const sundayPay = await db
        .request()
        .input('empId', sql.Int, EMP_ID)
        .input('branchId', sql.Int, GLEEM_BRANCH_ID)
        .input('workDate', sql.Date, workDate)
        .query(`
          SELECT ID, Status FROM dbo.TblEmpDailyPayroll
          WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
        `);
      const payRow = sundayPay.recordset[0] as { ID: number; Status: string } | undefined;
      if (payRow && payRow.Status !== 'PostedToCashMove') {
        await db
          .request()
          .input('payrollId', sql.Int, payRow.ID)
          .query(`
            UPDATE dbo.TblEmpLedgerEntry
            SET IsVoided = 1,
                VoidReason = N'إجازة أحد — حذف يومية',
                UpdatedAt = SYSDATETIME()
            WHERE RefType = N'TblEmpDailyPayroll'
              AND RefID = @payrollId
              AND EntryReason = N'hourly_wage'
              AND IsVoided = 0
          `);
        await db
          .request()
          .input('payrollId', sql.Int, payRow.ID)
          .query(`DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @payrollId`);
        console.log(`SUN removed payroll ${workDate} id=${payRow.ID}`);
      }

      console.log(`SUN DayOff ${workDate}`);
    } else {
      const attRes = await db
        .request()
        .input('empId', sql.Int, EMP_ID)
        .input('branchId', sql.Int, GLEEM_BRANCH_ID)
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

      const payRes = await db
        .request()
        .input('empId', sql.Int, EMP_ID)
        .input('branchId', sql.Int, GLEEM_BRANCH_ID)
        .input('workDate', sql.Date, workDate)
        .query(`
          SELECT TOP 1 ID, Status FROM dbo.TblEmpDailyPayroll
          WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
        `);
      const hasPayroll = payRes.recordset.length > 0;

      if (hasPayroll) {
        summary.payrollSkipExisting++;
        console.log(`SKIP payroll exists ${workDate}`);
      } else if (existing) {
        const status = existing.Status ?? '';
        const needsCheckout =
          existing.CheckInTime &&
          !existing.CheckOutTime &&
          !['DayOff', 'Absent', 'Excused'].includes(status);

        if (needsCheckout) {
          const checkIn = existing.CheckInTime!;
          const checkOut = DEFAULT_CHECKOUT;
          if (isFriday(workDate)) {
            await unlockScheduleForWorkOnDayOff({
              empId: EMP_ID,
              date: workDate,
              branchId: GLEEM_BRANCH_ID,
              reason: 'إكمال حضور كريم',
              sourceTag: 'ops-karim-gleem-fill',
            });
          }
          await persistNightlyDefaultFillAttendance({
            db,
            mode: 'update',
            attendanceId: existing.ID,
            branchId: GLEEM_BRANCH_ID,
            checkInTime: checkIn,
            checkOutTime: checkOut,
            status: status === 'Late' ? 'Late' : 'Present',
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            notes: `${NOTES} — إكمال خروج`,
            scheduledStart: checkIn,
            scheduledEnd: checkOut,
          });
          summary.attCompleted++;
          console.log(`ATT complete ${workDate} ${checkIn}→${checkOut} (was missing checkout)`);
        }

        const posted = await countPostedDailyPayroll(db, workDate, GLEEM_BRANCH_ID, [EMP_ID]);
        if (posted > 0) {
          summary.payrollSkipPosted++;
          console.log(`SKIP posted ${workDate}`);
        } else if (['DayOff', 'Absent', 'Excused'].includes(status)) {
          console.log(`SKIP payroll non-payable status ${workDate} ${status}`);
        } else {
          if (isFriday(workDate) && status !== 'DayOff') {
            await unlockScheduleForWorkOnDayOff({
              empId: EMP_ID,
              date: workDate,
              branchId: GLEEM_BRANCH_ID,
              reason: 'توليد يومية كريم',
              sourceTag: 'ops-karim-gleem-payroll',
            });
          }
          try {
            const { result } = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
              notesPrefix: `[OpsFill][GLEEM] `,
              branchId: GLEEM_BRANCH_ID,
              empIds: [EMP_ID],
            });
            summary.payrollOk++;
            console.log(
              `PAY ${workDate} generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage}`,
            );
          } catch (err) {
            summary.payrollFail++;
            const msg = err instanceof Error ? err.message : String(err);
            summary.failures.push(`${workDate} payroll: ${msg}`);
            console.error(`PAY FAIL ${workDate}: ${msg}`);
          }
        }
      } else {
        console.log(`SKIP no attendance ${workDate}`);
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

  const missingRes = await db.request().query(`
    WITH MonthDays AS (
      SELECT CAST(DATEADD(DAY, n, '2026-08-01') AS date) AS WorkDate
      FROM (SELECT TOP (27) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n FROM sys.all_objects) nums
      WHERE DATEADD(DAY, n, '2026-08-01') <= '2026-08-27'
    )
    SELECT CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate,
           DATENAME(WEEKDAY, d.WorkDate) AS DayName,
           a.Status AS AttStatus,
           CASE WHEN p.ID IS NULL THEN 0 ELSE 1 END AS HasPayroll
    FROM MonthDays d
    LEFT JOIN dbo.TblEmpAttendance a
      ON a.EmpID = ${EMP_ID} AND a.BranchID = ${GLEEM_BRANCH_ID} AND a.WorkDate = d.WorkDate
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = ${EMP_ID} AND p.BranchID = ${GLEEM_BRANCH_ID} AND p.WorkDate = d.WorkDate
    WHERE p.ID IS NULL
      AND NOT (DATEPART(WEEKDAY, d.WorkDate) = 1) -- skip Sundays (expected no payroll)
    ORDER BY d.WorkDate
  `);

  const pay = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS WorkDate, ActualHours, DailyWage, Status
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = ${EMP_ID} AND BranchID = ${GLEEM_BRANCH_ID}
      AND WorkDate >= '${FROM}' AND WorkDate <= '${LAST_PAYROLL_DATE}'
    ORDER BY WorkDate
  `);

  console.log('\n=== STILL MISSING (non-Sunday, through 27) ===');
  console.table(missingRes.recordset);
  console.log('\n=== PAYROLL through 27 ===');
  console.table(pay.recordset);
  console.log('\n=== SUMMARY ===');
  console.log(summary);

  process.exit(summary.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
