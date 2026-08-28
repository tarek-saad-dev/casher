/**
 * Force Ziad (EmpID 12) Gleem attendance to a full Present day (13:00–00:00)
 * for August 2026, including CLOSED workdays (reopen → fill → payroll → re-close).
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

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
const FULL_IN = '13:00';
const FULL_OUT = '00:00';
const NOTES = '[OpsFill][GLEEM] حضور يوم كامل زياد أغسطس';
const REOPEN_REASON = 'تصحيح حضور زياد ليوم كامل في جليم';

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
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');
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
    SELECT TOP 1 UserID
    FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY CASE WHEN UserLevel IN (N'Admin', N'admin', N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID);
  if (!Number.isFinite(actorUserId) || actorUserId <= 0) {
    throw new Error('لا يوجد مستخدم لإعادة فتح/قفل اليوم');
  }

  const dates = eachDateInclusive(FROM, TO);
  console.log(`Force full-day Present زياد EmpID=${EMP_ID} Gleem ${FROM}→${TO} actor=${actorUserId}`);

  const summary = {
    reopened: [] as string[],
    recloased: [] as string[],
    attUpdated: 0,
    attInserted: 0,
    payrollOk: 0,
    payrollSkipPosted: 0,
    payrollFail: 0,
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

    const isFriday = new Date(`${workDate}T12:00:00`).getDay() === 5;
    if (isFriday) {
      await unlockScheduleForWorkOnDayOff({
        empId: EMP_ID,
        date: workDate,
        branchId: GLEEM_BRANCH_ID,
        reason: 'حضور يوم كامل في جليم',
        sourceTag: 'ops-ziad-gleem-fullday',
      });
    }

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
      | { ID: number; Status: string | null; CheckInTime: string | null; CheckOutTime: string | null }
      | undefined;

    if (existing) {
      await persistNightlyDefaultFillAttendance({
        db,
        mode: 'update',
        attendanceId: existing.ID,
        branchId: GLEEM_BRANCH_ID,
        checkInTime: FULL_IN,
        checkOutTime: FULL_OUT,
        status: 'Present',
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        notes: NOTES,
        scheduledStart: FULL_IN,
        scheduledEnd: FULL_OUT,
      });
      summary.attUpdated++;
      console.log(
        `ATT update ${workDate} ${existing.Status} ${existing.CheckInTime ?? '—'}–${existing.CheckOutTime ?? '—'} → Present ${FULL_IN}–${FULL_OUT}`,
      );
    } else {
      await persistNightlyDefaultFillAttendance({
        db,
        mode: 'insert',
        branchId: GLEEM_BRANCH_ID,
        empId: EMP_ID,
        workDate,
        checkInTime: FULL_IN,
        checkOutTime: FULL_OUT,
        status: 'Present',
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        notes: NOTES,
        scheduledStart: FULL_IN,
        scheduledEnd: FULL_OUT,
      });
      summary.attInserted++;
      console.log(`ATT insert ${workDate} Present ${FULL_IN}–${FULL_OUT}`);
    }

    const posted = await countPostedDailyPayroll(db, workDate, GLEEM_BRANCH_ID, [EMP_ID]);
    if (posted > 0) {
      summary.payrollSkipPosted++;
      console.log(`PAY skip posted ${workDate}`);
    } else {
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

    if (wasClosed) {
      try {
        await persistEmpBranchWorkDayClosed({
          branchId: GLEEM_BRANCH_ID,
          workDate,
          actorUserId,
        });
        summary.recloased.push(workDate);
        console.log(`RECLOSE ${workDate}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.failures.push(`${workDate} reclose: ${msg}`);
        console.error(`RECLOSE FAIL ${workDate}: ${msg}`);
      }
    }
  }

  const afterAtt = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('from', sql.Date, FROM)
    .input('to', sql.Date, TO)
    .query(`
      SELECT CONVERT(varchar(10), WorkDate, 23) AS WorkDate,
             CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
             CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime,
             Status
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = ${GLEEM_BRANCH_ID}
        AND WorkDate >= @from AND WorkDate <= @to
      ORDER BY WorkDate
    `);
  const afterPay = await db
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
  const closeAfter = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS WorkDate, State
    FROM dbo.TblEmpBranchWorkDayClose
    WHERE BranchID = ${GLEEM_BRANCH_ID}
      AND WorkDate >= '${FROM}' AND WorkDate <= '${TO}'
    ORDER BY WorkDate
  `);

  console.log('\n=== ATTENDANCE ===');
  console.table(afterAtt.recordset);
  console.log('\n=== PAYROLL ===');
  console.table(afterPay.recordset);
  console.log('\n=== CLOSE STATE ===');
  console.table(closeAfter.recordset);

  const wageSum = (afterPay.recordset as Array<{ DailyWage: number }>).reduce(
    (s, r) => s + Number(r.DailyWage || 0),
    0,
  );
  const notFull = (afterAtt.recordset as Array<{ CheckInTime: string; CheckOutTime: string; Status: string }>).filter(
    (r) => r.CheckInTime !== FULL_IN || r.CheckOutTime !== FULL_OUT || r.Status !== 'Present',
  );
  console.log('\n=== SUMMARY ===');
  console.log(summary);
  console.log(`days=${afterAtt.recordset.length} payroll=${afterPay.recordset.length} wageSum=${wageSum.toFixed(2)} notFull=${notFull.length}`);

  process.exit(summary.failures.length || notFull.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
