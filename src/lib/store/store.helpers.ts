// ============================================
// CUT CLUB STORE - Helper Functions
// ============================================

import type {
  StoreItem,
  StoreItemWithStatus,
  InventoryItem,
  InventoryItemWithDetails,
  RawStoreCategoryFromDb,
  RawStoreItemFromDb,
  RawInventoryFromDb,
  StoreCategory,
} from "./store.types";

// ============================================
// Voucher Code Generation
// ============================================
export function generateVoucherCode(
  clientId: number,
  itemId: number,
): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CC-${clientId}-${itemId}-${timestamp}-${random}`;
}

// ============================================
// Stock Status Calculation
// ============================================
export function calculateStockStatus(
  stockQuantity: number | null,
  unlimitedStock: boolean,
): "available" | "low_stock" | "out_of_stock" {
  if (unlimitedStock) return "available";
  if (stockQuantity === null) return "available";
  if (stockQuantity === 0) return "out_of_stock";
  if (stockQuantity <= 5) return "low_stock";
  return "available";
}

// ============================================
// Days Until Expiry Calculation
// ============================================
export function calculateDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// ============================================
// Check if Item is Expiring Soon
// ============================================
export function isExpiringSoon(expiresAt: string | null): boolean {
  const daysUntilExpiry = calculateDaysUntilExpiry(expiresAt);
  if (daysUntilExpiry === null) return false;
  return daysUntilExpiry <= 7 && daysUntilExpiry > 0;
}

// ============================================
// Calculate Expiry Date
// ============================================
export function calculateExpiryDate(
  purchaseDate: Date,
  expiresAfterDays: number | null,
): Date | null {
  if (!expiresAfterDays) return null;
  const expiry = new Date(purchaseDate);
  expiry.setDate(expiry.getDate() + expiresAfterDays);
  return expiry;
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
// Check if Client Can Access Item (tier check)
// ============================================
export function canClientAccessItem(
  clientTierCode: string,
  itemMinTierCode: string | null,
): boolean {
  if (!itemMinTierCode) return true;
  return getTierRank(clientTierCode) >= getTierRank(itemMinTierCode);
}

// ============================================
// Add Status to Store Item
// ============================================
export function addStatusToStoreItem(
  item: StoreItem,
  clientBalance: number,
  clientTierCode: string,
): StoreItemWithStatus {
  const canAfford = clientBalance >= item.priceCoins;
  const tierLocked = !canClientAccessItem(clientTierCode, item.minTierCode);
  const stockStatus = calculateStockStatus(
    item.stockQuantity,
    item.unlimitedStock,
  );

  return {
    ...item,
    canAfford,
    remainingCoinsAfterPurchase: clientBalance - item.priceCoins,
    tierLocked,
    stockStatus,
    remainingStock: item.unlimitedStock ? null : item.stockQuantity,
  };
}

// ============================================
// Add Details to Inventory Item
// ============================================
export function addDetailsToInventoryItem(
  inventory: InventoryItem,
): InventoryItemWithDetails {
  const daysUntilExpiry = calculateDaysUntilExpiry(inventory.expiresAt);
  const isExpiringSoonFlag = isExpiringSoon(inventory.expiresAt);
  const canUse = inventory.status === "ACTIVE" && (daysUntilExpiry === null || daysUntilExpiry > 0);

  return {
    ...inventory,
    daysUntilExpiry,
    isExpiringSoon: isExpiringSoonFlag,
    canUse,
  };
}

// ============================================
// Map Database Category to API Type
// ============================================
export function mapDbCategoryToApi(
  dbCategory: RawStoreCategoryFromDb,
): StoreCategory {
  return {
    categoryId: dbCategory.CategoryID,
    code: dbCategory.Code,
    nameAr: dbCategory.NameAr,
    nameEn: dbCategory.NameEn,
    descriptionAr: dbCategory.DescriptionAr,
    descriptionEn: dbCategory.DescriptionEn,
    icon: dbCategory.Icon,
    sortOrder: dbCategory.SortOrder,
    isActive: dbCategory.IsActive,
  };
}

// ============================================
// Map Database Store Item to API Type
// ============================================
export function mapDbStoreItemToApi(
  dbItem: RawStoreItemFromDb,
): StoreItem {
  return {
    itemId: dbItem.ItemID,
    categoryId: dbItem.CategoryID,
    code: dbItem.Code,
    nameAr: dbItem.NameAr,
    nameEn: dbItem.NameEn,
    descriptionAr: dbItem.DescriptionAr,
    descriptionEn: dbItem.DescriptionEn,
    itemType: dbItem.ItemType as StoreItem["itemType"],
    priceCoins: dbItem.PriceCoins,
    value: dbItem.Value,
    serviceId: dbItem.ServiceID,
    productId: dbItem.ProductID,
    minTierCode: dbItem.MinTierCode,
    stockQuantity: dbItem.StockQuantity,
    unlimitedStock: dbItem.UnlimitedStock,
    expiresAfterDays: dbItem.ExpiresAfterDays,
    imageUrl: dbItem.ImageUrl,
    badgeText: dbItem.BadgeText,
    isFeatured: dbItem.IsFeatured,
    isActive: dbItem.IsActive,
    sortOrder: dbItem.SortOrder,
  };
}

// ============================================
// Map Database Inventory to API Type
// ============================================
export function mapDbInventoryToApi(
  dbInventory: RawInventoryFromDb,
  item: StoreItem,
): InventoryItem {
  return {
    inventoryId: dbInventory.InventoryID,
    clientId: dbInventory.ClientID,
    itemId: dbInventory.ItemID,
    quantity: dbInventory.Quantity,
    status: dbInventory.Status as InventoryItem["status"],
    purchasePriceCoins: dbInventory.PurchasePriceCoins,
    voucherCode: dbInventory.VoucherCode,
    purchasedAt: new Date(dbInventory.PurchasedAt).toISOString(),
    expiresAt: dbInventory.ExpiresAt
      ? new Date(dbInventory.ExpiresAt).toISOString()
      : null,
    usedAt: dbInventory.UsedAt
      ? new Date(dbInventory.UsedAt).toISOString()
      : null,
    usedInvId: dbInventory.UsedInvID,
    usedBookingId: dbInventory.UsedBookingID,
    notes: dbInventory.Notes,
    item,
  };
}

// ============================================
// Weighted Random Selection for Mystery Box
// ============================================
export function selectWeightedRandom<T extends { probabilityWeight: number }>(
  items: T[],
): T | null {
  if (items.length === 0) return null;

  const totalWeight = items.reduce(
    (sum, item) => sum + item.probabilityWeight,
    0,
  );
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.probabilityWeight;
    if (random <= 0) {
      return item;
    }
  }

  return items[items.length - 1];
}

// ============================================
// Validate Purchase Conditions
// ============================================
export interface PurchaseValidation {
  valid: boolean;
  error?: string;
}

export function validatePurchase(
  item: StoreItem,
  clientBalance: number,
  clientTierCode: string,
): PurchaseValidation {
  // Check if item is active
  if (!item.isActive) {
    return { valid: false, error: "هذا العنصر غير متاح حالياً" };
  }

  // Check tier restriction
  if (!canClientAccessItem(clientTierCode, item.minTierCode)) {
    return {
      valid: false,
      error: "هذا العنصر يتطلب مستوى عضوية أعلى",
    };
  }

  // Check balance
  if (clientBalance < item.priceCoins) {
    return {
      valid: false,
      error: "رصيد العملات غير كافٍ لشراء هذا العنصر",
    };
  }

  // Check stock
  if (!item.unlimitedStock && item.stockQuantity !== null) {
    if (item.stockQuantity <= 0) {
      return { valid: false, error: "هذا العنصر غير متوفر في المخزون" };
    }
  }

  return { valid: true };
}

// ============================================
// Format Coins Display
// ============================================
export function formatCoins(coins: number): string {
  return `${coins.toLocaleString("en-US")} CC`;
}

// ============================================
// Get Item Type Display Name (Arabic)
// ============================================
export function getItemTypeNameAr(itemType: string): string {
  const names: Record<string, string> = {
    DISCOUNT_AMOUNT: "خصم بقيمة محددة",
    DISCOUNT_PERCENT: "خصم بنسبة مئوية",
    FREE_SERVICE: "خدمة مجانية",
    FREE_PRODUCT: "منتج مجاني",
    DOUBLE_POINTS: "نقاط مضاعفة",
    BONUS_POINTS: "نقاط إضافية",
    VIP_UPGRADE: "ترقية VIP",
    PRIORITY_BOOKING: "حجز ذو أولوية",
    MYSTERY_BOX: "صندوق مفاجآت",
    CUSTOM: "عنصر مخصص",
  };
  return names[itemType] || itemType;
}

// ============================================
// Get Inventory Status Display Name (Arabic)
// ============================================
export function getInventoryStatusNameAr(status: string): string {
  const names: Record<string, string> = {
    ACTIVE: "نشط",
    USED: "مستخدم",
    EXPIRED: "منتهي الصلاحية",
    CANCELLED: "ملغي",
  };
  return names[status] || status;
}
