// ============================================
// Client Loyalty Types for CUT CLUB Public API
// ============================================

export interface ClientBasicInfo {
  id: number;
  name: string;
  phone: string | null;
}

export interface MembershipInfo {
  memberId: string;
  tierCode: string;
  tierNameAr: string;
  tierNameEn: string;
  pointsBalance: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  lifetimeAdjustedPoints: number;
  totalVisits: number;
  totalSpend: number;
  lastVisitDate: string | null;
  lastEarnAt: string | null;
  memberSince: string | null;
  isActive: boolean;
}

export interface NextRewardInfo {
  id: number;
  titleAr: string;
  titleEn: string;
  requiredPoints: number;
  remainingPoints: number;
  progress: number;
}

export interface ClientStats {
  visits: number;
  rewardsUsed: number;
  favoriteBarber: string | null;
  lastEarnedPoints: number | null;
}

export interface LoyaltyReward {
  id: number;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  requiredPoints: number;
  status: "available" | "locked" | "tier_locked";
  remainingPoints: number;
  progress: number;
  rewardType: string;
  minTierCode: string | null;
}

export interface PersonalOffer {
  type: "DOUBLE_POINTS" | "COMEBACK" | "SERVICE_UPSELL" | "BIRTHDAY" | "NONE";
  titleAr: string;
  descriptionAr: string;
  ctaLabelAr: string;
}

export interface LoyaltyLevel {
  tierId: number;
  tierCode: string;
  tierNameAr: string;
  tierNameEn: string;
  minLifetimePoints: number;
  pointsMultiplier: number;
  sortOrder: number;
  isCurrent: boolean;
  isCompleted: boolean;
}

export interface ReferralInfo {
  code: string;
  shareUrl: string;
  rewardPoints: number;
}

export interface LoyaltyActivityItem {
  id: number;
  type: string;
  labelAr: string;
  points: number;
  pointsBefore: number;
  pointsAfter: number;
  date: string;
  notes: string | null;
  sourceInvId: number | null;
}

export interface RedemptionResult {
  rewardId: number;
  titleAr: string;
  titleEn: string;
  pointsCost: number;
  code: string;
}

// Main Dashboard Response
export interface ClientLoyaltyDashboardResponse {
  ok: true;
  client: ClientBasicInfo;
  membership: MembershipInfo;
  nextReward: NextRewardInfo | null;
  stats: ClientStats;
  rewards: LoyaltyReward[];
  personalOffer: PersonalOffer | null;
  levels: LoyaltyLevel[];
  referral: ReferralInfo;
  recentActivity: LoyaltyActivityItem[];
}

// Activity List Response
export interface LoyaltyActivityListResponse {
  ok: true;
  activity: LoyaltyActivityItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

// Rewards List Response
export interface LoyaltyRewardsResponse {
  ok: true;
  rewards: LoyaltyReward[];
  nextReward: NextRewardInfo | null;
}

// Redeem Response
export interface LoyaltyRedeemResponse {
  ok: true;
  message: string;
  redemption: RedemptionResult;
  newBalance: number;
}

// Referral Response
export interface ClientReferralResponse {
  ok: true;
  code: string;
  shareUrl: string;
  rewardPoints: number;
  totalReferred: number;
  successfulReferrals: number;
}

// Error Response
export interface LoyaltyErrorResponse {
  ok: false;
  error: string;
}

// Database raw types (for internal use)
export interface RawClientFromDb {
  ClientID: number;
  Name?: string;
  ClientName?: string;
  Mobile?: string;
  Phone?: string;
}

export interface RawClientLoyaltyFromDb {
  ClientLoyaltyID: number;
  ClientID: number;
  PointsBalance: number;
  LifetimeEarnedPoints: number;
  LifetimeRedeemedPoints: number;
  LifetimeAdjustedPoints: number;
  TierID: number;
  TotalVisits: number;
  TotalSpend: number;
  LastVisitDate: Date | null;
  LastEarnAt: Date | null;
  IsActive: boolean;
  CreatedAt: Date;
  UpdatedAt: Date | null;
  TierCode?: string;
  TierNameAr?: string;
  TierNameEn?: string;
  MinLifetimePoints?: number;
  PointsMultiplier?: number;
}

export interface RawLoyaltyTierFromDb {
  TierID: number;
  TierCode: string;
  TierNameAr: string;
  TierNameEn: string;
  MinLifetimePoints: number;
  PointsMultiplier: number;
  SortOrder: number;
  IsActive: boolean;
}

export interface RawLoyaltyLedgerFromDb {
  LedgerID: number;
  ClientLoyaltyID: number;
  MovementType: string;
  PointsDelta: number;
  PointsBefore: number;
  PointsAfter: number;
  SourceInvID: number | null;
  SourceInvType: string | null;
  InvoiceAmount: number | null;
  Notes: string | null;
  CreatedAt: Date;
}
