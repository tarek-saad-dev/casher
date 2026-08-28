/**
 * Ops fill: Ziad (EmpID 12) Gleem attendance + daily payroll for August 2026.
 * Uses DefaultFill times (13:00–00:00) and payroll generate scoped to EmpID 12.
 * Does not overwrite complete Gleem punches. Skips CLOSED workdays. No WhatsApp.
 *
 * Range: 2026-08-01 → 2026-08-27 (through yesterday; today not filled).
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
const TO = '2026-08-27';
const DEFAULT_IN = '13:00';
const DEFAULT_OUT = '00:00';
const NOTES = '[OpsFill][GLEEM] حضور/يوميات زياد أغسطس';

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

function hhmm(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');
  const { applyDefaultTimesToRow } = await import('@/lib/hr/attendance-default-fill');
  const { unlockScheduleForWorkOnDayOff } = await import(
    '@/lib/hr/attendance/workOnDayOff.service'
  );
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '@/lib/services/employeeLedgerDualWrite'
  );
  const { countPostedDailyPayroll } = await import('@/lib/payroll/dailyPayrollGenerateCore');
  const { assertEmpBranchWorkDayMutable } = await import(
    '@/lib/hr/empBranchWorkDayClose.service'
  );

  const db = await getPool();
  const dates = eachDateInclusive(FROM, TO);

  const emp = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT EmpID, EmpName,
           CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
           CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
    FROM dbo.TblEmp WHERE EmpID = @empId
  `);
  const empRow = emp.recordset[0] as {
    EmpID: number;
    EmpName: string;
    DefaultCheckInTime: string | null;
    DefaultCheckOutTime: string | null;
  };
  if (!empRow) throw new Error('زياد EmpID=12 غير موجود');
  const defaultIn = hhmm(empRow.DefaultCheckInTime) || DEFAULT_IN;
  const defaultOut = hhmm(empRow.DefaultCheckOutTime) || DEFAULT_OUT;

  console.log(
    `Fill ${empRow.EmpName} EmpID=${EMP_ID} Gleem=${GLEEM_BRANCH_ID} ${FROM}→${TO} defaults ${defaultIn}-${defaultOut}`,
  );

  const summary = {
    attInserted: 0,
    attUpdated: 0,
    attKept: 0,
    attSkippedClosed: 0,
    payrollOk: 0,
    payrollSkipPosted: 0,
    payrollSkipClosed: 0,
    payrollFail: 0,
    failures: [] as string[],
  };

  for (const workDate of dates) {
    let mutable = true;
    try {
      await assertEmpBranchWorkDayMutable(GLEEM_BRANCH_ID, workDate);
    } catch (err) {
      mutable = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SKIP closed ${workDate}: ${msg}`);
      summary.attSkippedClosed++;
    }

    const attRes = await db
      .request()
      .input('empId', sql.Int, EMP_ID)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .input('workDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1
          ID, Status,
          CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
          CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime,
          CONVERT(VARCHAR(5), ScheduledStartTime, 108) AS ScheduledStartTime,
          CONVERT(VARCHAR(5), ScheduledEndTime, 108) AS ScheduledEndTime
        FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
      `);
    const existing = attRes.recordset[0] as
      | {
          ID: number;
          Status: string | null;
          CheckInTime: string | null;
          CheckOutTime: string | null;
          ScheduledStartTime: string | null;
          ScheduledEndTime: string | null;
        }
      | undefined;

    const status = existing?.Status || 'Pending';
    const checkIn = hhmm(existing?.CheckInTime);
    const checkOut = hhmm(existing?.CheckOutTime);
    const completePayable =
      !!existing &&
      !!checkIn &&
      !!checkOut &&
      ['Present', 'Late', 'EarlyLeave'].includes(status);

    if (mutable && !completePayable) {
      const isFriday = new Date(`${workDate}T12:00:00`).getDay() === 5;
      if (isFriday || status === 'DayOff' || status === 'Absent' || status === 'Excused') {
        await unlockScheduleForWorkOnDayOff({
          empId: EMP_ID,
          date: workDate,
          branchId: GLEEM_BRANCH_ID,
          reason: 'تعبئة حضور أغسطس في جليم',
          sourceTag: 'ops-ziad-gleem-august',
        });
      }

      const filled = applyDefaultTimesToRow({
        CheckInTime: checkIn,
        CheckOutTime: checkOut,
        DefaultCheckInTime: defaultIn,
        DefaultCheckOutTime: defaultOut,
        ScheduledStartTime: hhmm(existing?.ScheduledStartTime) || defaultIn,
        ScheduledEndTime: hhmm(existing?.ScheduledEndTime) || defaultOut,
        Status: ['DayOff', 'Absent', 'Excused'].includes(status) ? 'Pending' : status,
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      if (!filled.CheckInTime || !filled.CheckOutTime) {
        const msg = `${workDate}: defaults missing after fill`;
        console.error(msg);
        summary.failures.push(msg);
      } else if (existing) {
        await persistNightlyDefaultFillAttendance({
          db,
          mode: 'update',
          attendanceId: existing.ID,
          branchId: GLEEM_BRANCH_ID,
          checkInTime: filled.CheckInTime,
          checkOutTime: filled.CheckOutTime,
          status: filled.Status,
          lateMinutes: filled.LateMinutes,
          earlyLeaveMinutes: filled.EarlyLeaveMinutes,
          notes: NOTES,
          scheduledStart: defaultIn,
          scheduledEnd: defaultOut,
        });
        summary.attUpdated++;
        console.log(
          `ATT update ${workDate} id=${existing.ID} ${status} ${checkIn ?? '—'}–${checkOut ?? '—'} → ${filled.Status} ${filled.CheckInTime}–${filled.CheckOutTime}`,
        );
      } else {
        await persistNightlyDefaultFillAttendance({
          db,
          mode: 'insert',
          branchId: GLEEM_BRANCH_ID,
          empId: EMP_ID,
          workDate,
          checkInTime: filled.CheckInTime,
          checkOutTime: filled.CheckOutTime,
          status: filled.Status,
          lateMinutes: filled.LateMinutes,
          earlyLeaveMinutes: filled.EarlyLeaveMinutes,
          notes: NOTES,
          scheduledStart: defaultIn,
          scheduledEnd: defaultOut,
        });
        summary.attInserted++;
        console.log(
          `ATT insert ${workDate} ${filled.Status} ${filled.CheckInTime}–${filled.CheckOutTime}`,
        );
      }
    } else if (completePayable) {
      summary.attKept++;
      console.log(`ATT keep ${workDate} ${status} ${checkIn}–${checkOut}`);
    }

    if (!mutable) {
      summary.payrollSkipClosed++;
      continue;
    }

    const posted = await countPostedDailyPayroll(db, workDate, GLEEM_BRANCH_ID, [EMP_ID]);
    if (posted > 0) {
      summary.payrollSkipPosted++;
      console.log(`PAY skip posted ${workDate}`);
      continue;
    }

    try {
      const { result, ledgerDualWrite, ledgerSync } =
        await runDailyPayrollGenerateWithOptionalLedger(workDate, {
          notesPrefix: `[OpsFill][GLEEM] `,
          branchId: GLEEM_BRANCH_ID,
          empIds: [EMP_ID],
        });
      summary.payrollOk++;
      console.log(
        `PAY ${workDate} generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage} dual=${ledgerDualWrite} ledger=${JSON.stringify(ledgerSync ?? null)}`,
      );
    } catch (err) {
      summary.payrollFail++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.failures.push(`${workDate} payroll: ${msg}`);
      console.error(`PAY FAIL ${workDate}: ${msg}`);
    }
  }

  const afterAtt = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('from', sql.Date, FROM)
    .input('to', sql.Date, TO)
    .query(`
      SELECT CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
             b.BranchCode,
             CONVERT(VARCHAR(5), a.CheckInTime, 108) AS CheckInTime,
             CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
             a.Status
      FROM dbo.TblEmpAttendance a
      LEFT JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE a.EmpID = @empId AND a.BranchID = ${GLEEM_BRANCH_ID}
        AND a.WorkDate >= @from AND a.WorkDate <= @to
      ORDER BY a.WorkDate
    `);
  const afterPay = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('from', sql.Date, FROM)
    .input('to', sql.Date, TO)
    .query(`
      SELECT CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
             p.ActualHours, p.DailyWage, p.Status
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.EmpID = @empId AND p.BranchID = ${GLEEM_BRANCH_ID}
        AND p.WorkDate >= @from AND p.WorkDate <= @to
      ORDER BY p.WorkDate
    `);

  console.log('\n=== GLEEM ATTENDANCE AFTER ===');
  console.table(afterAtt.recordset);
  console.log('\n=== GLEEM PAYROLL AFTER ===');
  console.table(afterPay.recordset);

  const wageSum = (afterPay.recordset as Array<{ DailyWage: number }>).reduce(
    (s, r) => s + Number(r.DailyWage || 0),
    0,
  );
  console.log('\n=== SUMMARY ===');
  console.log(summary);
  console.log(
    `Gleem attendance days=${afterAtt.recordset.length} payroll days=${afterPay.recordset.length} wageSum=${wageSum.toFixed(2)}`,
  );

  process.exit(summary.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
