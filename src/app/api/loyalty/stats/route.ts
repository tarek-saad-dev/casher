import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { LoyaltyStats } from '@/lib/types';

export const runtime = 'nodejs';

// GET /api/loyalty/stats
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();

    // Get today's date (start of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await db.request()
      .input('today', sql.DateTime, today)
      .query(`
        WITH LoyaltyStats AS (
          SELECT 
            COUNT(*) as totalLoyaltyClients,
            ISNULL(SUM(PointsBalance), 0) as totalPointsBalance,
            ISNULL(SUM(LifetimeEarnedPoints), 0) as totalLifetimeEarned,
            ISNULL(SUM(LifetimeAdjustedPoints), 0) as totalLifetimeAdjusted,
            ISNULL(SUM(TotalVisits), 0) as totalVisits,
            ISNULL(SUM(TotalSpend), 0) as totalSpend
          FROM [dbo].[TblClientLoyalty]
          WHERE IsActive = 1
        ),
        TierCounts AS (
          SELECT 
            TierCode,
            COUNT(*) as count
          FROM [dbo].[TblClientLoyalty] cl
          INNER JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
          WHERE cl.IsActive = 1
          GROUP BY TierCode
        ),
        TodayStats AS (
          SELECT 
            ISNULL(SUM(CASE WHEN MovementType = 'EARN_SALE' THEN PointsDelta ELSE 0 END), 0) as todayEarnedPoints,
            ISNULL(SUM(CASE WHEN MovementType IN ('ADJUST_ADD', 'ADJUST_SUBTRACT') THEN PointsDelta ELSE 0 END), 0) as todayManualAdjustments,
            ISNULL(SUM(CASE WHEN MovementType = 'REVERSAL' THEN PointsDelta ELSE 0 END), 0) as todayReversedPoints
          FROM [dbo].[TblLoyaltyPointLedger]
          WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
        )
        SELECT 
          ls.totalLoyaltyClients,
          ls.totalPointsBalance,
          ls.totalLifetimeEarned,
          ls.totalLifetimeAdjusted,
          ls.totalVisits,
          ls.totalSpend,
          ISNULL((SELECT count FROM TierCounts WHERE TierCode = 'BRONZE'), 0) as bronzeCount,
          ISNULL((SELECT count FROM TierCounts WHERE TierCode = 'SILVER'), 0) as silverCount,
          ISNULL((SELECT count FROM TierCounts WHERE TierCode = 'GOLD'), 0) as goldCount,
          ISNULL((SELECT count FROM TierCounts WHERE TierCode = 'VIP'), 0) as vipCount,
          ts.todayEarnedPoints,
          ts.todayManualAdjustments,
          ts.todayReversedPoints
        FROM LoyaltyStats ls
        CROSS JOIN TodayStats ts
      `);

    const stats: LoyaltyStats = result.recordset[0] || {
      totalLoyaltyClients: 0,
      totalPointsBalance: 0,
      totalLifetimeEarned: 0,
      totalLifetimeAdjusted: 0,
      totalVisits: 0,
      totalSpend: 0,
      bronzeCount: 0,
      silverCount: 0,
      goldCount: 0,
      vipCount: 0,
      todayEarnedPoints: 0,
      todayManualAdjustments: 0,
      todayReversedPoints: 0
    };

    return NextResponse.json(stats);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/stats] GET error:', message);
    return NextResponse.json(
      { error: 'فشل في جلب إحصائيات الولاء', details: message },
      { status: 500 }
    );
  }
}
