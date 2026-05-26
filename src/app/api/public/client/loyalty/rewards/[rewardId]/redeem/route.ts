// ============================================
// POST /api/public/client/loyalty/rewards/[rewardId]/redeem
// Redeem a Loyalty Reward
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { 
  LoyaltyRedeemResponse, 
  LoyaltyErrorResponse
} from '@/lib/loyalty/types';
import { 
  getRewardById, 
  canClientAccessReward,
  generateRewardRedeemCode 
} from '@/lib/loyalty/helpers';

export const runtime = 'nodejs';

/**
 * POST /api/public/client/loyalty/rewards/[rewardId]/redeem
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 * - rewardId: number (from path param)
 * 
 * Body:
 * - confirm: boolean (must be true)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ rewardId: string }> }
): Promise<NextResponse<LoyaltyRedeemResponse | LoyaltyErrorResponse>> {
  try {
    // Get rewardId from path params
    const { rewardId: rewardIdStr } = await params;
    const rewardId = parseInt(rewardIdStr, 10);
    
    if (isNaN(rewardId) || rewardId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid rewardId' },
        { status: 400 }
      );
    }

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

    // Parse body
    const body = await req.json();
    
    if (!body.confirm || body.confirm !== true) {
      return NextResponse.json(
        { ok: false, error: 'Confirmation required. Set confirm: true to redeem.' },
        { status: 400 }
      );
    }

    const db = await getPool();

    // ============================================
    // 1. Get Reward Details (from static list)
    // ============================================
    const reward = getRewardById(rewardId);
    
    if (!reward) {
      return NextResponse.json(
        { ok: false, error: 'Reward not found' },
        { status: 404 }
      );
    }

    // ============================================
    // 2. Get Client Loyalty Data
    // ============================================
    const loyaltyResult = await db.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cl.ClientLoyaltyID,
          cl.PointsBalance,
          cl.LifetimeRedeemedPoints,
          lt.TierCode
        FROM [dbo].[TblClientLoyalty] cl
        LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
        WHERE cl.ClientID = @clientId
      `);

    if (loyaltyResult.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Client loyalty account not found' },
        { status: 404 }
      );
    }

    const loyalty = loyaltyResult.recordset[0];
    const clientLoyaltyId = loyalty.ClientLoyaltyID;
    const pointsBalance = loyalty.PointsBalance || 0;
    const tierCode = loyalty.TierCode || 'BRONZE';
    const lifetimeRedeemedPoints = loyalty.LifetimeRedeemedPoints || 0;

    // ============================================
    // 3. Validation Checks
    // ============================================
    
    // Check tier restriction
    if (!canClientAccessReward(tierCode, reward.minTierCode)) {
      return NextResponse.json(
        { ok: false, error: 'This reward requires a higher membership tier' },
        { status: 400 }
      );
    }

    // Check points balance
    if (pointsBalance < reward.requiredPoints) {
      return NextResponse.json(
        { ok: false, error: 'رصيد النقاط غير كافي لاستبدال هذه المكافأة' },
        { status: 400 }
      );
    }

    // ============================================
    // 4. Process Redemption in Transaction
    // ============================================
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      const newPointsBalance = pointsBalance - reward.requiredPoints;
      const newLifetimeRedeemed = lifetimeRedeemedPoints + reward.requiredPoints;
      
      // Generate idempotency key
      const idempotencyKey = `REDEEM-${clientId}-${rewardId}-${Date.now()}`;
      
      // Generate redemption code
      // TODO: Store in TblLoyaltyRewardRedemption when table is created
      const redemptionCode = generateRewardRedeemCode(clientId, rewardId);

      // 1. Insert ledger entry
      const ledgerReq = new sql.Request(transaction);
      ledgerReq
        .input('clientLoyaltyId', sql.Int, clientLoyaltyId)
        .input('movementType', sql.NVarChar(20), 'REDEEM')
        .input('pointsDelta', sql.Decimal(10, 2), -reward.requiredPoints)
        .input('pointsBefore', sql.Decimal(10, 2), pointsBalance)
        .input('pointsAfter', sql.Decimal(10, 2), newPointsBalance)
        .input('notes', sql.NVarChar(500), `Redeemed reward: ${reward.titleAr}`)
        .input('idempotencyKey', sql.NVarChar(100), idempotencyKey);

      await ledgerReq.query(`
        INSERT INTO [dbo].[TblLoyaltyPointLedger] (
          ClientLoyaltyID,
          MovementType,
          PointsDelta,
          PointsBefore,
          PointsAfter,
          Notes,
          IdempotencyKey,
          CreatedAt
        ) VALUES (
          @clientLoyaltyId,
          @movementType,
          @pointsDelta,
          @pointsBefore,
          @pointsAfter,
          @notes,
          @idempotencyKey,
          GETDATE()
        )
      `);

      // 2. Update client loyalty
      const updateReq = new sql.Request(transaction);
      updateReq
        .input('clientLoyaltyId', sql.Int, clientLoyaltyId)
        .input('newBalance', sql.Decimal(10, 2), newPointsBalance)
        .input('newRedeemed', sql.Decimal(10, 2), newLifetimeRedeemed);

      await updateReq.query(`
        UPDATE [dbo].[TblClientLoyalty]
        SET 
          PointsBalance = @newBalance,
          LifetimeRedeemedPoints = @newRedeemed,
          UpdatedAt = GETDATE()
        WHERE ClientLoyaltyID = @clientLoyaltyId
      `);

      // TODO: Insert into TblLoyaltyRewardRedemption when table is created
      // For now, the redemption code is generated but not persisted

      await transaction.commit();

      // ============================================
      // 5. Build Response
      // ============================================
      const response: LoyaltyRedeemResponse = {
        ok: true,
        message: 'تم استبدال المكافأة بنجاح',
        redemption: {
          rewardId,
          titleAr: reward.titleAr,
          titleEn: reward.titleEn,
          pointsCost: reward.requiredPoints,
          code: redemptionCode
        },
        newBalance: newPointsBalance
      };

      return NextResponse.json(response);

    } catch (err: unknown) {
      await transaction.rollback();
      throw err;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/public/client/loyalty/rewards/redeem] POST error:', message);
    return NextResponse.json(
      { ok: false, error: 'Failed to redeem reward' },
      { status: 500 }
    );
  }
}
