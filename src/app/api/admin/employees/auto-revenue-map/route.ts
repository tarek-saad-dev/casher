import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// POST /api/admin/employees/auto-revenue-map
// Automatically maps revenue categories to unmapped employees
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // 1. Get available revenue categories
      const revenueCategories = await new sql.Request(transaction)
        .input("expType", sql.NVarChar(50), "ايرادات")
        .query(`
          SELECT ExpINID, CatName 
          FROM dbo.TblExpINCat 
          WHERE ExpINType = @expType
          ORDER BY CatName
        `);

      // 2. Get unmapped employees
      const unmappedEmployees = await new sql.Request(transaction).query(`
        SELECT 
          e.EmpID,
          e.EmpName
        FROM dbo.TblEmp e
        WHERE ISNULL(e.isActive, 1) = 1
          AND NOT EXISTS (
            SELECT 1 FROM dbo.TblExpCatEmpMap m
            WHERE m.EmpID = e.EmpID 
              AND m.TxnKind = N'revenue' 
              AND m.IsActive = 1
          )
        ORDER BY e.EmpName
      `);

      // 3. Smart mapping logic for revenue only
      let smartMappings = 0;
      let individualMappings = 0;
      const mappingResults: any[] = [];

      // Define excluded category IDs (old Mohamed advance categories)
      const excludedCategoryIds = [12, 39];

      for (const employee of unmappedEmployees.recordset) {
        let mapped = false;
        
        // Try exact or partial name match for revenue categories only (exclude advances)
        for (const category of revenueCategories.recordset) {
          // Skip excluded categories
          if (excludedCategoryIds.includes(category.ExpINID)) {
            continue;
          }
          
          const catName = category.CatName.toLowerCase();
          const empName = employee.EmpName.toLowerCase();
          
          if (catName === empName || 
              catName.includes(empName) || 
              empName.includes(catName)) {
            
            // Insert smart mapping
            await new sql.Request(transaction)
              .input("empId", sql.Int, employee.EmpID)
              .input("expINID", sql.Int, category.ExpINID)
              .query(`
                INSERT INTO dbo.TblExpCatEmpMap 
                  (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
                VALUES
                  (@empId, @expINID, N'revenue', 1, 
                   N'Auto revenue mapping - smart match', GETDATE(), GETDATE())
              `);
            
            smartMappings++;
            mappingResults.push({
              empId: employee.EmpID,
              empName: employee.EmpName,
              category: category.CatName,
              type: 'smart'
            });
            mapped = true;
            break;
          }
        }
        
        // If no smart match found, create individual category
        if (!mapped) {
          const individualCategoryName = `ايراد (${employee.EmpName})`;
          
          // Check if individual category already exists
          const existingCat = await new sql.Request(transaction)
            .input("catName", sql.NVarChar(200), individualCategoryName)
            .input("expType", sql.NVarChar(50), "ايرادات")
            .query(`
              SELECT ExpINID FROM dbo.TblExpINCat 
              WHERE CatName = @catName AND ExpINType = @expType
            `);
          
          let categoryExpINID: number;
          
          if (existingCat.recordset.length === 0) {
            // Create individual revenue category
            const createCat = await new sql.Request(transaction)
              .input("catName", sql.NVarChar(200), individualCategoryName)
              .input("expType", sql.NVarChar(50), "ايرادات")
              .query(`
                INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
                OUTPUT INSERTED.ExpINID
                VALUES (@catName, @expType)
              `);
            categoryExpINID = createCat.recordset[0].ExpINID;
          } else {
            categoryExpINID = existingCat.recordset[0].ExpINID;
          }
          
          // Insert mapping to individual category
          await new sql.Request(transaction)
            .input("empId", sql.Int, employee.EmpID)
            .input("expINID", sql.Int, categoryExpINID)
            .query(`
              INSERT INTO dbo.TblExpCatEmpMap 
                (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
              VALUES
                (@empId, @expINID, N'revenue', 1, 
                 N'Auto revenue mapping - individual category', GETDATE(), GETDATE())
            `);
          
          individualMappings++;
          mappingResults.push({
            empId: employee.EmpID,
            empName: employee.EmpName,
            category: individualCategoryName,
            type: 'individual'
          });
        }
      }

      await transaction.commit();

      // Get final statistics
      const finalStats = await db.request().query(`
        SELECT 
          COUNT(*) AS totalEmployees,
          COUNT(CASE WHEN rev.ExpINID IS NOT NULL THEN 1 END) AS mappedEmployees
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblExpCatEmpMap rev
            ON rev.EmpID = e.EmpID
           AND rev.TxnKind = N'revenue'
           AND rev.IsActive = 1
        WHERE ISNULL(e.isActive, 1) = 1
      `);

      const stats = finalStats.recordset[0];
      const coverage = ((stats.mappedEmployees / stats.totalEmployees) * 100).toFixed(2);

      return NextResponse.json({
        success: true,
        message: "تم ربط الإيرادات تلقائياً بنجاح",
        statistics: {
          totalEmployees: stats.totalEmployees,
          mappedEmployees: stats.mappedEmployees,
          smartMappings,
          individualMappings,
          coverage: parseFloat(coverage)
        },
        mappings: mappingResults
      });

    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/auto-revenue-map] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/admin/employees/auto-revenue-map
// Preview what would be mapped without actually mapping
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const db = await getPool();

    // Get unmapped employees
    const unmappedEmployees = await db.request().query(`
      SELECT 
        e.EmpID,
        e.EmpName,
        e.Job
      FROM dbo.TblEmp e
      WHERE ISNULL(e.isActive, 1) = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblExpCatEmpMap m
          WHERE m.EmpID = e.EmpID 
            AND m.TxnKind = N'revenue' 
            AND m.IsActive = 1
        )
      ORDER BY e.EmpName
    `);

    // Get available revenue categories
    const revenueCategories = await db.request()
      .input("expType", sql.NVarChar(50), "ايرادات")
      .query(`
        SELECT ExpINID, CatName 
        FROM dbo.TblExpINCat 
        WHERE ExpINType = @expType
        ORDER BY CatName
      `);

    // Preview smart mappings
    const previewMappings: any[] = [];
    const categories = revenueCategories.recordset;
    
    // Define excluded category IDs (old Mohamed advance categories)
    const excludedCategoryIds = [12, 39];

    for (const employee of unmappedEmployees.recordset) {
      let mapped = false;
      
      // Try exact or partial name match (exclude old categories)
      for (const category of categories) {
        // Skip excluded categories
        if (excludedCategoryIds.includes(category.ExpINID)) {
          continue;
        }
        
        const catName = category.CatName.toLowerCase();
        const empName = employee.EmpName.toLowerCase();
        
        if (catName === empName || 
            catName.includes(empName) || 
            empName.includes(catName)) {
          
          previewMappings.push({
            empId: employee.EmpID,
            empName: employee.EmpName,
            job: employee.Job,
            category: category.CatName,
            type: 'smart'
          });
          mapped = true;
          break;
        }
      }
      
      // If no smart match, preview individual category
      if (!mapped) {
        const individualCategoryName = `ايراد (${employee.EmpName})`;
        previewMappings.push({
          empId: employee.EmpID,
          empName: employee.EmpName,
          job: employee.Job,
          category: individualCategoryName,
          type: 'individual'
        });
      }
    }

    return NextResponse.json({
      success: true,
      unmappedCount: unmappedEmployees.recordset.length,
      availableCategories: revenueCategories.recordset,
      previewMappings
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/auto-revenue-map] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
