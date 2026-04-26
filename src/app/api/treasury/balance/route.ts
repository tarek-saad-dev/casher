import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/treasury/balance
 * Returns the total cumulative balance in the treasury per payment method
 * = SUM of all-time inflows - SUM of all-time outflows (no date filter)
 */
export async function GET() {
  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT
        pm.PaymentMethod,
        SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) AS TotalIn,
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS TotalOut,
        SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) -
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Balance
      FROM [dbo].[TblCashMove] cm
      INNER JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
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
