import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';
import { getEmployeeLedgerOutstandingTotals } from '@/lib/services/employeeLedgerService';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * GET /api/treasury/hold-breakdown
 * Splits the treasury cash balance for the selected period into:
 *  - employeeEntitlements: money held for employees (outstanding ledger balances)
 *  - netProfit: the rest = treasuryTotal - employeeEntitlements
 *
 * Accepts the same filters as /api/treasury/daily-summary so the total matches
 * the banner: newDay, dateFrom, dateTo, shiftMoveId, userId.
 */
export async function GET(request: NextRequest) {
  try {
    // PHASE1D: never trust browser branchId — always filter by the session's active branch
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();

    const searchParams = request.nextUrl.searchParams;
    const newDay = searchParams.get('newDay') || null;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const shiftMoveId = searchParams.get('shiftMoveId') ? parseInt(searchParams.get('shiftMoveId')!) : null;
    const userId = searchParams.get('userId') ? parseInt(searchParams.get('userId')!) : null;

    // Build the same WHERE clause as daily-summary so the total matches the banner.
    const whereConditions: string[] = ['cm.BranchID = @branchId'];
    const params: Record<string, string | number> = {};

    if (newDay !== null) {
      whereConditions.push('sm.NewDay = @newDay');
      params.newDay = newDay;
    }
    if (dateFrom && dateTo) {
      whereConditions.push('cm.invDate >= @dateFrom AND cm.invDate <= @dateTo');
      params.dateFrom = dateFrom;
      params.dateTo = dateTo;
    } else if (dateFrom) {
      whereConditions.push('cm.invDate >= @dateFrom');
      params.dateFrom = dateFrom;
    } else if (dateTo) {
      whereConditions.push('cm.invDate <= @dateTo');
      params.dateTo = dateTo;
    }
    if (shiftMoveId !== null) {
      whereConditions.push('sm.ID = @shiftMoveId');
      params.shiftMoveId = shiftMoveId;
    }
    if (userId !== null) {
      whereConditions.push('sm.UserID = @userId');
      params.userId = userId;
    }

    const whereClause = whereConditions.join(' AND ');

    const cashRequest = db.request();
    cashRequest.input('branchId', sql.Int, branch.branchId);
    Object.keys(params).forEach((key) => {
      if (key === 'shiftMoveId' || key === 'userId') {
        cashRequest.input(key, sql.Int, params[key]);
      } else {
        cashRequest.input(key, sql.Date, params[key]);
      }
    });

    const cashResult = await cashRequest.query(`
      SELECT
        ISNULL(SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END), 0) -
        ISNULL(SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END), 0) AS TotalBalance
      FROM [dbo].[TblCashMove] cm
      LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
      WHERE ${whereClause}
    `);

    const treasuryTotal = round2(Number(cashResult.recordset[0]?.TotalBalance ?? 0));

    // Scope employee entitlements to the same period (by ledger EntryDate).
    const effectiveStart = dateFrom ?? newDay ?? dateTo ?? null;
    const effectiveEnd = dateTo ?? newDay ?? dateFrom ?? null;
    const range =
      effectiveStart && effectiveEnd
        ? { startDate: effectiveStart, endDate: effectiveEnd }
        : undefined;

    const outstanding = await getEmployeeLedgerOutstandingTotals(range);
    const employeeEntitlements = outstanding.totalOwedToEmployees;
    const netProfit = round2(treasuryTotal - employeeEntitlements);

    return NextResponse.json({
      treasuryTotal,
      employeeEntitlements,
      employeeAdvancesReceivable: outstanding.totalOwedByEmployees,
      netProfit,
    });
  } catch (error) {
    console.error('[api/treasury/hold-breakdown] error:', error);
    return NextResponse.json(
      { error: 'فشل تحميل توزيع رصيد الخزنة' },
      { status: 500 }
    );
  }
}
