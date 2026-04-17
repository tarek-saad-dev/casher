import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { EmployeeAdvanceData, RiskStatus } from '@/lib/types';

function calculateRiskStatus(advances: number, revenue: number): RiskStatus {
  // Critical: advances exist but no revenue
  if (revenue === 0 && advances > 0) {
    return {
      level: 'critical',
      label: 'حرج',
      color: 'bg-red-600',
      textColor: 'text-red-600',
      description: 'سلف بدون إيرادات',
    };
  }

  const percentage = (advances / revenue) * 100;

  // High Risk: > 60%
  if (percentage > 60) {
    return {
      level: 'high',
      label: 'خطر عالي',
      color: 'bg-orange-500',
      textColor: 'text-orange-600',
      description: 'السلف تتجاوز 60% من الإيرادات',
    };
  }

  // Watch: 30-60%
  if (percentage >= 30) {
    return {
      level: 'watch',
      label: 'مراقبة',
      color: 'bg-yellow-500',
      textColor: 'text-yellow-600',
      description: 'السلف بين 30-60% من الإيرادات',
    };
  }

  // Safe: < 30%
  return {
    level: 'safe',
    label: 'آمن',
    color: 'bg-green-500',
    textColor: 'text-green-600',
    description: 'السلف أقل من 30% من الإيرادات',
  };
}

// GET /api/reports/expenses/employee-advances?year=2026&month=3
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get('year') || '');
    const month = parseInt(searchParams.get('month') || '');

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'يجب تحديد سنة وشهر صحيحين' },
        { status: 400 }
      );
    }

    const db = await getPool();

    // Get employee advances from mapped categories
    const advancesResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          em.EmpID,
          e.EmpName,
          SUM(cm.GrandTolal) AS TotalAdvances,
          COUNT(cm.ID) AS AdvanceCount,
          MAX(cm.invDate) AS LatestAdvanceDate
        FROM [dbo].[TblExpCatEmpMap] em
        INNER JOIN [dbo].[TblCashMove] cm ON em.ExpINID = cm.ExpINID
        INNER JOIN [dbo].[TblEmp] e ON em.EmpID = e.EmpID
        WHERE em.IsActive = 1
          AND em.TxnKind = N'advance'
          AND cm.invType = N'مصروفات'
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY em.EmpID, e.EmpName
      `);

    // Get employee revenue from TblCashMove via category ExpINType='ايرادات'
    const revenueResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          em.EmpID,
          SUM(cm.GrandTolal) AS TotalRevenue,
          COUNT(cm.ID) AS RevenueCount
        FROM [dbo].[TblExpCatEmpMap] em
        INNER JOIN [dbo].[TblExpINCat] cat ON em.ExpINID = cat.ExpINID
        INNER JOIN [dbo].[TblCashMove] cm ON cat.ExpINID = cm.ExpINID
        INNER JOIN [dbo].[TblEmp] e ON em.EmpID = e.EmpID
        WHERE em.IsActive = 1
          AND em.TxnKind = N'revenue'
          AND cat.ExpINType = N'ايرادات'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY em.EmpID
      `);

    // Create revenue map for quick lookup
    const revenueMap = new Map<number, { TotalRevenue: number; RevenueCount: number }>();
    revenueResult.recordset.forEach((row: any) => {
      revenueMap.set(row.EmpID, {
        TotalRevenue: row.TotalRevenue || 0,
        RevenueCount: row.RevenueCount || 0,
      });
    });

    // Combine advances and revenue data
    const employeeData: EmployeeAdvanceData[] = advancesResult.recordset.map((row: any) => {
      const revenue = revenueMap.get(row.EmpID) || { TotalRevenue: 0, RevenueCount: 0 };
      const totalAdvances = row.TotalAdvances || 0;
      const totalRevenue = revenue.TotalRevenue;
      const remaining = totalRevenue - totalAdvances;
      const advancePercentage = totalRevenue > 0 ? (totalAdvances / totalRevenue) * 100 : 0;
      const riskStatus = calculateRiskStatus(totalAdvances, totalRevenue);

      return {
        EmpID: row.EmpID,
        EmpName: row.EmpName,
        TotalAdvances: totalAdvances,
        AdvanceCount: row.AdvanceCount || 0,
        LatestAdvanceDate: row.LatestAdvanceDate,
        TotalRevenue: totalRevenue,
        SalesCount: revenue.RevenueCount,
        Remaining: remaining,
        AdvancePercentage: advancePercentage,
        RiskStatus: riskStatus,
      };
    });

    // Sort by risk level (critical first, then high, watch, safe)
    const riskOrder = { critical: 0, high: 1, watch: 2, safe: 3 };
    employeeData.sort((a, b) => {
      const aOrder = riskOrder[a.RiskStatus.level];
      const bOrder = riskOrder[b.RiskStatus.level];
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same risk level, sort by advance amount descending
      return b.TotalAdvances - a.TotalAdvances;
    });

    return NextResponse.json(employeeData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/reports/expenses/employee-advances] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
