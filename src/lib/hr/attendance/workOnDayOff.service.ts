/**
 * Check in an employee who is on weekly/date day-off but came to work.
 * Shared by ops restore-present and HR/POS attendance panel.
 */
import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { getCairoTimeStr } from '@/lib/businessDate';
import { cairoTimeStr } from '@/lib/availabilityEngine';

export type WorkOnDayOffResult = {
  ok: true;
  message: string;
  checkInTime: string;
  branchId: number;
  dayOffOverridesCleared: number;
  dayOffRowsCleared: number;
  customHours: { start: string; end: string };
};

export type UnlockDayOffScheduleResult = {
  dayOffOverridesCleared: number;
  dayOffRowsCleared: number;
  customHours: { start: string; end: string };
};

/**
 * Clear day-off locks and open bookable custom_hours for this WorkDate.
 * Safe when TblEmpDayOff is missing.
 */
export async function unlockScheduleForWorkOnDayOff(params: {
  empId: number;
  date: string;
  branchId: number;
  reason?: string | null;
  sourceTag?: string;
}): Promise<UnlockDayOffScheduleResult> {
  const {
    empId,
    date,
    branchId,
    reason,
    sourceTag = 'work-on-day-off',
  } = params;

  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) {
    throw new Error('الفرع غير نشط');
  }

  const db = await getPool();
  const open = (branch.defaultOpenTime || '10:00').slice(0, 5);
  const close = (branch.defaultCloseTime || '22:00').slice(0, 5);

  const clearedOverrides = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, date)
    .query(`
      UPDATE dbo.TblEmpScheduleOverrides
      SET IsActive = 0
      WHERE EmpID = @empId
        AND OverrideDate = @day
        AND IsActive = 1
        AND Type = N'day_off'
    `);
  const dayOffOverridesCleared = Number(clearedOverrides.rowsAffected?.[0] ?? 0);

  let dayOffRowsCleared = 0;
  try {
    const r = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('day', sql.Date, date)
      .query(`
        UPDATE dbo.TblEmpDayOff
        SET IsDeleted = 1
        WHERE EmpID = @empId AND OffDate = @day AND ISNULL(IsDeleted, 0) = 0
      `);
    dayOffRowsCleared = Number(r.rowsAffected?.[0] ?? 0);
  } catch {
    /* optional table */
  }

  await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, date)
    .input('createdByPrefix', sql.NVarChar(40), 'schedule-control%')
    .input('restoreSource', sql.NVarChar(80), sourceTag)
    .query(`
      UPDATE dbo.TblEmpScheduleOverrides
      SET IsActive = 0
      WHERE EmpID = @empId
        AND OverrideDate = @day
        AND IsActive = 1
        AND Type = N'custom_hours'
        AND (
          CreatedBy LIKE @createdByPrefix
          OR CreatedBy = @restoreSource
          OR CreatedBy LIKE N'work-on-day-off%'
        )
    `)
    .catch(() => null);

  const reasonText =
    reason?.trim() ||
    'نزل يشتغل يوم إجازته — تسجيل حضور من متابعة الحضور';

  await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, date)
    .input('start', sql.VarChar(8), open)
    .input('end', sql.VarChar(8), close)
    .input('reason', sql.NVarChar(250), reasonText)
    .input('createdBy', sql.NVarChar(80), sourceTag)
    .query(`
      INSERT INTO dbo.TblEmpScheduleOverrides
        (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
      VALUES
        (@empId, @day, N'custom_hours',
         TRY_CAST(@start AS TIME), TRY_CAST(@end AS TIME),
         @reason, 1, @createdBy)
    `);

  return {
    dayOffOverridesCleared,
    dayOffRowsCleared,
    customHours: { start: open, end: close },
  };
}

export async function executeWorkOnDayOff(params: {
  empId: number;
  date: string;
  branchId: number;
  reason?: string | null;
  /** Notes prefix for attendance (audit trail). */
  sourceTag?: string;
}): Promise<WorkOnDayOffResult> {
  const {
    empId,
    date,
    branchId,
    reason,
    sourceTag = 'work-on-day-off',
  } = params;

  const unlock = await unlockScheduleForWorkOnDayOff({
    empId,
    date,
    branchId,
    reason,
    sourceTag,
  });

  const db = await getPool();
  const checkInTime = getCairoTimeStr() || cairoTimeStr(new Date());
  const reasonText =
    reason?.trim() ||
    'نزل يشتغل يوم إجازته — تسجيل حضور من متابعة الحضور';
  const notes = `${sourceTag}: ${reasonText}`.slice(0, 300);

  await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, date)
    .input('branchId', sql.Int, branchId)
    .input('checkIn', sql.VarChar(8), checkInTime.length === 5 ? `${checkInTime}:00` : checkInTime)
    .input('status', sql.NVarChar(40), 'Present')
    .input('notes', sql.NVarChar(300), notes)
    .query(`
      IF EXISTS (
        SELECT 1 FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
      )
      BEGIN
        UPDATE dbo.TblEmpAttendance
        SET
          Status = @status,
          CheckInTime = CASE
            WHEN CheckInTime IS NULL THEN TRY_CAST(@checkIn AS TIME)
            WHEN Status IN (N'Absent', N'DayOff', N'Pending') THEN TRY_CAST(@checkIn AS TIME)
            ELSE CheckInTime
          END,
          CheckOutTime = CASE
            WHEN Status IN (N'Absent', N'DayOff') THEN NULL
            ELSE CheckOutTime
          END,
          Notes = @notes,
          UpdatedAt = SYSUTCDATETIME()
        WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
      END
      ELSE
      BEGIN
        INSERT INTO dbo.TblEmpAttendance
          (BranchID, EmpID, WorkDate, CheckInTime, Status, Notes, CreatedAt)
        VALUES
          (@branchId, @empId, @workDate, TRY_CAST(@checkIn AS TIME), @status, @notes, GETDATE())
      END
    `);

  return {
    ok: true,
    message: 'تم تسجيل حضور الموظف في يوم إجازته',
    checkInTime,
    branchId,
    dayOffOverridesCleared: unlock.dayOffOverridesCleared,
    dayOffRowsCleared: unlock.dayOffRowsCleared,
    customHours: unlock.customHours,
  };
}
