import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// GET /api/expenses/distribute/summary - Get staff expense distribution summary
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const url = new URL(req.url);
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const staffId = url.searchParams.get('staffId');
    const categoryId = url.searchParams.get('categoryId');

    let whereClause = "WHERE cm.invType = N'staff_expense'";
    const request = db.request();

    if (dateFrom) {
      whereClause += ' AND cm.invDate >= @dateFrom';
      request.input('dateFrom', sql.Date, dateFrom);
    }
    if (dateTo) {
      whereClause += ' AND cm.invDate <= @dateTo';
      request.input('dateTo', sql.Date, dateTo);
    }
    if (staffId) {
      whereClause += ' AND ded.StaffMemberID = @staffId';
      request.input('staffId', sql.Int, parseInt(staffId));
    }
    if (categoryId) {
      whereClause += ' AND cm.ExpINID = @categoryId';
      request.input('categoryId', sql.Int, parseInt(categoryId));
    }

    const result = await request.query(`
      SELECT 
        e.EmpID,
        e.EmpName,
        cat.CatName AS ExpenseCategory,
        cat.ExpINID AS ExpenseCategoryID,
        COUNT(cm.ID) AS DistributionCount,
        SUM(cm.GrandTolal) AS TotalDistributed,
        AVG(cm.GrandTolal) AS AverageDistribution,
        MIN(cm.invDate) AS FirstDistribution,
        MAX(cm.invDate) AS LastDistribution,
        SUM(cm.GrandTolal) OVER (PARTITION BY e.EmpID) AS StaffTotal,
        SUM(cm.GrandTolal) OVER (PARTITION BY cat.ExpINID) AS CategoryTotal,
        SUM(cm.GrandTolal) OVER () AS GrandTotal
      FROM [dbo].[TblEmp] e
      INNER JOIN [dbo].[TblStaffExpenseDistributionDetail] ded ON e.EmpID = ded.StaffMemberID
      INNER JOIN [dbo].[TblCashMove] cm ON ded.OriginalExpenseID = cm.ID
      INNER JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      ${whereClause}
      GROUP BY e.EmpID, e.EmpName, cat.CatName, cat.ExpINID
      ORDER BY e.EmpName, cat.CatName
    `);

    // Get overall summary
    const summaryResult = await db.request().query(`
      SELECT 
        COUNT(DISTINCT e.EmpID) AS StaffCount,
        COUNT(DISTINCT cat.ExpINID) AS CategoryCount,
        COUNT(cm.ID) AS TotalDistributions,
        SUM(cm.GrandTolal) AS TotalAmount,
        AVG(cm.GrandTolal) AS AverageAmount,
        MIN(cm.invDate) AS PeriodStart,
        MAX(cm.invDate) AS PeriodEnd
      FROM [dbo].[TblEmp] e
      INNER JOIN [dbo].[TblStaffExpenseDistributionDetail] ded ON e.EmpID = ded.StaffMemberID
      INNER JOIN [dbo].[TblCashMove] cm ON ded.OriginalExpenseID = cm.ID
      INNER JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      ${whereClause}
    `);

    return NextResponse.json({
      details: result.recordset,
      summary: summaryResult.recordset[0] || {}
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/distribute/summary] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
