/**
 * POST /api/operations/schedule-control/apply
 *
 * Body: { empId, date, type, startTime?, endTime?, reason?, forceApply? }
 *
 * Hardened:
 * - Runs conflict pre-check via computePreview before writing.
 * - Returns 409 { requiresForce: true, affectedBookings, affectedQueueTickets }
 *   if conflicts exist and forceApply !== true.
 * - Enforces contradictory-override rules in the backend.
 * - Tags day_off attendance record with source="schedule-control day_off"
 *   so DELETE can safely revert it.
 * - Emits QA log for every request.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { ensureOverridesTable } from "@/lib/scheduleOverrides";
import { getBarberDayStatus, getScheduleOverrides, cairoDateStr } from "@/lib/availabilityEngine";
import { computePreview } from "@/lib/scheduleControlPreview";
import type { OverrideType } from "@/lib/scheduleOverrides";
import { syncBreakFromBlockRange } from "@/lib/hr/attendance-break-schedule-sync";
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from "@/lib/branch";

export const runtime = "nodejs";

const VALID_TYPES: OverrideType[] = [
  "day_off", "late_start", "early_leave", "custom_hours", "block_range",
];

function isValidDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
}
function isValidTime(t: string) {
  return /^\d{2}:\d{2}$/.test(t);
}
function hhmmToMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(req: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    const {
      empId,
      date,
      type,
      startTime,
      endTime,
      reason,
      forceApply = false,
    } = body as {
      empId: number;
      date: string;
      type: OverrideType;
      startTime?: string;
      endTime?: string;
      reason?: string;
      forceApply?: boolean;
    };

    // ── Input validation ──────────────────────────────────────────────────────
    if (!empId || typeof empId !== "number")
      return NextResponse.json({ error: "empId مطلوب" }, { status: 400 });
    if (!date || !isValidDate(date))
      return NextResponse.json({ error: "date غير صالح" }, { status: 400 });
    if (!type || !VALID_TYPES.includes(type))
      return NextResponse.json({ error: "type غير صالح" }, { status: 400 });
    if (type === "late_start" && !startTime)
      return NextResponse.json({ error: "late_start يتطلب startTime" }, { status: 400 });
    if (type === "early_leave" && !endTime)
      return NextResponse.json({ error: "early_leave يتطلب endTime" }, { status: 400 });
    if ((type === "block_range" || type === "custom_hours") && (!startTime || !endTime))
      return NextResponse.json({ error: `${type} يتطلب startTime و endTime` }, { status: 400 });
    if (startTime && !isValidTime(startTime))
      return NextResponse.json({ error: "startTime يجب أن يكون HH:MM" }, { status: 400 });
    if (endTime && !isValidTime(endTime))
      return NextResponse.json({ error: "endTime يجب أن يكون HH:MM" }, { status: 400 });
    if (type === "block_range" && startTime && endTime) {
      if (hhmmToMin(startTime) >= hhmmToMin(endTime))
        return NextResponse.json({ error: "block_range: startTime يجب أن يكون قبل endTime" }, { status: 400 });
    }

    const db = await getPool();
    await ensureOverridesTable(db);

    const todayStr = cairoDateStr(new Date());
    const isToday  = date === todayStr;

    // ── Contradictory override rules ──────────────────────────────────────────
    // Load currently active overrides for this barber/date
    const existingOverrides = await getScheduleOverrides(empId, date);
    const activeTypes = new Set(
      existingOverrides.filter((o) => o.IsActive !== false).map((o) => o.Type),
    );

    // day_off blocks everything — if already day_off, nothing else makes sense
    if (type !== "day_off" && activeTypes.has("day_off")) {
      return NextResponse.json(
        { error: "الصنايعي لديه غياب ليوم هذا التاريخ. أزل الغياب أولاً قبل إضافة تعديل آخر." },
        { status: 409 },
      );
    }

    // custom_hours replaces late_start and early_leave — deactivate them first
    const typesToDeactivate: OverrideType[] = [];
    if (type === "custom_hours") {
      if (activeTypes.has("late_start"))  typesToDeactivate.push("late_start");
      if (activeTypes.has("early_leave")) typesToDeactivate.push("early_leave");
    }
    // applying day_off deactivates all other active non-block_range overrides
    if (type === "day_off") {
      for (const t of activeTypes) {
        if (t !== "block_range") typesToDeactivate.push(t as OverrideType);
      }
    }

    // ── Conflict pre-check (same logic as /preview) ───────────────────────────
    const preview = await computePreview(empId, date, type, startTime, endTime);

    const qaLog = {
      empId, date, type, startTime, endTime, reason,
      forceApply,
      oldEffectiveStart:  preview.oldEffectiveStart,
      oldEffectiveEnd:    preview.oldEffectiveEnd,
      newEffectiveStart:  preview.newEffectiveStart,
      newEffectiveEnd:    preview.newEffectiveEnd,
      affectedBookingsCount:     preview.affectedBookings.length,
      affectedQueueTicketsCount: preview.affectedQueueTickets.length,
      safe: preview.safe,
    };

    if (!preview.safe && !forceApply) {
      console.log("[ops/schedule-control/apply] BLOCKED (requiresForce)", qaLog);
      return NextResponse.json(
        {
          requiresForce:       true,
          safe:                false,
          affectedBookings:    preview.affectedBookings,
          affectedQueueTickets: preview.affectedQueueTickets,
          warnings:            preview.warnings,
          error:               "يوجد تعارض. أرسل forceApply=true للمتابعة.",
        },
        { status: 409 },
      );
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    // Deactivate conflicting/superseded types
    const allToDeactivate = type === "block_range"
      ? typesToDeactivate                    // block_range is additive
      : [...typesToDeactivate, type];        // also replace same-type

    if (allToDeactivate.length > 0) {
      for (const t of [...new Set(allToDeactivate)]) {
        await db
          .request()
          .input("empId", sql.Int, empId)
          .input("odate", sql.Date, date)
          .input("otype", sql.NVarChar(30), t)
          .query(`
            UPDATE dbo.TblEmpScheduleOverrides
            SET IsActive = 0
            WHERE EmpID = @empId AND OverrideDate = @odate AND Type = @otype AND IsActive = 1
          `)
          .catch(() => {});
      }
    }

    // Insert new override — use "schedule-control <type>" as CreatedBy source tag
    const sourceTag = `schedule-control ${type}`;
    const insRes = await db
      .request()
      .input("empId",    sql.Int,          empId)
      .input("odate",    sql.Date,          date)
      .input("otype",    sql.NVarChar(30),  type)
      .input("startT",   sql.NVarChar(5),   startTime ?? null)
      .input("endT",     sql.NVarChar(5),   endTime   ?? null)
      .input("reason",   sql.NVarChar(300), reason    ?? null)
      .input("createdBy",sql.NVarChar(100), sourceTag)
      .query(`
        INSERT INTO dbo.TblEmpScheduleOverrides
          (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
        OUTPUT INSERTED.OverrideID
        VALUES
          (@empId, @odate, @otype,
           TRY_CAST(@startT AS TIME),
           TRY_CAST(@endT   AS TIME),
           @reason, 1, @createdBy)
      `);

    const newId: number = insRes.recordset[0]?.OverrideID;

    // day_off + today → upsert attendance Absent, tagged with source
    if (type === "day_off" && isToday) {
      const attendanceNote = `schedule-control day_off${reason ? `: ${reason}` : ""}`;
      await db
        .request()
        .input("empId",    sql.Int,          empId)
        .input("workDate", sql.Date,          date)
        .input("branchId", sql.Int,           branch.branchId)
        .input("notes",    sql.NVarChar(300), attendanceNote)
        .query(`
          IF EXISTS (
            SELECT 1 FROM dbo.TblEmpAttendance
            WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
          )
            UPDATE dbo.TblEmpAttendance
            SET Status = 'Absent', Notes = @notes
            WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
          ELSE
            INSERT INTO dbo.TblEmpAttendance (BranchID, EmpID, WorkDate, Status, Notes)
            VALUES (@branchId, @empId, @workDate, 'Absent', @notes)
        `)
        .catch(() => {});
    }

    // block_range → mirror as وقت مستقطع on attendance (same date)
    if (type === "block_range" && startTime && endTime) {
      await syncBreakFromBlockRange(
        db,
        empId,
        date,
        startTime,
        endTime,
        reason,
        branch.branchId,
      ).catch((err) => {
        console.warn("[ops/schedule-control/apply] break sync failed", err);
      });
    }

    // Return fresh barber status
    const updatedStatus = await getBarberDayStatus(empId, date, { isToday });

    console.log("[ops/schedule-control/apply] SAVED", { ...qaLog, overrideId: newId });

    return NextResponse.json({
      ok: true,
      overrideId: newId,
      barberStatus: {
        empId,
        dateStr:                   updatedStatus.dateStr,
        isWorkingDay:              updatedStatus.isWorkingDay,
        isDayOff:                  updatedStatus.isDayOff,
        isAbsent:                  updatedStatus.isAbsent,
        isLateStart:               updatedStatus.isLateStart,
        isEarlyLeave:              updatedStatus.isEarlyLeave,
        isCustomHours:             updatedStatus.isCustomHours,
        effectiveStart:            updatedStatus.effectiveStart,
        effectiveEnd:              updatedStatus.effectiveEnd,
        statusReasonArabic:        updatedStatus.statusReasonArabic,
        currentAvailabilityStatus: updatedStatus.currentAvailabilityStatus,
        appliedOverride:           updatedStatus.appliedOverride,
        attendance:                updatedStatus.attendance,
      },
    });
  } catch (err) {
    console.error("[operations/schedule-control/apply]", err);
    return NextResponse.json({ error: "فشل تطبيق التعديل" }, { status: 500 });
  }
}
