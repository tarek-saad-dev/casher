import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/admin/employees/:id/days-off - Get employee days off
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

    // Get query parameters
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    // Default to last 90 days if no dates provided
    const defaultFromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const defaultToDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const db = await getPool();

    // Check if employee exists
    const empCheck = await db.request()
      .input("empId", sql.Int, empId)
      .query("SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId");

    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    // Get days off
    const request = db.request()
      .input("empId", sql.Int, empId)
      .input("fromDate", sql.Date, fromDate || defaultFromDate)
      .input("toDate", sql.Date, toDate || defaultToDate);

    let query = `
      SELECT 
        ID,
        OffDate,
        OffType,
        Reason,
        IsPaid,
        CreatedAt,
        UpdatedAt
      FROM dbo.TblEmpDayOff 
      WHERE EmpID = @empId 
        AND IsDeleted = 0
        AND OffDate BETWEEN @fromDate AND @toDate
      ORDER BY OffDate DESC
    `;

    const result = await request.query(query);

    return NextResponse.json({
      success: true,
      daysOff: result.recordset,
      employee: empCheck.recordset[0]
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/days-off] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/employees/:id/days-off - Add day off
export async function POST(
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
    const { OffDate, OffType = "day_off", Reason, IsPaid = false } = body;

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
      // Check if employee exists
      const empCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .query("SELECT EmpID FROM dbo.TblEmp WHERE EmpID = @empId");

      if (empCheck.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      // Check if day off already exists (soft deleted check)
      const existingCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .input("offDate", sql.Date, offDate)
        .query(`
          SELECT ID, IsDeleted FROM dbo.TblEmpDayOff 
          WHERE EmpID = @empId AND OffDate = @offDate
        `);

      if (existingCheck.recordset.length > 0) {
        const existing = existingCheck.recordset[0];
        
        if (existing.IsDeleted === 0) {
          await transaction.rollback();
          return NextResponse.json({ error: "يوجد إجازة مسجلة في هذا التاريخ بالفعل" }, { status: 400 });
        } else {
          // Reactivate soft deleted record
          await new sql.Request(transaction)
            .input("empId", sql.Int, empId)
            .input("offDate", sql.Date, offDate)
            .input("offType", sql.NVarChar(30), OffType)
            .input("reason", sql.NVarChar(200), Reason || null)
            .input("isPaid", sql.Bit, IsPaid ? 1 : 0)
            .input("dayOffId", sql.Int, existing.ID)
            .query(`
              UPDATE dbo.TblEmpDayOff 
              SET OffType = @offType,
                  Reason = @reason,
                  IsPaid = @isPaid,
                  IsDeleted = 0,
                  UpdatedAt = GETDATE()
              WHERE ID = @dayOffId
            `);

          await transaction.commit();

          return NextResponse.json({
            success: true,
            message: "تم إعادة تفعيل الإجازة بنجاح",
            dayOffId: existing.ID
          });
        }
      }

      // Insert new day off
      const insertResult = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .input("offDate", sql.Date, offDate)
        .input("offType", sql.NVarChar(30), OffType)
        .input("reason", sql.NVarChar(200), Reason || null)
        .input("isPaid", sql.Bit, IsPaid ? 1 : 0)
        .query(`
          INSERT INTO dbo.TblEmpDayOff 
            (EmpID, OffDate, OffType, Reason, IsPaid, IsDeleted, CreatedAt)
          OUTPUT INSERTED.ID
          VALUES
            (@empId, @offDate, @offType, @reason, @isPaid, 0, GETDATE())
        `);

      await transaction.commit();

      return NextResponse.json({
        success: true,
        message: "تم إضافة الإجازة بنجاح",
        dayOffId: insertResult.recordset[0].ID
      });

    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/days-off] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
