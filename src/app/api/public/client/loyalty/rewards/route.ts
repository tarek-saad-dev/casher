// ============================================
// GET /api/public/client/loyalty/rewards
// Client Loyalty Rewards List
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { 
  LoyaltyRewardsResponse, 
  LoyaltyErrorResponse
} from '@/lib/loyalty/types';
import { buildRewardsForClient, getNextReward } from '@/lib/loyalty/helpers';

export const runtime = 'nodejs';

/**
 * GET /api/public/client/loyalty/rewards
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 */
export async function GET(req: NextRequest): Promise<NextResponse<LoyaltyRewardsResponse | LoyaltyErrorResponse>> {
  try {
    // TODO: Replace with authenticated session / OTP token
    const { searchParams } = new URL(req.url);
    const clientIdParam = searchParams.get('clientId');
    
    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: 'clientId is required in development mode' },
        { status: 400 }
      );
    }
    
    const clientId = parseInt(clientIdParam, 10);
    if (isNaN(clientId) || clientId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid clientId' },
        { status: 400 }
      );
    }

    const db = await getPool();

    // ============================================
    // 1. Get Client Loyalty Data
    // ============================================
    const loyaltyResult = await db.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cl.PointsBalance,
          cl.TierID,
          lt.TierCode
        FROM [dbo].[TblClientLoyalty] cl
        LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
        WHERE cl.ClientID = @clientId
      `);

    let pointsBalance = 0;
    let tierCode = 'BRONZE';

    if (loyaltyResult.recordset.length > 0) {
      pointsBalance = loyaltyResult.recordset[0].PointsBalance || 0;
      tierCode = loyaltyResult.recordset[0].TierCode || 'BRONZE';
    }

    // ============================================
    // 2. Build Rewards for Client
    // ============================================
    const rewards = buildRewardsForClient(pointsBalance, tierCode);
    const nextReward = getNextReward(rewards);

    // ============================================
    // 3. Build Response
    // ============================================
    const response: LoyaltyRewardsResponse = {
      ok: true,
      rewards,
      nextReward
    };

    return NextResponse.json(response);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/public/client/loyalty/rewards] GET error:', message);
    return NextResponse.json(
      { ok: false, error: 'Failed to load rewards data' },
      { status: 500 }
    );
  }
}
