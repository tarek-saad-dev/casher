/**
 * Adjust Ziad (زياد EmpID=12) Gleem Aug 2026 basic salary from 9000 → 7000:
 * - Remove 6 Gleem attendance days where he also worked Camp Caesar (300×6 = 1800)
 * - Shorten Aug 4 Gleem day to ~3.64h (100 EGP) instead of full 300
 * - Void/delete payroll + ledger for removed days; regenerate affected days
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
const REMOVE_DATES = [
  '2026-08-01',
  '2026-08-02',
  '2026-08-05',
  '2026-08-08',
  '2026-08-10',
  '2026-08-16',
] as const;
const PARTIAL_DATE = '2026-08-04';
const PARTIAL_CHECK_OUT = '16:40'; // ~3.67h → 100 EGP at 27.2727/hr
const NOTES = '[Ops] تصحيح راتب أساسي زياد جليم أغسطس 9000→7000';
const REOPEN_REASON = 'تصحيح حضور/يوميات زياد جليم أغسطس';

async function getActorUserId(
  db: Awaited<ReturnType<(typeof import('@/lib/db'))['getPool']>>,
): Promise<number> {
  const actorRes = await db.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY CASE WHEN UserLevel IN (N'Admin', N'admin', N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID);
  if (!Number.isFinite(actorUserId) || actorUserId <= 0) {
    throw new Error('لا يوجد مستخدم لإعادة فتح اليوم المقفل');
  }
  return actorUserId;
}

async function ensureDayMutable(
  branchId: number,
  workDate: string,
  actorUserId: number,
  reopened: string[],
): Promise<void> {
  const { getEmpBranchWorkDayCloseState, reopenEmpBranchWorkDay } = await import(
    '@/lib/hr/empBranchWorkDayClose.service'
  );
  const closeView = await getEmpBranchWorkDayCloseState(branchId, workDate);
  if (closeView.state === 'CLOSED') {
    await reopenEmpBranchWorkDay({
      branchId,
      workDate,
      actorUserId,
      reopenReason: REOPEN_REASON,
    });
    reopened.push(workDate);
    console.log(`REOPEN ${workDate}`);
  }
}

async function voidWageLedgerForDate(
  db: Awaited<ReturnType<(typeof import('@/lib/db'))['getPool']>>,
  sql: typeof import('@/lib/db').sql,
  workDate: string,
  voidReason: string,
): Promise<number> {
  const r = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, GLEEM_BRANCH_ID)
    .input('workDate', sql.Date, workDate)
    .input('voidReason', sql.NVarChar(300), voidReason)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1, VoidReason = @voidReason, UpdatedAt = SYSDATETIME()
      WHERE EmpID = @empId AND BranchID = @branchId
        AND EntryDate = @workDate
        AND EntryReason = N'hourly_wage' AND IsVoided = 0
    `);
  return r.rowsAffected[0] ?? 0;
}

async function removeGleemDay(
  db: Awaited<ReturnType<(typeof import('@/lib/db'))['getPool']>>,
  sql: typeof import('@/lib/db').sql,
  workDate: string,
): Promise<void> {
  const pay = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, GLEEM_BRANCH_ID)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT ID FROM dbo.TblEmpDailyPayroll
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
        AND Status = N'Generated'
    `);
  for (const row of pay.recordset as Array<{ ID: number }>) {
    const payrollId = Number(row.ID);
    await db
      .request()
      .input('refId', sql.Int, payrollId)
      .input('voidReason', sql.NVarChar(300), NOTES)
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET IsVoided = 1, VoidReason = @voidReason, UpdatedAt = SYSDATETIME()
        WHERE RefType = N'TblEmpDailyPayroll' AND RefID = @refId
          AND EntryReason = N'hourly_wage' AND IsVoided = 0
      `);
    await db.request().input('id', sql.Int, payrollId).query(`
      DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @id AND Status = N'Generated'
    `);
    console.log(`DEL payroll ${workDate} id=${payrollId}`);
  }

  const voided = await voidWageLedgerForDate(db, sql, workDate, NOTES);
  if (voided > 0) console.log(`VOID ledger orphan ${workDate} rows=${voided}`);

  const att = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, GLEEM_BRANCH_ID)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);
  const attId = Number(att.recordset[0]?.ID);
  if (attId > 0) {
    await db.request().input('id', sql.Int, attId).query(`
      IF OBJECT_ID('dbo.TblEmpAttendanceBreakTime', 'U') IS NOT NULL
        DELETE FROM dbo.TblEmpAttendanceBreakTime WHERE AttendanceID = @id;
      IF OBJECT_ID('dbo.TblEmpAttendanceBreak', 'U') IS NOT NULL
        DELETE FROM dbo.TblEmpAttendanceBreak WHERE AttendanceID = @id;
      DELETE FROM dbo.TblEmpAttendance WHERE ID = @id;
    `);
    console.log(`DEL attendance ${workDate} id=${attId}`);
  } else {
    console.log(`NO attendance ${workDate}`);
  }
}

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');
  const { runDailyPayrollGenerateWithOptionalLedger, syncHourlyWageLedgerForEmployees } =
    await import('@/lib/services/employeeLedgerDualWrite');
  const { persistEmpBranchWorkDayClosed } = await import(
    '@/lib/hr/empBranchWorkDayClose.service'
  );

  const db = await getPool();
  const actorUserId = await getActorUserId(db);
  const reopened: string[] = [];

  const touchDates = [...new Set([...REMOVE_DATES, PARTIAL_DATE])];
  for (const d of touchDates) {
    await ensureDayMutable(GLEEM_BRANCH_ID, d, actorUserId, reopened);
  }

  for (const workDate of REMOVE_DATES) {
    await removeGleemDay(db, sql, workDate);
  }

  const partialAtt = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, GLEEM_BRANCH_ID)
    .input('workDate', sql.Date, PARTIAL_DATE)
    .query(`
      SELECT TOP 1 ID,
        CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(5), ScheduledStartTime, 108) AS ScheduledStartTime,
        CONVERT(VARCHAR(5), ScheduledEndTime, 108) AS ScheduledEndTime,
        Status
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);
  const row = partialAtt.recordset[0] as
    | {
        ID: number;
        CheckInTime: string;
        ScheduledStartTime: string | null;
        ScheduledEndTime: string | null;
        Status: string;
      }
    | undefined;
  if (!row) throw new Error(`لا يوجد حضور جليم ${PARTIAL_DATE}`);
  const checkIn = row.CheckInTime?.slice(0, 5) || '13:00';
  await persistNightlyDefaultFillAttendance({
    db,
    mode: 'update',
    attendanceId: row.ID,
    branchId: GLEEM_BRANCH_ID,
    checkInTime: checkIn,
    checkOutTime: PARTIAL_CHECK_OUT,
    status: 'EarlyLeave',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    notes: NOTES,
    scheduledStart: row.ScheduledStartTime?.slice(0, 5) || checkIn,
    scheduledEnd: row.ScheduledEndTime?.slice(0, 5) || '00:00',
  });
  console.log(
    `PARTIAL ${PARTIAL_DATE} id=${row.ID} ${checkIn}→${PARTIAL_CHECK_OUT} EarlyLeave`,
  );

  const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(PARTIAL_DATE, {
    notesPrefix: '[Ops] ',
    branchId: GLEEM_BRANCH_ID,
    empIds: [EMP_ID],
  });
  console.log(
    `REGEN ${PARTIAL_DATE} wage=${result.totalWage} ledger=${JSON.stringify(ledgerSync)}`,
  );

  for (const workDate of reopened) {
    try {
      await persistEmpBranchWorkDayClosed({
        branchId: GLEEM_BRANCH_ID,
        workDate,
        actorUserId,
      });
      console.log(`RECLOSE ${workDate}`);
    } catch (err) {
      console.error(`RECLOSE FAIL ${workDate}`, err instanceof Error ? err.message : err);
    }
  }

  const gleem = await db.request().query(`
    SELECT CONVERT(varchar(10), EntryDate, 23) AS d, Amount
    FROM dbo.TblEmpLedgerEntry
    WHERE EmpID = ${EMP_ID} AND BranchID = ${GLEEM_BRANCH_ID} AND IsVoided = 0
      AND EntryDate >= '2026-08-01' AND EntryDate <= '2026-08-31'
      AND EntryReason = N'hourly_wage'
    ORDER BY EntryDate
  `);
  const rows = gleem.recordset as Array<{ d: string; Amount: number }>;
  const sum = rows.reduce((s, r) => s + Number(r.Amount), 0);
  console.log(`\nGLEEM hourly_wage: ${rows.length} days, sum=${sum}`);
  console.table(rows);

  const pay = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS d, DailyWage, ActualHours
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = ${EMP_ID} AND BranchID = ${GLEEM_BRANCH_ID}
      AND WorkDate >= '2026-08-01' AND WorkDate <= '2026-08-31'
      AND Status = N'Generated'
    ORDER BY WorkDate
  `);
  const payRows = pay.recordset as Array<{ DailyWage: number }>;
  const paySum = payRows.reduce((s, r) => s + Number(r.DailyWage), 0);
  console.log(`GLEEM payroll sum=${paySum} days=${payRows.length}`);

  process.exit(sum === 7000 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
