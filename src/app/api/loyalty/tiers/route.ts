import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { LoyaltyTier } from '@/lib/types';

export const runtime = 'nodejs';

// GET /api/loyalty/tiers
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT 
        TierID,
        TierCode,
        TierNameAr,
        TierNameEn,
        MinLifetimePoints,
        PointsMultiplier,
        SortOrder,
        IsActive
      FROM [dbo].[TblLoyaltyTier]
      WHERE IsActive = 1
      ORDER BY SortOrder, MinLifetimePoints
    `);

    const tiers: LoyaltyTier[] = result.recordset;

    return NextResponse.json(tiers);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/tiers] GET error:', message);
    return NextResponse.json(
      { error: 'فشل في جلب مستويات الولاء', details: message },
      { status: 500 }
    );
  }
}
