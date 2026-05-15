import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { sqlTimeToHHmm, calcLateMinutes as calcLate, calcEarlyLeaveMinutes as calcEarlyLeave } from "@/lib/timeUtils";

async function ensureAttendanceTable(db: any) {
  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpAttendance')
    BEGIN
        CREATE TABLE dbo.TblEmpAttendance (
            ID INT IDENTITY(1,1) PRIMARY KEY,
            EmpID INT NOT NULL,
            WorkDate DATE NOT NULL,
            ScheduledStartTime TIME NULL,
            ScheduledEndTime TIME NULL,
            CheckInTime TIME NULL,
            CheckOutTime TIME NULL,
            Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
            LateMinutes INT NOT NULL DEFAULT 0,
            EarlyLeaveMinutes INT NOT NULL DEFAULT 0,
            Notes NVARCHAR(500) NULL,
            CreatedByUserID INT NULL,
            UpdatedByUserID INT NULL,
            CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
            UpdatedAt DATETIME NULL
        );

        ALTER TABLE dbo.TblEmpAttendance
        ADD CONSTRAINT FK_TblEmpAttendance_TblEmp
        FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);

        CREATE UNIQUE INDEX UQ_TblEmpAttendance_Emp_Date
        ON dbo.TblEmpAttendance (EmpID, WorkDate);

        CREATE INDEX IX_TblEmpAttendance_WorkDate
        ON dbo.TblEmpAttendance (WorkDate);
    END
  `);
}

function formatTime(val: any): string | null {
  return sqlTimeToHHmm(val);
}

function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === "") return null;
  // Parse "HH:mm" or "HH:mm:ss" into a Date anchored to 1970-01-01 UTC
  // so mssql driver stores it correctly as a TIME value.
  const parts = timeStr.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0); // 1970-01-01T00:00:00.000Z
  d.setUTCHours(h, m, s, 0);
  return d;
}

function calcLateMinutes(checkIn: string | null, scheduledStart: string | null): number {
  return calcLate(checkIn, scheduledStart);
}

function calcEarlyLeaveMinutes(checkOut: string | null, scheduledEnd: string | null): number {
  return calcEarlyLeave(checkOut, scheduledEnd);
}

// GET /api/admin/attendance?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: "التاريخ مطلوب بصيغة YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const targetDate = new Date(dateStr + "T00:00:00");
    const dayOfWeek = targetDate.getDay(); // 0=Sunday ... 6=Saturday

    const db = await getPool();
    await ensureAttendanceTable(db);

    // Get all active employees with their schedule for this day and attendance
    const result = await db
      .request()
      .input("workDate", sql.Date, dateStr)
      .input("dayOfWeek", sql.TinyInt, dayOfWeek)
      .query(`
        SELECT
          e.EmpID,
          e.EmpName,
          ws.DayOfWeek,
          ws.IsWorkingDay,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          a.ID AS AttendanceID,
          a.WorkDate,
          CONVERT(VARCHAR(5), a.CheckInTime,  108) AS CheckInTime,
          CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
          a.Status,
          a.LateMinutes,
          a.EarlyLeaveMinutes,
          a.Notes
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpWorkSchedule ws
          ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = e.EmpID AND a.WorkDate = @workDate
        WHERE ISNULL(e.isActive, 1) = 1
        ORDER BY e.EmpName
      `);

    const rows = result.recordset.map((row: any) => {
      const hasAttendance = row.AttendanceID != null;
      const hasSchedule   = row.DayOfWeek != null;
      const isWorkingDay  = hasSchedule ? !!row.IsWorkingDay : (dayOfWeek !== 5);

      // Always use DefaultCheckInTime / DefaultCheckOutTime as the canonical schedule
      const schedStart = row.DefaultCheckInTime  || null;
      const schedEnd   = row.DefaultCheckOutTime || null;

      const checkIn  = row.CheckInTime  || null;
      const checkOut = row.CheckOutTime || null;

      // Recalculate LateMinutes from actual check-in vs default schedule
      const lateMin  = hasAttendance && checkIn ? calcLateMinutes(checkIn, schedStart) : 0;
      const earlyMin = hasAttendance && checkOut ? calcEarlyLeaveMinutes(checkOut, schedEnd) : 0;

      return {
        EmpID: row.EmpID,
        EmpName: row.EmpName,
        WorkDate: dateStr,
        DayOfWeek: dayOfWeek,
        IsWorkingDay: isWorkingDay,
        ScheduledStartTime: schedStart,
        ScheduledEndTime: schedEnd,
        CheckInTime: checkIn,
        CheckOutTime: checkOut,
        Status: hasAttendance ? row.Status : (isWorkingDay ? "Pending" : "DayOff"),
        LateMinutes: lateMin,
        EarlyLeaveMinutes: earlyMin,
        Notes: row.Notes || "",
        HasRecord: hasAttendance,
      };
    });

    return NextResponse.json({ success: true, date: dateStr, attendance: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/attendance] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/admin/attendance — single employee save
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const body = await req.json();
    const { EmpID, WorkDate, CheckInTime, CheckOutTime, Status, Notes } = body;

    if (!EmpID || !WorkDate) {
      return NextResponse.json(
        { error: "EmpID و WorkDate مطلوبين" },
        { status: 400 }
      );
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(WorkDate)
    ) {
      return NextResponse.json(
        { error: "صيغة التاريخ غير صحيحة" },
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
    if (Status && !validStatuses.includes(Status)) {
      return NextResponse.json(
        { error: "حالة غير صحيحة" },
        { status: 400 }
      );
    }

    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (CheckInTime && !timeRegex.test(CheckInTime)) {
      return NextResponse.json(
        { error: "صيغة وقت الحضور غير صحيحة" },
        { status: 400 }
      );
    }
    if (CheckOutTime && !timeRegex.test(CheckOutTime)) {
      return NextResponse.json(
        { error: "صيغة وقت الانصراف غير صحيحة" },
        { status: 400 }
      );
    }

    const db = await getPool();
    await ensureAttendanceTable(db);

    // Get DefaultCheckInTime / DefaultCheckOutTime from TblEmp as canonical schedule
    const targetDate = new Date(WorkDate + "T00:00:00");
    const dayOfWeek = targetDate.getDay();

    const empResult = await db
      .request()
      .input("empId", sql.Int, EmpID)
      .query(`
        SELECT
          CONVERT(VARCHAR(5), DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
        FROM dbo.TblEmp
        WHERE EmpID = @empId
      `);

    let schedStart: string | null = null;
    let schedEnd:   string | null = null;
    if (empResult.recordset.length > 0) {
      schedStart = empResult.recordset[0].DefaultCheckInTime  || null;
      schedEnd   = empResult.recordset[0].DefaultCheckOutTime || null;
    }

    // Calculate late/early
    const lateMinutes = calcLateMinutes(CheckInTime || null, schedStart);
    const earlyLeaveMinutes = calcEarlyLeaveMinutes(
      CheckOutTime || null,
      schedEnd
    );

    // Auto-determine status if not manually overridden to Absent/DayOff/Excused
    let finalStatus = Status || "Pending";
    const manualStatuses = ["Absent", "DayOff", "Excused"];
    if (!manualStatuses.includes(finalStatus)) {
      if (CheckInTime) {
        finalStatus = lateMinutes > 0 ? "Late" : "Present";
      }
      if (
        CheckOutTime &&
        earlyLeaveMinutes > 0 &&
        finalStatus === "Present"
      ) {
        finalStatus = "EarlyLeave";
      }
    }

    // UPSERT
    const existing = await db
      .request()
      .input("empId", sql.Int, EmpID)
      .input("workDate", sql.Date, WorkDate)
      .query(
        "SELECT ID FROM dbo.TblEmpAttendance WHERE EmpID = @empId AND WorkDate = @workDate"
      );

    if (existing.recordset.length > 0) {
      // UPDATE
      await db
        .request()
        .input("id", sql.Int, existing.recordset[0].ID)
        .input("checkInTime", sql.Time, timeToDate(CheckInTime))
        .input("checkOutTime", sql.Time, timeToDate(CheckOutTime))
        .input("status", sql.NVarChar(50), finalStatus)
        .input("lateMinutes", sql.Int, lateMinutes)
        .input("earlyLeaveMinutes", sql.Int, earlyLeaveMinutes)
        .input("notes", sql.NVarChar(500), Notes || null)
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
    } else {
      // INSERT
      await db
        .request()
        .input("empId", sql.Int, EmpID)
        .input("workDate", sql.Date, WorkDate)
        .input("checkInTime", sql.Time, timeToDate(CheckInTime))
        .input("checkOutTime", sql.Time, timeToDate(CheckOutTime))
        .input("status", sql.NVarChar(50), finalStatus)
        .input("lateMinutes", sql.Int, lateMinutes)
        .input("earlyLeaveMinutes", sql.Int, earlyLeaveMinutes)
        .input("notes", sql.NVarChar(500), Notes || null)
        .input("scheduledStart", sql.Time, timeToDate(schedStart))
        .input("scheduledEnd", sql.Time, timeToDate(schedEnd))
        .input("createdBy", sql.Int, session.UserID || null)
        .query(`
          INSERT INTO dbo.TblEmpAttendance
            (EmpID, WorkDate, CheckInTime, CheckOutTime, Status, LateMinutes, EarlyLeaveMinutes, Notes, ScheduledStartTime, ScheduledEndTime, CreatedByUserID, CreatedAt)
          VALUES
            (@empId, @workDate, @checkInTime, @checkOutTime, @status, @lateMinutes, @earlyLeaveMinutes, @notes, @scheduledStart, @scheduledEnd, @createdBy, GETDATE())
        `);
    }

    return NextResponse.json({
      success: true,
      message: "تم حفظ الحضور بنجاح",
      data: {
        EmpID,
        WorkDate,
        Status: finalStatus,
        LateMinutes: lateMinutes,
        EarlyLeaveMinutes: earlyLeaveMinutes,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/attendance] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
