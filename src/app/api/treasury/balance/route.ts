import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';

/**
 * GET /api/treasury/balance
 * Returns the total cumulative balance in the treasury per payment method
 * = SUM of all-time inflows - SUM of all-time outflows (no date filter), scoped to the active branch
 */
export async function GET() {
  try {
    // PHASE1D: never trust browser branchId — always filter by the session's active branch
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();

    const result = await db.request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
      SELECT
        pm.PaymentMethod,
        SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) AS TotalIn,
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS TotalOut,
        SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) -
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Balance
      FROM [dbo].[TblCashMove] cm
      INNER JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
      WHERE cm.BranchID = @branchId
      GROUP BY pm.PaymentID, pm.PaymentMethod
      ORDER BY Balance DESC
    `);

    const breakdown = result.recordset.map((row: any) => ({
      name: row.PaymentMethod,
      totalIn: row.TotalIn ?? 0,
      totalOut: row.TotalOut ?? 0,
      balance: row.Balance ?? 0,
    }));

    const totalBalance = breakdown.reduce((sum: number, r: any) => sum + r.balance, 0);
    const cashBalance = breakdown.find((r: any) => r.name?.includes('نقد'))?.balance ?? 0;

    return NextResponse.json({ totalBalance, cashBalance, breakdown });
  } catch (error) {
    console.error('[api/treasury/balance] error:', error);
    return NextResponse.json(
      { error: 'فشل تحميل رصيد الخزنة' },
      { status: 500 }
    );
  }
}
