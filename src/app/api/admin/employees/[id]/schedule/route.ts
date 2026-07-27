import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

async function ensureScheduleTable(db: Awaited<ReturnType<typeof getPool>>) {
  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpWorkSchedule')
    BEGIN
        CREATE TABLE dbo.TblEmpWorkSchedule (
            ID INT IDENTITY(1,1) PRIMARY KEY,
            EmpID INT NOT NULL,
            DayOfWeek TINYINT NOT NULL,
            IsWorkingDay BIT NOT NULL DEFAULT 1,
            StartTime TIME NULL,
            EndTime TIME NULL,
            BreakStartTime TIME NULL,
            BreakEndTime TIME NULL,
            Notes NVARCHAR(200) NULL,
            CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
            UpdatedAt DATETIME NULL,
            CONSTRAINT CK_TblEmpWorkSchedule_DayOfWeek CHECK (DayOfWeek BETWEEN 0 AND 6)
        );
        
        ALTER TABLE dbo.TblEmpWorkSchedule 
        ADD CONSTRAINT FK_TblEmpWorkSchedule_TblEmp 
        FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
        
        CREATE UNIQUE INDEX UQ_TblEmpWorkSchedule_Emp_Day 
        ON dbo.TblEmpWorkSchedule (EmpID, DayOfWeek);
        
        CREATE INDEX IX_TblEmpWorkSchedule_EmpID 
        ON dbo.TblEmpWorkSchedule (EmpID);
    END
  `);
}

function formatScheduleRow(row: {
  DayOfWeek: number;
  IsWorkingDay: boolean | number;
  StartTime: unknown;
  EndTime: unknown;
  BreakStartTime: unknown;
  BreakEndTime: unknown;
  Notes: string | null;
}) {
  const fmt = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v.substring(0, 5);
    if (v instanceof Date) {
      return `${String(v.getUTCHours()).padStart(2,'0')}:${String(v.getUTCMinutes()).padStart(2,'0')}`;
    }
    return null;
  };
  return {
    ...row,
    StartTime: fmt(row.StartTime),
    EndTime: fmt(row.EndTime),
    BreakStartTime: fmt(row.BreakStartTime),
    BreakEndTime: fmt(row.BreakEndTime),
  };
}

// GET /api/admin/employees/:id/schedule - Read-only legacy compatibility view
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id, 10);
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const db = await getPool();
    await ensureScheduleTable(db);

    const empCheck = await db.request()
      .input("empId", sql.Int, empId)
      .query("SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId");

    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    const scheduleResult = await db.request()
      .input("empId", sql.Int, empId)
      .query(`
        SELECT 
          DayOfWeek,
          IsWorkingDay,
          StartTime,
          EndTime,
          BreakStartTime,
          BreakEndTime,
          Notes
        FROM dbo.TblEmpWorkSchedule 
        WHERE EmpID = @empId
        ORDER BY DayOfWeek
      `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedule: any[] = [...scheduleResult.recordset];

    if (schedule.length < 7) {
      const existingDays = new Set(schedule.map((s) => s.DayOfWeek));
      for (let day = 0; day <= 6; day++) {
        if (!existingDays.has(day)) {
          schedule.push({
            DayOfWeek: day,
            IsWorkingDay: 0,
            StartTime: null,
            EndTime: null,
            BreakStartTime: null,
            BreakEndTime: null,
            Notes: null,
          });
        }
      }
      schedule.sort((a, b) => a.DayOfWeek - b.DayOfWeek);
    }

    return NextResponse.json({
      success: true,
      readOnly: true,
      sourceOfTruth: 'TblEmpBranchWorkSchedule',
      schedule: schedule.map(formatScheduleRow),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/schedule] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Phase 1S — legacy operational write lock.
 * Ordinary application routes must not INSERT/UPDATE/DELETE TblEmpWorkSchedule.
 * Use /api/admin/employees/[id]/branch-schedule instead.
 */
export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const { id } = await params;
  const empId = parseInt(id, 10);

  return NextResponse.json(
    {
      error:
        "تم قفل الكتابة على الجدول التشغيلي القديميم. استخدم مواعيد الفروع (TblEmpBranchWorkSchedule).",
      code: "LEGACY_EMP_WORK_SCHEDULE_WRITE_LOCKED",
      empId: Number.isFinite(empId) ? empId : null,
      redirectTo: Number.isFinite(empId)
        ? `/admin/hr/employees/${empId}/branch-schedule`
        : "/admin/hr",
    },
    { status: 409 },
  );
}
