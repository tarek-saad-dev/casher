import { NextRequest, NextResponse } from 'next/server';
import { getEmployeeServicesRevenue } from '@/lib/services/employeeServicesReportService';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const { year, month } = parseMonthYearParams(
      url.searchParams.get('year'),
      url.searchParams.get('month')
    );

    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
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
