import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// PATCH /api/admin/employees/:id/finance-map
// Body: { advanceExpINID?, revenueExpINID? }
export async function PATCH(
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
      return NextResponse.json({ error: "معرف الموظف غير صالح" }, { status: 400 });
    }

    const body = await req.json();
    const { advanceExpINID, revenueExpINID } = body;

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // Verify employee exists
      const empCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .query(`
          SELECT EmpID, EmpName, isActive 
          FROM dbo.TblEmp 
          WHERE EmpID = @empId
        `);

      if (empCheck.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      const employee = empCheck.recordset[0];

      // Handle advance mapping update
      if (advanceExpINID !== undefined && advanceExpINID !== null) {
        // Verify advance category exists and is expense type
        const advCheck = await new sql.Request(transaction)
          .input("expINID", sql.Int, advanceExpINID)
          .query(`
            SELECT ExpINID, CatName, ExpINType 
            FROM dbo.TblExpINCat 
            WHERE ExpINID = @expINID AND ExpINType = N'مصروفات'
          `);

        if (advCheck.recordset.length === 0) {
          await transaction.rollback();
          return NextResponse.json({ error: "تصنيف السلفة غير موجود" }, { status: 400 });
        }

        // Deactivate ALL existing advance mappings for this employee
        await new sql.Request(transaction)
          .input("empId", sql.Int, empId)
          .query(`
            UPDATE dbo.TblExpCatEmpMap 
            SET IsActive = 0, 
                ModifiedDate = GETDATE(),
                Notes = CONCAT(ISNULL(Notes, N''), N' | Deactivated by new advance mapping')
            WHERE EmpID = @empId AND TxnKind = N'advance'
          `);

        // Check if the new mapping already exists (but inactive)
        const existingMapping = await new sql.Request(transaction)
          .input("empId", sql.Int, empId)
          .input("expINID", sql.Int, advanceExpINID)
          .query(`
            SELECT 1 FROM dbo.TblExpCatEmpMap
            WHERE EmpID = @empId AND ExpINID = @expINID AND TxnKind = N'advance'
          `);

        if (existingMapping.recordset.length > 0) {
          // Reactivate existing mapping
          await new sql.Request(transaction)
            .input("empId", sql.Int, empId)
            .input("expINID", sql.Int, advanceExpINID)
            .query(`
              UPDATE dbo.TblExpCatEmpMap 
              SET IsActive = 1, 
                  ModifiedDate = GETDATE(),
                  Notes = CONCAT(ISNULL(Notes, N''), N' | Reactivated advance mapping')
              WHERE EmpID = @empId AND ExpINID = @expINID AND TxnKind = N'advance'
            `);
        } else {
          // Insert new advance mapping
          await new sql.Request(transaction)
            .input("empId", sql.Int, empId)
            .input("expINID", sql.Int, advanceExpINID)
            .query(`
              INSERT INTO dbo.TblExpCatEmpMap 
                (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
              VALUES
                (@empId, @expINID, N'advance', 1, 
                 N'Updated advance mapping', GETDATE(), GETDATE())
            `);
        }
      }

      // Update revenue mapping if provided
      if (revenueExpINID !== undefined) {
        // Deactivate ALL existing revenue mappings for this employee
        // Deactivate existing revenue mapping
        await new sql.Request(transaction)
          .input("empId", sql.Int, empId)
          .query(`
            UPDATE dbo.TblExpCatEmpMap 
            SET IsActive = 0, ModifiedDate = GETDATE()
            WHERE EmpID = @empId AND TxnKind = N'revenue'
          `);

        // Insert new revenue mapping
        await new sql.Request(transaction)
          .input("empId", sql.Int, empId)
          .input("expINID", sql.Int, revenueExpINID)
          .query(`
            INSERT INTO dbo.TblExpCatEmpMap 
              (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
            VALUES
              (@empId, @expINID, N'revenue', 1, 
               N'Updated from employees admin', GETDATE(), GETDATE())
          `);

        console.log(`Updated revenue mapping for EmpID=${empId} to ExpINID=${revenueExpINID}`);
      }

      await transaction.commit();

      // Return updated employee data
      const updatedResult = await db.request()
        .input("empId", sql.Int, empId)
        .query(`
          SELECT
            e.EmpID,
            e.EmpName,
            e.Job,
            e.isActive,
            e.BaseSalary,
            e.TargetCommissionPercent,
            e.TargetMinSales,
            e.DefaultCheckInTime,
            e.DefaultCheckOutTime,
            e.IsPayrollEnabled,
            
            -- Advance mapping
            adv.ExpINID AS AdvanceExpINID,
            advCat.CatName AS AdvanceCatName,
            
            -- Revenue mapping
            rev.ExpINID AS RevenueExpINID,
            revCat.CatName AS RevenueCatName
            
          FROM dbo.TblEmp e
          
          LEFT JOIN dbo.TblExpCatEmpMap adv
              ON adv.EmpID = e.EmpID
             AND adv.TxnKind = N'advance'
             AND adv.IsActive = 1
          LEFT JOIN dbo.TblExpINCat advCat
              ON advCat.ExpINID = adv.ExpINID
              
          LEFT JOIN dbo.TblExpCatEmpMap rev
              ON rev.EmpID = e.EmpID
             AND rev.TxnKind = N'revenue'
             AND rev.IsActive = 1
          LEFT JOIN dbo.TblExpINCat revCat
              ON revCat.ExpINID = rev.ExpINID
              
          WHERE e.EmpID = @empId
        `);

      return NextResponse.json({
        success: true,
        message: "تم تحديث الربط المالي بنجاح",
        employee: updatedResult.recordset[0]
      });

    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/finance-map] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/employees/:id/finance-map
// Body: { type: 'advance' | 'revenue' }
export async function DELETE(
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
      return NextResponse.json({ error: "معرف الموظف غير صالح" }, { status: 400 });
    }

    const body = await req.json();
    const { type } = body;

    if (!type || (type !== 'advance' && type !== 'revenue')) {
      return NextResponse.json({ 
        error: "نوع الربط المطلوب غير صالح (advance أو revenue)" 
      }, { status: 400 });
    }

    const db = await getPool();

    // Deactivate the specified mapping
    const result = await db.request()
      .input("empId", sql.Int, empId)
      .input("txnKind", sql.NVarChar(20), type)
      .query(`
        UPDATE dbo.TblExpCatEmpMap 
        SET IsActive = 0, ModifiedDate = GETDATE()
        WHERE EmpID = @empId AND TxnKind = @txnKind
        
        SELECT @@ROWCOUNT AS AffectedRows
      `);

    const affectedRows = result.recordset[0].AffectedRows;

    if (affectedRows === 0) {
      return NextResponse.json({ 
        error: "لا يوجد ربط مالي نشط لهذا النوع" 
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `تم حذف ربط ${type === 'advance' ? 'السلفة' : 'الإيراد'} بنجاح`
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/finance-map] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
