import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// GET /api/deductions/monthly-summary — Get monthly deductions summary per employee
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const url = new URL(req.url);
    const month = url.searchParams.get('month'); // Format: YYYY-MM
    const employeeId = url.searchParams.get('employeeId');

    // Default to current month if not specified
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    
    let whereClause = `
      WHERE cm.invType = N'مصروفات' 
        AND cm.inOut = N'out' 
        AND cat.CatName LIKE N'%سلف%'
        AND FORMAT(cm.invDate, 'yyyy-MM') = @targetMonth
    `;
    
    const request = db.request();
    request.input('targetMonth', sql.NVarChar(7), targetMonth);

    if (employeeId) {
      whereClause += ' AND EXISTS (SELECT 1 FROM dbo.TblExpCatEmpMap m WHERE m.ExpINID = cm.ExpINID AND m.EmpID = @employeeId AND m.TxnKind = N\'advance\')';
      request.input('employeeId', sql.Int, parseInt(employeeId));
    }

    const result = await request.query(`
      SELECT 
        emp.EmpID,
        emp.EmpName,
        emp.Job,
        COUNT(cm.ID) AS DeductionCount,
        SUM(cm.GrandTolal) AS TotalDeductions,
        MIN(cm.invDate) AS FirstDeductionDate,
        MAX(cm.invDate) AS LastDeductionDate,
        STRING_AGG(
          CAST(cm.invID AS NVARCHAR) + N' (' + FORMAT(cm.GrandTolal, 'N2') + N' ج.م)', 
          N', '
        ) WITHIN GROUP (ORDER BY cm.invDate DESC) AS DeductionDetails
      FROM [dbo].[TblCashMove] cm
      LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      LEFT JOIN [dbo].[TblExpCatEmpMap map ON cm.ExpINID = map.ExpINID AND map.TxnKind = N\'advance\'
      LEFT JOIN [dbo].[TblEmp] emp ON map.EmpID = emp.EmpID
      ${whereClause}
      GROUP BY emp.EmpID, emp.EmpName, emp.Job
      HAVING COUNT(cm.ID) > 0
      ORDER BY emp.EmpName
    `);

    // Get overall summary
    const summaryResult = await db.request()
      .input('targetMonth', sql.NVarChar(7), targetMonth)
      .query(`
        SELECT 
          COUNT(cm.ID) AS TotalDeductionCount,
          SUM(cm.GrandTolal) AS GrandTotalDeductions,
          COUNT(DISTINCT emp.EmpID) AS UniqueEmployeesCount
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
        LEFT JOIN [dbo].[TblExpCatEmpMap map ON cm.ExpINID = map.ExpINID AND map.TxnKind = N\'advance\'
        LEFT JOIN [dbo].[TblEmp] emp ON map.EmpID = emp.EmpID
        WHERE cm.invType = N'مصروفات' 
          AND cm.inOut = N'out' 
          AND cat.CatName LIKE N'%سلف%'
          AND FORMAT(cm.invDate, 'yyyy-MM') = @targetMonth
      `);

    const monthName = new Date(targetMonth + '-01').toLocaleDateString('ar-EG', { 
      year: 'numeric', 
      month: 'long' 
    });

    return NextResponse.json({
      month: targetMonth,
      monthName,
      employees: result.recordset,
      summary: summaryResult.recordset[0] || {
        TotalDeductionCount: 0,
        GrandTotalDeductions: 0,
        UniqueEmployeesCount: 0
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/deductions/monthly-summary] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
