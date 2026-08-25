/**
 * Automatic operational absence after scheduled start + threshold.
 * Default: 30 minutes (QueueBookingSettings.AutoAbsenceMinutes).
 * Never silently cancels bookings — marks ACTION_REQUIRED / AT_RISK.
 *
 * Hardened: uses resolveEmployeeDayPlan (Cairo business date, multi-window,
 * freelancer skip, transfer-aware branch, no invented 10:00 start).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate, SALON_TZ } from '@/lib/businessDate';
import { markBookingsActionRequired } from '@/lib/booking/affectedBookings';
import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';
import { invalidateEmployeeScheduleCaches } from '@/lib/hr/scheduleAvailabilityInvalidation';
import { resolveEmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import { markAutoAbsenceAttendance } from '@/modules/attendance';

export const DEFAULT_AUTO_ABSENCE_MINUTES = 30;

const SCAN_LOCK_RESOURCE = 'auto_absence_scan';

function msToHhmmCairo(ms: number): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const bits = fmt.formatToParts(new Date(ms));
  const h = bits.find((p) => p.type === 'hour')?.value ?? '00';
  const m = bits.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

export async function getBranchAutoAbsenceMinutes(branchId: number): Promise<number> {
  const db = await getPool();
  try {
    const r = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT TOP 1
          CASE
            WHEN COL_LENGTH('dbo.QueueBookingSettings', 'AutoAbsenceMinutes') IS NOT NULL
            THEN ISNULL(AutoAbsenceMinutes, ${DEFAULT_AUTO_ABSENCE_MINUTES})
            ELSE ${DEFAULT_AUTO_ABSENCE_MINUTES}
          END AS Mins
        FROM dbo.QueueBookingSettings
        WHERE BranchID = @branchId
      `);
    const mins = Number(r.recordset[0]?.Mins ?? DEFAULT_AUTO_ABSENCE_MINUTES);
    return Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_AUTO_ABSENCE_MINUTES;
  } catch {
    return DEFAULT_AUTO_ABSENCE_MINUTES;
  }
}

export async function ensureAutoAbsenceSettingsColumn(): Promise<void> {
  const db = await getPool();
  await db.request().query(`
    IF COL_LENGTH(N'dbo.QueueBookingSettings', N'AutoAbsenceMinutes') IS NULL
    BEGIN
      ALTER TABLE dbo.QueueBookingSettings
        ADD AutoAbsenceMinutes INT NOT NULL
          CONSTRAINT DF_QBS_AutoAbsenceMinutes DEFAULT (30);
    END
  `);
}

function cairoNowTimeHhmm(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const bits = fmt.formatToParts(now);
  const h = bits.find((p) => p.type === 'hour')?.value ?? '00';
  const m = bits.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/**
 * Acquire exclusive applock on a dedicated short transaction around the scan
 * body. Emp-scoped scans skip the lock (live verification / targeted runs).
 */
async function withScanLock<T>(fn: () => Promise<T>): Promise<T | { skipped: true; reason: string }> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  try {
    const lock = await new sql.Request(transaction)
      .input('res', sql.NVarChar(128), SCAN_LOCK_RESOURCE)
      .query(`
        DECLARE @r INT;
        EXEC @r = sp_getapplock
          @Resource = @res,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 0;
        SELECT @r AS LockResult;
      `);
    const lockResult = Number(lock.recordset[0]?.LockResult ?? -1);
    if (lockResult < 0) {
      await transaction.rollback();
      return { skipped: true, reason: 'scan_in_progress' };
    }
    const result = await fn();
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function executeAutoAbsenceScanBody(args: {
  businessDate: string;
  branchId?: number;
  empId?: number;
  now: Date;
  nowTimeCairo: string;
}): Promise<{
  processed: number;
  markedAbsent: number;
  bookingsMarked: number;
  configErrors: number;
}> {
  const { businessDate, now, nowTimeCairo } = args;
  const db = await getPool();
  const branches = await db
    .request()
    .input('branchId', sql.Int, args.branchId ?? null)
    .query(`
      SELECT b.BranchID,
        ISNULL(q.AutoAbsenceMinutes, 30) AS AutoAbsenceMinutes
      FROM dbo.TblBranch b
      LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
      WHERE ISNULL(b.IsActive, 0) = 1
        AND (@branchId IS NULL OR b.BranchID = @branchId)
    `);

  let processed = 0;
  let markedAbsent = 0;
  let bookingsMarked = 0;
  let configErrors = 0;

  for (const br of branches.recordset as Array<{
    BranchID: number;
    AutoAbsenceMinutes: number;
  }>) {
    const branchId = Number(br.BranchID);
    const threshold = Number(br.AutoAbsenceMinutes) || DEFAULT_AUTO_ABSENCE_MINUTES;

    const cands = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('date', sql.Date, businessDate)
      .input('empId', sql.Int, args.empId ?? null)
      .query(`
        SELECT DISTINCT e.EmpID, ISNULL(e.EmploymentType, N'full_time') AS EmploymentType
        FROM dbo.TblEmp e
        WHERE ISNULL(e.isActive, 1) = 1
          AND ISNULL(e.EmploymentType, N'full_time') <> N'freelance'
          AND (@empId IS NULL OR e.EmpID = @empId)
          AND (
            EXISTS (
              SELECT 1 FROM dbo.TblEmpBranchAssignment ea
              WHERE ea.EmpID = e.EmpID AND ea.BranchID = @branchId AND ea.IsActive = 1
            )
            OR EXISTS (
              SELECT 1 FROM dbo.TblEmpTemporaryBranchTransfer t
              WHERE t.EmpID = e.EmpID AND t.ToBranchID = @branchId
                AND t.WorkDate = @date AND ISNULL(t.IsActive, 1) = 1
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM dbo.TblEmpAttendance a
            WHERE a.EmpID = e.EmpID AND a.WorkDate = @date AND a.BranchID = @branchId
              AND a.Status IN (N'Present', N'Late', N'EarlyLeave', N'Absent')
          )
      `);

    for (const c of cands.recordset as Array<{ EmpID: number; EmploymentType: string }>) {
      processed += 1;
      const empId = Number(c.EmpID);

      let plan;
      try {
        plan = await resolveEmployeeDayPlan({
          empId,
          branchId,
          businessDate,
          source: 'admin',
        });
      } catch {
        configErrors += 1;
        continue;
      }

      if (!plan.isWorking) {
        if (
          plan.denyReasonCode === 'SCHEDULE_NOT_CONFIGURED' ||
          plan.denyReasonCode === 'FREELANCER_HOURS_NOT_CONFIGURED'
        ) {
          configErrors += 1;
        }
        continue;
      }

      const windows = plan.effectiveWindows?.length ? plan.effectiveWindows : [];
      if (!windows.length || windows[0].startMs == null) {
        configErrors += 1;
        continue;
      }

      const firstStartMs = Math.min(...windows.map((w) => Number(w.startMs)));
      const plannedStart = new Date(firstStartMs);
      const elapsedMin = (now.getTime() - plannedStart.getTime()) / 60_000;
      if (elapsedMin < threshold) continue;

      const plannedHhmm = msToHhmmCairo(firstStartMs);

      await markAutoAbsenceAttendance({
        empId,
        branchId,
        workDate: businessDate,
      });

      try {
        await db
          .request()
          .input('empId', sql.Int, empId)
          .input('date', sql.Date, businessDate)
          .query(`
            IF NOT EXISTS (
              SELECT 1 FROM dbo.TblEmpScheduleOverrides
              WHERE EmpID = @empId AND OverrideDate = @date AND Type = N'day_off' AND IsActive = 1
            )
              INSERT INTO dbo.TblEmpScheduleOverrides (
                EmpID, OverrideDate, Type, IsActive, Reason, CreatedBy, CreatedAt
              )
              VALUES (
                @empId, @date, N'day_off', 1,
                N'AUTO_ABSENCE', N'system-auto-absence', SYSUTCDATETIME()
              );
          `);
      } catch {
        /* override table shape may vary */
      }

      markedAbsent += 1;
      logBookingAvailabilityMetric({
        event: 'attendance_auto_absence',
        reasonCode: 'EMPLOYEE_ABSENT',
        branchId,
        empId,
        businessDate,
        extra: { thresholdMinutes: threshold, plannedStart: plannedHhmm },
      });

      const future = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .input('date', sql.Date, businessDate)
        .input('nowTime', sql.NVarChar(8), nowTimeCairo)
        .query(`
          SELECT BookingID
          FROM dbo.Bookings
          WHERE AssignedEmpID = @empId
            AND BranchID = @branchId
            AND BookingDate = @date
            AND Status IN (N'confirmed', N'booked', N'pending', N'scheduled')
            AND CONVERT(varchar(5), StartTime, 108) >= @nowTime
        `);
      const ids = future.recordset.map((x: { BookingID: number }) => Number(x.BookingID));
      bookingsMarked += await markBookingsActionRequired({
        bookingIds: ids,
        reasonCode: 'AT_RISK',
        sourceEvent: `auto_absence:${businessDate}`,
        branchId,
        empId,
        businessDate,
      });

      invalidateEmployeeScheduleCaches({
        empId,
        workDate: businessDate,
        branchIds: [branchId],
      });
    }
  }

  return { processed, markedAbsent, bookingsMarked, configErrors };
}

/**
 * Scan active branch employees with a planned start who have not checked in
 * within threshold → mark Absent + ACTION_REQUIRED on future bookings.
 */
export async function runAutoAbsenceScan(args?: {
  businessDate?: string;
  branchId?: number;
  /** When set, only evaluate this employee (safe for live verification). */
  empId?: number;
  now?: Date;
}): Promise<{
  processed: number;
  markedAbsent: number;
  bookingsMarked: number;
  skipped?: boolean;
  skipReason?: string;
  configErrors?: number;
}> {
  await ensureAutoAbsenceSettingsColumn();
  const businessDate = args?.businessDate ?? getCairoBusinessDate();
  const now = args?.now ?? new Date();
  const nowTimeCairo = cairoNowTimeHhmm(now);

  const run = () =>
    executeAutoAbsenceScanBody({
      businessDate,
      branchId: args?.branchId,
      empId: args?.empId,
      now,
      nowTimeCairo,
    });

  // Emp-scoped runs skip global lock (verification / targeted admin).
  if (args?.empId) {
    return run();
  }

  const locked = await withScanLock(run);
  if (locked && typeof locked === 'object' && 'skipped' in locked && locked.skipped) {
    return {
      processed: 0,
      markedAbsent: 0,
      bookingsMarked: 0,
      skipped: true,
      skipReason: locked.reason,
    };
  }

  return locked as {
    processed: number;
    markedAbsent: number;
    bookingsMarked: number;
    configErrors?: number;
  };
}
