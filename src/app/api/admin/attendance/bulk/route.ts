import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { sqlTimeToHHmm, calcLateMinutes, calcEarlyLeaveMinutes } from "@/lib/timeUtils";

function formatTime(val: any): string | null {
  return sqlTimeToHHmm(val);
}

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
    }

    const db = await getPool();
    const targetDate = new Date(WorkDate + "T00:00:00");
    const dayOfWeek = targetDate.getDay();

    // Get DefaultCheckInTime / DefaultCheckOutTime from TblEmp for all employees
    const empIds = items.map((i: any) => Number(i.EmpID)).join(",");
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

        // Check existing
        const existReq = new sql.Request(transaction);
        const existing = await existReq
          .input("empId", sql.Int, item.EmpID)
          .input("workDate", sql.Date, WorkDate)
          .query(
            "SELECT ID FROM dbo.TblEmpAttendance WHERE EmpID = @empId AND WorkDate = @workDate"
          );

        if (existing.recordset.length > 0) {
          const updateReq = new sql.Request(transaction);
          await updateReq
            .input("id", sql.Int, existing.recordset[0].ID)
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
          const insertReq = new sql.Request(transaction);
          await insertReq
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
              VALUES
                (@empId, @workDate, @checkInTime, @checkOutTime, @status, @lateMinutes, @earlyLeaveMinutes, @notes, @scheduledStart, @scheduledEnd, @createdBy, GETDATE())
            `);
          insertedCount++;
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
