/**
 * Force-close Aug 31 2026: default checkout for incomplete attendance,
 * generate payroll + ledger for GLEEM and CAMP_CAESAR.
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

const WORK_DATE = '2026-08-31';
const BRANCHES = [
  { id: 1, code: 'GLEEM' },
  { id: 3, code: 'CAMP_CAESAR' },
] as const;

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
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '@/lib/services/employeeLedgerDualWrite'
  );
  const { validateDailyPayrollAttendance } = await import(
    '@/lib/payroll/dailyPayrollGenerateCore'
  );
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

  for (const branch of BRANCHES) {
    const close = await getEmpBranchWorkDayCloseState(branch.id, WORK_DATE);
    if (close.state === 'CLOSED') {
      await reopenEmpBranchWorkDay({
        branchId: branch.id,
        workDate: WORK_DATE,
        actorUserId,
        reopenReason: 'إغلاق يوم 31 أغسطس — تعبئة حضور وتوليد يوميات',
      });
      console.log(`REOPEN ${branch.code}`);
    }
  }

  const incomplete = await db.request().input('d', sql.Date, WORK_DATE).query(`
    SELECT a.ID, a.EmpID, e.EmpName, a.BranchID, b.BranchCode,
      CONVERT(VARCHAR(5), a.CheckInTime, 108) AS CheckInTime,
      CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
      CONVERT(VARCHAR(5), a.ScheduledStartTime, 108) AS ScheduledStartTime,
      CONVERT(VARCHAR(5), a.ScheduledEndTime, 108) AS ScheduledEndTime,
      a.Status,
      CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
      CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.WorkDate = @d
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
      AND (a.CheckInTime IS NULL OR a.CheckOutTime IS NULL)
  `);

  let filled = 0;
  for (const row of incomplete.recordset as Array<Record<string, unknown>>) {
    const checkIn = hhmm(row.CheckInTime);
    const checkOut = hhmm(row.CheckOutTime);
    const defaultIn = hhmm(row.DefaultCheckInTime);
    const defaultOut = hhmm(row.DefaultCheckOutTime);
    const schedStart = hhmm(row.ScheduledStartTime) || defaultIn;
    const schedEnd = hhmm(row.ScheduledEndTime) || defaultOut;

    const filledRow = applyDefaultTimesToRow({
      CheckInTime: checkIn,
      CheckOutTime: checkOut,
      DefaultCheckInTime: defaultIn,
      // Force default checkout even during overnight grace (user-requested day close)
      DefaultCheckOutTime: defaultOut ?? schedEnd,
      ScheduledStartTime: schedStart,
      ScheduledEndTime: schedEnd,
      Status: String(row.Status),
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
    });

    const out =
      filledRow.CheckOutTime ||
      schedEnd ||
      defaultOut ||
      (checkIn === '13:00' ? '01:00' : null);
    const inTime = filledRow.CheckInTime || checkIn || defaultIn || schedStart;
    if (!inTime || !out) {
      console.warn('SKIP fill', row.EmpName, row.BranchCode, 'no times');
      continue;
    }

    await persistNightlyDefaultFillAttendance({
      db,
      mode: 'update',
      attendanceId: Number(row.ID),
      branchId: Number(row.BranchID),
      checkInTime: inTime,
      checkOutTime: out,
      status: filledRow.Status || String(row.Status),
      lateMinutes: filledRow.LateMinutes,
      earlyLeaveMinutes: filledRow.EarlyLeaveMinutes,
      notes: '[OpsClose] تعبئة افتراضية إغلاق 31 أغسطس',
      scheduledStart: schedStart || inTime,
      scheduledEnd: schedEnd || out,
    });
    filled++;
    console.log(
      `FILL ${row.BranchCode} ${row.EmpName}: ${inTime}→${out} (${filledRow.Status || row.Status})`,
    );
  }

  for (const branch of BRANCHES) {
    const { missing } = await validateDailyPayrollAttendance(db, WORK_DATE, {
      branchId: branch.id,
    });
    if (missing.length) {
      console.log(`${branch.code} still missing payroll att:`, missing);
    }

    const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(WORK_DATE, {
      branchId: branch.id,
      notesPrefix: '[OpsClose] ',
    });
    console.log(
      `PAYROLL ${branch.code}: generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage} ledger=${JSON.stringify(ledgerSync)}`,
    );
  }

  const audit = await db.request().input('d', sql.Date, WORK_DATE).query(`
    SELECT b.BranchName,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance a
       WHERE a.BranchID=b.BranchID AND a.WorkDate=@d
         AND a.Status IN (N'Present',N'Late',N'EarlyLeave')
         AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL) AS AttComplete,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
       WHERE p.BranchID=b.BranchID AND p.WorkDate=@d AND p.Status=N'Generated') AS PayrollGen,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
       WHERE p.BranchID=b.BranchID AND p.WorkDate=@d AND p.Status=N'Generated' AND p.DailyWage>0
         AND EXISTS (
           SELECT 1 FROM dbo.TblEmpLedgerEntry l
           WHERE l.RefType=N'TblEmpDailyPayroll' AND l.RefID=p.ID
             AND l.EntryReason=N'hourly_wage' AND l.IsVoided=0)) AS PayrollLedger
    FROM dbo.TblBranch b WHERE b.IsActive=1 ORDER BY b.BranchID
  `);
  console.log('\nSUMMARY:');
  console.table(audit.recordset);
  console.log(`Attendance rows force-filled: ${filled}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
