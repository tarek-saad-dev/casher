import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/employees — list all active employees with finance mapping
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT 
        e.EmpID, e.EmpName, e.Job, e.isActive, e.BaseSalary, e.TargetCommissionPercent, e.TargetMinSales,
        e.DefaultCheckInTime, e.DefaultCheckOutTime, 
        CASE 
          WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WorkScheduleNotes') 
          THEN e.WorkScheduleNotes ELSE NULL 
        END AS WorkScheduleNotes, 
        e.IsPayrollEnabled,
        adv.ExpINID AS AdvanceExpINID, adv.CatName AS AdvanceCatName,
        rev.ExpINID AS RevenueExpINID, rev.CatName AS RevenueCatName
      FROM dbo.TblEmp e
      OUTER APPLY (
        SELECT TOP 1
          m.ExpINID,
          cat.CatName
        FROM dbo.TblExpCatEmpMap m
        JOIN dbo.TblExpINCat cat
          ON cat.ExpINID = m.ExpINID
        WHERE m.EmpID = e.EmpID
          AND m.TxnKind = N'advance'
          AND m.IsActive = 1
          AND cat.ExpINType = N'مصروفات'
        ORDER BY m.ModifiedDate DESC, m.ID DESC
      ) adv
      OUTER APPLY (
        SELECT TOP 1
          m.ExpINID,
          cat.CatName
        FROM dbo.TblExpCatEmpMap m
        JOIN dbo.TblExpINCat cat
          ON cat.ExpINID = m.ExpINID
        WHERE m.EmpID = e.EmpID
          AND m.TxnKind = N'revenue'
          AND m.IsActive = 1
          AND cat.ExpINType = N'ايرادات'
        ORDER BY m.ModifiedDate DESC, m.ID DESC
      ) rev
      WHERE ISNULL(e.isActive, 1) = 1
      ORDER BY e.EmpName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/employees] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/employees  { empName, isActive? }
// Creates employee + advance expense category + mapping atomically
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const body = await req.json();
    const { empName, isActive = true } = body;

    if (!empName || String(empName).trim().length === 0) {
      return NextResponse.json({ error: "اسم الموظف مطلوب" }, { status: 400 });
    }

    const name = String(empName).trim();
    const catName = `سلفه ( ${name} )`;
    const expType = "مصروفات";

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // ── 1. Insert employee ───────────────────────────────────────────
      const empRes = await new sql.Request(transaction)
        .input("empName", sql.NVarChar(200), name)
        .input("isActive", sql.Bit, isActive ? 1 : 0).query(`
          INSERT INTO dbo.TblEmp (EmpName, isActive)
          OUTPUT INSERTED.EmpID, INSERTED.EmpName, INSERTED.isActive
          VALUES (@empName, @isActive)
        `);

      const newEmp = empRes.recordset[0];
      const newEmpID: number = newEmp.EmpID;

      console.log(
        `[api/employees] Inserted EmpID=${newEmpID}  EmpName=${name}`,
      );

      // ── 2. Create advance category if not already there ──────────────
      let expINID: number = 0;

      const existCat = await new sql.Request(transaction)
        .input("catName", sql.NVarChar(200), catName)
        .input("expType", sql.NVarChar(50), expType).query(`
          SELECT ExpINID FROM dbo.TblExpINCat
          WHERE CatName = @catName AND ExpINType = @expType
        `);

      if (existCat.recordset.length > 0) {
        expINID = existCat.recordset[0].ExpINID;
        console.log(`[api/employees] Re-using existing ExpINID=${expINID}`);
      } else {
        const catRes = await new sql.Request(transaction)
          .input("catName", sql.NVarChar(200), catName)
          .input("expType", sql.NVarChar(50), expType).query(`
            INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
            OUTPUT INSERTED.ExpINID
            VALUES (@catName, @expType)
          `);
        expINID = catRes.recordset[0].ExpINID;
        console.log(`[api/employees] Created TblExpINCat ExpINID=${expINID}`);
      }

      // Validate expINID was assigned
      if (!expINID || expINID <= 0) {
        await transaction.rollback();
        return NextResponse.json(
          { error: "فشل في إنشاء/العثور على تصنيف السلفة" },
          { status: 500 },
        );
      }

      // ── 3. Create advance mapping if not already there ───────────────
      const existMap = await new sql.Request(transaction)
        .input("empID", sql.Int, newEmpID)
        .input("expINID", sql.Int, expINID).query(`
          SELECT 1 FROM dbo.TblExpCatEmpMap
          WHERE EmpID = @empID AND ExpINID = @expINID AND TxnKind = N'advance'
        `);

      if (existMap.recordset.length === 0) {
        await new sql.Request(transaction)
          .input("empID", sql.Int, newEmpID)
          .input("expINID", sql.Int, expINID).query(`
            INSERT INTO dbo.TblExpCatEmpMap
              (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
            VALUES
              (@empID, @expINID, N'advance', 1,
               N'Auto map on employee creation', GETDATE(), GETDATE())
          `);
        console.log(
          `[api/employees] Created advance mapping EmpID=${newEmpID} -> ExpINID=${expINID}`,
        );
      }

      await transaction.commit();

      return NextResponse.json(
        {
          EmpID: newEmpID,
          EmpName: newEmp.EmpName,
          isActive: newEmp.isActive,
          AdvanceExpINID: expINID,
          AdvanceCatName: catName,
        },
        { status: 201 },
      );
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/employees] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
