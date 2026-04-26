import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// PUT /api/admin/employees/:id/days-off/:dayOffId - Update day off
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayOffId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id, dayOffId } = await params;
    const empId = parseInt(id);
    const dayOffIdNum = parseInt(dayOffId);

    if (isNaN(empId) || isNaN(dayOffIdNum)) {
      return NextResponse.json({ error: "معرف الموظف أو الإجازة غير صحيح" }, { status: 400 });
    }

    const body = await req.json();
    const { OffDate, OffType, Reason, IsPaid } = body;

    // Validation
    if (!OffDate) {
      return NextResponse.json({ error: "تاريخ الإجازة مطلوب" }, { status: 400 });
    }

    const offDate = new Date(OffDate);
    if (isNaN(offDate.getTime())) {
      return NextResponse.json({ error: "تاريخ الإجازة غير صحيح" }, { status: 400 });
    }

    const validTypes = ["day_off", "sick", "emergency", "annual"];
    if (!validTypes.includes(OffType)) {
      return NextResponse.json({ error: "نوع الإجازة غير صحيح" }, { status: 400 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // Check if day off exists and belongs to employee
      const dayOffCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .input("dayOffId", sql.Int, dayOffIdNum)
        .query(`
          SELECT ID, EmpID FROM dbo.TblEmpDayOff 
          WHERE ID = @dayOffId AND EmpID = @empId AND IsDeleted = 0
        `);

      if (dayOffCheck.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "الإجازة غير موجودة" }, { status: 404 });
      }

      // Check for duplicate date (excluding current record)
      const duplicateCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .input("offDate", sql.Date, offDate)
        .input("dayOffId", sql.Int, dayOffIdNum)
        .query(`
          SELECT ID FROM dbo.TblEmpDayOff 
          WHERE EmpID = @empId AND OffDate = @offDate AND ID != @dayOffId AND IsDeleted = 0
        `);

      if (duplicateCheck.recordset.length > 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "يوجد إجازة مسجلة في هذا التاريخ بالفعل" }, { status: 400 });
      }

      // Update day off
      await new sql.Request(transaction)
        .input("dayOffId", sql.Int, dayOffIdNum)
        .input("offDate", sql.Date, offDate)
        .input("offType", sql.NVarChar(30), OffType)
        .input("reason", sql.NVarChar(200), Reason || null)
        .input("isPaid", sql.Bit, IsPaid ? 1 : 0)
        .query(`
          UPDATE dbo.TblEmpDayOff 
          SET OffDate = @offDate,
              OffType = @offType,
              Reason = @reason,
              IsPaid = @isPaid,
              UpdatedAt = GETDATE()
          WHERE ID = @dayOffId
        `);

      await transaction.commit();

      // Get updated day off
      const updatedResult = await db.request()
        .input("dayOffId", sql.Int, dayOffIdNum)
        .query(`
          SELECT 
            ID,
            OffDate,
            OffType,
            Reason,
            IsPaid,
            CreatedAt,
            UpdatedAt
          FROM dbo.TblEmpDayOff 
          WHERE ID = @dayOffId
        `);

      return NextResponse.json({
        success: true,
        message: "تم تحديث الإجازة بنجاح",
        dayOff: updatedResult.recordset[0]
      });

    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/days-off/[dayOffId]] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/employees/:id/days-off/:dayOffId - Delete day off (soft delete)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayOffId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id, dayOffId } = await params;
    const empId = parseInt(id);
    const dayOffIdNum = parseInt(dayOffId);

    if (isNaN(empId) || isNaN(dayOffIdNum)) {
      return NextResponse.json({ error: "معرف الموظف أو الإجازة غير صحيح" }, { status: 400 });
    }

    const db = await getPool();

    // Check if day off exists and belongs to employee
    const dayOffCheck = await db.request()
      .input("empId", sql.Int, empId)
      .input("dayOffId", sql.Int, dayOffIdNum)
      .query(`
        SELECT ID, EmpID FROM dbo.TblEmpDayOff 
        WHERE ID = @dayOffId AND EmpID = @empId AND IsDeleted = 0
      `);

    if (dayOffCheck.recordset.length === 0) {
      return NextResponse.json({ error: "الإجازة غير موجودة" }, { status: 404 });
    }

    // Soft delete the day off
    await db.request()
      .input("dayOffId", sql.Int, dayOffIdNum)
      .query(`
        UPDATE dbo.TblEmpDayOff 
        SET IsDeleted = 1, UpdatedAt = GETDATE()
        WHERE ID = @dayOffId
      `);

    return NextResponse.json({
      success: true,
      message: "تم حذف الإجازة بنجاح"
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/days-off/[dayOffId]] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
