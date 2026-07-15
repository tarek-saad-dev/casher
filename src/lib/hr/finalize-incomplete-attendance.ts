/**
 * Nightly incomplete attendance close.
 * Ops shorthand "D" = same Default fill as HR attendance board button D
 * (`applyDefaultTimesToRow`).
 */

import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  validateDailyPayrollAttendance,
  type ValidationMissing,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import type { PayrollValidationReason } from '@/lib/payroll/dailyPayrollHrRules';
import {
  applyDefaultTimesToRow,
  type AttendanceTimeFillRow,
} from '@/lib/hr/attendance-default-fill';
import { sqlTimeToHHmm } from '@/lib/timeUtils';

/** Ops shorthand: D = Default fill (same as /admin/hr?tab=attendance). */
export const NIGHTLY_INCOMPLETE_STATUS_CODE = 'D' as const;
export const NIGHTLY_INCOMPLETE_ACTION = 'DefaultFill' as const;

export const INCOMPLETE_ATTENDANCE_REASONS = new Set<PayrollValidationReason>([
  'no_attendance',
  'missing_checkin',
  'missing_checkout',
]);

export function isIncompleteAttendanceReason(
  reason: PayrollValidationReason,
): boolean {
  return INCOMPLETE_ATTENDANCE_REASONS.has(reason);
}

export function selectIncompleteAttendanceMissing(
  missing: ValidationMissing[],
): ValidationMissing[] {
  return missing.filter((m) => isIncompleteAttendanceReason(m.reason));
}

/** @deprecated use applyDefaultTimesToRow — kept for older nightly tests */
export function planDefaultTimeFill(input: {
  checkIn: string | null | undefined;
  checkOut: string | null | undefined;
  defaultCheckIn: string | null | undefined;
  defaultCheckOut: string | null | undefined;
}): {
  checkIn: string | null;
  checkOut: string | null;
  filledIn: boolean;
  filledOut: boolean;
  canComplete: boolean;
} {
  const beforeIn = sqlTimeToHHmm(input.checkIn) ?? null;
  const beforeOut = sqlTimeToHHmm(input.checkOut) ?? null;
  const row = applyDefaultTimesToRow({
    CheckInTime: beforeIn,
    CheckOutTime: beforeOut,
    DefaultCheckInTime: sqlTimeToHHmm(input.defaultCheckIn),
    DefaultCheckOutTime: sqlTimeToHHmm(input.defaultCheckOut),
    ScheduledStartTime: sqlTimeToHHmm(input.defaultCheckIn),
    ScheduledEndTime: sqlTimeToHHmm(input.defaultCheckOut),
    Status: 'Pending',
    LateMinutes: 0,
    EarlyLeaveMinutes: 0,
  });
  return {
    checkIn: row.CheckInTime,
    checkOut: row.CheckOutTime,
    filledIn: !beforeIn && !!row.CheckInTime,
    filledOut: !beforeOut && !!row.CheckOutTime,
    canComplete: !!row.CheckInTime && !!row.CheckOutTime,
  };
}

export function deriveAttendanceStatusAfterFill(input: {
  checkIn: string;
  checkOut: string;
  schedStart: string | null;
  schedEnd: string | null;
}): {
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
} {
  const row = applyDefaultTimesToRow({
    CheckInTime: null,
    CheckOutTime: null,
    DefaultCheckInTime: input.checkIn,
    DefaultCheckOutTime: input.checkOut,
    ScheduledStartTime: input.schedStart,
    ScheduledEndTime: input.schedEnd,
    Status: 'Pending',
    LateMinutes: 0,
    EarlyLeaveMinutes: 0,
  });
  return {
    status: row.Status,
    lateMinutes: row.LateMinutes,
    earlyLeaveMinutes: row.EarlyLeaveMinutes,
  };
}

function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0);
  d.setUTCHours(h, m, s, 0);
  return d;
}

export interface FinalizeIncompleteAttendanceFilledRow {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
  checkIn: string;
  checkOut: string;
  filledIn: boolean;
  filledOut: boolean;
  status: string;
}

export interface FinalizeIncompleteAttendanceResult {
  workDate: string;
  statusCode: typeof NIGHTLY_INCOMPLETE_STATUS_CODE;
  action: typeof NIGHTLY_INCOMPLETE_ACTION;
  status: typeof NIGHTLY_INCOMPLETE_ACTION;
  filled: FinalizeIncompleteAttendanceFilledRow[];
  closed: FinalizeIncompleteAttendanceFilledRow[];
  skippedNoDefault: Array<{
    empId: number;
    empName: string;
    reason: PayrollValidationReason;
  }>;
  remainingMissing: ValidationMissing[];
}

/**
 * Same D behavior as HR attendance: fill missing check-in/out from defaults,
 * then persist so nightly payroll can generate.
 */
export async function finalizeIncompleteAttendanceWithDefaults(
  workDate: string,
): Promise<FinalizeIncompleteAttendanceResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error('workDate يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const db = await getPool();
  const { missing } = await validateDailyPayrollAttendance(db, workDate);
  const toFix = selectIncompleteAttendanceMissing(missing);

  const emptyResult = (
    remainingMissing: ValidationMissing[],
    filled: FinalizeIncompleteAttendanceFilledRow[] = [],
    skippedNoDefault: FinalizeIncompleteAttendanceResult['skippedNoDefault'] = [],
  ): FinalizeIncompleteAttendanceResult => ({
    workDate,
    statusCode: NIGHTLY_INCOMPLETE_STATUS_CODE,
    action: NIGHTLY_INCOMPLETE_ACTION,
    status: NIGHTLY_INCOMPLETE_ACTION,
    filled,
    closed: filled,
    skippedNoDefault,
    remainingMissing,
  });

  if (toFix.length === 0) {
    return emptyResult(missing);
  }

  const empIds = toFix.map((m) => m.empId);
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getDay();

  const defaultsReq = db.request().input('dayOfWeek', sql.TinyInt, dayOfWeek);
  const placeholders = empIds.map((id, i) => {
    const name = `e${i}`;
    defaultsReq.input(name, sql.Int, id);
    return `@${name}`;
  });
  const defaultsResult = await defaultsReq.query(`
    SELECT
      e.EmpID,
      e.EmpName,
      CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
      CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
      CONVERT(VARCHAR(5), ws.StartTime, 108) AS ScheduleStartTime,
      CONVERT(VARCHAR(5), ws.EndTime, 108) AS ScheduleEndTime
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpWorkSchedule ws
      ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
    WHERE e.EmpID IN (${placeholders.join(',')})
  `);

  const defaultsByEmp = new Map<
    number,
    {
      empName: string;
      defaultIn: string | null;
      defaultOut: string | null;
      scheduleStart: string | null;
      scheduleEnd: string | null;
    }
  >();
  for (const row of defaultsResult.recordset as Array<{
    EmpID: number;
    EmpName: string;
    DefaultCheckInTime: string | null;
    DefaultCheckOutTime: string | null;
    ScheduleStartTime: string | null;
    ScheduleEndTime: string | null;
  }>) {
    defaultsByEmp.set(Number(row.EmpID), {
      empName: String(row.EmpName ?? ''),
      defaultIn: row.DefaultCheckInTime || null,
      defaultOut: row.DefaultCheckOutTime || null,
      scheduleStart: row.ScheduleStartTime || null,
      scheduleEnd: row.ScheduleEndTime || null,
    });
  }

  const attMap = new Map<
    number,
    {
      id: number;
      checkIn: string | null;
      checkOut: string | null;
      schedStart: string | null;
      schedEnd: string | null;
      status: string;
      lateMinutes: number;
      earlyLeaveMinutes: number;
    }
  >();

  const attReq = db.request().input('workDate', sql.Date, workDate);
  const attPlaceholders = empIds.map((id, i) => {
    const name = `a${i}`;
    attReq.input(name, sql.Int, id);
    return `@${name}`;
  });
  const attRows = await attReq.query(`
    SELECT
      EmpID,
      ID,
      CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
      CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime,
      CONVERT(VARCHAR(5), ScheduledStartTime, 108) AS ScheduledStartTime,
      CONVERT(VARCHAR(5), ScheduledEndTime, 108) AS ScheduledEndTime,
      Status,
      ISNULL(LateMinutes, 0) AS LateMinutes,
      ISNULL(EarlyLeaveMinutes, 0) AS EarlyLeaveMinutes
    FROM dbo.TblEmpAttendance
    WHERE WorkDate = @workDate
      AND EmpID IN (${attPlaceholders.join(',')})
  `);

  for (const row of attRows.recordset as Array<{
    EmpID: number;
    ID: number;
    CheckInTime: string | null;
    CheckOutTime: string | null;
    ScheduledStartTime: string | null;
    ScheduledEndTime: string | null;
    Status: string | null;
    LateMinutes: number;
    EarlyLeaveMinutes: number;
  }>) {
    attMap.set(Number(row.EmpID), {
      id: Number(row.ID),
      checkIn: row.CheckInTime || null,
      checkOut: row.CheckOutTime || null,
      schedStart: row.ScheduledStartTime || null,
      schedEnd: row.ScheduledEndTime || null,
      status: row.Status || 'Pending',
      lateMinutes: Number(row.LateMinutes) || 0,
      earlyLeaveMinutes: Number(row.EarlyLeaveMinutes) || 0,
    });
  }

  const filled: FinalizeIncompleteAttendanceFilledRow[] = [];
  const skippedNoDefault: FinalizeIncompleteAttendanceResult['skippedNoDefault'] = [];
  const note = `[NightlyClose] D — same as HR attendance Default fill`;

  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    for (const item of toFix) {
      const defs = defaultsByEmp.get(item.empId);
      const att = attMap.get(item.empId);

      const beforeIn = att?.checkIn ?? null;
      const beforeOut = att?.checkOut ?? null;

      const schedStart =
        att?.schedStart ?? defs?.scheduleStart ?? defs?.defaultIn ?? null;
      const schedEnd =
        att?.schedEnd ?? defs?.scheduleEnd ?? defs?.defaultOut ?? null;

      const baseRow: AttendanceTimeFillRow = {
        CheckInTime: beforeIn,
        CheckOutTime: beforeOut,
        DefaultCheckInTime: defs?.defaultIn ?? null,
        DefaultCheckOutTime: defs?.defaultOut ?? null,
        ScheduledStartTime: schedStart,
        ScheduledEndTime: schedEnd,
        Status: att?.status ?? 'Pending',
        LateMinutes: att?.lateMinutes ?? 0,
        EarlyLeaveMinutes: att?.earlyLeaveMinutes ?? 0,
      };

      const updated = applyDefaultTimesToRow(baseRow);

      if (!updated.CheckInTime || !updated.CheckOutTime) {
        skippedNoDefault.push({
          empId: item.empId,
          empName: item.empName,
          reason: item.reason,
        });
        continue;
      }

      if (att) {
        await new sql.Request(transaction)
          .input('id', sql.Int, att.id)
          .input('checkInTime', sql.Time, timeToDate(updated.CheckInTime))
          .input('checkOutTime', sql.Time, timeToDate(updated.CheckOutTime))
          .input('status', sql.NVarChar(50), updated.Status)
          .input('lateMinutes', sql.Int, updated.LateMinutes)
          .input('earlyLeaveMinutes', sql.Int, updated.EarlyLeaveMinutes)
          .input('notes', sql.NVarChar(500), note)
          .input('scheduledStart', sql.Time, timeToDate(schedStart))
          .input('scheduledEnd', sql.Time, timeToDate(schedEnd))
          .query(`
            UPDATE dbo.TblEmpAttendance
            SET
              CheckInTime = @checkInTime,
              CheckOutTime = @checkOutTime,
              Status = @status,
              LateMinutes = @lateMinutes,
              EarlyLeaveMinutes = @earlyLeaveMinutes,
              ScheduledStartTime = ISNULL(ScheduledStartTime, @scheduledStart),
              ScheduledEndTime = ISNULL(ScheduledEndTime, @scheduledEnd),
              Notes = CASE
                WHEN Notes IS NULL OR LTRIM(RTRIM(Notes)) = N'' THEN @notes
                ELSE Notes + N' | ' + @notes
              END,
              UpdatedAt = GETDATE()
            WHERE ID = @id
          `);
      } else {
        await new sql.Request(transaction)
          .input('empId', sql.Int, item.empId)
          .input('workDate', sql.Date, workDate)
          .input('checkInTime', sql.Time, timeToDate(updated.CheckInTime))
          .input('checkOutTime', sql.Time, timeToDate(updated.CheckOutTime))
          .input('status', sql.NVarChar(50), updated.Status)
          .input('lateMinutes', sql.Int, updated.LateMinutes)
          .input('earlyLeaveMinutes', sql.Int, updated.EarlyLeaveMinutes)
          .input('notes', sql.NVarChar(500), note)
          .input('scheduledStart', sql.Time, timeToDate(schedStart))
          .input('scheduledEnd', sql.Time, timeToDate(schedEnd))
          .query(`
            INSERT INTO dbo.TblEmpAttendance
              (EmpID, WorkDate, CheckInTime, CheckOutTime, Status,
               LateMinutes, EarlyLeaveMinutes, Notes,
               ScheduledStartTime, ScheduledEndTime, CreatedAt)
            VALUES
              (@empId, @workDate, @checkInTime, @checkOutTime, @status,
               @lateMinutes, @earlyLeaveMinutes, @notes,
               @scheduledStart, @scheduledEnd, GETDATE())
          `);
      }

      filled.push({
        empId: item.empId,
        empName: item.empName,
        reason: item.reason,
        checkIn: updated.CheckInTime,
        checkOut: updated.CheckOutTime,
        filledIn: !beforeIn && !!updated.CheckInTime,
        filledOut: !beforeOut && !!updated.CheckOutTime,
        status: updated.Status,
      });
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  const after = await validateDailyPayrollAttendance(db, workDate);
  return emptyResult(after.missing, filled, skippedNoDefault);
}

/** @deprecated use finalizeIncompleteAttendanceWithDefaults */
export const finalizeIncompleteAttendanceAsDayOff =
  finalizeIncompleteAttendanceWithDefaults;
