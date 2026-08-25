import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  computeAttendanceSummary,
  filterAttendanceBoardRows,
  type RawAttendanceDbRow,
} from "@/lib/hr/attendance-eligibility";
import {
  ensureAttendanceBreakSchema,
  loadBreaksByAttendanceIds,
} from "@/lib/hr/attendance-breaks-db";
import {
  ensureAttendanceBreakTimeSchema,
  loadBreakTimesByAttendanceIds,
} from "@/lib/hr/attendance-break-time-db";
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from "@/lib/branch";
import {
  isDailyPayrollViewScope,
  resolveDailyPayrollViewScope,
} from "@/lib/payroll/dailyPayrollEmployeeScope";
import {
  empBranchWorkDayCloseErrorResponse,
  isEmpBranchWorkDayCloseError,
} from "@/lib/hr/empBranchWorkDayClose.http";
import {
  saveAdminAttendance,
  AttendanceCommandError,
} from "@/modules/attendance";

async function ensureAttendanceTable(db: { request: () => sql.Request }) {
  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpAttendance')
    BEGIN
        CREATE TABLE dbo.TblEmpAttendance (
            ID INT IDENTITY(1,1) PRIMARY KEY,
            BranchID INT NOT NULL,
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

        ALTER TABLE dbo.TblEmpAttendance
        ADD CONSTRAINT FK_TblEmpAttendance_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch(BranchID);

        CREATE UNIQUE INDEX UQ_TblEmpAttendance_Branch_Emp_WorkDate
        ON dbo.TblEmpAttendance (BranchID, EmpID, WorkDate);

        CREATE INDEX IX_TblEmpAttendance_Branch_WorkDate
        ON dbo.TblEmpAttendance (BranchID, WorkDate);
    END
  `);
  await ensureAttendanceBreakSchema(db);
  await ensureAttendanceBreakTimeSchema(db);
}

// GET /api/admin/attendance?date=YYYY-MM-DD&employeeScope=all|GLEEM|CAMP_CAESAR&onlyPayrollEnabled=true&includeFreelance=false
// employeeScope is read-only visibility — does not switch session branch.
// Omitted employeeScope → active session branch only (legacy callers / smart-fix).
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

    const viewScope = await resolveDailyPayrollViewScope(
      searchParams.get("employeeScope"),
    );
    if (!isDailyPayrollViewScope(viewScope)) return viewScope;

    // Still require an operable active session (mutations stay session-scoped).
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getDay();

    const db = await getPool();
    await ensureAttendanceTable(db);
    const { ensureEmpBranchWorkScheduleTable } = await import(
      '@/lib/hr/empBranchWorkSchedule'
    );
    await ensureEmpBranchWorkScheduleTable();

    const payrollFilter = onlyPayrollEnabled
      ? "AND ISNULL(e.IsPayrollEnabled, 1) = 1"
      : "";

    const allRows: Array<
      ReturnType<typeof filterAttendanceBoardRows>[number] & {
        BranchID: number;
        BranchCode: string;
        BranchName: string;
      }
    > = [];

    for (const vb of viewScope.branches) {
      const result = await db
        .request()
        .input("workDate", sql.Date, dateStr)
        .input("dayOfWeek", sql.TinyInt, dayOfWeek)
        .input("branchId", sql.Int, vb.branchId).query(`
        SELECT
          e.EmpID,
          e.EmpName,
          e.isActive,
          e.EmploymentType,
          e.PayrollMethod,
          e.DayOffPolicy,
          e.IsAttendanceExempt,
          e.IsPayrollEnabled,
          ws.ScheduleDayOfWeek,
          ws.IsWorkingDay,
          ws.ScheduleStartTime,
          ws.ScheduleEndTime,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          a.ID AS AttendanceID,
          a.BranchID AS AttendanceBranchID,
          CONVERT(VARCHAR(5), a.CheckInTime,  108) AS CheckInTime,
          CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
          a.Status,
          a.LateMinutes,
          a.EarlyLeaveMinutes,
          a.Notes,
          ISNULL(a.BreakMinutesTotal, 0) AS BreakMinutesTotal,
          ISNULL(a.BreakTimeMinutesTotal, 0) AS BreakTimeMinutesTotal,
          xferIn.X AS XferIn,
          xferIn.StartTime AS XferInStart,
          xferIn.EndTime AS XferInEnd,
          xferOut.X AS XferOut,
          xferOut.StartTime AS XferOutStart,
          xferOut.EndTime AS XferOutEnd
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = e.EmpID AND a.WorkDate = @workDate AND a.BranchID = @branchId
        OUTER APPLY (
          SELECT TOP 1
            s.DayOfWeek AS ScheduleDayOfWeek,
            CAST(s.IsWorking AS bit) AS IsWorkingDay,
            CONVERT(VARCHAR(5), s.StartTime, 108) AS ScheduleStartTime,
            CONVERT(VARCHAR(5), s.EndTime, 108) AS ScheduleEndTime
          FROM dbo.TblEmpBranchWorkSchedule s
          WHERE s.EmpID = e.EmpID
            AND s.BranchID = @branchId
            AND s.DayOfWeek = @dayOfWeek
            AND s.IsActive = 1
            AND s.EffectiveFrom <= @workDate
            AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @workDate)
          ORDER BY s.EffectiveFrom DESC, s.ScheduleID DESC
        ) ws
        OUTER APPLY (
          SELECT TOP 1
            1 AS X,
            CONVERT(VARCHAR(5), t.StartTime, 108) AS StartTime,
            CONVERT(VARCHAR(5), t.EndTime, 108) AS EndTime
          FROM dbo.TblEmpTemporaryBranchTransfer t
          WHERE t.EmpID = e.EmpID
            AND t.WorkDate = @workDate
            AND t.IsActive = 1
            AND t.ToBranchID = @branchId
        ) xferIn
        OUTER APPLY (
          SELECT TOP 1
            1 AS X,
            CONVERT(VARCHAR(5), t.StartTime, 108) AS StartTime,
            CONVERT(VARCHAR(5), t.EndTime, 108) AS EndTime
          FROM dbo.TblEmpTemporaryBranchTransfer t
          WHERE t.EmpID = e.EmpID
            AND t.WorkDate = @workDate
            AND t.IsActive = 1
            AND t.FromBranchID = @branchId
        ) xferOut
        WHERE ISNULL(e.isActive, 1) = 1
          ${payrollFilter}
          AND (
            (ws.IsWorkingDay = 1 AND EXISTS (
              SELECT 1 FROM dbo.TblEmpBranchAssignment ea
              WHERE ea.EmpID = e.EmpID AND ea.BranchID = @branchId AND ea.IsActive = 1
                AND ea.EffectiveFrom <= @workDate
                AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
            ))
            OR (
              ws.IsWorkingDay = 0
              AND EXISTS (
                SELECT 1 FROM dbo.TblEmpBranchAssignment ea
                WHERE ea.EmpID = e.EmpID AND ea.BranchID = @branchId AND ea.IsActive = 1
                  AND ea.EffectiveFrom <= @workDate
                  AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
              )
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.TblEmpBranchWorkSchedule s2
                WHERE s2.EmpID = e.EmpID
                  AND s2.BranchID <> @branchId
                  AND s2.DayOfWeek = @dayOfWeek
                  AND s2.IsActive = 1
                  AND s2.IsWorking = 1
                  AND s2.EffectiveFrom <= @workDate
                  AND (s2.EffectiveTo IS NULL OR s2.EffectiveTo >= @workDate)
              )
            )
            OR a.ID IS NOT NULL
            OR xferIn.X IS NOT NULL
          )
        ORDER BY e.EmpName
      `);

      const rawRows = result.recordset as RawAttendanceDbRow[];
      const attendanceIds = rawRows
        .map((r) => r.AttendanceID)
        .filter((id): id is number => id != null && id > 0);
      const breaksMap = await loadBreaksByAttendanceIds(db, attendanceIds);
      const breakTimesMap = await loadBreakTimesByAttendanceIds(db, attendanceIds);
      for (const row of rawRows) {
        if (row.AttendanceID != null) {
          row.Breaks = breaksMap.get(row.AttendanceID) ?? [];
          row.BreakTimes = breakTimesMap.get(row.AttendanceID) ?? [];
        }
      }

      const rows = filterAttendanceBoardRows(rawRows, dateStr, dayOfWeek, {
        includeFreelance,
      }).map((r) => ({
        ...r,
        BranchID: vb.branchId,
        BranchCode: vb.branchCode,
        BranchName: vb.branchName,
      }));
      allRows.push(...rows);
    }

    allRows.sort((a, b) => {
      const bc = String(a.BranchCode).localeCompare(String(b.BranchCode));
      if (bc !== 0) return bc;
      return String(a.EmpName).localeCompare(String(b.EmpName), "ar");
    });

    const summary = computeAttendanceSummary(allRows);

    return NextResponse.json({
      success: true,
      date: dateStr,
      employeeScope: viewScope.employeeScope,
      branchIds: viewScope.branchIds,
      branches: viewScope.branches,
      branchId: sessionBranch.branchId,
      branchCode: sessionBranch.branchCode,
      attendance: allRows,
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

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    if (body.BranchID != null || body.branchId != null) {
      return NextResponse.json(
        { error: "BranchID في الطلب غير مسموح" },
        { status: 400 },
      );
    }
    const { EmpID, WorkDate, CheckInTime, CheckOutTime, Status, Notes, Breaks, BreakTimes } = body;

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

    const data = await saveAdminAttendance({
      branchId: branch.branchId,
      userId: session.UserID || null,
      empId: EmpID,
      workDate: WorkDate,
      checkInTime: CheckInTime,
      checkOutTime: CheckOutTime,
      status: Status,
      notes: Notes,
      breaks: Breaks,
      breakTimes: BreakTimes,
    });

    return NextResponse.json({
      success: true,
      message: "تم حفظ الحضور بنجاح",
      data,
    });
  } catch (err: unknown) {
    if (isEmpBranchWorkDayCloseError(err)) {
      return empBranchWorkDayCloseErrorResponse(err);
    }
    if (err instanceof AttendanceCommandError) {
      return NextResponse.json(
        err.code !== undefined
          ? { error: err.message, code: err.code }
          : { error: err.message },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/attendance] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
