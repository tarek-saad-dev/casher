import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/admin/employees/:id/schedule - Get employee work schedule
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id);
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const db = await getPool();

    // Check if employee exists
    const empCheck = await db.request()
      .input("empId", sql.Int, empId)
      .query("SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId");

    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    // Get existing schedule
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

    let schedule = scheduleResult.recordset;

    // Backfill missing days (should always return 7 days)
    if (schedule.length < 7) {
      const existingDays = schedule.map(s => s.DayOfWeek);
      const missingDays = [];

      for (let day = 0; day <= 6; day++) {
        if (!existingDays.includes(day)) {
          missingDays.push(day);
        }
      }

      if (missingDays.length > 0) {
        const transaction = new sql.Transaction(db);
        await transaction.begin();

        try {
          // Get employee default times
          const empResult = await new sql.Request(transaction)
            .input("empId", sql.Int, empId)
            .query(`
              SELECT DefaultCheckInTime, DefaultCheckOutTime 
              FROM dbo.TblEmp 
              WHERE EmpID = @empId
            `);

          const emp = empResult.recordset[0];
          const defaultStart = emp.DefaultCheckInTime || '12:00';
          const defaultEnd = emp.DefaultCheckOutTime || '02:00';

          // Insert missing days
          for (const day of missingDays) {
            const isWorkingDay = day !== 5; // Friday is day off
            const notes = day === 5 ? 'جمعة - إجازة أسبوعية' : 'يوم عمل عادي';

            await new sql.Request(transaction)
              .input("empId", sql.Int, empId)
              .input("dayOfWeek", sql.TinyInt, day)
              .input("isWorkingDay", sql.Bit, isWorkingDay ? 1 : 0)
              .input("startTime", sql.Time, isWorkingDay ? defaultStart : null)
              .input("endTime", sql.Time, isWorkingDay ? defaultEnd : null)
              .input("notes", sql.NVarChar(200), notes)
              .query(`
                INSERT INTO dbo.TblEmpWorkSchedule 
                  (EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime, Notes, CreatedAt)
                VALUES
                  (@empId, @dayOfWeek, @isWorkingDay, @startTime, @endTime, @notes, GETDATE())
              `);
          }

          await transaction.commit();

          // Get complete schedule again
          const completeResult = await db.request()
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

          schedule = completeResult.recordset;

        } catch (innerErr) {
          await transaction.rollback();
          throw innerErr;
        }
      }
    }

    return NextResponse.json({
      success: true,
      schedule
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/schedule] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/admin/employees/:id/schedule - Update employee work schedule
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id);
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const body = await req.json();
    const { schedule } = body;

    // Validation
    if (!Array.isArray(schedule)) {
      return NextResponse.json({ error: "جدول المواعيد يجب أن يكون مصفوفة" }, { status: 400 });
    }

    if (schedule.length !== 7) {
      return NextResponse.json({ error: "يجب أن يحتوي الجدول على 7 أيام" }, { status: 400 });
    }

    // Validate each day
    for (const day of schedule) {
      if (typeof day.DayOfWeek !== 'number' || day.DayOfWeek < 0 || day.DayOfWeek > 6) {
        return NextResponse.json({ error: "DayOfWeek يجب أن يكون بين 0 و 6" }, { status: 400 });
      }

      if (day.IsWorkingDay && (!day.StartTime || !day.EndTime)) {
        return NextResponse.json({ error: "أيام العمل يجب أن تحتوي على وقت البدء والانتهاء" }, { status: 400 });
      }

      // Validate time format (HH:mm or HH:mm:ss)
      if (day.StartTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(day.StartTime)) {
        return NextResponse.json({ error: "صيغة وقت البدء غير صحيحة" }, { status: 400 });
      }

      if (day.EndTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(day.EndTime)) {
        return NextResponse.json({ error: "صيغة وقت الانتهاء غير صحيحة" }, { status: 400 });
      }
    }

    // Check for duplicate days
    const dayNumbers = schedule.map(d => d.DayOfWeek);
    const uniqueDays = [...new Set(dayNumbers)];
    if (uniqueDays.length !== 7) {
      return NextResponse.json({ error: "يوجد أيام مكررة في الجدول" }, { status: 400 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // Check if employee exists
      const empCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .query("SELECT EmpID FROM dbo.TblEmp WHERE EmpID = @empId");

      if (empCheck.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      // Update each day (UPSERT)
      for (const day of schedule) {
        const request = new sql.Request(transaction);
        
        // Check if day exists
        const existingDay = await request
          .input("empId", sql.Int, empId)
          .input("dayOfWeek", sql.TinyInt, day.DayOfWeek)
          .query(`
            SELECT ID FROM dbo.TblEmpWorkSchedule 
            WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
          `);

        if (existingDay.recordset.length > 0) {
          // Update existing
          await request
            .input("isWorkingDay", sql.Bit, day.IsWorkingDay ? 1 : 0)
            .input("startTime", sql.Time, day.IsWorkingDay ? day.StartTime : null)
            .input("endTime", sql.Time, day.IsWorkingDay ? day.EndTime : null)
            .input("breakStartTime", sql.Time, day.BreakStartTime || null)
            .input("breakEndTime", sql.Time, day.BreakEndTime || null)
            .input("notes", sql.NVarChar(200), day.Notes || null)
            .input("scheduleId", sql.Int, existingDay.recordset[0].ID)
            .query(`
              UPDATE dbo.TblEmpWorkSchedule 
              SET IsWorkingDay = @isWorkingDay,
                  StartTime = @startTime,
                  EndTime = @endTime,
                  BreakStartTime = @breakStartTime,
                  BreakEndTime = @breakEndTime,
                  Notes = @notes,
                  UpdatedAt = GETDATE()
              WHERE ID = @scheduleId
            `);
        } else {
          // Insert new
          await request
            .input("isWorkingDay", sql.Bit, day.IsWorkingDay ? 1 : 0)
            .input("startTime", sql.Time, day.IsWorkingDay ? day.StartTime : null)
            .input("endTime", sql.Time, day.IsWorkingDay ? day.EndTime : null)
            .input("breakStartTime", sql.Time, day.BreakStartTime || null)
            .input("breakEndTime", sql.Time, day.BreakEndTime || null)
            .input("notes", sql.NVarChar(200), day.Notes || null)
            .query(`
              INSERT INTO dbo.TblEmpWorkSchedule 
                (EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime, BreakStartTime, BreakEndTime, Notes, CreatedAt)
              VALUES
                (@empId, @dayOfWeek, @isWorkingDay, @startTime, @endTime, @breakStartTime, @breakEndTime, @notes, GETDATE())
            `);
        }
      }

      await transaction.commit();

      // Get updated schedule
      const updatedResult = await db.request()
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

      return NextResponse.json({
        success: true,
        message: "تم تحديث جدول المواعيد بنجاح",
        schedule: updatedResult.recordset
      });

    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/schedule] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
