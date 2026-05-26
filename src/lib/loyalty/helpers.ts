// ============================================
// Client Loyalty Helpers for CUT CLUB
// ============================================

import type {
  LoyaltyReward,
  LoyaltyLevel,
  NextRewardInfo,
  LoyaltyActivityItem,
} from "./types";

// ============================================
// Static Rewards Definition (Temporary until DB table is created)
// TODO: Move to TblLoyaltyReward when table is created
// ============================================
export const STATIC_REWARDS: Omit<
  LoyaltyReward,
  "status" | "remainingPoints" | "progress"
>[] = [
  {
    id: 1,
    titleAr: "خصم 50 جنيه",
    titleEn: "50 EGP Discount",
    descriptionAr: "استخدم نقاطك للحصول على خصم مباشر على زيارتك القادمة",
    descriptionEn:
      "Redeem your points for a direct discount on your next visit",
    requiredPoints: 220,
    rewardType: "DISCOUNT_AMOUNT",
    minTierCode: null,
  },
  {
    id: 2,
    titleAr: "تسريح مجاني",
    titleEn: "Free Styling",
    descriptionAr: "افتح خدمة تسريح مجانية مع زيارتك القادمة",
    descriptionEn: "Unlock a free styling service on your next visit",
    requiredPoints: 400,
    rewardType: "FREE_SERVICE",
    minTierCode: null,
  },
  {
    id: 3,
    titleAr: "تنظيف بشرة مجاني",
    titleEn: "Free Skin Cleaning",
    descriptionAr: "استبدل نقاطك بجلسة تنظيف بشرة مجانية",
    descriptionEn: "Redeem your points for a free skin cleaning session",
    requiredPoints: 600,
    rewardType: "FREE_SERVICE",
    minTierCode: null,
  },
  {
    id: 4,
    titleAr: "ترقية VIP Package",
    titleEn: "VIP Package Upgrade",
    descriptionAr: "ترقية خاصة على الباكدج لعملاء CUT CLUB",
    descriptionEn: "Special package upgrade for CUT CLUB members",
    requiredPoints: 1200,
    rewardType: "UPGRADE",
    minTierCode: "GOLD",
  },
];

// ============================================
// Movement Type Mapping to Arabic Labels
// ============================================
export function mapLoyaltyMovementTypeToArabicLabel(type: string): string {
  const labels: Record<string, string> = {
    EARN_SALE: "كسب نقاط من زيارة",
    ADJUST_ADD: "إضافة نقاط",
    ADJUST_SUBTRACT: "خصم نقاط",
    REVERSAL: "عكس نقاط فاتورة",
    REDEEM: "استبدال مكافأة",
    REFERRAL_BONUS: "مكافأة دعوة صديق",
  };

  return labels[type] || "حركة نقاط";
}

// ============================================
// Progress Calculation
// ============================================
export function calculateProgress(
  currentPoints: number,
  requiredPoints: number,
): number {
  if (requiredPoints <= 0) return 100;
  return Math.min(100, Math.round((currentPoints / requiredPoints) * 100));
}

// ============================================
// Generate Rewards for Client (with status calculation)
// ============================================
export function buildRewardsForClient(
  pointsBalance: number,
  tierCode: string,
): LoyaltyReward[] {
  // Define tier ranking for comparison
  const tierRanking: Record<string, number> = {
    BRONZE: 1,
    SILVER: 2,
    GOLD: 3,
    VIP: 4,
  };

  const currentTierRank = tierRanking[tierCode] || 1;

  return STATIC_REWARDS.map((reward) => {
    const rewardTierRank = reward.minTierCode
      ? tierRanking[reward.minTierCode] || 0
      : 0;

    // Determine status
    let status: LoyaltyReward["status"];
    if (reward.minTierCode && currentTierRank < rewardTierRank) {
      status = "tier_locked";
    } else if (pointsBalance >= reward.requiredPoints) {
      status = "available";
    } else {
      status = "locked";
    }

    const remainingPoints = Math.max(0, reward.requiredPoints - pointsBalance);
    const progress = calculateProgress(pointsBalance, reward.requiredPoints);

    return {
      ...reward,
      status,
      remainingPoints,
      progress,
    };
  });
}

// ============================================
// Get Next Reward (first locked reward by lowest required points)
// ============================================
export function getNextReward(rewards: LoyaltyReward[]): NextRewardInfo | null {
  // Filter available and tier_locked rewards
  const lockedRewards = rewards.filter((r) => r.status === "locked");

  if (lockedRewards.length === 0) {
    return null;
  }

  // Sort by required points ascending and take first
  const nextReward = lockedRewards.sort(
    (a, b) => a.requiredPoints - b.requiredPoints,
  )[0];

  return {
    id: nextReward.id,
    titleAr: nextReward.titleAr,
    titleEn: nextReward.titleEn,
    requiredPoints: nextReward.requiredPoints,
    remainingPoints: nextReward.remainingPoints,
    progress: nextReward.progress,
  };
}

// ============================================
// Generate Referral Code
// TODO: Replace with DB lookup when TblClientReferral is created
// ============================================
export function generateReferralCode(clientId: number): string {
  return `CUT-${clientId}`;
}

// ============================================
// Generate Referral Share URL
// ============================================
export function generateReferralShareUrl(code: string): string {
  return `https://cutsaloon.com/ref/${code}`;
}

// ============================================
// Generate Reward Redemption Code
// TODO: Replace with DB storage when TblLoyaltyRewardRedemption is created
// ============================================
export function generateRewardRedeemCode(
  clientId: number,
  rewardId: number,
): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  return `RW-CUT-${clientId}-${rewardId}-${timestamp}`;
}

// ============================================
// Determine Personal Offer Based on Client State
// ============================================
export function determinePersonalOffer(
  lastVisitDate: string | null,
  _totalVisits: number,
): {
  type: "DOUBLE_POINTS" | "COMEBACK" | "SERVICE_UPSELL" | "BIRTHDAY" | "NONE";
  titleAr: string;
  descriptionAr: string;
  ctaLabelAr: string;
} | null {
  // _totalVisits reserved for future personalization logic

  // Check for comeback offer (last visit > 45 days ago)
  if (lastVisitDate) {
    const lastVisit = new Date(lastVisitDate);
    const daysSinceLastVisit = Math.floor(
      (Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceLastVisit > 45) {
      return {
        type: "COMEBACK",
        titleAr: "وحشتنا في Cut",
        descriptionAr:
          "ارجع خلال الأسبوع ده وخد نقاط إضافية على زيارتك القادمة",
        ctaLabelAr: "احجز زيارتك",
      };
    }
  }

  // Default offer for active clients
  return {
    type: "DOUBLE_POINTS",
    titleAr: "عرض مخصوص ليك",
    descriptionAr: "احجز Haircut & Beard هذا الأسبوع وخد نقاط مضاعفة",
    ctaLabelAr: "احجز العرض",
  };
}

// ============================================
// Build Levels with Completion Status
// ============================================
export function buildLevels(
  tiers: {
    TierID: number;
    TierCode: string;
    TierNameAr: string;
    TierNameEn: string;
    MinLifetimePoints: number;
    PointsMultiplier: number;
    SortOrder: number;
  }[],
  currentTierCode: string,
  lifetimeEarnedPoints: number,
): LoyaltyLevel[] {
  return tiers.map((tier) => {
    const isCurrent = tier.TierCode === currentTierCode;
    const isCompleted = lifetimeEarnedPoints >= tier.MinLifetimePoints;

    return {
      tierId: tier.TierID,
      tierCode: tier.TierCode,
      tierNameAr: tier.TierNameAr,
      tierNameEn: tier.TierNameEn,
      minLifetimePoints: tier.MinLifetimePoints,
      pointsMultiplier: tier.PointsMultiplier,
      sortOrder: tier.SortOrder,
      isCurrent,
      isCompleted,
    };
  });
}

// ============================================
// Map Ledger Entry to Activity Item
// ============================================
export function mapLedgerToActivityItem(ledger: {
  LedgerID: number;
  MovementType: string;
  PointsDelta: number;
  PointsBefore: number;
  PointsAfter: number;
  SourceInvID: number | null;
  Notes: string | null;
  CreatedAt: Date;
}): LoyaltyActivityItem {
  return {
    id: ledger.LedgerID,
    type: ledger.MovementType,
    labelAr: mapLoyaltyMovementTypeToArabicLabel(ledger.MovementType),
    points: ledger.PointsDelta,
    pointsBefore: ledger.PointsBefore,
    pointsAfter: ledger.PointsAfter,
    date: new Date(ledger.CreatedAt).toISOString(),
    notes: ledger.Notes,
    sourceInvId: ledger.SourceInvID,
  };
}

// ============================================
// Format Member ID
// ============================================
export function formatMemberId(clientLoyaltyId: number): string {
  return `CC-${clientLoyaltyId.toString().padStart(6, "0")}`;
}

// ============================================
// Get Reward by ID
// ============================================
export function getRewardById(
  rewardId: number,
): (typeof STATIC_REWARDS)[0] | undefined {
  return STATIC_REWARDS.find((r) => r.id === rewardId);
}

// ============================================
// Tier Ranking Helper
// ============================================
export function getTierRank(tierCode: string): number {
  const tierRanking: Record<string, number> = {
    BRONZE: 1,
    SILVER: 2,
    GOLD: 3,
    VIP: 4,
  };
  return tierRanking[tierCode] || 0;
}

// ============================================
// Can Client Access Reward (tier check)
// ============================================
export function canClientAccessReward(
  clientTierCode: string,
  rewardMinTierCode: string | null,
): boolean {
  if (!rewardMinTierCode) return true;
  return getTierRank(clientTierCode) >= getTierRank(rewardMinTierCode);
}
