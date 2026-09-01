/**
 * Ahmed (احمد EmpID=18) Gleem — 970 EGP wages via attendance + payroll + ledger.
 * 3 full days (300) + partial day (70) = 970 at hourly rate 25/hr.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const m = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const EMP_ID = 18;
const GLEEM_BRANCH_ID = 1;
const EFFECTIVE_FROM = '2026-08-01';
const NOTES = '[Ops] رواتب 970 لسلفة احمد جليم أغسطس';

const FULL_DAYS = ['2026-08-20', '2026-08-24', '2026-08-30'] as const;
const PARTIAL_DAY = '2026-08-29';
const DEFAULT_IN = '12:00';
const DEFAULT_OUT = '00:00';
const PARTIAL_OUT = '14:48'; // ~2.8h → 70 EGP at 25/hr

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');
  const { unlockScheduleForWorkOnDayOff } = await import('@/lib/hr/attendance/workOnDayOff.service');
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '@/lib/services/employeeLedgerDualWrite'
  );
  const { countPostedDailyPayroll } = await import('@/lib/payroll/dailyPayrollGenerateCore');
  const {
    getEmpBranchWorkDayCloseState,
    reopenEmpBranchWorkDay,
  } = await import('@/lib/hr/empBranchWorkDayClose.service');

  const db = await getPool();
  const actorRes = await db.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0
    ORDER BY CASE WHEN UserLevel IN (N'Admin',N'admin',N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID) || 10;

  // Activate Gleem assignment (only one active home branch per employee)
  await db.request().input('empId', sql.Int, EMP_ID).input('from', sql.Date, EFFECTIVE_FROM).query(`
    UPDATE dbo.TblEmpBranchAssignment
    SET IsHomeBranch = 0, IsActive = 0, UpdatedAt = SYSUTCDATETIME()
    WHERE EmpID = @empId AND BranchID <> ${GLEEM_BRANCH_ID};

    UPDATE dbo.TblEmpBranchAssignment
    SET IsActive = 1, IsHomeBranch = 1, EffectiveTo = NULL,
        Notes = N'تفعيل جليم — رواتب 970 أغسطس',
        UpdatedAt = SYSUTCDATETIME()
    WHERE EmpID = @empId AND BranchID = ${GLEEM_BRANCH_ID}
      AND EffectiveFrom = @from;
  `);
  const asgCheck = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT BranchID, IsActive, IsHomeBranch, EffectiveFrom
    FROM dbo.TblEmpBranchAssignment WHERE EmpID=@empId ORDER BY BranchID, EffectiveFrom
  `);
  console.log('Assignments after activate:');
  console.table(asgCheck.recordset);

  // Hourly plan for partial-day wage math (25/hr × hours)
  await db.request().input('empId', sql.Int, EMP_ID).query(`
    UPDATE dbo.TblEmpBranchPayrollPlan
    SET PayType = N'hourly', HourlyRate = 25, IsActive = 1,
        SourceNotes = N'خطة جليم احمد — توليد 970 أغسطس',
        UpdatedAt = SYSUTCDATETIME()
    WHERE EmpID = @empId AND BranchID = ${GLEEM_BRANCH_ID} AND IsActive = 1
      AND EffectiveFrom <= '2026-08-31'
      AND (EffectiveTo IS NULL OR EffectiveTo >= '2026-08-01');
  `);
  console.log('Payroll plan set to hourly 25/hr');

  const allDates = [...FULL_DAYS, PARTIAL_DAY];
  for (const workDate of allDates) {
    const close = await getEmpBranchWorkDayCloseState(GLEEM_BRANCH_ID, workDate);
    if (close.state === 'CLOSED') {
      await reopenEmpBranchWorkDay({
        branchId: GLEEM_BRANCH_ID,
        workDate,
        actorUserId,
        reopenReason: 'رواتب احمد 970 أغسطس',
      });
      console.log(`REOPEN ${workDate}`);
    }
  }

  async function ensureAttendance(
    workDate: string,
    checkIn: string,
    checkOut: string,
    status: string,
  ) {
    const existing = await db
      .request()
      .input('empId', sql.Int, EMP_ID)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .input('workDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1 ID FROM dbo.TblEmpAttendance
        WHERE EmpID=@empId AND BranchID=@branchId AND WorkDate=@workDate
      `);
    if (existing.recordset[0]) {
      console.log(`ATT exists ${workDate} id=${existing.recordset[0].ID} — skip insert`);
      return;
    }

    await unlockScheduleForWorkOnDayOff({
      empId: EMP_ID,
      date: workDate,
      branchId: GLEEM_BRANCH_ID,
      reason: 'رواتب احمد أغسطس',
      sourceTag: 'ops-ahmed-gleem-970',
    });

    await persistNightlyDefaultFillAttendance({
      db,
      mode: 'insert',
      branchId: GLEEM_BRANCH_ID,
      empId: EMP_ID,
      workDate,
      checkInTime: checkIn,
      checkOutTime: checkOut,
      status,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      notes: NOTES,
      scheduledStart: checkIn,
      scheduledEnd: checkOut === PARTIAL_OUT ? DEFAULT_OUT : checkOut,
    });
    console.log(`ATT insert ${workDate} ${checkIn}→${checkOut} ${status}`);
  }

  for (const d of FULL_DAYS) {
    await ensureAttendance(d, DEFAULT_IN, DEFAULT_OUT, 'Present');
  }
  await ensureAttendance(PARTIAL_DAY, DEFAULT_IN, PARTIAL_OUT, 'EarlyLeave');

  let totalWage = 0;
  for (const workDate of allDates) {
    const posted = await countPostedDailyPayroll(db, workDate, GLEEM_BRANCH_ID, [EMP_ID]);
    if (posted > 0) {
      console.log(`PAY skip posted ${workDate}`);
      continue;
    }
    const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
      branchId: GLEEM_BRANCH_ID,
      empIds: [EMP_ID],
      notesPrefix: '[Ops] ',
    });
    totalWage += Number(result.totalWage || 0);
    console.log(
      `PAY ${workDate} wage=${result.totalWage} hours=${result.totalHours} ledger=${JSON.stringify(ledgerSync)}`,
    );
  }

  const pay = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS d, DailyWage, ActualHours, Status
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID=${EMP_ID} AND BranchID=${GLEEM_BRANCH_ID}
      AND WorkDate IN ('2026-08-20','2026-08-24','2026-08-29','2026-08-30')
    ORDER BY WorkDate
  `);
  console.log('\nPAYROLL ROWS:');
  console.table(pay.recordset);

  const ledger = await db.request().query(`
    SELECT CONVERT(varchar(10), EntryDate, 23) AS d, Amount, EntryReason
    FROM dbo.TblEmpLedgerEntry
    WHERE EmpID=${EMP_ID} AND BranchID=${GLEEM_BRANCH_ID} AND IsVoided=0
      AND EntryReason=N'hourly_wage'
      AND EntryDate IN ('2026-08-20','2026-08-24','2026-08-29','2026-08-30')
    ORDER BY EntryDate
  `);
  console.log('\nLEDGER hourly_wage:');
  console.table(ledger.recordset);

  const sum = (ledger.recordset as Array<{ Amount: number }>).reduce(
    (s, r) => s + Number(r.Amount),
    0,
  );
  const balance = await db.request().query(`
    SELECT SUM(CASE WHEN EntryDirection=N'credit' THEN Amount ELSE -Amount END) AS Balance
    FROM dbo.TblEmpLedgerEntry WHERE EmpID=${EMP_ID} AND BranchID=1 AND IsVoided=0
  `);
  console.log(`\nNew wages sum=${sum.toFixed(2)} (target 970) totalWage=${totalWage}`);
  console.log('Balance after:', balance.recordset[0]);

  process.exit(Math.abs(sum - 970) < 1 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
