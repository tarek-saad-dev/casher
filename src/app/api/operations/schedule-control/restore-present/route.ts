/**
 * POST /api/operations/schedule-control/restore-present
 *
 * One-shot ops action for weekly-off / day_off / Absent:
 * 1) Clear day_off locks + open bookable custom_hours for the WorkDate
 * 2) Today only: upsert attendance Present + CheckInTime (HR attendance tab)
 *
 * Future dates: schedule unlock only (no premature check-in).
 * Does not mutate TblEmpBranchWorkSchedule / legacy weekly schedule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getBranchById } from '@/lib/branch/repository';
import { getBarberDayStatus, cairoDateStr, cairoTimeStr } from '@/lib/availabilityEngine';
import { getCairoBusinessDate, getCairoTimeStr } from '@/lib/businessDate';
import { unlockScheduleForWorkOnDayOff } from '@/lib/hr/attendance/workOnDayOff.service';

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

    const todayBusiness = getCairoBusinessDate();
    const todayCalendar = cairoDateStr(new Date());
    const isToday = date === todayBusiness || date === todayCalendar;
    if (date < todayBusiness && date < todayCalendar) {
      return NextResponse.json(
        { ok: false, error: 'تشغيل يوم الإجازة متاح لليوم أو تاريخ مستقبلي فقط' },
        { status: 400 },
      );
    }

    const branch = await getBranchById(auth.activeBranchId);
    if (!branch || !branch.isActive) {
      return NextResponse.json({ ok: false, error: 'الفرع غير نشط' }, { status: 403 });
    }

    const unlock = await unlockScheduleForWorkOnDayOff({
      empId,
      date,
      branchId: branch.branchId,
      reason:
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : isToday
            ? 'إلغاء الغياب وتشغيل اليوم من إدارة مواعيد اليوم'
            : 'تشغيل يوم إجازة أسبوعية لتاريخ مستقبلي من إدارة مواعيد اليوم',
      sourceTag: RESTORE_SOURCE,
    });

    let checkInTime: string | null = null;

    // Attendance check-in only for the operational "today" — never invent Present for the future.
    if (isToday) {
      const db = await getPool();
      checkInTime = getCairoTimeStr() || cairoTimeStr(new Date());
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
    }

    const updatedStatus = await getBarberDayStatus(empId, date, {
      isToday,
      branchId: branch.branchId,
    });

    return NextResponse.json({
      ok: true,
      message: isToday
        ? 'تم إلغاء الغياب وتسجيل الحضور'
        : 'تم تشغيل هذا اليوم للحجز — تسجيل الحضور يتم يوم العمل نفسه',
      checkInTime,
      attendanceRecorded: isToday,
      branchId: branch.branchId,
      dayOffOverridesCleared: unlock.dayOffOverridesCleared,
      dayOffRowsCleared: unlock.dayOffRowsCleared,
      customHours: unlock.customHours,
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
    return NextResponse.json({ ok: false, error: 'فشل إلغاء الغياب وتشغيل اليوم' }, { status: 500 });
  }
}
