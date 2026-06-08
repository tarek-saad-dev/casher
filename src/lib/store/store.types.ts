// ============================================
// CUT CLUB STORE - Type Definitions
// ============================================

// ============================================
// Store Category Types
// ============================================
export interface StoreCategory {
  categoryId: number;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
}

// ============================================
// Store Item Types
// ============================================
export type ItemType =
  | "DISCOUNT_AMOUNT"
  | "DISCOUNT_PERCENT"
  | "FREE_SERVICE"
  | "FREE_PRODUCT"
  | "DOUBLE_POINTS"
  | "BONUS_POINTS"
  | "VIP_UPGRADE"
  | "PRIORITY_BOOKING"
  | "MYSTERY_BOX"
  | "CUSTOM";

export interface StoreItem {
  itemId: number;
  categoryId: number;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  itemType: ItemType;
  priceCoins: number;
  value: number | null;
  serviceId: number | null;
  productId: number | null;
  minTierCode: string | null;
  stockQuantity: number | null;
  unlimitedStock: boolean;
  expiresAfterDays: number | null;
  imageUrl: string | null;
  badgeText: string | null;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface StoreItemWithStatus extends StoreItem {
  canAfford: boolean;
  remainingCoinsAfterPurchase: number;
  tierLocked: boolean;
  stockStatus: "available" | "low_stock" | "out_of_stock";
  remainingStock: number | null;
}

// ============================================
// Inventory Types
// ============================================
export type InventoryStatus = "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED";

export interface InventoryItem {
  inventoryId: number;
  clientId: number;
  itemId: number;
  quantity: number;
  status: InventoryStatus;
  purchasePriceCoins: number;
  voucherCode: string;
  purchasedAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedInvId: number | null;
  usedBookingId: number | null;
  notes: string | null;
  item: StoreItem;
}

export interface InventoryItemWithDetails extends InventoryItem {
  daysUntilExpiry: number | null;
  isExpiringSoon: boolean;
  canUse: boolean;
}

// ============================================
// Mystery Box Types
// ============================================
export type MysteryBoxRewardType =
  | "COINS"
  | "STORE_ITEM"
  | "DISCOUNT"
  | "BONUS_POINTS"
  | "JACKPOT";

export interface MysteryBoxReward {
  rewardId: number;
  boxItemId: number;
  rewardType: MysteryBoxRewardType;
  rewardValue: number;
  rewardItemId: number | null;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  probabilityWeight: number;
  isActive: boolean;
}

export interface MysteryBoxOpenResult {
  ok: true;
  success: boolean;
  reward: {
    type: MysteryBoxRewardType;
    nameAr: string;
    nameEn: string;
    value: number;
    itemId: number | null;
  };
  newBalance: number;
}

// ============================================
// Referral Types
// ============================================
export type ReferralStatus = "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED";

export interface ClientReferral {
  referralId: number;
  referrerClientId: number;
  referredClientId: number | null;
  referralCode: string;
  referredPhone: string | null;
  status: ReferralStatus;
  referrerRewardCoins: number | null;
  referredRewardCoins: number | null;
  referrerRewardGiven: boolean;
  referredRewardGiven: boolean;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface ReferralRewardRule {
  rewardRuleId: number;
  ruleName: string;
  referrerRewardCoins: number;
  referredRewardCoins: number;
  minFirstPurchaseAmount: number | null;
  requireCompletedVisit: boolean;
  validFromDate: string | null;
  validToDate: string | null;
  isActive: boolean;
  isDefault: boolean;
}

// ============================================
// API Response Types
// ============================================
export interface StoreResponse {
  ok: true;
  balance: number;
  categories: StoreCategory[];
  featuredItems: StoreItemWithStatus[];
  items: StoreItemWithStatus[];
}

export interface StoreItemResponse {
  ok: true;
  item: StoreItemWithStatus;
  relatedItems: StoreItemWithStatus[];
}

export interface PurchaseResponse {
  ok: true;
  message: string;
  purchase: {
    inventoryId: number;
    itemId: number;
    nameAr: string;
    nameEn: string;
    priceCoins: number;
    voucherCode: string;
    expiresAt: string | null;
  };
  newBalance: number;
}

export interface InventoryResponse {
  ok: true;
  items: InventoryItemWithDetails[];
  stats: {
    totalActive: number;
    totalUsed: number;
    expiringThisWeek: number;
  };
}

export interface InventoryItemDetailResponse {
  ok: true;
  item: InventoryItemWithDetails;
  usageHistory: InventoryUsageLog[];
}

export interface InventoryUsageLog {
  usageId: number;
  actionType: string;
  usedAt: string;
  notes: string | null;
  invId: number | null;
  bookingId: number | null;
}

export interface POSClientInventoryResponse {
  ok: true;
  clientId: number;
  clientName: string;
  activeItems: InventoryItemWithDetails[];
}

export interface POSUseItemResponse {
  ok: true;
  message: string;
  usedItem: {
    inventoryId: number;
    itemType: ItemType;
    nameAr: string;
    value: number | null;
  };
  appliedEffect: string;
}

export interface StoreErrorResponse {
  ok: false;
  error: string;
}

// ============================================
// Database Raw Types
// ============================================
export interface RawStoreCategoryFromDb {
  CategoryID: number;
  SalonID: number | null;
  Code: string;
  NameAr: string;
  NameEn: string;
  DescriptionAr: string | null;
  DescriptionEn: string | null;
  Icon: string | null;
  SortOrder: number;
  IsActive: boolean;
  CreatedAt: Date;
  UpdatedAt: Date | null;
}

export interface RawStoreItemFromDb {
  ItemID: number;
  CategoryID: number;
  SalonID: number | null;
  Code: string;
  NameAr: string;
  NameEn: string;
  DescriptionAr: string;
  DescriptionEn: string;
  ItemType: string;
  PriceCoins: number;
  Value: number | null;
  ServiceID: number | null;
  ProductID: number | null;
  MinTierID: number | null;
  MinTierCode: string | null;
  StockQuantity: number | null;
  UnlimitedStock: boolean;
  ExpiresAfterDays: number | null;
  ImageUrl: string | null;
  BadgeText: string | null;
  IsFeatured: boolean;
  IsActive: boolean;
  SortOrder: number;
  CreatedAt: Date;
  UpdatedAt: Date | null;
}

export interface RawInventoryFromDb {
  InventoryID: number;
  ClientID: number;
  ItemID: number;
  Quantity: number;
  Status: string;
  PurchasePriceCoins: number;
  VoucherCode: string;
  PurchasedAt: Date;
  ExpiresAt: Date | null;
  UsedAt: Date | null;
  UsedInvID: number | null;
  UsedBookingID: number | null;
  Notes: string | null;
}

export interface RawMysteryBoxRewardFromDb {
  RewardID: number;
  BoxItemID: number;
  SalonID: number | null;
  RewardType: string;
  RewardValue: number;
  RewardItemID: number | null;
  ProbabilityWeight: number;
  NameAr: string;
  NameEn: string;
  DescriptionAr: string | null;
  DescriptionEn: string | null;
  IsActive: boolean;
  CreatedAt: Date;
  UpdatedAt: Date | null;
}

export interface RawClientReferralFromDb {
  ReferralID: number;
  ReferrerClientID: number;
  ReferredClientID: number | null;
  SalonID: number | null;
  ReferralCode: string;
  ReferredPhone: string | null;
  Status: string;
  ReferrerRewardCoins: number | null;
  ReferredRewardCoins: number | null;
  ReferrerRewardGiven: boolean;
  ReferredRewardGiven: boolean;
  CreatedAt: Date;
  CompletedAt: Date | null;
  ExpiresAt: Date | null;
  Notes: string | null;
}
