import 'server-only';

import { getPool, sql } from '@/lib/db';
import { saveAdminAttendance, persistNightlyDefaultFillAttendance } from '@/modules/attendance';
import { deriveAttendanceStatusAfterFill } from '@/lib/hr/finalize-incomplete-attendance';
import { unlockScheduleForWorkOnDayOff } from '@/lib/hr/attendance/workOnDayOff.service';
import {
  runDailyPayrollGenerateWithOptionalLedger,
  syncHourlyWageLedgerForEmployees,
} from '@/lib/services/employeeLedgerDualWrite';
import { countPostedDailyPayroll } from '@/lib/payroll/dailyPayrollGenerateCore';
import {
  getEmpBranchWorkDayCloseState,
  reopenEmpBranchWorkDay,
  persistEmpBranchWorkDayClosed,
} from '@/lib/hr/empBranchWorkDayClose.service';
import { runEmployeeLedgerHistoricalSync } from '@/lib/services/employeeLedgerSyncService';
import {
  previewRelocateEmployeeDayBranch,
  relocateEmployeeDayBranch,
} from '@/lib/hr/relocateEmployeeDayBranch';

const EMP_ID = 1026;
const GLEEM_BRANCH_ID = 1;
const FROM = '2026-08-01';
const TO = '2026-08-27';
const NOTES = '[OpsFill][GLEEM] يوسف محمد أغسطس';
const REOPEN_REASON = 'تصحيح حضور وتوليد يوميات يوسف محمد — جليم';

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

async function removePayroll(
  db: Awaited<ReturnType<typeof getPool>>,
  payrollId: number,
): Promise<void> {
  await db
    .request()
    .input('payrollId', sql.Int, payrollId)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = N'إعادة توليد يوسف محمد',
          UpdatedAt = SYSDATETIME()
      WHERE RefType = N'TblEmpDailyPayroll'
        AND RefID = @payrollId
        AND EntryReason = N'hourly_wage'
        AND IsVoided = 0
    `);
  await db.request().input('payrollId', sql.Int, payrollId).query(`
    DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @payrollId
  `);
}

async function resolveEmployeeTimes(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<{ checkIn: string; checkOut: string }> {
  const emp = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT
      CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
      CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
    FROM dbo.TblEmp WHERE EmpID = @empId
  `);
  let checkIn = String(emp.recordset[0]?.DefaultCheckInTime ?? '').trim();
  let checkOut = String(emp.recordset[0]?.DefaultCheckOutTime ?? '').trim();

  if (!checkIn || !checkOut) {
    const mode = await db.request().input('empId', sql.Int, EMP_ID).query(`
      SELECT TOP 1
        CONVERT(VARCHAR(5), CheckInTime, 108) AS ci,
        CONVERT(VARCHAR(5), CheckOutTime, 108) AS co
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId
        AND CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL
        AND Status NOT IN (N'DayOff', N'Absent')
      GROUP BY CONVERT(VARCHAR(5), CheckInTime, 108), CONVERT(VARCHAR(5), CheckOutTime, 108)
      ORDER BY COUNT(*) DESC
    `);
    if (!checkIn) checkIn = String(mode.recordset[0]?.ci ?? '12:00');
    if (!checkOut) checkOut = String(mode.recordset[0]?.co ?? '22:00');
  }

  if (!checkIn) checkIn = '12:00';
  if (!checkOut) checkOut = '22:00';
  return { checkIn, checkOut };
}

async function relocateWrongBranches(
  db: Awaited<ReturnType<typeof getPool>>,
  actorUserId: number,
  dates: string[],
): Promise<number> {
  let moved = 0;

  const branches = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT DISTINCT BranchID FROM (
      SELECT BranchID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate >= '${FROM}' AND WorkDate <= '${TO}' AND BranchID <> ${GLEEM_BRANCH_ID}
      UNION
      SELECT BranchID FROM dbo.TblEmpDailyPayroll
      WHERE EmpID = @empId AND WorkDate >= '${FROM}' AND WorkDate <= '${TO}' AND BranchID <> ${GLEEM_BRANCH_ID}
    ) x
  `);

  for (const workDate of dates) {
    for (const row of branches.recordset as Array<{ BranchID: number }>) {
      const fromBranch = Number(row.BranchID);
      if (!fromBranch || fromBranch === GLEEM_BRANCH_ID) continue;
      const preview = await previewRelocateEmployeeDayBranch({
        empId: EMP_ID,
        workDate,
        fromBranchId: fromBranch,
        toBranchId: GLEEM_BRANCH_ID,
      });
      if (!preview.ok) continue;
      if (
        !preview.willMove.attendance &&
        preview.willMove.payrollIds.length === 0 &&
        preview.willMove.targetIds.length === 0
      ) {
        continue;
      }
      const result = await relocateEmployeeDayBranch({
        empId: EMP_ID,
        workDate,
        fromBranchId: fromBranch,
        toBranchId: GLEEM_BRANCH_ID,
        actorUserId,
        reason: 'نقل يوسف محمد إلى جليم — أغسطس 2026',
      });
      if (result.ok) moved++;
    }
  }
  return moved;
}

async function ensureGleemAssignmentAndPlan(db: Awaited<ReturnType<typeof getPool>>): Promise<void> {
  const asg = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, GLEEM_BRANCH_ID)
    .input('from', sql.Date, FROM)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @from AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
    `);
  if (!asg.recordset[0]) {
    await db
      .request()
      .input('empId', sql.Int, EMP_ID)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .input('from', sql.Date, FROM)
      .query(`
        INSERT INTO dbo.TblEmpBranchAssignment (
          EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom, EffectiveTo, Notes
        )
        VALUES (@empId, @branchId, 1, 0, 1, @from, NULL, N'تعيين جليم — يوسف محمد')
      `);
  }

  const plan = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, GLEEM_BRANCH_ID)
    .input('from', sql.Date, FROM)
    .query(`
      SELECT TOP 1 PlanID FROM dbo.TblEmpBranchPayrollPlan
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @from AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
    `);
  if (!plan.recordset[0]) {
    const emp = await db.request().input('empId', sql.Int, EMP_ID).query(`
      SELECT HourlyRate, ManualHourlyRate FROM dbo.TblEmp WHERE EmpID = @empId
    `);
    const row = emp.recordset[0] as { HourlyRate: number | null; ManualHourlyRate: number | null };
    const hourly =
      Number(row?.HourlyRate) > 0
        ? Number(row.HourlyRate)
        : Number(row?.ManualHourlyRate) > 0
          ? Number(row.ManualHourlyRate)
          : 20;
    await db
      .request()
      .input('empId', sql.Int, EMP_ID)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .input('hourly', sql.Decimal(18, 4), hourly)
      .input('from', sql.Date, FROM)
      .query(`
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
          EffectiveFrom, EffectiveTo, IsActive, SourceNotes
        )
        VALUES (@empId, @branchId, N'hourly', @hourly, NULL, NULL, @from, NULL, 1, N'خطة جليم — يوسف محمد')
      `);
  }
}

export async function fillYoussefMohamedGleemAugust() {
  process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

  const db = await getPool();
  await ensureGleemAssignmentAndPlan(db);
  const { checkIn: CHECK_IN, checkOut: CHECK_OUT } = await resolveEmployeeTimes(db);

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
  const relocated = await relocateWrongBranches(db, actorUserId, dates);

  const summary = {
    relocated,
    times: { checkIn: CHECK_IN, checkOut: CHECK_OUT },
    sundayDayOff: 0,
    attInserted: 0,
    attUpdated: 0,
    attUnchanged: 0,
    payrollGenerated: 0,
    payrollRegenerated: 0,
    payrollSkipPosted: 0,
    ledgerSynced: 0,
    failures: [] as string[],
    reopened: [] as string[],
    reclosed: [] as string[],
  };

  for (const workDate of dates) {
    let wasClosed = false;
    try {
      const closeView = await getEmpBranchWorkDayCloseState(GLEEM_BRANCH_ID, workDate);
      wasClosed = closeView.state === 'CLOSED';
      if (wasClosed) {
        await reopenEmpBranchWorkDay({
          branchId: GLEEM_BRANCH_ID,
          workDate,
          actorUserId,
          reopenReason: REOPEN_REASON,
        });
        summary.reopened.push(workDate);
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
          await removePayroll(db, payRow.ID);
        }
        continue;
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
        | {
            ID: number;
            Status: string | null;
            CheckInTime: string | null;
            CheckOutTime: string | null;
          }
        | undefined;

      if (existing?.Status === 'DayOff') {
        const { status, lateMinutes, earlyLeaveMinutes } = deriveAttendanceStatusAfterFill({
          checkIn: CHECK_IN,
          checkOut: CHECK_OUT,
          schedStart: CHECK_IN,
          schedEnd: CHECK_OUT,
        });
        await persistNightlyDefaultFillAttendance({
          db,
          mode: 'update',
          attendanceId: existing.ID,
          branchId: GLEEM_BRANCH_ID,
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
      } else {
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
          !existing.CheckOutTime;

        if (needsAttUpdate) {
          if (new Date(`${workDate}T12:00:00`).getDay() === 5) {
            await unlockScheduleForWorkOnDayOff({
              empId: EMP_ID,
              date: workDate,
              branchId: GLEEM_BRANCH_ID,
              reason: 'حضور يوسف محمد يوم جمعة',
              sourceTag: 'ops-youssef-mohamed-fill',
            });
          }
          if (existing) {
            await persistNightlyDefaultFillAttendance({
              db,
              mode: 'update',
              attendanceId: existing.ID,
              branchId: GLEEM_BRANCH_ID,
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
          } else {
            await persistNightlyDefaultFillAttendance({
              db,
              mode: 'insert',
              branchId: GLEEM_BRANCH_ID,
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
          }
        } else {
          summary.attUnchanged++;
        }
      }

      const posted = await countPostedDailyPayroll(db, workDate, GLEEM_BRANCH_ID, [EMP_ID]);
      if (posted > 0) {
        summary.payrollSkipPosted++;
        continue;
      }

      const payRes = await db
        .request()
        .input('empId', sql.Int, EMP_ID)
        .input('branchId', sql.Int, GLEEM_BRANCH_ID)
        .input('workDate', sql.Date, workDate)
        .query(`
          SELECT TOP 1 ID, Status FROM dbo.TblEmpDailyPayroll
          WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
        `);
      const payRow = payRes.recordset[0] as { ID: number; Status: string } | undefined;

      const hadPayroll = Boolean(payRow);
      if (payRow && payRow.Status !== 'PostedToCashMove') {
        await removePayroll(db, payRow.ID);
      }

      const { result } = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
        notesPrefix: '[OpsFill][GLEEM] ',
        branchId: GLEEM_BRANCH_ID,
        empIds: [EMP_ID],
      });

      if (result.generatedCount > 0) {
        if (hadPayroll) summary.payrollRegenerated++;
        else summary.payrollGenerated++;
      } else {
        summary.failures.push(`${workDate}: payroll not generated`);
      }

      const ledger = await syncHourlyWageLedgerForEmployees(db, workDate, GLEEM_BRANCH_ID, [
        EMP_ID,
      ]);
      summary.ledgerSynced += ledger.inserted + ledger.updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failures.push(`${workDate}: ${msg}`);
    } finally {
      if (wasClosed) {
        try {
          await persistEmpBranchWorkDayClosed({
            branchId: GLEEM_BRANCH_ID,
            workDate,
            actorUserId,
          });
          summary.reclosed.push(workDate);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.failures.push(`${workDate} reclose: ${msg}`);
        }
      }
    }
  }

  const histSync = await runEmployeeLedgerHistoricalSync({
    month: '2026-08',
    empId: EMP_ID,
    dryRun: false,
    syncPayrollCredits: true,
    syncAdvanceDebits: false,
    createdByUserId: actorUserId,
  });

  const verify = await db.request().query(`
    WITH MonthDays AS (
      SELECT CAST('${FROM}' AS date) AS WorkDate
      UNION ALL SELECT DATEADD(DAY, 1, WorkDate) FROM MonthDays WHERE WorkDate < '${TO}'
    )
    SELECT
      CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate,
      DATENAME(WEEKDAY, d.WorkDate) AS DayName,
      a.Status AS AttStatus,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      p.BranchID AS PayBranch,
      p.DailyWage,
      CASE WHEN l.ID IS NULL AND p.DailyWage > 0 THEN 0 ELSE 1 END AS HasLedger
    FROM MonthDays d
    LEFT JOIN dbo.TblEmpAttendance a
      ON a.EmpID = ${EMP_ID} AND a.BranchID = ${GLEEM_BRANCH_ID} AND a.WorkDate = d.WorkDate
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = ${EMP_ID} AND p.WorkDate = d.WorkDate
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
    ORDER BY d.WorkDate
    OPTION (MAXRECURSION 366)
  `);

  const payrollByBranch = await db.request().query(`
    SELECT BranchID, COUNT(*) cnt FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = ${EMP_ID} AND WorkDate >= '${FROM}' AND WorkDate <= '${TO}'
    GROUP BY BranchID
  `);

  return {
    summary,
    histSync: histSync.counts,
    verify: verify.recordset,
    payrollByBranch: payrollByBranch.recordset,
  };
}
