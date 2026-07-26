/**
 * POST /api/operations/schedule-control/restore-present
 *
 * One-shot ops action:
 * 1) Clear day_off overrides for the date
 * 2) Soft-clear EmpDayOff if present
 * 3) Ensure custom_hours so weekly-off can work today
 * 4) Upsert attendance Present + CheckInTime (shows in /admin/hr?tab=attendance)
 *
 * Does not mutate TblEmpBranchWorkSchedule / legacy weekly schedule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getBranchById } from '@/lib/branch/repository';
import { getBarberDayStatus, cairoDateStr, cairoTimeStr } from '@/lib/availabilityEngine';
import { getCairoBusinessDate, getCairoTimeStr } from '@/lib/businessDate';

export const runtime = 'nodejs';

const RESTORE_SOURCE = 'schedule-control restore-present';
const DAY_OFF_SOURCE = 'schedule-control day_off';

export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const empId = Number(body.empId);
    const date = String(body.date || getCairoBusinessDate());
    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ ok: false, error: 'empId غير صالح' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: 'date غير صالح' }, { status: 400 });
    }

    const todayStr = cairoDateStr(new Date());
    if (date !== todayStr && date !== getCairoBusinessDate()) {
      // Allow business-date edge near cutoff; still only "today" operational restore
      if (date !== todayStr) {
        return NextResponse.json(
          { ok: false, error: 'تسجيل الحضور السريع متاح لليوم الحالي فقط' },
          { status: 400 },
        );
      }
    }

    const branch = await getBranchById(auth.activeBranchId);
    if (!branch || !branch.isActive) {
      return NextResponse.json({ ok: false, error: 'الفرع غير نشط' }, { status: 403 });
    }

    const db = await getPool();
    const checkInTime = getCairoTimeStr() || cairoTimeStr(new Date());
    const open = (branch.defaultOpenTime || '10:00').slice(0, 5);
    const close = (branch.defaultCloseTime || '22:00').slice(0, 5);

    // 1) Soft-deactivate day_off overrides
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

    // 2) Soft-clear EmpDayOff if table supports IsDeleted
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
      /* optional table / column */
    }

    // 3) Ensure custom_hours unlock for today (weekly off → working window)
    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('day', sql.Date, date)
      .input('createdByPrefix', sql.NVarChar(40), 'schedule-control%')
      .input('restoreSource', sql.NVarChar(80), RESTORE_SOURCE)
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
          )
      `)
      .catch(() => null);

    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('day', sql.Date, date)
      .input('start', sql.VarChar(8), open)
      .input('end', sql.VarChar(8), close)
      .input('reason', sql.NVarChar(250), 'إلغاء الغياب وتشغيل اليوم من إدارة مواعيد اليوم')
      .input('createdBy', sql.NVarChar(80), RESTORE_SOURCE)
      .query(`
        INSERT INTO dbo.TblEmpScheduleOverrides
          (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
        VALUES
          (@empId, @day, N'custom_hours',
           TRY_CAST(@start AS TIME), TRY_CAST(@end AS TIME),
           @reason, 1, @createdBy)
      `);

    // 4) Upsert attendance Present + CheckIn (HR attendance tab)
    const notes = `${RESTORE_SOURCE}${body.reason ? `: ${String(body.reason).trim()}` : ''}`;
    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('workDate', sql.Date, date)
      .input('branchId', sql.Int, branch.branchId)
      .input('checkIn', sql.VarChar(8), checkInTime.length === 5 ? `${checkInTime}:00` : checkInTime)
      .input('status', sql.NVarChar(40), 'Present')
      .input('notes', sql.NVarChar(300), notes)
      .input('dayOffTag', sql.NVarChar(80), DAY_OFF_SOURCE)
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
              WHEN Status = N'Absent' THEN TRY_CAST(@checkIn AS TIME)
              ELSE CheckInTime
            END,
            CheckOutTime = CASE WHEN Status = N'Absent' THEN NULL ELSE CheckOutTime END,
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

        -- Also clear Absent rows tagged from schedule-control on any branch for this date
        UPDATE dbo.TblEmpAttendance
        SET Status = @status,
            CheckInTime = ISNULL(CheckInTime, TRY_CAST(@checkIn AS TIME)),
            Notes = @notes,
            UpdatedAt = SYSUTCDATETIME()
        WHERE EmpID = @empId
          AND WorkDate = @workDate
          AND Status = N'Absent'
          AND BranchID <> @branchId
          AND Notes LIKE @dayOffTag + N'%'
      `);

    const updatedStatus = await getBarberDayStatus(empId, date, { isToday: true });

    return NextResponse.json({
      ok: true,
      message: 'تم إلغاء الغياب وتسجيل الحضور',
      checkInTime,
      branchId: branch.branchId,
      dayOffOverridesCleared,
      dayOffRowsCleared,
      customHours: { start: open, end: close },
      barberStatus: {
        empId,
        isWorkingDay: updatedStatus.isWorkingDay,
        isDayOff: updatedStatus.isDayOff,
        isAbsent: updatedStatus.isAbsent,
        statusReasonArabic: updatedStatus.statusReasonArabic,
        currentAvailabilityStatus: updatedStatus.currentAvailabilityStatus,
        effectiveStart: updatedStatus.effectiveStart,
        effectiveEnd: updatedStatus.effectiveEnd,
        attendance: updatedStatus.attendance,
      },
    });
  } catch (err) {
    console.error('[schedule-control/restore-present]', err);
    return NextResponse.json({ ok: false, error: 'فشل إلغاء الغياب وتسجيل الحضور' }, { status: 500 });
  }
}
