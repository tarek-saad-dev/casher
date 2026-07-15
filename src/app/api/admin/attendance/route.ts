import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  calcLateMinutes as calcLate,
  calcEarlyLeaveMinutes as calcEarlyLeave,
} from "@/lib/timeUtils";
import {
  computeAttendanceSummary,
  filterAttendanceBoardRows,
  resolveScheduleForDay,
  type RawAttendanceDbRow,
} from "@/lib/hr/attendance-eligibility";
import { normalizeEmploymentType } from "@/lib/hr/employee-hr-model";
import {
  ensureAttendanceBreakSchema,
  loadBreaksByAttendanceIds,
  replaceAttendanceBreaks,
} from "@/lib/hr/attendance-breaks-db";
import { normalizeBreaksInput } from "@/lib/hr/attendance-breaks";
import { syncBlockRangesFromBreaks } from "@/lib/hr/attendance-break-schedule-sync";

async function ensureAttendanceTable(db: { request: () => any }) {
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
  await ensureAttendanceBreakSchema(db);
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

function calcLateMinutes(
  checkIn: string | null,
  scheduledStart: string | null,
): number {
  return calcLate(checkIn, scheduledStart);
}

function calcEarlyLeaveMinutes(
  checkOut: string | null,
  scheduledEnd: string | null,
): number {
  return calcEarlyLeave(checkOut, scheduledEnd);
}

// GET /api/admin/attendance?date=YYYY-MM-DD&onlyPayrollEnabled=true&includeFreelance=false
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    const onlyPayrollEnabled = searchParams.get("onlyPayrollEnabled") === "true";
    const includeFreelance = searchParams.get("includeFreelance") === "true";
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: "التاريخ مطلوب بصيغة YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getDay();

    const db = await getPool();
    await ensureAttendanceTable(db);

    const result = await db
      .request()
      .input("workDate", sql.Date, dateStr)
      .input("dayOfWeek", sql.TinyInt, dayOfWeek).query(`
        SELECT
          e.EmpID,
          e.EmpName,
          e.isActive,
          e.EmploymentType,
          e.PayrollMethod,
          e.DayOffPolicy,
          e.IsAttendanceExempt,
          e.IsPayrollEnabled,
          ws.DayOfWeek AS ScheduleDayOfWeek,
          ws.IsWorkingDay,
          CONVERT(VARCHAR(5), ws.StartTime, 108) AS ScheduleStartTime,
          CONVERT(VARCHAR(5), ws.EndTime, 108) AS ScheduleEndTime,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          a.ID AS AttendanceID,
          CONVERT(VARCHAR(5), a.CheckInTime,  108) AS CheckInTime,
          CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
          a.Status,
          a.LateMinutes,
          a.EarlyLeaveMinutes,
          a.Notes,
          ISNULL(a.BreakMinutesTotal, 0) AS BreakMinutesTotal
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpWorkSchedule ws
          ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = e.EmpID AND a.WorkDate = @workDate
        WHERE ISNULL(e.isActive, 1) = 1
          ${onlyPayrollEnabled ? "AND ISNULL(e.IsPayrollEnabled, 1) = 1" : ""}
        ORDER BY e.EmpName
      `);

    const rawRows = result.recordset as RawAttendanceDbRow[];
    const attendanceIds = rawRows
      .map((r) => r.AttendanceID)
      .filter((id): id is number => id != null && id > 0);
    const breaksMap = await loadBreaksByAttendanceIds(db, attendanceIds);
    for (const row of rawRows) {
      if (row.AttendanceID != null) {
        row.Breaks = breaksMap.get(row.AttendanceID) ?? [];
      }
    }

    const rows = filterAttendanceBoardRows(
      rawRows,
      dateStr,
      dayOfWeek,
      { includeFreelance },
    );

    const summary = computeAttendanceSummary(rows);

    return NextResponse.json({
      success: true,
      date: dateStr,
      attendance: rows,
      summary,
    });
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
    const { EmpID, WorkDate, CheckInTime, CheckOutTime, Status, Notes, Breaks } = body;

    if (!EmpID || !WorkDate) {
      return NextResponse.json(
        { error: "EmpID و WorkDate مطلوبين" },
        { status: 400 },
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(WorkDate)) {
      return NextResponse.json(
        { error: "صيغة التاريخ غير صحيحة" },
        { status: 400 },
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
      return NextResponse.json({ error: "حالة غير صحيحة" }, { status: 400 });
    }

    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (CheckInTime && !timeRegex.test(CheckInTime)) {
      return NextResponse.json(
        { error: "صيغة وقت الحضور غير صحيحة" },
        { status: 400 },
      );
    }
    if (CheckOutTime && !timeRegex.test(CheckOutTime)) {
      return NextResponse.json(
        { error: "صيغة وقت الانصراف غير صحيحة" },
        { status: 400 },
      );
    }

    const clearBreaks =
      Status === "Absent" || Status === "DayOff" || (!CheckInTime && !CheckOutTime);
    let parsedBreaks = { breaks: [] as ReturnType<typeof normalizeBreaksInput>["breaks"], breakMinutesTotal: 0, error: null as string | null };
    if (Breaks !== undefined || clearBreaks) {
      parsedBreaks = clearBreaks
        ? { breaks: [], breakMinutesTotal: 0, error: null }
        : normalizeBreaksInput(Breaks);
      if (parsedBreaks.error) {
        return NextResponse.json({ error: parsedBreaks.error }, { status: 400 });
      }
    }

    const db = await getPool();
    await ensureAttendanceTable(db);

    const dayOfWeek = new Date(`${WorkDate}T12:00:00Z`).getDay();

    const empResult = await db
      .request()
      .input("empId", sql.Int, EmpID)
      .input("dayOfWeek", sql.TinyInt, dayOfWeek)
      .query(`
        SELECT
          e.EmploymentType,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          ws.DayOfWeek AS ScheduleDayOfWeek,
          ws.IsWorkingDay,
          CONVERT(VARCHAR(5), ws.StartTime, 108) AS ScheduleStartTime,
          CONVERT(VARCHAR(5), ws.EndTime, 108) AS ScheduleEndTime
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpWorkSchedule ws
          ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
        WHERE e.EmpID = @empId
      `);

    let schedStart: string | null = null;
    let schedEnd: string | null = null;
    if (empResult.recordset.length > 0) {
      const emp = empResult.recordset[0];
      const employmentType = normalizeEmploymentType(emp.EmploymentType) ?? "full_time";
      const schedule = resolveScheduleForDay(employmentType, {
        hasScheduleRow: emp.ScheduleDayOfWeek != null,
        isWorkingDayFromSchedule:
          emp.ScheduleDayOfWeek != null ? !!emp.IsWorkingDay : null,
        scheduleStart: emp.ScheduleStartTime || null,
        scheduleEnd: emp.ScheduleEndTime || null,
        defaultStart: emp.DefaultCheckInTime || null,
        defaultEnd: emp.DefaultCheckOutTime || null,
      });
      schedStart = schedule.scheduledStart;
      schedEnd = schedule.scheduledEnd;
    }

    // Calculate late/early
    const lateMinutes = calcLateMinutes(CheckInTime || null, schedStart);
    const earlyLeaveMinutes = calcEarlyLeaveMinutes(
      CheckOutTime || null,
      schedEnd,
    );

    // Auto-determine status if not manually overridden to Absent/DayOff/Excused
    let finalStatus = Status || "Pending";
    const manualStatuses = ["Absent", "DayOff", "Excused"];
    if (!manualStatuses.includes(finalStatus)) {
      if (CheckInTime) {
        finalStatus = lateMinutes > 0 ? "Late" : "Present";
      }
      if (CheckOutTime && earlyLeaveMinutes > 0 && finalStatus === "Present") {
        finalStatus = "EarlyLeave";
      }
    }

    // UPSERT
    const existing = await db
      .request()
      .input("empId", sql.Int, EmpID)
      .input("workDate", sql.Date, WorkDate)
      .query(
        "SELECT ID FROM dbo.TblEmpAttendance WHERE EmpID = @empId AND WorkDate = @workDate",
      );

    let attendanceId: number;
    if (existing.recordset.length > 0) {
      attendanceId = existing.recordset[0].ID as number;
      await db
        .request()
        .input("id", sql.Int, attendanceId)
        .input("checkInTime", sql.Time, timeToDate(CheckInTime))
        .input("checkOutTime", sql.Time, timeToDate(CheckOutTime))
        .input("status", sql.NVarChar(50), finalStatus)
        .input("lateMinutes", sql.Int, lateMinutes)
        .input("earlyLeaveMinutes", sql.Int, earlyLeaveMinutes)
        .input("notes", sql.NVarChar(500), Notes || null)
        .input("scheduledStart", sql.Time, timeToDate(schedStart))
        .input("scheduledEnd", sql.Time, timeToDate(schedEnd))
        .input("updatedBy", sql.Int, session.UserID || null).query(`
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
      const insertResult = await db
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
        .input("createdBy", sql.Int, session.UserID || null).query(`
          INSERT INTO dbo.TblEmpAttendance
            (EmpID, WorkDate, CheckInTime, CheckOutTime, Status, LateMinutes, EarlyLeaveMinutes, Notes, ScheduledStartTime, ScheduledEndTime, CreatedByUserID, CreatedAt)
          OUTPUT INSERTED.ID
          VALUES
            (@empId, @workDate, @checkInTime, @checkOutTime, @status, @lateMinutes, @earlyLeaveMinutes, @notes, @scheduledStart, @scheduledEnd, @createdBy, GETDATE())
        `);
      attendanceId = insertResult.recordset[0].ID as number;
    }

    let breakMinutesTotal: number | undefined;
    if (Breaks !== undefined || clearBreaks) {
      breakMinutesTotal = await replaceAttendanceBreaks(
        db,
        attendanceId,
        parsedBreaks.breaks,
      );
      // Mirror وقت مستقطع → إدارة مواعيد اليوم (block_range)
      await syncBlockRangesFromBreaks(
        db,
        EmpID,
        WorkDate,
        parsedBreaks.breaks,
      ).catch((err) => {
        console.warn("[api/admin/attendance] block_range sync failed", err);
      });
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
        BreakMinutesTotal: breakMinutesTotal,
        Breaks: Breaks !== undefined || clearBreaks ? parsedBreaks.breaks : undefined,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/attendance] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
