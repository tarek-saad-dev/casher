import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { calcLateMinutes as calcLate } from '@/lib/timeUtils';
import type { TeamAttendanceMember } from '@/lib/teamAttendance';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';

async function ensureAttendanceTable(db: {
  request: () => { query: (q: string) => Promise<unknown> };
}) {
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
}

// GET /api/pos/team-attendance?date=YYYY-MM-DD
// Active session branch only — same roster rules as admin attendance board
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: 'التاريخ مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getDay();
    const db = await getPool();
    await ensureAttendanceTable(db);
    const { ensureEmpBranchWorkScheduleTable } = await import(
      '@/lib/hr/empBranchWorkSchedule'
    );
    await ensureEmpBranchWorkScheduleTable();

    const result = await db
      .request()
      .input('workDate', sql.Date, dateStr)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT
          e.EmpID,
          e.EmpName,
          e.Job,
          ws.ScheduleDayOfWeek AS DayOfWeek,
          ws.IsWorkingDay,
          CONVERT(VARCHAR(5), COALESCE(ws.ScheduleStartTime, e.DefaultCheckInTime),  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), COALESCE(ws.ScheduleEndTime, e.DefaultCheckOutTime), 108) AS DefaultCheckOutTime,
          a.ID AS AttendanceID,
          CONVERT(VARCHAR(5), a.CheckInTime,  108) AS CheckInTime,
          CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
          a.Status,
          a.LateMinutes,
          a.Notes
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = e.EmpID AND a.WorkDate = @workDate AND a.BranchID = @branchId
        OUTER APPLY (
          SELECT TOP 1
            s.DayOfWeek AS ScheduleDayOfWeek,
            CAST(s.IsWorking AS bit) AS IsWorkingDay,
            s.StartTime AS ScheduleStartTime,
            s.EndTime AS ScheduleEndTime
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
          SELECT TOP 1 1 AS X
          FROM dbo.TblEmpTemporaryBranchTransfer t
          WHERE t.EmpID = e.EmpID
            AND t.WorkDate = @workDate
            AND t.IsActive = 1
            AND t.ToBranchID = @branchId
        ) xferIn
        WHERE ISNULL(e.isActive, 1) = 1
          AND ISNULL(e.IsPayrollEnabled, 1) = 1
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

    const team: TeamAttendanceMember[] = result.recordset.map(
      (row: {
        EmpID: number;
        EmpName: string;
        Job: string | null;
        DayOfWeek: number | null;
        IsWorkingDay: boolean | null;
        DefaultCheckInTime: string | null;
        DefaultCheckOutTime: string | null;
        AttendanceID: number | null;
        CheckInTime: string | null;
        CheckOutTime: string | null;
        Status: string | null;
        LateMinutes: number | null;
        Notes: string | null;
      }) => {
        const hasAttendance = row.AttendanceID != null;
        const isWorkingDay = !!row.IsWorkingDay;
        const schedStart = row.DefaultCheckInTime || null;
        const checkIn = row.CheckInTime || null;
        const checkOut = row.CheckOutTime || null;
        const lateMin =
          hasAttendance && checkIn ? calcLate(checkIn, schedStart) : 0;

        let status: string;
        if (hasAttendance) {
          status = row.Status || 'Pending';
        } else if (isWorkingDay) {
          status = 'Pending';
        } else {
          status = 'DayOff';
        }

        return {
          employeeId: row.EmpID,
          employeeName: row.EmpName,
          jobTitle: row.Job || null,
          scheduledStartTime: schedStart,
          scheduledEndTime: row.DefaultCheckOutTime || null,
          attendanceStatus: status,
          checkInTime: checkIn,
          checkOutTime: checkOut,
          isCheckedIn: !!checkIn,
          isCheckedOut: !!checkOut,
          lateMinutes: lateMin,
          notes: row.Notes || '',
        };
      },
    );

    return NextResponse.json({
      success: true,
      date: dateStr,
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      team,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/team-attendance] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
