/**
 * DELETE /api/operations/schedule-control/override/[id]
 *
 * Soft-deletes (IsActive=0) an override by OverrideID.
 *
 * Hardened (Phase 2.5):
 * - If the deleted override is type=day_off AND was created by schedule-control
 *   (CreatedBy LIKE 'schedule-control day_off%') AND date=today:
 *     → Revert attendance back to NULL / 'Present' so the barber is unblocked.
 * - If a day_off override is deleted but attendance STILL shows Absent
 *   (e.g., independently set), returns attendanceWarning so the UI can alert
 *   the operator.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getBarberDayStatus, cairoDateStr } from "@/lib/availabilityEngine";
import {
  isSyncedBlockRangeCreatedBy,
  removeBreakMatchingBlockRange,
} from "@/lib/hr/attendance-break-schedule-sync";

export const runtime = "nodejs";

const SC_DAY_OFF_SOURCE = "schedule-control day_off";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const overrideId = parseInt(id, 10);
    if (!overrideId || isNaN(overrideId)) {
      return NextResponse.json({ error: "id غير صالح" }, { status: 400 });
    }

    const db = await getPool();

    // 1. Load override metadata before deleting
    const fetchRes = await db
      .request()
      .input("oid", sql.Int, overrideId)
      .query(`
        SELECT
          EmpID,
          CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
          Type,
          ISNULL(CreatedBy, '') AS CreatedBy,
          CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
          CASE WHEN EndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime,   108), 5) ELSE NULL END AS EndTime
        FROM dbo.TblEmpScheduleOverrides
        WHERE OverrideID = @oid
      `)
      .catch(() => ({ recordset: [] as any[] }));

    if (!fetchRes.recordset.length) {
      return NextResponse.json({ error: "التعديل غير موجود" }, { status: 404 });
    }

    const {
      EmpID: empId,
      OverrideDate: date,
      Type: overrideType,
      CreatedBy: createdBy,
      StartTime: startTime,
      EndTime: endTime,
    } = fetchRes.recordset[0];

    const todayStr = cairoDateStr(new Date());
    const isToday  = date === todayStr;

    // 2. Soft-delete the override
    await db
      .request()
      .input("oid", sql.Int, overrideId)
      .query(`
        UPDATE dbo.TblEmpScheduleOverrides
        SET IsActive = 0
        WHERE OverrideID = @oid
      `);

    // 3. If day_off + today + created by schedule-control → revert attendance
    let attendanceReverted = false;
    if (
      overrideType === "day_off" &&
      isToday &&
      typeof createdBy === "string" &&
      createdBy.startsWith(SC_DAY_OFF_SOURCE)
    ) {
      // Only revert if the attendance Notes still carries our source tag
      // (guards against manual attendance edits made after the override)
      await db
        .request()
        .input("empId",    sql.Int,         empId)
        .input("workDate", sql.Date,         date)
        .input("sourceTag",sql.NVarChar(100), SC_DAY_OFF_SOURCE)
        .query(`
          UPDATE dbo.TblEmpAttendance
          SET Status = NULL, Notes = NULL
          WHERE EmpID = @empId
            AND WorkDate = @workDate
            AND Status = 'Absent'
            AND Notes LIKE @sourceTag + '%'
        `)
        .then(r => { attendanceReverted = r.rowsAffected[0] > 0; })
        .catch(() => {});
    }

    // 3b. block_range synced ↔ وقت مستقطع → remove matching break
    if (
      overrideType === "block_range" &&
      isSyncedBlockRangeCreatedBy(createdBy)
    ) {
      await removeBreakMatchingBlockRange(db, empId, date, startTime, endTime).catch((err) => {
        console.warn("[ops/schedule-control/override DELETE] break sync failed", err);
      });
    }

    // 4. Load fresh status (after revert)
    const updatedStatus = await getBarberDayStatus(empId, date, { isToday });

    // 5. Check if Absent attendance still lingers (not created by us)
    let attendanceWarning: string | null = null;
    if (
      overrideType === "day_off" &&
      isToday &&
      !attendanceReverted &&
      updatedStatus.isAbsent
    ) {
      attendanceWarning =
        "تم حذف تعديل المواعيد لكن حالة الحضور ما زالت غائب — " +
        "يجب تحديث سجل الحضور يدوياً لإعادة إتاحة الصنايعي.";
    }

    console.log(
      `[ops/schedule-control/override DELETE]` +
      ` OverrideID=${overrideId} EmpID=${empId} date=${date}` +
      ` type=${overrideType} attendanceReverted=${attendanceReverted}` +
      ` attendanceWarning=${!!attendanceWarning}`,
    );

    return NextResponse.json({
      ok: true,
      attendanceReverted,
      attendanceWarning,
      barberStatus: {
        empId,
        dateStr:                   updatedStatus.dateStr,
        isWorkingDay:              updatedStatus.isWorkingDay,
        isDayOff:                  updatedStatus.isDayOff,
        isAbsent:                  updatedStatus.isAbsent,
        effectiveStart:            updatedStatus.effectiveStart,
        effectiveEnd:              updatedStatus.effectiveEnd,
        statusReasonArabic:        updatedStatus.statusReasonArabic,
        currentAvailabilityStatus: updatedStatus.currentAvailabilityStatus,
        appliedOverride:           updatedStatus.appliedOverride,
        attendance:                updatedStatus.attendance,
      },
    });
  } catch (err) {
    console.error("[ops/schedule-control/override DELETE]", err);
    return NextResponse.json({ error: "فشل حذف التعديل" }, { status: 500 });
  }
}
