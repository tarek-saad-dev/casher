import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { calcLateMinutes, calcEarlyLeaveMinutes } from "@/lib/timeUtils";
import { normalizeBreaksInput } from "@/lib/hr/attendance-breaks";
import {
  ensureAttendanceBreakSchema,
  replaceAttendanceBreaks,
} from "@/lib/hr/attendance-breaks-db";
import { syncBlockRangesFromBreaks } from "@/lib/hr/attendance-break-schedule-sync";

function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === "") return null;
  const parts = timeStr.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0);
  d.setUTCHours(h, m, s, 0);
  return d;
}

// PUT /api/admin/attendance/bulk
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const body = await req.json();
    const { WorkDate, items } = body;

    if (!WorkDate || !/^\d{4}-\d{2}-\d{2}$/.test(WorkDate)) {
      return NextResponse.json(
        { error: "التاريخ مطلوب بصيغة YYYY-MM-DD" },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "يجب إرسال مصفوفة items" },
        { status: 400 }
      );
    }

    const validStatuses = [
      "Pending",
      "Present",
      "Late",
      "Absent",
      "DayOff",
      "EarlyLeave",
      "Excused",
    ];
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

    for (const item of items) {
      if (!item.EmpID) {
        return NextResponse.json(
          { error: "EmpID مطلوب لكل عنصر" },
          { status: 400 }
        );
      }
      if (item.Status && !validStatuses.includes(item.Status)) {
        return NextResponse.json(
          { error: `حالة غير صحيحة: ${item.Status}` },
          { status: 400 }
        );
      }
      if (item.CheckInTime && !timeRegex.test(item.CheckInTime)) {
        return NextResponse.json(
          { error: `صيغة وقت حضور غير صحيحة للموظف ${item.EmpID}` },
          { status: 400 }
        );
      }
      if (item.CheckOutTime && !timeRegex.test(item.CheckOutTime)) {
        return NextResponse.json(
          { error: `صيغة وقت انصراف غير صحيحة للموظف ${item.EmpID}` },
          { status: 400 }
        );
      }
      if (item.Breaks !== undefined) {
        const parsed = normalizeBreaksInput(item.Breaks);
        if (parsed.error) {
          return NextResponse.json(
            { error: `${parsed.error} (موظف ${item.EmpID})` },
            { status: 400 },
          );
        }
        item._parsedBreaks = parsed.breaks;
      }
    }

    const db = await getPool();
    await ensureAttendanceBreakSchema(db);

    const empIds = items.map((i: { EmpID: number }) => Number(i.EmpID)).join(",");
    const empDefaults = await db
      .request()
      .query(`
        SELECT
          EmpID,
          CONVERT(VARCHAR(5), DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
        FROM dbo.TblEmp
        WHERE EmpID IN (${empIds || "0"})
      `);

    const empDefaultMap = new Map<number, { schedStart: string | null; schedEnd: string | null }>();
    for (const e of empDefaults.recordset) {
      empDefaultMap.set(e.EmpID, {
        schedStart: e.DefaultCheckInTime  || null,
        schedEnd:   e.DefaultCheckOutTime || null,
      });
    }

    const transaction = new sql.Transaction(db);
    await transaction.begin();
    const txDb = { request: () => new sql.Request(transaction) };

    let insertedCount = 0;
    let updatedCount = 0;

    try {
      for (const item of items) {
        const empDef = empDefaultMap.get(item.EmpID);
        const schedStart = empDef?.schedStart ?? null;
        const schedEnd   = empDef?.schedEnd   ?? null;

        const checkIn = item.CheckInTime || null;
        const checkOut = item.CheckOutTime || null;

        const lateMinutes = calcLateMinutes(checkIn, schedStart);
        const earlyLeaveMinutes = calcEarlyLeaveMinutes(checkOut, schedEnd);

        let finalStatus = item.Status || "Pending";
        const manualStatuses = ["Absent", "DayOff", "Excused"];
        if (!manualStatuses.includes(finalStatus)) {
          if (checkIn) {
            finalStatus = lateMinutes > 0 ? "Late" : "Present";
          }
          if (checkOut && earlyLeaveMinutes > 0 && finalStatus === "Present") {
            finalStatus = "EarlyLeave";
          }
        }

        const clearBreaks =
          finalStatus === "Absent" ||
          finalStatus === "DayOff" ||
          (!checkIn && !checkOut);

        const existing = await txDb
          .request()
          .input("empId", sql.Int, item.EmpID)
          .input("workDate", sql.Date, WorkDate)
          .query(
            "SELECT ID FROM dbo.TblEmpAttendance WHERE EmpID = @empId AND WorkDate = @workDate"
          );

        let attendanceId: number;
        if (existing.recordset.length > 0) {
          attendanceId = existing.recordset[0].ID as number;
          await txDb
            .request()
            .input("id", sql.Int, attendanceId)
            .input("checkInTime", sql.Time, timeToDate(checkIn))
            .input("checkOutTime", sql.Time, timeToDate(checkOut))
            .input("status", sql.NVarChar(50), finalStatus)
            .input("lateMinutes", sql.Int, lateMinutes)
            .input("earlyLeaveMinutes", sql.Int, earlyLeaveMinutes)
            .input("notes", sql.NVarChar(500), item.Notes || null)
            .input("scheduledStart", sql.Time, timeToDate(schedStart))
            .input("scheduledEnd", sql.Time, timeToDate(schedEnd))
            .input("updatedBy", sql.Int, session.UserID || null)
            .query(`
              UPDATE dbo.TblEmpAttendance
              SET CheckInTime = @checkInTime,
                  CheckOutTime = @checkOutTime,
                  Status = @status,
                  LateMinutes = @lateMinutes,
                  EarlyLeaveMinutes = @earlyLeaveMinutes,
                  Notes = @notes,
                  ScheduledStartTime = @scheduledStart,
                  ScheduledEndTime = @scheduledEnd,
                  UpdatedByUserID = @updatedBy,
                  UpdatedAt = GETDATE()
              WHERE ID = @id
            `);
          updatedCount++;
        } else {
          const insertResult = await txDb
            .request()
            .input("empId", sql.Int, item.EmpID)
            .input("workDate", sql.Date, WorkDate)
            .input("checkInTime", sql.Time, timeToDate(checkIn))
            .input("checkOutTime", sql.Time, timeToDate(checkOut))
            .input("status", sql.NVarChar(50), finalStatus)
            .input("lateMinutes", sql.Int, lateMinutes)
            .input("earlyLeaveMinutes", sql.Int, earlyLeaveMinutes)
            .input("notes", sql.NVarChar(500), item.Notes || null)
            .input("scheduledStart", sql.Time, timeToDate(schedStart))
            .input("scheduledEnd", sql.Time, timeToDate(schedEnd))
            .input("createdBy", sql.Int, session.UserID || null)
            .query(`
              INSERT INTO dbo.TblEmpAttendance
                (EmpID, WorkDate, CheckInTime, CheckOutTime, Status, LateMinutes, EarlyLeaveMinutes, Notes, ScheduledStartTime, ScheduledEndTime, CreatedByUserID, CreatedAt)
              OUTPUT INSERTED.ID
              VALUES
                (@empId, @workDate, @checkInTime, @checkOutTime, @status, @lateMinutes, @earlyLeaveMinutes, @notes, @scheduledStart, @scheduledEnd, @createdBy, GETDATE())
            `);
          attendanceId = insertResult.recordset[0].ID as number;
          insertedCount++;
        }

        if (clearBreaks || item.Breaks !== undefined) {
          const breaksToSave = clearBreaks ? [] : (item._parsedBreaks ?? []);
          await replaceAttendanceBreaks(
            txDb,
            attendanceId,
            breaksToSave,
          );
          await syncBlockRangesFromBreaks(
            txDb,
            Number(item.EmpID),
            WorkDate,
            breaksToSave,
          );
        }
      }

      await transaction.commit();

      return NextResponse.json({
        success: true,
        message: "تم حفظ الحضور بنجاح",
        summary: {
          savedCount: insertedCount + updatedCount,
          insertedCount,
          updatedCount,
        },
      });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/attendance/bulk] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
