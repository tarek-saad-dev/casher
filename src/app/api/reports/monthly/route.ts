import { NextRequest, NextResponse } from 'next/server';
import { getMonthlyFinancialSummary } from '@/lib/services/TreasurySummaryService';
import { getAllEmployeesRevenueTotal } from '@/lib/reports/employeeServicesRevenue';

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
    const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    const revenue = await getAllEmployeesRevenueTotal(fromDate, endDateExclusive);

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
