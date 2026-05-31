import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getMonthlyFinancialSummary } from '@/lib/services/TreasurySummaryService';

/**
 * Simplified Monthly Profit Report API
 * 
 * Revenue Source: Employee Services Report (TblinvServDetail)
 * Net Profit Source: Treasury (TblCashMove)
 * Expenses: Calculated as Revenue - Net Profit
 * 
 * GET /api/reports/monthly?month=5&year=2026
 */

interface EmployeeServicesSummary {
  totalAmount: number;
  totalServices: number;
  totalInvoices: number;
}

/**
 * Get Revenue from Employee Services (same source as /admin/reports/employee-services)
 */
async function getEmployeeServicesRevenue(year: number, month: number): Promise<number> {
  const db = await getPool();
  
  // Calculate first and last day of month
  const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const result = await db.request()
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT 
        ISNULL(SUM(
          CASE
            WHEN ISNULL(d.SValue, 0) > 0
              THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
            ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
          END
        ), 0) AS TotalRevenue,
        COUNT(*) AS TotalServices,
        COUNT(DISTINCT h.invID) AS TotalInvoices
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
        AND h.invType = d.invType
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
        AND d.EmpID IS NOT NULL
        AND d.ProID IS NOT NULL
    `);

  const revenue = result.recordset[0]?.TotalRevenue ?? 0;
  return Math.round(revenue * 100) / 100;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const monthParam = url.searchParams.get('month');
    const yearParam = url.searchParams.get('year');

    // Default to current month/year if not provided
    const now = new Date();
    const year = yearParam ? parseInt(yearParam) : now.getFullYear();
    const month = monthParam ? parseInt(monthParam) : now.getMonth() + 1;

    // Validate inputs
    if (isNaN(year) || year < 2020 || year > now.getFullYear() + 1) {
      return NextResponse.json({ error: 'سنة غير صالحة' }, { status: 400 });
    }
    if (isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'شهر غير صالح' }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════════
    // Fetch Revenue from Employee Services (matches /admin/reports/employee-services)
    // ═══════════════════════════════════════════════════════════════════
    const revenue = await getEmployeeServicesRevenue(year, month);

    // ═══════════════════════════════════════════════════════════════════
    // Fetch Net Profit from Treasury (TblCashMove)
    // ═══════════════════════════════════════════════════════════════════
    const treasuryData = await getMonthlyFinancialSummary(year, month);
    const netProfit = treasuryData.netAmount;

    // ═══════════════════════════════════════════════════════════════════
    // Calculate Expenses dynamically
    // Expenses = Revenue - Net Profit
    // ═══════════════════════════════════════════════════════════════════
    const totalExpenses = revenue - netProfit;

    // ═══════════════════════════════════════════════════════════════════
    // Build Simplified Response
    // ═══════════════════════════════════════════════════════════════════
    const report = {
      // Core Financial Data
      totalRevenue: revenue,           // From Employee Services
      totalExpenses: totalExpenses,    // Calculated: Revenue - Net Profit
      netProfit: netProfit,            // From Treasury
      
      // Additional Info
      totalInvoices: treasuryData.transactionsCount,
      
      // Metadata for verification
      _meta: {
        revenueSource: 'EmployeeServices (TblinvServDetail)',
        netProfitSource: 'Treasury (TblCashMove)',
        expensesCalculation: 'Revenue - Net Profit',
        employeeServicesMatch: true,
      }
    };

    return NextResponse.json(report);
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/reports/monthly] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
