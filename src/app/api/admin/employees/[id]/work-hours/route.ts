import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const empId = parseInt(id);
    
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const body = await req.json();
    const {
      DefaultCheckInTime,
      DefaultCheckOutTime,
      WorkScheduleNotes
    } = body;

    // Validation
    if (DefaultCheckInTime !== undefined && DefaultCheckInTime !== null) {
      if (typeof DefaultCheckInTime !== 'string') {
        return NextResponse.json({ error: "وقت البدء يجب أن يكون نصاً" }, { status: 400 });
      }
      // Validate time format HH:mm or HH:mm:ss
      const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
      if (!timeRegex.test(DefaultCheckInTime)) {
        return NextResponse.json({ error: "صيغة وقت البدء غير صحيحة، يجب أن تكون HH:mm أو HH:mm:ss" }, { status: 400 });
      }
    }

    if (DefaultCheckOutTime !== undefined && DefaultCheckOutTime !== null) {
      if (typeof DefaultCheckOutTime !== 'string') {
        return NextResponse.json({ error: "وقت الانتهاء يجب أن يكون نصاً" }, { status: 400 });
      }
      // Validate time format HH:mm or HH:mm:ss
      const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
      if (!timeRegex.test(DefaultCheckOutTime)) {
        return NextResponse.json({ error: "صيغة وقت الانتهاء غير صحيحة، يجب أن تكون HH:mm أو HH:mm:ss" }, { status: 400 });
      }
    }

    if (WorkScheduleNotes !== undefined && WorkScheduleNotes !== null) {
      if (typeof WorkScheduleNotes !== 'string') {
        return NextResponse.json({ error: "الملاحظات يجب أن تكون نصاً" }, { status: 400 });
      }
      if (WorkScheduleNotes.length > 250) {
        return NextResponse.json({ error: "الملاحظات يجب ألا تزيد عن 250 حرف" }, { status: 400 });
      }
    }

    // Validate that if one time is provided, the other should also be provided
    if ((DefaultCheckInTime && !DefaultCheckOutTime) || (!DefaultCheckInTime && DefaultCheckOutTime)) {
      return NextResponse.json({ error: "يجب تحديد وقت البدء والانتهاء معاً" }, { status: 400 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // Check if employee exists
      const empCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .query("SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId");

      if (empCheck.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      const employee = empCheck.recordset[0];

      // Check if columns exist before updating
      const columnsCheck = await new sql.Request(transaction).query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'TblEmp' 
          AND COLUMN_NAME IN ('DefaultCheckInTime', 'DefaultCheckOutTime', 'WorkScheduleNotes')
      `);
      
      const existingColumns = columnsCheck.recordset.map(r => r.COLUMN_NAME);

      // Build update query dynamically based on existing columns
      const updateFields = [];
      const request = new sql.Request(transaction);

      if (DefaultCheckInTime !== undefined && existingColumns.includes('DefaultCheckInTime')) {
        if (DefaultCheckInTime && DefaultCheckInTime.trim() !== '') {
          updateFields.push("DefaultCheckInTime = @defaultCheckInTime");
          request.input("defaultCheckInTime", sql.Time, DefaultCheckInTime);
        } else {
          updateFields.push("DefaultCheckInTime = NULL");
        }
      }

      if (DefaultCheckOutTime !== undefined && existingColumns.includes('DefaultCheckOutTime')) {
        if (DefaultCheckOutTime && DefaultCheckOutTime.trim() !== '') {
          updateFields.push("DefaultCheckOutTime = @defaultCheckOutTime");
          request.input("defaultCheckOutTime", sql.Time, DefaultCheckOutTime);
        } else {
          updateFields.push("DefaultCheckOutTime = NULL");
        }
      }

      if (WorkScheduleNotes !== undefined && existingColumns.includes('WorkScheduleNotes')) {
        updateFields.push("WorkScheduleNotes = @workScheduleNotes");
        request.input("workScheduleNotes", sql.NVarChar(250), WorkScheduleNotes || null);
      }

      if (updateFields.length > 0) {
        updateFields.push("ModifiedDate = GETDATE()");
        
        const updateQuery = `
          UPDATE dbo.TblEmp 
          SET ${updateFields.join(", ")}
          WHERE EmpID = @empId
        `;
        
        request.input("empId", sql.Int, empId);
        await request.query(updateQuery);
      }

      await transaction.commit();

      // Get updated employee data
      const updatedResult = await db.request()
        .input("empId", sql.Int, empId)
        .query(`
          SELECT 
            EmpID, EmpName,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'DefaultCheckInTime') 
              THEN CONVERT(VARCHAR(8), DefaultCheckInTime, 108) ELSE NULL 
            END AS DefaultCheckInTime,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'DefaultCheckOutTime') 
              THEN CONVERT(VARCHAR(8), DefaultCheckOutTime, 108) ELSE NULL 
            END AS DefaultCheckOutTime,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WorkScheduleNotes') 
              THEN WorkScheduleNotes ELSE NULL 
            END AS WorkScheduleNotes
          FROM dbo.TblEmp 
          WHERE EmpID = @empId
        `);

      const updatedEmployee = updatedResult.recordset[0];

      return NextResponse.json({
        success: true,
        message: "تم حفظ مواعيد العمل بنجاح",
        employee: updatedEmployee
      });

    } catch (error) {
      await transaction.rollback();
      console.error('Error updating work hours:', error);
      return NextResponse.json({ error: "فشل تحديث مواعيد العمل" }, { status: 500 });
    }

  } catch (error) {
    console.error('Work hours API error:', error);
    return NextResponse.json({ error: "خطأ في الخادم" }, { status: 500 });
  }
}
