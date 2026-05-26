// ============================================
// GET /api/public/client/loyalty/me
// Client Loyalty Dashboard for CUT CLUB
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import type {
  ClientLoyaltyDashboardResponse,
  LoyaltyErrorResponse,
  ClientBasicInfo,
  MembershipInfo,
  ClientStats,
  PersonalOffer,
  ReferralInfo,
  LoyaltyActivityItem,
  LoyaltyLevel,
} from "@/lib/loyalty/types";
import {
  buildRewardsForClient,
  getNextReward,
  determinePersonalOffer,
  buildLevels,
  mapLedgerToActivityItem,
  formatMemberId,
  generateReferralCode,
  generateReferralShareUrl,
} from "@/lib/loyalty/helpers";

export const runtime = "nodejs";

/**
 * GET /api/public/client/loyalty/me
 *
 * TODO: During development, accepts clientId as query param.
 * Replace with authenticated client session / OTP token later.
 */
export async function GET(
  req: NextRequest,
): Promise<
  NextResponse<ClientLoyaltyDashboardResponse | LoyaltyErrorResponse>
> {
  try {
    // TODO: Replace with authenticated session / OTP token
    const { searchParams } = new URL(req.url);
    const clientIdParam = searchParams.get("clientId");

    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "clientId is required in development mode" },
        { status: 400 },
      );
    }

    const clientId = parseInt(clientIdParam, 10);
    if (isNaN(clientId) || clientId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid clientId" },
        { status: 400 },
      );
    }

    const db = await getPool();

    // ============================================
    // 1. Get Client Basic Info
    // ============================================
    const clientResult = await db.request().input("clientId", sql.Int, clientId)
      .query(`
        SELECT 
          c.ClientID,
          c.Name as ClientName,
          c.Mobile as Phone
        FROM [dbo].[TblClient] c
        WHERE c.ClientID = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Client not found" },
        { status: 404 },
      );
    }

    const rawClient = clientResult.recordset[0];
    const client: ClientBasicInfo = {
      id: rawClient.ClientID,
      name: rawClient.ClientName || "",
      phone: rawClient.Phone || null,
    };

    // ============================================
    // 2. Get All Active Tiers (for levels calculation)
    // ============================================
    const tiersResult = await db.request().query(`
      SELECT 
        TierID,
        TierCode,
        TierNameAr,
        TierNameEn,
        MinLifetimePoints,
        PointsMultiplier,
        SortOrder
      FROM [dbo].[TblLoyaltyTier]
      WHERE IsActive = 1
      ORDER BY SortOrder, MinLifetimePoints
    `);

    const tiers = tiersResult.recordset;

    // ============================================
    // 3. Get Client Loyalty Data (or create default for new client)
    // ============================================
    const loyaltyResult = await db
      .request()
      .input("clientId", sql.Int, clientId).query(`
        SELECT 
          cl.ClientLoyaltyID,
          cl.PointsBalance,
          cl.LifetimeEarnedPoints,
          cl.LifetimeRedeemedPoints,
          cl.LifetimeAdjustedPoints,
          cl.TierID,
          cl.TotalVisits,
          cl.TotalSpend,
          cl.LastVisitDate,
          cl.LastEarnAt,
          cl.IsActive,
          cl.CreatedAt,
          lt.TierCode,
          lt.TierNameAr,
          lt.TierNameEn,
          lt.MinLifetimePoints,
          lt.PointsMultiplier
        FROM [dbo].[TblClientLoyalty] cl
        LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
        WHERE cl.ClientID = @clientId
      `);

    let membership: MembershipInfo;
    let pointsBalance = 0;
    let tierCode = "BRONZE";
    let lifetimeEarnedPoints = 0;
    let clientLoyaltyId: number | null = null;

    if (loyaltyResult.recordset.length === 0) {
      // New client - use default tier (first active tier or BRONZE)
      const defaultTier = tiers[0] || {
        TierCode: "BRONZE",
        TierNameAr: "برونز",
        TierNameEn: "Bronze",
        MinLifetimePoints: 0,
        PointsMultiplier: 1,
      };

      membership = {
        memberId: "PENDING",
        tierCode: defaultTier.TierCode,
        tierNameAr: defaultTier.TierNameAr,
        tierNameEn: defaultTier.TierNameEn,
        pointsBalance: 0,
        lifetimeEarnedPoints: 0,
        lifetimeRedeemedPoints: 0,
        lifetimeAdjustedPoints: 0,
        totalVisits: 0,
        totalSpend: 0,
        lastVisitDate: null,
        lastEarnAt: null,
        memberSince: null,
        isActive: true,
      };

      tierCode = defaultTier.TierCode;
      lifetimeEarnedPoints = 0;
    } else {
      const rawLoyalty = loyaltyResult.recordset[0];
      clientLoyaltyId = rawLoyalty.ClientLoyaltyID;
      pointsBalance = rawLoyalty.PointsBalance || 0;
      tierCode = rawLoyalty.TierCode || "BRONZE";
      lifetimeEarnedPoints = rawLoyalty.LifetimeEarnedPoints || 0;

      membership = {
        memberId: formatMemberId(rawLoyalty.ClientLoyaltyID),
        tierCode: rawLoyalty.TierCode || "BRONZE",
        tierNameAr: rawLoyalty.TierNameAr || "برونز",
        tierNameEn: rawLoyalty.TierNameEn || "Bronze",
        pointsBalance: rawLoyalty.PointsBalance || 0,
        lifetimeEarnedPoints: rawLoyalty.LifetimeEarnedPoints || 0,
        lifetimeRedeemedPoints: rawLoyalty.LifetimeRedeemedPoints || 0,
        lifetimeAdjustedPoints: rawLoyalty.LifetimeAdjustedPoints || 0,
        totalVisits: rawLoyalty.TotalVisits || 0,
        totalSpend: rawLoyalty.TotalSpend || 0,
        lastVisitDate: rawLoyalty.LastVisitDate
          ? new Date(rawLoyalty.LastVisitDate).toISOString()
          : null,
        lastEarnAt: rawLoyalty.LastEarnAt
          ? new Date(rawLoyalty.LastEarnAt).toISOString()
          : null,
        memberSince: rawLoyalty.CreatedAt
          ? new Date(rawLoyalty.CreatedAt).toISOString()
          : null,
        isActive: rawLoyalty.IsActive !== false,
      };
    }

    // ============================================
    // 4. Build Rewards
    // ============================================
    const rewards = buildRewardsForClient(pointsBalance, tierCode);
    const nextReward = getNextReward(rewards);

    // ============================================
    // 5. Build Levels
    // ============================================
    const levels: LoyaltyLevel[] = buildLevels(
      tiers,
      tierCode,
      lifetimeEarnedPoints,
    );

    // ============================================
    // 6. Get Recent Activity (last 5 entries)
    // ============================================
    let recentActivity: LoyaltyActivityItem[] = [];

    if (clientLoyaltyId) {
      const ledgerResult = await db
        .request()
        .input("clientLoyaltyId", sql.Int, clientLoyaltyId).query(`
          SELECT TOP 5
            LedgerID,
            MovementType,
            PointsDelta,
            PointsBefore,
            PointsAfter,
            SourceInvID,
            Notes,
            CreatedAt
          FROM [dbo].[TblLoyaltyPointLedger]
          WHERE ClientLoyaltyID = @clientLoyaltyId
          ORDER BY CreatedAt DESC, LedgerID DESC
        `);

      recentActivity = ledgerResult.recordset.map(mapLedgerToActivityItem);
    }

    // ============================================
    // 7. Get Stats
    // ============================================
    let rewardsUsed = 0;
    let lastEarnedPoints: number | null = null;

    if (clientLoyaltyId) {
      // Count redemptions
      const redeemCountResult = await db
        .request()
        .input("clientLoyaltyId", sql.Int, clientLoyaltyId).query(`
          SELECT COUNT(*) as count
          FROM [dbo].[TblLoyaltyPointLedger]
          WHERE ClientLoyaltyID = @clientLoyaltyId
            AND MovementType = 'REDEEM'
        `);

      rewardsUsed = redeemCountResult.recordset[0]?.count || 0;

      // Get last earned points
      const lastEarnResult = await db
        .request()
        .input("clientLoyaltyId", sql.Int, clientLoyaltyId).query(`
          SELECT TOP 1 PointsDelta
          FROM [dbo].[TblLoyaltyPointLedger]
          WHERE ClientLoyaltyID = @clientLoyaltyId
            AND PointsDelta > 0
          ORDER BY CreatedAt DESC
        `);

      if (lastEarnResult.recordset.length > 0) {
        lastEarnedPoints = lastEarnResult.recordset[0].PointsDelta;
      }
    }

    // TODO: Calculate favorite barber from bookings/invoices if relationships are clear
    const stats: ClientStats = {
      visits: membership.totalVisits,
      rewardsUsed,
      favoriteBarber: null, // Reserved for future implementation
      lastEarnedPoints,
    };

    // ============================================
    // 8. Determine Personal Offer
    // ============================================
    const personalOffer: PersonalOffer | null = determinePersonalOffer(
      membership.lastVisitDate,
      membership.totalVisits,
    );

    // ============================================
    // 9. Build Referral Info
    // ============================================
    // TODO: Replace with DB lookup when TblClientReferral is created
    const referralCode = generateReferralCode(clientId);
    const referral: ReferralInfo = {
      code: referralCode,
      shareUrl: generateReferralShareUrl(referralCode),
      rewardPoints: 100,
    };

    // ============================================
    // 10. Build Response
    // ============================================
    const response: ClientLoyaltyDashboardResponse = {
      ok: true,
      client,
      membership,
      nextReward,
      stats,
      rewards,
      personalOffer,
      levels,
      referral,
      recentActivity,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/loyalty/me] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load loyalty data" },
      { status: 500 },
    );
  }
}
