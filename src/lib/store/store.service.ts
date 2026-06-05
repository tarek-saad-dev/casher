// ============================================
// CUT CLUB STORE - Store Service Layer
// ============================================

import { getPool, sql } from "@/lib/db";
import type {
  StoreCategory,
  StoreItem,
  StoreItemWithStatus,
  RawStoreCategoryFromDb,
  RawStoreItemFromDb,
} from "./store.types";
import {
  mapDbCategoryToApi,
  mapDbStoreItemToApi,
  addStatusToStoreItem,
  validatePurchase,
  generateVoucherCode,
  calculateExpiryDate,
} from "./store.helpers";
import { isValidItemId, isValidClientId } from "./store.validators";

// ============================================
// Get All Store Categories
// ============================================
export async function getStoreCategories(
  salonId: number | null = null,
): Promise<StoreCategory[]> {
  const db = await getPool();

  const query = `
    SELECT 
      CategoryID,
      SalonID,
      Code,
      NameAr,
      NameEn,
      DescriptionAr,
      DescriptionEn,
      Icon,
      SortOrder,
      IsActive,
      CreatedAt,
      UpdatedAt
    FROM [dbo].[TblLoyaltyStoreCategory]
    WHERE IsActive = 1
      AND (SalonID IS NULL OR SalonID = @salonId)
    ORDER BY SortOrder, CategoryID
  `;

  const result = await db
    .request()
    .input("salonId", sql.Int, salonId)
    .query<RawStoreCategoryFromDb>(query);

  return result.recordset.map(mapDbCategoryToApi);
}

// ============================================
// Get Store Items by Category
// ============================================
export async function getStoreItemsByCategory(
  categoryId: number,
  salonId: number | null = null,
): Promise<StoreItem[]> {
  const db = await getPool();

  const query = `
    SELECT 
      si.ItemID,
      si.CategoryID,
      si.SalonID,
      si.Code,
      si.NameAr,
      si.NameEn,
      si.DescriptionAr,
      si.DescriptionEn,
      si.ItemType,
      si.PriceCoins,
      si.Value,
      si.ServiceID,
      si.ProductID,
      si.MinTierID,
      lt.TierCode as MinTierCode,
      si.StockQuantity,
      si.UnlimitedStock,
      si.ExpiresAfterDays,
      si.ImageUrl,
      si.BadgeText,
      si.IsFeatured,
      si.IsActive,
      si.SortOrder,
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.CategoryID = @categoryId
      AND si.IsActive = 1
      AND (si.SalonID IS NULL OR si.SalonID = @salonId)
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await db
    .request()
    .input("categoryId", sql.Int, categoryId)
    .input("salonId", sql.Int, salonId)
    .query<RawStoreItemFromDb>(query);

  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// Get All Store Items
// ============================================
export async function getAllStoreItems(
  salonId: number | null = null,
): Promise<StoreItem[]> {
  const db = await getPool();

  const query = `
    SELECT 
      si.ItemID,
      si.CategoryID,
      si.SalonID,
      si.Code,
      si.NameAr,
      si.NameEn,
      si.DescriptionAr,
      si.DescriptionEn,
      si.ItemType,
      si.PriceCoins,
      si.Value,
      si.ServiceID,
      si.ProductID,
      si.MinTierID,
      lt.TierCode as MinTierCode,
      si.StockQuantity,
      si.UnlimitedStock,
      si.ExpiresAfterDays,
      si.ImageUrl,
      si.BadgeText,
      si.IsFeatured,
      si.IsActive,
      si.SortOrder,
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.IsActive = 1
      AND (si.SalonID IS NULL OR si.SalonID = @salonId)
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await db
    .request()
    .input("salonId", sql.Int, salonId)
    .query<RawStoreItemFromDb>(query);

  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// Get Featured Store Items
// ============================================
export async function getFeaturedStoreItems(
  salonId: number | null = null,
): Promise<StoreItem[]> {
  const db = await getPool();

  const query = `
    SELECT TOP 6
      si.ItemID,
      si.CategoryID,
      si.SalonID,
      si.Code,
      si.NameAr,
      si.NameEn,
      si.DescriptionAr,
      si.DescriptionEn,
      si.ItemType,
      si.PriceCoins,
      si.Value,
      si.ServiceID,
      si.ProductID,
      si.MinTierID,
      lt.TierCode as MinTierCode,
      si.StockQuantity,
      si.UnlimitedStock,
      si.ExpiresAfterDays,
      si.ImageUrl,
      si.BadgeText,
      si.IsFeatured,
      si.IsActive,
      si.SortOrder,
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.IsFeatured = 1
      AND si.IsActive = 1
      AND (si.SalonID IS NULL OR si.SalonID = @salonId)
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await db
    .request()
    .input("salonId", sql.Int, salonId)
    .query<RawStoreItemFromDb>(query);

  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// Get Store Item by ID
// ============================================
export async function getStoreItemById(
  itemId: number,
): Promise<StoreItem | null> {
  if (!isValidItemId(itemId)) {
    throw new Error("Invalid item ID");
  }

  const db = await getPool();

  const query = `
    SELECT 
      si.ItemID,
      si.CategoryID,
      si.SalonID,
      si.Code,
      si.NameAr,
      si.NameEn,
      si.DescriptionAr,
      si.DescriptionEn,
      si.ItemType,
      si.PriceCoins,
      si.Value,
      si.ServiceID,
      si.ProductID,
      si.MinTierID,
      lt.TierCode as MinTierCode,
      si.StockQuantity,
      si.UnlimitedStock,
      si.ExpiresAfterDays,
      si.ImageUrl,
      si.BadgeText,
      si.IsFeatured,
      si.IsActive,
      si.SortOrder,
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.ItemID = @itemId
  `;

  const result = await db
    .request()
    .input("itemId", sql.Int, itemId)
    .query<RawStoreItemFromDb>(query);

  if (result.recordset.length === 0) {
    return null;
  }

  return mapDbStoreItemToApi(result.recordset[0]);
}

// ============================================
// Get Client Balance (from TblClientLoyalty)
// ============================================
export async function getClientBalance(clientId: number): Promise<number> {
  if (!isValidClientId(clientId)) {
    throw new Error("Invalid client ID");
  }

  const db = await getPool();

  const query = `
    SELECT PointsBalance
    FROM [dbo].[TblClientLoyalty]
    WHERE ClientID = @clientId
  `;

  const result = await db
    .request()
    .input("clientId", sql.Int, clientId)
    .query(query);

  if (result.recordset.length === 0) {
    return 0;
  }

  return result.recordset[0].PointsBalance || 0;
}

// ============================================
// Get Client Tier Code
// ============================================
export async function getClientTierCode(clientId: number): Promise<string> {
  if (!isValidClientId(clientId)) {
    throw new Error("Invalid client ID");
  }

  const db = await getPool();

  const query = `
    SELECT lt.TierCode
    FROM [dbo].[TblClientLoyalty] cl
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
    WHERE cl.ClientID = @clientId
  `;

  const result = await db
    .request()
    .input("clientId", sql.Int, clientId)
    .query(query);

  if (result.recordset.length === 0) {
    return "BRONZE";
  }

  return result.recordset[0].TierCode || "BRONZE";
}

// ============================================
// Add Status to Store Items (for client)
// ============================================
export async function addStatusToStoreItems(
  items: StoreItem[],
  clientId: number,
): Promise<StoreItemWithStatus[]> {
  const balance = await getClientBalance(clientId);
  const tierCode = await getClientTierCode(clientId);

  return items.map((item) => addStatusToStoreItem(item, balance, tierCode));
}

// ============================================
// Purchase Store Item
// ============================================
export async function purchaseStoreItem(
  clientId: number,
  itemId: number,
): Promise<{
  success: boolean;
  inventoryId?: number;
  voucherCode?: string;
  expiresAt?: Date | null;
  error?: string;
}> {
  if (!isValidClientId(clientId)) {
    return { success: false, error: "Invalid client ID" };
  }

  if (!isValidItemId(itemId)) {
    return { success: false, error: "Invalid item ID" };
  }

  const db = await getPool();

  // Get item details
  const item = await getStoreItemById(itemId);
  if (!item) {
    return { success: false, error: "Item not found" };
  }

  // Get client balance and tier
  const balance = await getClientBalance(clientId);
  const tierCode = await getClientTierCode(clientId);

  // Validate purchase
  const validation = validatePurchase(item, balance, tierCode);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Start transaction
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    // Generate voucher code
    const voucherCode = generateVoucherCode(clientId, itemId);

    // Calculate expiry date
    const purchaseDate = new Date();
    const expiresAt = calculateExpiryDate(purchaseDate, item.expiresAfterDays);

    // Insert into inventory
    const inventoryReq = new sql.Request(transaction);
    const inventoryResult = await inventoryReq
      .input("clientId", sql.Int, clientId)
      .input("itemId", sql.Int, itemId)
      .input("quantity", sql.Int, 1)
      .input("status", sql.NVarChar(30), "ACTIVE")
      .input("purchasePriceCoins", sql.Decimal(18, 2), item.priceCoins)
      .input("voucherCode", sql.NVarChar(100), voucherCode)
      .input("purchasedAt", sql.DateTime, purchaseDate)
      .input("expiresAt", sql.DateTime, expiresAt).query(`
        INSERT INTO [dbo].[TblClientInventory] (
          ClientID, ItemID, Quantity, Status, PurchasePriceCoins,
          VoucherCode, PurchasedAt, ExpiresAt
        )
        OUTPUT INSERTED.InventoryID
        VALUES (
          @clientId, @itemId, @quantity, @status, @purchasePriceCoins,
          @voucherCode, @purchasedAt, @expiresAt
        )
      `);

    const inventoryId = inventoryResult.recordset[0].InventoryID;

    // Deduct coins from client balance
    const updateBalanceReq = new sql.Request(transaction);
    await updateBalanceReq
      .input("clientId", sql.Int, clientId)
      .input("amount", sql.Decimal(18, 2), item.priceCoins).query(`
        UPDATE [dbo].[TblClientLoyalty]
        SET PointsBalance = PointsBalance - @amount,
            UpdatedAt = GETDATE()
        WHERE ClientID = @clientId
      `);

    // Add ledger entry
    const idempotencyKey = `STORE-${clientId}-${itemId}-${Date.now()}`;
    const ledgerReq = new sql.Request(transaction);
    await ledgerReq
      .input("clientId", sql.Int, clientId)
      .input("movementType", sql.NVarChar(20), "STORE_PURCHASE")
      .input("pointsDelta", sql.Decimal(10, 2), -item.priceCoins)
      .input("pointsBefore", sql.Decimal(10, 2), balance)
      .input("pointsAfter", sql.Decimal(10, 2), balance - item.priceCoins)
      .input("notes", sql.NVarChar(500), `Store purchase: ${item.nameAr}`)
      .input("idempotencyKey", sql.NVarChar(100), idempotencyKey)
      .query(`
        INSERT INTO [dbo].[TblLoyaltyPointLedger] (
          ClientID, ClientLoyaltyID, MovementType, PointsDelta, PointsBefore, PointsAfter, Notes, IdempotencyKey, CreatedAt
        )
        SELECT 
          @clientId,
          ClientLoyaltyID,
          @movementType,
          @pointsDelta,
          @pointsBefore,
          @pointsAfter,
          @notes,
          @idempotencyKey,
          GETDATE()
        FROM [dbo].[TblClientLoyalty]
        WHERE ClientID = @clientId
      `);

    // Update stock if not unlimited
    if (!item.unlimitedStock && item.stockQuantity !== null) {
      const updateStockReq = new sql.Request(transaction);
      await updateStockReq.input("itemId", sql.Int, itemId).query(`
        UPDATE [dbo].[TblLoyaltyStoreItem]
        SET StockQuantity = StockQuantity - 1,
            UpdatedAt = GETDATE()
        WHERE ItemID = @itemId AND StockQuantity > 0
      `);
    }

    await transaction.commit();

    return {
      success: true,
      inventoryId,
      voucherCode,
      expiresAt,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

// ============================================
// Decrease Stock Quantity
// ============================================
export async function decreaseStockQuantity(
  itemId: number,
  quantity: number = 1,
): Promise<void> {
  const db = await getPool();

  await db
    .request()
    .input("itemId", sql.Int, itemId)
    .input("quantity", sql.Int, quantity).query(`
    UPDATE [dbo].[TblLoyaltyStoreItem]
    SET StockQuantity = StockQuantity - @quantity,
        UpdatedAt = GETDATE()
    WHERE ItemID = @itemId 
      AND UnlimitedStock = 0 
      AND StockQuantity >= @quantity
  `);
}
